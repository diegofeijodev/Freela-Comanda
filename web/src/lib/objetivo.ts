type BaseObjetivo = {
  objetivo_manual: number | null;
  usar_manual: boolean;
  consumo_semanal_manual: number | null;
};

/** Ausência de histórico e de base informada não significa consumo zero confirmado. */
export function objetivoPendente(item: BaseObjetivo, consumoCalculado: number) {
  if (item.objetivo_manual != null) return false;
  if (item.usar_manual && item.consumo_semanal_manual != null) return false;
  return consumoCalculado <= 0;
}