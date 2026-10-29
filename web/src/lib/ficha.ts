export type Cfg = { custo_preparo_pct: number; margem_seguranca_pct: number; mkup_padrao: number };

/** Regras da Ficha Técnica Gerencial */
export function calcFicha(somaIngredientes: number, cfg: Cfg, mkup: number | null, precoPraticado: number | null) {
  const preparo = somaIngredientes * (Number(cfg.custo_preparo_pct) / 100);
  const total = somaIngredientes + preparo;
  const comMargem = total * (1 + Number(cfg.margem_seguranca_pct) / 100);
  const mk = mkup ?? Number(cfg.mkup_padrao);
  const sugerido = comMargem * mk;
  const lucro = precoPraticado != null ? precoPraticado - comMargem : null;
  const cmvPct = precoPraticado ? (total / precoPraticado) * 100 : null;
  const ok = precoPraticado != null && precoPraticado >= sugerido - 0.005;
  return { preparo, total, comMargem, mk, sugerido, lucro, cmvPct, ok };
}
