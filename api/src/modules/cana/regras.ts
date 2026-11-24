import { addDays } from '../../common/time/dates';

/**
 * Regras do lançamento da cana (puras, testadas em `__tests__/cana.dto.spec.ts`): o que cada tipo pede, as datas da loja e o
 * motivo da anulação. O banco repete o essencial em CHECK (cana_lancamentos_campos_check), como última barreira.
 */
export const TIPOS_CANA = ['recebimento', 'producao', 'contagem'] as const;
export type TipoCana = (typeof TIPOS_CANA)[number];

export interface CamposCana {
  duzias?: number | null;
  litros_caldo?: number | null;
  litros_frozen?: number | null;
  fornecedor?: string | null;
  observacao?: string | null;
}
export interface DadosLancamento {
  duzias: number | null;
  litros_caldo: number | null;
  litros_frozen: number | null;
  fornecedor: string | null;
  observacao: string | null;
}

const texto = (s: string | null | undefined) => (s && s.trim() ? s.trim().replace(/\s+/g, ' ') : null);
const tem = (n: number | null | undefined): n is number => typeof n === 'number';
const erro = (mensagem: string) => ({ ok: false as const, mensagem });

export function camposDoLancamento(tipo: TipoCana, c: CamposCana): { ok: true; dados: DadosLancamento } | { ok: false; mensagem: string } {
  const dados: DadosLancamento = {
    duzias: tem(c.duzias) ? c.duzias : null,
    litros_caldo: tem(c.litros_caldo) ? c.litros_caldo : null,
    litros_frozen: tem(c.litros_frozen) ? c.litros_frozen : null,
    fornecedor: texto(c.fornecedor),
    observacao: texto(c.observacao),
  };
  if (tipo !== 'contagem' && dados.litros_frozen !== null) return erro('Frozen só entra na contagem.');
  if (tipo !== 'recebimento' && dados.fornecedor !== null) return erro('Fornecedor só entra no recebimento.');
  if (tipo === 'recebimento') {
    if (dados.duzias === null || dados.duzias <= 0) return erro('Digite quantas dúzias chegaram (maior que zero).');
    if (dados.litros_caldo !== null) return erro('Recebimento de cana é só em dúzias.');
  } else if (tipo === 'producao') {
    if (dados.litros_caldo === null || dados.litros_caldo <= 0) return erro('Digite quantos litros de caldo saíram (maior que zero).');
    if (dados.duzias !== null && dados.duzias <= 0) return erro('As dúzias moídas, se informadas, têm de ser maiores que zero.');
  } else {
    if (dados.duzias === null || dados.duzias < 0) return erro('Digite as dúzias de cana que sobraram (não sobrou? digite 0).');
    if (dados.litros_caldo === null || dados.litros_caldo < 0) return erro('Digite os litros de caldo que sobraram (não sobrou? digite 0).');
  }
  return { ok: true, dados };
}

/** null = a data vale. A loja lança só hoje ou ontem (os botões vêm do servidor); o admin, qualquer dia até hoje. */
export function conferirData(data: string, hoje: string, admin: boolean): string | null {
  if (data > hoje) return 'Data no futuro.';
  if (!admin && data !== hoje && data !== addDays(hoje, -1)) return 'A loja lança só hoje ou ontem.';
  return null;
}

/** O motivo aparado, ou null se tem menos de 3 letras. */
export function conferirMotivo(m: string | null | undefined): string | null {
  const t = texto(m);
  return t && t.length >= 3 ? t : null;
}
