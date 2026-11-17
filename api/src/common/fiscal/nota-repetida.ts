// Nota "parece repetida": mesmo emitente + mesmo número + (quando as duas têm série) mesma série. A chave igual é outro caso (DUPLICADO).
import { normalizarNumeroSerie } from './chave-acesso';
import { normalizarCnpj } from './cnpj';

export type RefNota = { cnpj: string | null; numero: string | null; serie: string | null };

export type NotaParecida = {
  id: string;
  numero: string | null;
  serie: string | null;
  fornecedor_nome: string;
  data_emissao: string;
  data_entrada: string;
  valor_total: number;
  origem: string;
  created_at: string;
};

export function pareceRepetida(a: RefNota, b: RefNota): boolean {
  const ca = normalizarCnpj(a.cnpj ?? '');
  if (!ca || ca !== normalizarCnpj(b.cnpj ?? '')) return false;
  const na = normalizarNumeroSerie(a.numero);
  if (!na || na !== normalizarNumeroSerie(b.numero)) return false;
  const sa = normalizarNumeroSerie(a.serie);
  const sb = normalizarNumeroSerie(b.serie);
  return !sa || !sb || sa === sb;
}

const ORIGENS: Record<string, string> = { xml: 'por XML', pdf: 'por PDF', foto: 'por foto', sefaz: 'pela SEFAZ' };

export function origemPorExtenso(origem: string): string {
  return ORIGENS[origem] ?? `por ${origem}`;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" pela divisão do texto (nunca por Date, que daria o dia anterior). */
function dataBr(d: string): string {
  const [a, m, dia] = d.slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
}

/** Frase do 409 NOTA_REPETIDA; `p[0]` é a parecida mais nova. */
export function fraseNotaRepetida(p: NotaParecida[]): string {
  const n = p[0]!;
  const serie = n.serie ? ` série ${n.serie}` : '';
  const valor = n.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const mais = p.length > 1 ? ` (e mais ${p.length - 1} ${p.length === 2 ? 'parecida' : 'parecidas'})` : '';
  return (
    `Já existe a NF ${n.numero}${serie} de ${n.fornecedor_nome}, lançada em ${dataBr(n.data_entrada)} ${origemPorExtenso(n.origem)}, ` +
    `de R$ ${valor}${mais}. Se for outra nota, confirme para lançar mesmo assim.`
  );
}
