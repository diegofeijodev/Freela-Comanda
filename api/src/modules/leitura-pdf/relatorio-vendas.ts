// Limpeza do relatório de vendas lido pela IA (desenho 24/11, A.6), pura: a IA pode devolver data impossível, número como texto ou
// linha sem produto. Nada é inventado: o que não dá para ler vira null e a tela pede para a pessoa completar ou tirar a linha.
import { isDateString } from '../../common/time/dates';

export type LinhaRelatorio = {
  pedido: string | null;
  data: string | null;
  hora: string | null;
  produto: string;
  quantidade: number | null;
  valor_total: number | null;
  desconto: number | null;
};
export type RelatorioVendas = {
  sistema: string | null;
  periodo_ini: string | null;
  periodo_fim: string | null;
  total_relatorio: number | null;
  linhas: LinhaRelatorio[];
};

const texto = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const numero = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
};
/** aaaa-mm-dd que existe, ou dd/mm/aaaa convertido; o resto vira null. */
const dia = (v: unknown): string | null => {
  const t = texto(v);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const d = br ? `${br[3]}-${br[2]}-${br[1]}` : t.slice(0, 10);
  return isDateString(d) ? d : null;
};
const hora = (v: unknown): string | null => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(texto(v));
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
};

/** null = a resposta não é um relatório (ou veio cortada): PDF_ILEGIVEL. */
export function limparRelatorioVendas(r: unknown): RelatorioVendas | null {
  if (!r || typeof r !== 'object' || !Array.isArray((r as { linhas?: unknown }).linhas)) return null;
  const o = r as Record<string, unknown> & { linhas: unknown[] };
  const linhas = o.linhas
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      pedido: texto(l.pedido) || null,
      data: dia(l.data),
      hora: hora(l.hora),
      produto: texto(l.produto),
      quantidade: numero(l.quantidade),
      valor_total: numero(l.valor_total),
      desconto: numero(l.desconto),
    }))
    .filter((l) => l.produto);
  return { sistema: texto(o.sistema) || null, periodo_ini: dia(o.periodo_ini), periodo_fim: dia(o.periodo_fim), total_relatorio: numero(o.total_relatorio), linhas };
}
