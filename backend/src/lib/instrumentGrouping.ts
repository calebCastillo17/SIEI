/*
 * Agrupamiento de instrumentos por Instrumento Asociado — compartido entre
 * el motor de orden del LDI (backend/src/lib/ldi/order.ts) y el listado de
 * Instrumentos del Master (backend/src/routes/instruments.ts). Vivía
 * originalmente solo dentro de ldi/order.ts; se extrajo acá cuando el
 * usuario pidió el mismo agrupamiento visual ("los PIT juntos") también en
 * el Master — una sola fuente de verdad evita que las dos pantallas
 * diverjan en el criterio (ya pasó una vez: el Master usaba TAG literal
 * para instrumentos explícitamente asociados mientras el LDI, antes de la
 * corrección, recortaba al correlativo — ver historial de order.ts).
 */

export interface InstrumentoParaAgrupar {
  id: string;
  tagInstrumento: string;
  instrumentoAsociadoId: string | null;
  instrumentoAsociadoTag: string | null;
}

function splitTagParts(tag: string): string[] {
  return tag.toUpperCase().trim().split('-');
}

/** Segundo segmento del TAG separado por "-" (ej. "620-LV-5003A" -> "LV")
 * — mismo criterio que ObtenerPrefijoTag de la macro legacy. */
export function obtenerPrefijoTag(tag: string): string {
  const partes = splitTagParts(tag);
  if (partes.length >= 3) return partes[1];
  if (partes.length >= 2) return partes[0];
  return partes[0] ?? '';
}

/** Prefijo + último segmento del TAG sin la letra final si termina en
 * letra (ej. "620-LV-5003A" -> "LV-5003", "620-PIT-5046" -> "PIT-5046").
 *
 * Incluir el prefijo (no solo el correlativo) preserva la intención
 * original de la macro legacy — agrupar variantes A/B/C del MISMO
 * tipo+número ("620-LV-5003A" con "620-LV-5003B") — sin fusionar tipos
 * distintos que solo coinciden en el número (ej. "620-FE-5046" con
 * "620-PIT-5046", que son instrumentos reales sin ninguna relación entre
 * sí, encontrado con datos reales del proyecto 22043/620). */
export function obtenerGrupoTagInferido(tag: string): string {
  const partes = splitTagParts(tag);
  if (partes.length < 3) {
    return tag.toUpperCase().trim();
  }
  const prefijo = partes[1];
  const base = partes[partes.length - 1];
  const correlativo = /[A-Z]$/.test(base) ? base.slice(0, -1) : base;
  return `${prefijo}-${correlativo}`;
}

/** Grupo efectivo para "instrumento_asociado": prioriza la relación
 * explícita (por id, resuelto a su TAG literal si el instrumento asociado
 * sigue activo en el dataset; si no, su tag libre literal); si el propio
 * row no tiene relación pero es CABEZA (otro row lo señala), usa su propio
 * TAG literal — así sus hijos, que resuelven al mismo TAG, siempre
 * empatan con él. Solo cuando NO hay ninguna relación explícita de por
 * medio (ni este row la tiene, ni es cabeza de nadie) cae al grupo
 * inferido por texto (heurística legacy, recorta la letra final).
 *
 * CORRECCIÓN (encontrado con datos reales — 620-LV-5003/5003A/5003B, cada
 * uno con su PROPIO LY asociado distinto): cuando una relación explícita
 * SÍ existe, el TAG se usa LITERAL, nunca recortado por
 * `obtenerGrupoTagInferido` — esa función le quita la letra final
 * pensando en variantes A/B/C de una MISMA cosa (dos transmisores
 * redundantes de la misma medición), pero acá 5003/5003A/5003B son TRES
 * válvulas distintas, cada una con su propio hijo — recortarles la letra
 * las fusionaba en un solo grupo falso "LV-5003", y como las tres eran
 * cabeza, el desempate ponía las tres cabezas juntas primero y los tres
 * hijos juntos después, en vez de cada par LV+su LY adyacente. El recorte
 * por texto queda reservado EXCLUSIVAMENTE para instrumentos sin ninguna
 * relación explícita en ningún sentido. */
export function resolverGrupoInstrumentoAsociado(
  row: InstrumentoParaAgrupar,
  tagPorInstrumentoId: Map<string, string>,
  cabezaIds: ReadonlySet<string>
): string {
  if (row.instrumentoAsociadoId) {
    const tagResuelto = tagPorInstrumentoId.get(row.instrumentoAsociadoId);
    if (tagResuelto) return tagResuelto;
  }
  if (row.instrumentoAsociadoTag) {
    return row.instrumentoAsociadoTag;
  }
  if (cabezaIds.has(row.id)) {
    return row.tagInstrumento;
  }
  return obtenerGrupoTagInferido(row.tagInstrumento);
}

/**
 * Calcula, para TODO un dataset a la vez, el grupo de orden (incluye el
 * fallback por texto) y quién es cabeza explícita (alguien más lo señala
 * vía instrumentoAsociadoId) — pensado para ordenar/clusterizar una lista
 * completa, no para decidir qué se le muestra al usuario como "Grupo": eso
 * sigue siendo la relación curada real (ver `grupoTag`/`esCabezaDeGrupo`
 * en instruments.ts), que a propósito NO usa el fallback por texto — un
 * instrumento suelto sin relación real no debería aparentar tener un
 * "grupo" ante el usuario solo porque comparte tipo+número con otro.
 */
export function calcularOrdenAgrupado<T extends InstrumentoParaAgrupar>(
  rows: T[]
): Map<string, { ordenGrupoTag: string; esCabezaExplicita: boolean }> {
  const tagPorInstrumentoId = new Map(rows.map((r) => [r.id, r.tagInstrumento]));

  const cabezaIds = new Set<string>();
  for (const row of rows) {
    if (row.instrumentoAsociadoId) cabezaIds.add(row.instrumentoAsociadoId);
  }

  const result = new Map<string, { ordenGrupoTag: string; esCabezaExplicita: boolean }>();
  for (const row of rows) {
    result.set(row.id, {
      ordenGrupoTag: resolverGrupoInstrumentoAsociado(row, tagPorInstrumentoId, cabezaIds),
      esCabezaExplicita: cabezaIds.has(row.id)
    });
  }
  return result;
}
