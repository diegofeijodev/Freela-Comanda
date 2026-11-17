import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XmlInvalido } from '../../sefaz/xml-leitura';
import {
  aplicarNaCaixa,
  chaveDoDocumento,
  classificar,
  tipoDoSchema,
  type Classificacao,
  type LinhaCaixa,
  type TipoDocumento,
} from '../classificacao';

const fx = (nome: string) => readFileSync(join(__dirname, '../../sefaz/__tests__/fixtures', nome), 'utf8');
const NOSSO = '12345678000195';
const VETOR = '35261112ABC34501DE35550010000044111000044116';
const K880 = '35261111222333000181550010000008801000000887';
const K77 = '35261111222333000181550010000000771000000071';
const BASE = { ambiente: 'producao' as const, cnpj_destinatario: NOSSO };

const doc = (tipo: TipoDocumento, xml: string | null) => ({ tipo, xml });

function linha(extra: Partial<LinhaCaixa> = {}): LinhaCaixa {
  return {
    ambiente: 'producao',
    cnpj_destinatario: NOSSO,
    chave: K880,
    emitente_cnpj: '11222333000181',
    emitente_nome: 'DISTRIB. BEBIDAS TESTE',
    numero: '880',
    serie: '1',
    emitida_em: null,
    autorizada_em: null,
    valor_total: '890.00',
    tp_nf: 1,
    fin_nfe: null,
    nat_op: null,
    situacao_sefaz: 'autorizada',
    cancelada_em: null,
    resumo_id: 'r0',
    documento_completo_id: null,
    ...extra,
  };
}

describe('tipoDoSchema', () => {
  it('usa o prefixo antes de "_v"', () => {
    expect(tipoDoSchema('resNFe_v1.01.xsd')).toBe('resNFe');
    expect(tipoDoSchema('procNFe_v4.00.xsd')).toBe('procNFe');
    expect(tipoDoSchema('resEvento_v1.01.xsd')).toBe('resEvento');
    expect(tipoDoSchema('procEventoNFe_v1.00.xsd')).toBe('procEventoNFe');
    expect(tipoDoSchema('resCTe_v1.00.xsd')).toBe('outro');
  });
});

describe('classificar + aplicarNaCaixa', () => {
  it('resNFe cria a linha com os dados do resumo', () => {
    const c = classificar(doc('resNFe', fx('res-nfe.xml')), NOSSO);
    expect(c.tipo).toBe('resumo');
    const r = aplicarNaCaixa(null, c, 'd1', BASE);
    expect(r).toEqual({
      criar: expect.objectContaining({
        ambiente: 'producao',
        cnpj_destinatario: NOSSO,
        chave: VETOR,
        numero: '4411',
        serie: '1',
        emitente_cnpj: '12ABC34501DE35',
        emitente_nome: 'ATACADAO TESTE S.A.',
        valor_total: '1234.56',
        tp_nf: 1,
        situacao_sefaz: 'autorizada',
        resumo_id: 'd1',
        documento_completo_id: null,
        cancelada_em: null,
      }),
    });
    const l = (r as { criar: LinhaCaixa }).criar;
    expect(l.emitida_em?.toISOString()).toBe('2026-11-14T13:00:00.000Z');
    expect(l.autorizada_em?.toISOString()).toBe('2026-11-14T13:00:05.000Z');
  });

  it('resNFe com cSitNFe 2 e 3 vira denegada e cancelada', () => {
    const x = fx('res-nfe.xml');
    const den = classificar(doc('resNFe', x.replace('<cSitNFe>1<', '<cSitNFe>2<')), NOSSO);
    const can = classificar(doc('resNFe', x.replace('<cSitNFe>1<', '<cSitNFe>3<')), NOSSO);
    expect((den as { dados: { situacao_sefaz: string } }).dados.situacao_sefaz).toBe('denegada');
    expect((can as { dados: { situacao_sefaz: string } }).dados.situacao_sefaz).toBe('cancelada');
  });

  it('resNFe de emitente pessoa física usa o CPF', () => {
    const x = fx('res-nfe.xml').replace('<CNPJ>12ABC34501DE35</CNPJ>', '<CPF>12345678909</CPF>');
    const c = classificar(doc('resNFe', x), NOSSO);
    expect((c as { dados: { emitente_cnpj: string } }).dados.emitente_cnpj).toBe('12345678909');
  });

  it('procNFe sobre linha existente só anexa o completo', () => {
    const c = classificar(doc('procNFe', fx('proc-nfe.xml')), NOSSO);
    expect(c.tipo).toBe('completo');
    expect(aplicarNaCaixa(linha(), c, 'd1', BASE)).toEqual({ atualizar: { documento_completo_id: 'd1', fin_nfe: 1, nat_op: 'VENDA' } });
  });

  it('procNFe sem linha cria a linha com o documento completo', () => {
    const c = classificar(doc('procNFe', fx('proc-nfe.xml')), NOSSO);
    const r = aplicarNaCaixa(null, c, 'd1', BASE) as { criar: LinhaCaixa };
    expect(r.criar).toMatchObject({
      chave: K880,
      numero: '880',
      serie: '1',
      emitente_cnpj: '11222333000181',
      emitente_nome: 'DISTRIB. BEBIDAS TESTE',
      valor_total: '890.00',
      tp_nf: 1,
      fin_nfe: 1,
      nat_op: 'VENDA',
      situacao_sefaz: 'autorizada',
      documento_completo_id: 'd1',
      resumo_id: null,
    });
  });

  it('procNFe com cStat 110 ou 301–306 vira denegada', () => {
    for (const cs of ['110', '301', '306']) {
      const c = classificar(doc('procNFe', fx('proc-nfe.xml').replace('<cStat>100<', `<cStat>${cs}<`)), NOSSO);
      expect((c as { dados: { situacao_sefaz: string } }).dados.situacao_sefaz).toBe('denegada');
    }
  });

  it('procNFe com destinatário de outro CNPJ: nao_destinatario e nada a gravar', () => {
    const x = fx('proc-nfe.xml').replace('<CNPJ>12345678000195</CNPJ>', '<CNPJ>99888777000100</CNPJ>');
    const c = classificar(doc('procNFe', x), NOSSO);
    expect(c).toEqual({ tipo: 'nao_destinatario', chave: K880 });
    expect(aplicarNaCaixa(null, c, 'd1', BASE)).toBeNull();
    expect(aplicarNaCaixa(linha(), c, 'd1', BASE)).toBeNull();
  });

  it('procNFe sem destinatário também é nao_destinatario', () => {
    const x = fx('proc-nfe.xml').replace(/<dest>.*<\/dest>/, '');
    expect(classificar(doc('procNFe', x), NOSSO).tipo).toBe('nao_destinatario');
  });

  it('cancelamento 110111 (resEvento) depois do resumo atualiza a situação', () => {
    const c = classificar(doc('resEvento', fx('res-evento-110111.xml')), NOSSO);
    expect(c.tipo).toBe('cancelamento');
    const r = aplicarNaCaixa(linha({ chave: K77 }), c, 'd2', BASE) as { atualizar: Partial<LinhaCaixa> };
    expect(r.atualizar.situacao_sefaz).toBe('cancelada');
    expect(r.atualizar.cancelada_em?.toISOString()).toBe('2026-11-16T12:00:00.000Z');
  });

  it('cancelamento sem resumo cria a linha a partir da chave', () => {
    const c = classificar(doc('resEvento', fx('res-evento-110111.xml')), NOSSO);
    const r = aplicarNaCaixa(null, c, 'd2', BASE) as { criar: LinhaCaixa };
    expect(r.criar).toMatchObject({
      chave: K77,
      numero: '77',
      serie: '1',
      emitente_cnpj: '11222333000181',
      emitente_nome: '',
      valor_total: null,
      tp_nf: null,
      situacao_sefaz: 'cancelada',
    });
    expect(r.criar.cancelada_em?.toISOString()).toBe('2026-11-16T12:00:00.000Z');
  });

  it('procEventoNFe 110111 também cancela', () => {
    const c = classificar(doc('procEventoNFe', fx('proc-evento-110111.xml')), NOSSO);
    expect(c).toMatchObject({ tipo: 'cancelamento', chave: '35261111222333000181550010000001201000000120' });
    expect((c as { cancelada_em: Date }).cancelada_em.toISOString()).toBe('2026-11-16T13:00:00.000Z');
  });

  it('resumo depois do cancelamento não volta a situação para autorizada', () => {
    const c = classificar(doc('resNFe', fx('res-nfe.xml')), NOSSO);
    const r = aplicarNaCaixa(linha({ chave: VETOR, situacao_sefaz: 'cancelada' }), c, 'd3', BASE) as { atualizar: Partial<LinhaCaixa> };
    expect(r.atualizar).not.toHaveProperty('situacao_sefaz');
    expect(r.atualizar.resumo_id).toBe('d3');
  });

  it('resumo sobre linha autorizada atualiza a situação', () => {
    const c = classificar(doc('resNFe', fx('res-nfe.xml')), NOSSO);
    const r = aplicarNaCaixa(linha({ chave: VETOR }), c, 'd3', BASE) as { atualizar: Partial<LinhaCaixa> };
    expect(r.atualizar.situacao_sefaz).toBe('autorizada');
  });

  it('outro evento (210210): nada para gravar, mas guarda chave e tipo', () => {
    const x = fx('res-evento-110111.xml').replace('<tpEvento>110111<', '<tpEvento>210210<');
    const c = classificar(doc('resEvento', x), NOSSO);
    expect(c).toEqual({ tipo: 'outro_evento', chave: K77, tp_evento: '210210' });
    expect(aplicarNaCaixa(null, c, 'd1', BASE)).toBeNull();
    expect(chaveDoDocumento(c)).toEqual({ chave: K77, tp_evento: '210210' });
  });

  it('XML com DOCTYPE lança XmlInvalido', () => {
    const x = '<!DOCTYPE a [<!ENTITY x "y">]>' + fx('res-nfe.xml');
    expect(() => classificar(doc('resNFe', x), NOSSO)).toThrow(XmlInvalido);
  });

  it('chave com DV errado lança', () => {
    const x = fx('res-nfe.xml').replace(VETOR, VETOR.slice(0, 43) + '1');
    expect(() => classificar(doc('resNFe', x), NOSSO)).toThrow();
  });

  it('outro e ilegível, ou sem XML: sem_uso', () => {
    expect(classificar(doc('outro', '<a/>'), NOSSO)).toEqual({ tipo: 'sem_uso' });
    expect(classificar(doc('ilegivel', null), NOSSO)).toEqual({ tipo: 'sem_uso' });
    expect(classificar(doc('resNFe', null), NOSSO)).toEqual({ tipo: 'sem_uso' });
    expect(chaveDoDocumento({ tipo: 'sem_uso' })).toEqual({ chave: null, tp_evento: null });
  });

  it('chaveDoDocumento por tipo', () => {
    const c: Classificacao = classificar(doc('resNFe', fx('res-nfe.xml')), NOSSO);
    expect(chaveDoDocumento(c)).toEqual({ chave: VETOR, tp_evento: null });
    const k = classificar(doc('resEvento', fx('res-evento-110111.xml')), NOSSO);
    expect(chaveDoDocumento(k)).toEqual({ chave: K77, tp_evento: '110111' });
  });
});
