import { Inject, Injectable } from '@nestjs/common';
import { isDateString } from '../../common/time/dates';
import { PrismaService } from '../../common/database/prisma.service';
import { LEITOR_PDF, LeituraPdfErro, type ArquivoLeitura, type LeitorPdf } from './leitor-pdf.port';
import { INSTRUCOES_DDA, INSTRUCOES_NOTA_SUGESTAO, SCHEMA_DDA, SCHEMA_NOTA_SUGESTAO } from './schemas';
import { limparItens, textoCatalogo, type ItemIa } from './sugestao-insumo';

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

/** Chave de acesso: só dígitos e só se tiver exatamente 44; senão null. */
const chave44 = (c: unknown): string | null => {
  const d = typeof c === 'string' ? c.replace(/\D/g, '') : '';
  return d.length === 44 ? d : null;
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
    r.parcelas = (r.parcelas ?? []).map((p) => ({ ...p, vencimento: diaValido(p.vencimento) }));
    return { ...r, itens: limparItens(r.itens, insumos, subgrupos) };
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
