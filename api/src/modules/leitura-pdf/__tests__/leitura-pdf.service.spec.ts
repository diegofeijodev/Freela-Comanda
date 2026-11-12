import { ClaudeLeitorPdf } from '../claude-leitor-pdf';
import { LeituraPdfErro, MSG, type LeitorPdf, type PedidoLeitura } from '../leitor-pdf.port';
import { iso, LeituraPdfService } from '../leitura-pdf.service';
import { SCHEMA_DDA, SCHEMA_NOTA } from '../schemas';

/** Leitor falso: nenhum teste faz rede. Guarda o pedido para conferir esquema/instruções. */
class LeitorFalso implements LeitorPdf {
  pedidos: PedidoLeitura[] = [];
  constructor(private readonly resposta: unknown) {}
  configurado() {
    return true;
  }
  async ler(p: PedidoLeitura) {
    this.pedidos.push(p);
    return this.resposta;
  }
}

describe('leitura de PDF', () => {
  it('nota: usa o esquema do protótipo e corrige datas dd/mm/aaaa', async () => {
    const leitor = new LeitorFalso({
      chave: null,
      numero: '1',
      serie: '1',
      emitente_nome: 'X',
      emitente_cnpj: null,
      data_emissao: '20/10/2026',
      valor_total: 10,
      forma_pagamento: 'boleto',
      itens: [{ codigo: null, descricao: 'A', unidade: 'UN', quantidade: 1, valor_unitario: 10, valor_total: 10 }],
      parcelas: [{ numero: '1', vencimento: '20/11/2026', valor: 10 }],
    });
    const r = await new LeituraPdfService(leitor).lerNota('JVBERi0=', 'nf.pdf');
    expect(r.data_emissao).toBe('2026-10-20');
    expect(r.parcelas).toEqual([{ numero: '1', vencimento: '2026-11-20', valor: 10 }]);
    expect(leitor.pedidos[0]!.schema).toBe(SCHEMA_NOTA);
    expect(leitor.pedidos[0]!.nomeArquivo).toBe('nf.pdf');
  });

  it('DDA: devolve a lista de boletos', async () => {
    const leitor = new LeitorFalso({ boletos: [{ beneficiario: 'B', cnpj: null, vencimento: '2026-11-10T00:00', valor: 5, linha_digitavel: null }] });
    const r = await new LeituraPdfService(leitor).lerDDA('JVBERi0=', '');
    expect(r).toEqual([{ beneficiario: 'B', cnpj: null, vencimento: '2026-11-10', valor: 5, linha_digitavel: null }]);
    expect(leitor.pedidos[0]!.schema).toBe(SCHEMA_DDA);
    expect(leitor.pedidos[0]!.nomeArquivo).toBe('dda.pdf');
  });

  it('resposta sem itens vira a mensagem de PDF ilegível', async () => {
    await expect(new LeituraPdfService(new LeitorFalso({ foo: 1 })).lerNota('x', 'a.pdf')).rejects.toThrow(
      'Não consegui identificar os dados deste PDF.',
    );
  });

  it('sem chave: "Leitura de PDF não configurada" sem chamar a rede', async () => {
    const leitor = new ClaudeLeitorPdf('', 'claude-opus-5-5');
    expect(leitor.configurado()).toBe(false);
    await expect(leitor.ler({} as PedidoLeitura)).rejects.toEqual(new LeituraPdfErro(MSG.naoConfigurada, 503, 'PDF_NAO_CONFIGURADO'));
  });

  it('iso do protótipo', () => {
    expect(iso('05/03/2026')).toBe('2026-03-05');
    expect(iso('2026-03-05T10:00:00')).toBe('2026-03-05');
    expect(iso(null)).toBe('');
  });
});
