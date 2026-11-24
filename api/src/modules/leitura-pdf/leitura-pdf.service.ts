import { Inject, Injectable } from '@nestjs/common';
import { chaveValida, normalizarChave } from '../../common/fiscal/chave-acesso';
import { documentoLidoPelaIa } from '../../common/fiscal/cnpj';
import { isDateString } from '../../common/time/dates';
import { PrismaService } from '../../common/database/prisma.service';
import { LEITOR_PDF, LeituraPdfErro, type ArquivoLeitura, type LeitorPdf } from './leitor-pdf.port';
import { limparRelatorioVendas } from './relatorio-vendas';
import {
  INSTRUCOES_DDA,
  INSTRUCOES_NOTA_SUGESTAO,
  INSTRUCOES_RELATORIO_VENDAS,
  INSTRUCOES_SUGESTAO_ITENS,
  SCHEMA_DDA,
  SCHEMA_NOTA_SUGESTAO,
  SCHEMA_RELATORIO_VENDAS,
  SCHEMA_SUGESTAO_ITENS,
} from './schemas';
import { casarPorIndice, limparItens, linhasNumeradas, textoCatalogo, type ItemIa } from './sugestao-insumo';

/** dd/mm/aaaa → aaaa-mm-dd; o resto corta em 10 caracteres (o `iso` do protótipo). */
export const iso = (d: string | null | undefined): string => {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (d ?? '').slice(0, 10);
};

/** `iso` que só devolve dia real AAAA-MM-DD; texto ilegível ou data impossível vira ''. */
const diaValido = (d: string | null | undefined): string => {
  const v = iso(d);
  return isDateString(v) ? v : '';
};

/** Chave de acesso: maiúsculas, só `[0-9A-Z]`, e só se for válida (44 caracteres e DV conferido); senão null. */
const chave44 = (c: unknown): string | null => {
  const n = typeof c === 'string' ? normalizarChave(c) : '';
  return chaveValida(n) ? n : null;
};

type NotaLida = {
  data_emissao: string;
  parcelas?: { vencimento: string }[];
  itens?: ItemIa[];
  [k: string]: unknown;
};
type Boleto = { vencimento: string; [k: string]: unknown };

const ilegivel = (o: string, de = 'PDF') => new LeituraPdfErro(`Não consegui identificar ${o} ${de === 'PDF' ? 'deste PDF' : 'desta foto'}.`, 422, 'PDF_ILEGIVEL');

@Injectable()
export class LeituraPdfService {
  constructor(
    @Inject(LEITOR_PDF) private readonly leitor: LeitorPdf,
    private readonly prisma: PrismaService,
  ) {}

  /** Nota em PDF (1 arquivo) ou foto (1 a 4 imagens). A IA recebe o estoque e indica o insumo de cada item. */
  async lerNota(arquivos: ArquivoLeitura[]) {
    const [insumos, subs] = await Promise.all([
      this.prisma.itens_estoque.findMany({ where: { ativo: true }, select: { id: true, nome: true, unidade: true }, orderBy: { nome: 'asc' } }),
      this.prisma.subgrupos.findMany({ select: { nome: true }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] }),
    ]);
    const subgrupos = subs.map((s) => s.nome);
    const r = (await this.leitor.ler({
      arquivos,
      instrucoes: INSTRUCOES_NOTA_SUGESTAO,
      pedido: `Extraia os dados desta nota fiscal.\n\n${textoCatalogo(insumos, subgrupos)}`,
      schema: SCHEMA_NOTA_SUGESTAO,
    })) as NotaLida | null;
    if (!r || typeof r !== 'object' || !Array.isArray(r.itens)) {
      throw ilegivel('os dados', arquivos.some((a) => a.mime === 'application/pdf') ? 'PDF' : 'foto');
    }
    r.data_emissao = diaValido(r.data_emissao);
    r.chave = chave44(r.chave);
    r.emitente_cnpj = typeof r.emitente_cnpj === 'string' ? documentoLidoPelaIa(r.emitente_cnpj) : null;
    r.parcelas = (r.parcelas ?? []).map((p) => ({ ...p, vencimento: diaValido(p.vencimento) }));
    return { ...r, itens: limparItens(r.itens, insumos, subgrupos) };
  }

  /**
   * Sugere o insumo de cada linha de uma nota XML sem vínculo salvo. Pedido só de texto: só descrição e unidade das linhas saem para a IA
   * (nunca o XML, CNPJ, valores nem dados do fornecedor). Devolve uma sugestão por linha, na mesma ordem.
   */
  async sugerirInsumos(itens: { descricao: string; unidade?: string | null }[]) {
    const [insumos, subs] = await Promise.all([
      this.prisma.itens_estoque.findMany({ where: { ativo: true }, select: { id: true, nome: true, unidade: true }, orderBy: { nome: 'asc' } }),
      this.prisma.subgrupos.findMany({ select: { nome: true }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] }),
    ]);
    const subgrupos = subs.map((s) => s.nome);
    const linhas = itens.map((i) => ({ descricao: i.descricao, unidade: i.unidade ?? null }));
    const r = (await this.leitor.ler({
      arquivos: [],
      instrucoes: INSTRUCOES_SUGESTAO_ITENS,
      pedido: `Indique o insumo do estoque de cada linha desta nota fiscal.\n\n${textoCatalogo(insumos, subgrupos)}\n\nLinhas da nota:\n${linhasNumeradas(linhas)}`,
      schema: SCHEMA_SUGESTAO_ITENS,
    })) as { itens?: unknown[] } | null;
    if (!r || typeof r !== 'object' || !Array.isArray(r.itens)) {
      throw new LeituraPdfErro('Não consegui sugerir os insumos desta nota.', 422, 'SUGESTAO_ILEGIVEL');
    }
    const casadas = casarPorIndice(r.itens, linhas.length);
    if (!casadas) throw new LeituraPdfErro('Não consegui usar a sugestão da IA para esta nota.', 422, 'SUGESTAO_ILEGIVEL');
    const juntos: ItemIa[] = linhas.map((l, i) => ({
      codigo: null,
      descricao: l.descricao,
      unidade: l.unidade,
      quantidade: 0,
      valor_unitario: 0,
      valor_total: 0,
      ...(casadas[i] ?? { insumo: null, novo_nome: null, novo_unidade: null, novo_subgrupo: null, fator: 1 }),
    }));
    return {
      itens: limparItens(juntos, insumos, subgrupos).map(({ item_estoque_id, novo, fator }) => ({ item_estoque_id, novo, fator })),
    };
  }

  /**
   * Relatório de vendas de outro sistema (importar vendas, A.6): só lê, nunca grava. Resposta que não é relatório (ou cortada, quando o
   * relatório é longo demais para a IA) = PDF_ILEGIVEL; a tela sugere exportar por dia ou em planilha.
   */
  async lerRelatorioVendas(pdfBase64: string, nome: string) {
    const r = await this.leitor.ler({
      arquivos: [{ base64: pdfBase64, mime: 'application/pdf', nome: nome || 'relatorio.pdf' }],
      instrucoes: INSTRUCOES_RELATORIO_VENDAS,
      pedido: 'Extraia as vendas deste relatório.',
      schema: SCHEMA_RELATORIO_VENDAS as unknown as Record<string, unknown>,
    });
    const limpo = limparRelatorioVendas(r);
    if (!limpo) throw ilegivel('as vendas');
    return limpo;
  }

  async lerDDA(pdfBase64: string, nome: string) {
    const r = (await this.leitor.ler({
      arquivos: [{ base64: pdfBase64, mime: 'application/pdf', nome: nome || 'dda.pdf' }],
      instrucoes: INSTRUCOES_DDA,
      pedido: 'Extraia os boletos deste DDA.',
      schema: SCHEMA_DDA,
    })) as { boletos?: Boleto[] } | null;
    if (!r || !Array.isArray(r.boletos)) throw ilegivel('os boletos');
    return r.boletos.map((b) => ({ ...b, vencimento: iso(b.vencimento) }));
  }
}
