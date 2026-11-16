import { createHash, X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dataBrSp } from '../../../common/time/dates';
import * as forge from 'node-forge';
import { abrirPfx, lerCamposX509, macConfere, type PfxAberto } from '../pkcs12.adapter';

const fx = (nome: string): Buffer => readFileSync(join(__dirname, 'fixtures', nome));
const SENHA = 'senha-de-teste';
const ACENTUADA = 'açaí-de-teste';
const sha = (c: X509Certificate) => createHash('sha256').update(c.raw).digest('hex');
const folhaDe = (p: PfxAberto) => p.certificados.find((c) => c.checkPrivateKey(p.chave)) as X509Certificate;

describe('abrirPfx', () => {
  const valido = abrirPfx(fx('valido.pfx'), SENHA);
  const INTER = valido.certificados.find((c) => c.ca && /AC Intermediaria de Teste/.test(c.subject)) as X509Certificate;

  it('abre o .pfx moderno (PBES2): chave RSA e 3 certificados', () => {
    expect(valido.chave.asymmetricKeyType).toBe('rsa');
    expect(valido.certificados).toHaveLength(3);
    expect(folhaDe(valido)).toBeDefined();
  });

  it('abre o .pfx legado (RC2/3DES) com a mesma folha', () => {
    const legado = abrirPfx(fx('legado.pfx'), SENHA);
    expect(sha(folhaDe(legado))).toBe(sha(folhaDe(valido)));
  });

  it.each(['senha-acentuada.pfx', 'senha-acentuada-legado.pfx'])('%s abre com senha acentuada', (nome) => {
    const p = abrirPfx(fx(nome), ACENTUADA);
    expect(sha(folhaDe(p))).toBe(sha(folhaDe(valido)));
  });

  it.each(['senha-acentuada.pfx', 'senha-acentuada-legado.pfx'])('%s com senha acentuada errada = SENHA', (nome) => {
    expect(() => abrirPfx(fx(nome), 'açaí-errada')).toThrow(expect.objectContaining({ code: 'CERTIFICADO_SENHA' }));
  });

  it.each(['valido.pfx', 'legado.pfx'])('%s com senha errada = SENHA, sem vazar a senha', (nome) => {
    let erro: unknown;
    try {
      abrirPfx(fx(nome), 'errada');
    } catch (e) {
      erro = e;
    }
    expect(erro).toMatchObject({ code: 'CERTIFICADO_SENHA' });
    expect(String(erro)).not.toContain('errada');
  });

  it('sem-chave.p12 = SEM_CHAVE', () => {
    expect(() => abrirPfx(fx('sem-chave.p12'), SENHA)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_SEM_CHAVE' }));
  });

  it.each([
    ['PDF', Buffer.from('%PDF-1.4 x')],
    ['PEM', fx('raiz-teste.pem')],
  ])('%s = ARQUIVO', (_n, buf) => {
    expect(() => abrirPfx(buf, SENHA)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_ARQUIVO' }));
  });

  it.each([
    ['senha certa', SENHA],
    ['senha errada', 'errada'],
    ['senha acentuada', ACENTUADA],
  ])('.pfx sem MAC (%s) = FORMATO, antes de qualquer senha', (_n, senha) => {
    expect(() => abrirPfx(fx('sem-mac.pfx'), senha)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_FORMATO' }));
  });

  it('arquivo truncado (perdeu o bloco de MAC) = ARQUIVO ou FORMATO, nunca SENHA', () => {
    const inteiro = fx('valido.pfx');
    // (cortar só o fim, no meio do HMAC, é indistinguível de senha errada no PKCS#12: dá SENHA, e é aceito)
    for (const corte of [20, 200, Math.floor(inteiro.length / 2)]) {
      expect(() => abrirPfx(inteiro.subarray(0, corte), SENHA)).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^CERTIFICADO_(ARQUIVO|FORMATO)$/) }),
      );
    }
  });

  it('arquivo adulterado (um byte do CONTEÚDO) com a senha acentuada certa = SENHA, pois o MAC não confere', () => {
    const b = Buffer.from(fx('senha-acentuada.pfx'));
    b[300] ^= 0xff; // dentro do authSafe, longe do salt/digest do macData
    expect(() => abrirPfx(b, ACENTUADA)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_SENHA' }));
  });

  it('OID do algoritmo do MAC forjado (FF×8 01) com senha acentuada certa = FORMATO, nunca abre', () => {
    const b = Buffer.from(fx('senha-acentuada.pfx'));
    const oidSha256 = Buffer.from('608648016503040201', 'hex');
    const i = b.lastIndexOf(oidSha256);
    expect(i).toBeGreaterThan(4000); // o do macData, no fim do arquivo
    Buffer.from('ffffffffffffffff01', 'hex').copy(b, i);
    expect(() => abrirPfx(b, ACENTUADA)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_FORMATO' }));
    expect(() => abrirPfx(b, 'errada')).toThrow(expect.objectContaining({ code: 'CERTIFICADO_FORMATO' }));
  });

  it('.pfx com mais de 20 certificados (21) = FORMATO', () => {
    expect(() => abrirPfx(fx('muitos-certificados.pfx'), SENHA)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_FORMATO' }));
  });

  it('iterações do MAC acima do teto = FORMATO, sem demorar', () => {
    const raiz = forge.asn1.fromDer(fx('valido.pfx').toString('binary'), false);
    const macData = (raiz.value as forge.asn1.Asn1[])[2];
    (macData.value as forge.asn1.Asn1[])[2].value = '\x0f\x42\x41'; // 1.000.001
    const b = Buffer.from(forge.asn1.toDer(raiz).getBytes(), 'binary');
    const t = Date.now();
    expect(() => abrirPfx(b, SENHA)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_FORMATO' }));
    expect(Date.now() - t).toBeLessThan(2000);
  });

  describe('macConfere', () => {
    const arquivos = readdirSync(join(__dirname, 'fixtures')).filter((n) => /\.(pfx|p12)$/.test(n) && n !== 'sem-mac.pfx');
    it('há arquivos com MAC para conferir', () => {
      expect(arquivos.length).toBeGreaterThanOrEqual(16);
    });
    it.each(arquivos)('%s: senha certa = true, errada = false', (nome) => {
      const raiz = forge.asn1.fromDer(fx(nome).toString('binary'), false);
      const certa = nome.startsWith('senha-acentuada') ? ACENTUADA : SENHA;
      expect(macConfere(raiz, certa)).toBe(true);
      expect(macConfere(raiz, 'errada')).toBe(false);
    });
  });

  describe('lerCamposX509', () => {
    const campos = (nome: string) => lerCamposX509(folhaDe(abrirPfx(fx(nome), SENHA)).raw);

    it('folha do valido', () => {
      expect(campos('valido.pfx')).toEqual({
        cnpjSan: '12345678000195',
        cnSujeito: 'EMPRESA DE TESTE LTDA:12345678000195',
        orgEmissor: 'ICP-Brasil',
        cnEmissor: 'AC Intermediaria de Teste',
        politicas: ['2.16.76.1.2.1.999'],
        serialNumberSujeito: null,
      });
    });
    it('SAN em PrintableString', () => {
      expect(campos('mesma-raiz-filial.pfx').cnpjSan).toBe('12345678000276');
    });
    it('selo SE-S: sem SAN, CNPJ no serialNumber', () => {
      expect(campos('selo-se-s.pfx')).toMatchObject({
        cnpjSan: null,
        serialNumberSujeito: '12345678000195',
        politicas: ['2.16.76.1.2.201.999'],
      });
    });
    it('CNPJ alfanumérico', () => {
      expect(campos('cnpj-alfanumerico.pfx').cnpjSan).toBe('12ABC34501DE35');
    });
    it('certificado malformado = FORMATO, nunca erro cru', () => {
      const der = folhaDe(abrirPfx(fx('valido.pfx'), SENHA)).raw;
      const malformados = [Buffer.from('lixo'), Buffer.alloc(0), der.subarray(0, 40), Buffer.concat([der.subarray(0, 12), Buffer.alloc(30, 0xff)])];
      for (const b of malformados) {
        expect(() => lerCamposX509(b)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_FORMATO' }));
      }
    });
  });

  it('a reserialização do forge devolve os mesmos bytes (raiz e cadeia verificam)', () => {
    const raiz = valido.certificados.find((c) => c.subject.includes('AC Raiz de Teste')) as X509Certificate;
    expect(raiz.fingerprint256).toBe(new X509Certificate(fx('raiz-teste.pem')).fingerprint256);
    expect(INTER.ca).toBe(true);
    expect(folhaDe(valido).verify(INTER.publicKey)).toBe(true);
    expect(INTER.verify(raiz.publicKey)).toBe(true);
  });
});

describe('dataBrSp', () => {
  it('usa o dia de Brasília', () => {
    expect(dataBrSp(new Date('2027-03-10T02:59:59Z'))).toBe('09/03/2027');
  });
});

describe('fitness: node-forge só no adapter', () => {
  it('nenhum outro arquivo de src importa o node-forge', () => {
    const src = join(__dirname, '..', '..', '..');
    const achados: string[] = [];
    const varre = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== '__tests__' && n !== 'node_modules') varre(p);
        } else if (n.endsWith('.ts') && readFileSync(p, 'utf8').includes("from 'node-forge'")) {
          achados.push(p.slice(src.length + 1));
        }
      }
    };
    varre(src);
    expect(achados).toEqual(['modules/certificado-digital/pkcs12.adapter.ts']);
  });
});
