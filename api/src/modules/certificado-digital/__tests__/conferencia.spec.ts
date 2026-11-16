import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { type CadeiaIcp, montarCadeia } from '../cadeia';
import { conferirCertificado, escolherFolha, tipoDaPolitica } from '../conferencia';
import { abrirPfx } from '../pkcs12.adapter';

const fx = (nome: string): Buffer => readFileSync(join(__dirname, 'fixtures', nome));
const SENHA = 'senha-de-teste';
const AGORA = new Date('2027-06-01T12:00:00Z');
const EMPRESA = '12.345.678/0001-95';
const RAIZ = new X509Certificate(fx('raiz-teste.pem'));
const INTER = abrirPfx(fx('valido.pfx'), SENHA).certificados.find(
  (c) => c.ca && /AC Intermediaria de Teste/.test(c.subject),
) as X509Certificate;
const ICP: CadeiaIcp = { ancoras: [RAIZ], pacote: [] };

const conferir = (nome: string, extra: Partial<Parameters<typeof conferirCertificado>[0]> = {}) =>
  conferirCertificado({ arquivo: fx(nome), senha: SENHA, cnpjEmpresa: EMPRESA, agora: AGORA, icp: ICP, ...extra });
const recusa = (nome: string, extra: Partial<Parameters<typeof conferirCertificado>[0]> = {}) => {
  try {
    conferir(nome, extra);
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('não recusou');
};

describe('conferirCertificado', () => {
  it('valido: todos os campos', () => {
    const r = conferir('valido.pfx');
    expect(r).toMatchObject({
      cnpj: '12345678000195',
      cnpjConfere: 'igual',
      tipo: 'A1',
      politicaOid: '2.16.76.1.2.1.999',
      titular: 'EMPRESA DE TESTE LTDA',
      emissor: 'AC Intermediaria de Teste',
      cadeiaConferida: true,
    });
    expect(r.cadeia.map((c) => c.fingerprint256)).toEqual([INTER.fingerprint256]);
    expect(r.validoAte).toEqual(new Date('2036-01-01T00:00:00Z'));
    expect(r.impressaoDigital).toMatch(/^[0-9A-F]{64}$/);
    expect(r.folha.checkPrivateKey(r.chave)).toBe(true);
  });

  it('o legado dá a mesma impressão digital', () => {
    expect(conferir('legado.pfx').impressaoDigital).toBe(conferir('valido.pfx').impressaoDigital);
  });

  describe('CNPJ', () => {
    it('mesma raiz, outro estabelecimento: aceita com mesma_raiz', () => {
      expect(conferir('mesma-raiz-filial.pfx').cnpjConfere).toBe('mesma_raiz');
    });
    it('selo SE-S: CNPJ do serialNumber', () => {
      expect(conferir('selo-se-s.pfx')).toMatchObject({ tipo: 'SE-S', cnpj: '12345678000195' });
    });
    it('alfanumérico', () => {
      const r = conferir('cnpj-alfanumerico.pfx', { cnpjEmpresa: '12.ABC.345/01DE-35' });
      expect(r).toMatchObject({ cnpj: '12ABC34501DE35', cnpjConfere: 'igual' });
    });
    it('e-CPF = SEM_CNPJ', () => {
      expect(recusa('ecpf.pfx').code).toBe('CERTIFICADO_SEM_CNPJ');
    });
    it.each(['', '00.000.000/0001-00'])('empresa sem CNPJ válido (%j) = EMPRESA_SEM_CNPJ', (cnpjEmpresa) => {
      expect(recusa('valido.pfx', { cnpjEmpresa }).code).toBe('EMPRESA_SEM_CNPJ');
    });
    it('outro CNPJ: mensagem exata', () => {
      const e = recusa('outro-cnpj.pfx');
      expect(e.code).toBe('CERTIFICADO_OUTRO_CNPJ');
      expect(e.message).toBe(
        'Este certificado é do CNPJ 99.888.777/0001-00 (OUTRA EMPRESA SA). O CNPJ da empresa é 12.345.678/0001-95.',
      );
    });
  });

  describe('validade (dia de Brasília)', () => {
    it('vencido', () => {
      const e = recusa('vencido.pfx');
      expect(e.code).toBe('CERTIFICADO_VENCIDO');
      expect(e.message).toBe('Este certificado venceu em 31/12/2020. Envie o certificado renovado.');
    });
    it('ainda não vale', () => {
      const e = recusa('ainda-nao-vale.pfx');
      expect(e.code).toBe('CERTIFICADO_AINDA_NAO_VALE');
      expect(e.message).toBe('Este certificado só vale a partir de 31/12/2034.');
    });
    it('a validade vem antes do CNPJ', () => {
      expect(recusa('vencido.pfx', { cnpjEmpresa: '' }).code).toBe('CERTIFICADO_VENCIDO');
    });
  });

  it('política A3 é aceita com tipo "outro"', () => {
    expect(conferir('politica-a3.pfx')).toMatchObject({ tipo: 'outro', politicaOid: '2.16.76.1.2.3.999' });
  });

  describe('cadeia e ICP', () => {
    it.each([[[]], [[INTER]]])('cadeia-adulterada = CADEIA (pacote %#)', (pacote) => {
      expect(recusa('cadeia-adulterada.pfx', { icp: { ancoras: [RAIZ], pacote } }).code).toBe('CERTIFICADO_CADEIA');
    });
    it('fora da ICP = NAO_ICP', () => {
      expect(recusa('fora-da-icp.pfx').code).toBe('CERTIFICADO_NAO_ICP');
    });
    it('só o certificado final: sem pacote não fecha; com a intermediária no pacote fecha', () => {
      const sem = conferir('so-certificado-final.pfx');
      expect(sem.cadeiaConferida).toBe(false);
      expect(sem.cadeia).toEqual([]);
      const com = conferir('so-certificado-final.pfx', { icp: { ancoras: [RAIZ], pacote: [INTER] } });
      expect(com.cadeiaConferida).toBe(true);
      expect(com.cadeia.map((c) => c.fingerprint256)).toEqual([INTER.fingerprint256]);
    });
    it('sem âncoras: aceito com aviso, guardando a intermediária do .pfx', () => {
      const r = conferir('valido.pfx', { icp: { ancoras: [], pacote: [] } });
      expect(r.cadeiaConferida).toBe(false);
      expect(r.cadeia.map((c) => c.fingerprint256)).toEqual([INTER.fingerprint256]);
    });
  });

  it('senha errada e arquivo que não é certificado seguem as frases da Tarefa 2', () => {
    expect(recusa('valido.pfx', { senha: 'errada' }).code).toBe('CERTIFICADO_SENHA');
    expect(recusa('raiz-teste.pem').code).toBe('CERTIFICADO_ARQUIVO');
  });
});

describe('escolherFolha', () => {
  it('par trocado (chave de outro .pfx) = FORMATO', () => {
    const chaveOutro = abrirPfx(fx('outro-cnpj.pfx'), SENHA).chave;
    const certsValido = abrirPfx(fx('valido.pfx'), SENHA).certificados;
    expect(() => escolherFolha(chaveOutro, certsValido)).toThrow(expect.objectContaining({ code: 'CERTIFICADO_FORMATO' }));
  });
  it('acha a folha pelo par, não pela ordem', () => {
    const { chave, certificados } = abrirPfx(fx('valido.pfx'), SENHA);
    expect(escolherFolha(chave, [...certificados].reverse()).checkPrivateKey(chave)).toBe(true);
  });
});

describe('tipoDaPolitica', () => {
  it.each([
    [['2.16.76.1.2.1.999'], { tipo: 'A1', politicaOid: '2.16.76.1.2.1.999' }],
    [['2.16.76.1.2.201.7'], { tipo: 'SE-S', politicaOid: '2.16.76.1.2.201.7' }],
    [['1.2.3', '2.16.76.1.2.3.4'], { tipo: 'outro', politicaOid: '2.16.76.1.2.3.4' }],
    [['1.2.3'], { tipo: 'outro', politicaOid: '1.2.3' }],
    [[], { tipo: 'outro', politicaOid: null }],
  ])('%j', (politicas, esperado) => {
    expect(tipoDaPolitica(politicas)).toEqual(esperado);
  });
});

describe('montarCadeia: o que NÃO é adulteração', () => {
  const { certificados } = abrirPfx(fx('valido.pfx'), SENHA);
  const folha = certificados.find((c) => /EMPRESA DE TESTE/.test(c.subject)) as X509Certificate;

  it('emissor vencido dentro do arquivo = não conferida (não recusa)', () => {
    const r = montarCadeia(folha, certificados, ICP, new Date('2041-01-01T12:00:00Z'));
    expect(r.situacao).toBe('nao_fechou');
  });

  it('emissor de chave ilegível (caso da raiz v7) é descartado, sem recusa', () => {
    const ilegivel = {
      subject: folha.issuer,
      issuer: 'CN=Raiz v7',
      raw: Buffer.from('emissor-ilegivel'),
      ca: true,
      validFrom: INTER.validFrom,
      validTo: INTER.validTo,
      get publicKey(): never {
        throw new Error('chave não suportada');
      },
    } as unknown as X509Certificate;
    expect(montarCadeia(folha, [folha, ilegivel], ICP, AGORA).situacao).toBe('nao_fechou');
  });

  it('assinatura refutada com chave legível continua sendo adulteração', () => {
    const adult = abrirPfx(fx('cadeia-adulterada.pfx'), SENHA).certificados;
    const f = adult.find((c) => /EMPRESA DE TESTE/.test(c.subject)) as X509Certificate;
    expect(montarCadeia(f, adult, ICP, AGORA).situacao).toBe('adulterada');
  });

  // certificados de mentira: só o que `montarCadeia` lê; `verify` sempre confirma, para o pior caso de ramificação
  const falso = (i: number, subject: string, issuer: string) =>
    ({
      subject,
      issuer,
      raw: Buffer.from(`falso-${i}-${subject}-${issuer}`),
      ca: true,
      validFrom: INTER.validFrom,
      validTo: INTER.validTo,
      publicKey: {},
      verify: () => true,
    }) as unknown as X509Certificate;

  it('ciclo entre ACs termina rápido, não conferida', () => {
    const cs = Array.from({ length: 6 }, (_, i) => falso(i, `CN=ac${i}`, `CN=ac${(i + 1) % 6}`));
    const f = falso(99, 'CN=folha', 'CN=ac0');
    const t = Date.now();
    expect(montarCadeia(f, [f, ...cs], ICP, AGORA).situacao).toBe('nao_fechou');
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('cadeia longa passa da profundidade máxima: não conferida, sem exceção', () => {
    const cs = Array.from({ length: 12 }, (_, i) => falso(i, `CN=ac${i}`, `CN=ac${i + 1}`));
    const f = falso(99, 'CN=folha', 'CN=ac0');
    expect(montarCadeia(f, [f, ...cs], ICP, AGORA).situacao).toBe('nao_fechou');
  });

  it('muitas ACs com o mesmo nome: a busca visita cada uma uma vez só', () => {
    const cs = Array.from({ length: 150 }, (_, i) => falso(i, 'CN=x', 'CN=x'));
    const f = falso(99, 'CN=folha', 'CN=x');
    const t = Date.now();
    expect(montarCadeia(f, [f, ...cs], ICP, AGORA).situacao).toBe('nao_fechou');
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
