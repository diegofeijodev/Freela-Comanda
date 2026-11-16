import { createHash, X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dataBrSp } from '../../../common/time/dates';
import { abrirPfx, lerCamposX509, type PfxAberto } from '../pkcs12.adapter';

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
