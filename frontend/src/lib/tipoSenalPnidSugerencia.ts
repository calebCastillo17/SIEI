/**
 * Sugerencia de claseSenalId/tipoIoId al crear una señal nueva, a partir de
 * `instrumento.tipoSenalPnid` (P&ID) — NUNCA automática, NUNCA se pisa un
 * valor ya elegido: `SignalForm` solo la aplica cuando el usuario recién
 * eligió el instrumento dueño y la clase todavía está vacía. Decisión del
 * usuario: "las señales se les pone el P&ID... 120 VAC, 4 a 20, todo eso".
 *
 * Valores reales encontrados en el proyecto 620 (ver CLAUDE.md, sección
 * "tipo_senal_pnid"): "120 VAC" (117), "COM" (74), "4 a 20 mA + HART" (65),
 * "NO SEÑAL" (63), "RESISTENCIA" (10), "120 VDC" (6).
 *
 * "120 VAC"/"120 VDC" quedan deliberadamente SIN tipoIoId sugerido — es
 * ambiguo entre DI (contacto de estado/alarma) y DO (comando de control) y
 * no hay una regla real confirmada para distinguirlos; solo se sugiere la
 * clase (CONTROL). "NO SEÑAL" no sugiere nada — ese instrumento
 * probablemente nunca necesita una señal real.
 */
export interface SugerenciaSenal {
  claseCodigo: 'CONTROL' | 'COM';
  tipoIoCodigo?: 'AI' | 'DI' | 'DO' | 'RTD';
}

const SUGERENCIAS: Record<string, SugerenciaSenal> = {
  '4 a 20 ma + hart': { claseCodigo: 'CONTROL', tipoIoCodigo: 'AI' },
  resistencia: { claseCodigo: 'CONTROL', tipoIoCodigo: 'RTD' },
  com: { claseCodigo: 'COM' },
  '120 vac': { claseCodigo: 'CONTROL' },
  '120 vdc': { claseCodigo: 'CONTROL' }
};

export function sugerirDesdeTipoSenalPnid(tipoSenalPnid: string | null): SugerenciaSenal | null {
  if (!tipoSenalPnid) return null;
  const key = tipoSenalPnid.trim().toLowerCase();
  return SUGERENCIAS[key] ?? null;
}
