import { Inject, Injectable } from '@nestjs/common';
import { LEITOR_PDF, LeituraPdfErro, type LeitorPdf } from './leitor-pdf.port';
import { INSTRUCOES_DDA, INSTRUCOES_NOTA, SCHEMA_DDA, SCHEMA_NOTA } from './schemas';

/** dd/mm/aaaa → aaaa-mm-dd; o resto corta em 10 caracteres (o `iso` do protótipo). */
export const iso = (d: string | null | undefined): string => {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (d ?? '').slice(0, 10);
};

type NotaLida = {
  data_emissao: string;
  parcelas?: { vencimento: string }[];
  itens?: unknown[];
  [k: string]: unknown;
};
type Boleto = { vencimento: string; [k: string]: unknown };

const ilegivel = (o: string) => new LeituraPdfErro(`Não consegui identificar ${o} deste PDF.`, 422, 'PDF_ILEGIVEL');

@Injectable()
export class LeituraPdfService {
  constructor(@Inject(LEITOR_PDF) private readonly leitor: LeitorPdf) {}

  async lerNota(pdfBase64: string, nome: string) {
    const r = (await this.leitor.ler({
      pdfBase64,
      nomeArquivo: nome || 'nota.pdf',
      instrucoes: INSTRUCOES_NOTA,
      pedido: 'Extraia os dados desta nota fiscal.',
      schema: SCHEMA_NOTA,
    })) as NotaLida | null;
    if (!r || typeof r !== 'object' || !Array.isArray(r.itens)) throw ilegivel('os dados');
    r.data_emissao = iso(r.data_emissao);
    r.parcelas = (r.parcelas ?? []).map((p) => ({ ...p, vencimento: iso(p.vencimento) }));
    return r;
  }

  async lerDDA(pdfBase64: string, nome: string) {
    const r = (await this.leitor.ler({
      pdfBase64,
      nomeArquivo: nome || 'dda.pdf',
      instrucoes: INSTRUCOES_DDA,
      pedido: 'Extraia os boletos deste DDA.',
      schema: SCHEMA_DDA,
    })) as { boletos?: Boleto[] } | null;
    if (!r || !Array.isArray(r.boletos)) throw ilegivel('os boletos');
    return r.boletos.map((b) => ({ ...b, vencimento: iso(b.vencimento) }));
  }
}
