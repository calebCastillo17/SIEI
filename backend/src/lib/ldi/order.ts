/*
 * Motor de ordenamiento configurable del LDI.
 *
 * Replica y combina, en el orden aprobado:
 *  1. Relación EXPLÍCITA instrumento_asociado_id (o su tag libre) cuando
 *     existe — agrupa con lo que el ingeniero declaró.
 *  2. Fallback: grupo INFERIDO por texto del propio TAG (misma técnica que
 *     la macro legacy `ObtenerGrupoTag` — último segmento separado por
 *     guiones, sin la letra final si termina en letra).
 *  3. Orden de tipo (`cat.cat_orden_tipo_instrumento`, prefijo -> valor;
 *     misma técnica que `ObtenerPrioridadTag`/`ObtenerPrefijoTag`: el
 *     prefijo es el SEGUNDO segmento del TAG separado por guiones).
 *  4. TAG como desempate final (ya cubre el sufijo A/B/C alfabéticamente).
 *
 * NO se llama a esto "prioridad" (no representa prioridad de alarmas) —
 * el nombre aprobado es `orden_instrumentos_asociados`.
 */

export interface LdiOrderableInstrumento {
  id: string;
  tagInstrumento: string;
  tagAnterior: string | null;
  descripcion: string | null;
  tipoInstrumento: string | null;
  tecnologia: string | null;
  conexionProceso: string | null;
  lineaPnid: string | null;
  equipoAsociadoTag: string | null;
  servicio: string | null;
  ubicacion: string | null;
  sistema: string | null;
  planoPnid: string | null;
  nodo: string | null;
  instrumentoAsociadoId: string | null;
  instrumentoAsociadoTag: string | null;
}

export interface CriterioOrden {
  campo: string;
  direccion: 'ASC' | 'DESC';
}

const CAMPOS_ORDEN_VALIDOS = new Set([
  'sistema',
  'nodo',
  'tag',
  'tag_anterior',
  'servicio',
  'tipo',
  'tecnologia',
  'locacion', // instrumento.ubicacion — mismo nombre que la columna LOCACIÓN del LDI, no "ubicacion"
  'equipo_asociado',
  'instrumento_asociado',
  'orden_instrumentos_asociados'
]);

export function esCampoOrdenValido(campo: string): boolean {
  return CAMPOS_ORDEN_VALIDOS.has(campo);
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

/** Último segmento del TAG sin la letra final si termina en letra (ej.
 * "620-LV-5003A" -> "5003") — mismo criterio que ObtenerGrupoTag. */
export function obtenerGrupoTagInferido(tag: string): string {
  const partes = splitTagParts(tag);
  if (partes.length >= 3) {
    const base = partes[partes.length - 1];
    if (/[A-Z]$/.test(base)) return base.slice(0, -1);
    return base;
  }
  return tag.toUpperCase().trim();
}

/** Grupo efectivo para "instrumento_asociado": prioriza la relación
 * explícita (por id, resuelto a su TAG si el instrumento asociado sigue
 * activo en el dataset; si no, su tag libre); si no hay relación
 * explícita, cae al grupo inferido por texto del propio TAG.
 *
 * Importante: el TAG resuelto de la relación explícita se pasa por
 * `obtenerGrupoTagInferido` igual que cualquier otro — si no, un
 * instrumento con relación explícita nunca terminaría adyacente al
 * instrumento asociado mismo (que calcula SU PROPIO grupo con esa misma
 * función): las dos claves tienen que vivir en el mismo "espacio" para
 * poder empatar al ordenar. La relación explícita decide A QUÉ grupo se
 * une, no inventa un espacio de claves aparte. */
export function resolverGrupoInstrumentoAsociado(
  row: LdiOrderableInstrumento,
  tagPorInstrumentoId: Map<string, string>
): string {
  if (row.instrumentoAsociadoId) {
    const tagResuelto = tagPorInstrumentoId.get(row.instrumentoAsociadoId);
    if (tagResuelto) return obtenerGrupoTagInferido(tagResuelto);
  }
  if (row.instrumentoAsociadoTag) {
    return obtenerGrupoTagInferido(row.instrumentoAsociadoTag);
  }
  return obtenerGrupoTagInferido(row.tagInstrumento);
}

export function resolverOrdenInstrumentosAsociados(
  row: LdiOrderableInstrumento,
  ordenPorPrefijo: Map<string, number>
): number {
  const prefijo = obtenerPrefijoTag(row.tagInstrumento);
  return ordenPorPrefijo.get(prefijo) ?? 99;
}

interface OrderContext {
  grupoPorId: Map<string, string>;
  ordenPorId: Map<string, number>;
}

function buildContext(
  rows: LdiOrderableInstrumento[],
  ordenPorPrefijo: Map<string, number>
): OrderContext {
  const tagPorInstrumentoId = new Map(rows.map((r) => [r.id, r.tagInstrumento]));
  const grupoPorId = new Map<string, string>();
  const ordenPorId = new Map<string, number>();

  for (const row of rows) {
    grupoPorId.set(row.id, resolverGrupoInstrumentoAsociado(row, tagPorInstrumentoId));
    ordenPorId.set(row.id, resolverOrdenInstrumentosAsociados(row, ordenPorPrefijo));
  }

  return { grupoPorId, ordenPorId };
}

function resolveSortValue(
  row: LdiOrderableInstrumento,
  campo: string,
  ctx: OrderContext
): string | number {
  switch (campo) {
    case 'sistema': return row.sistema ?? '';
    case 'nodo': return row.nodo ?? '';
    case 'tag': return row.tagInstrumento;
    case 'tag_anterior': return row.tagAnterior ?? '';
    case 'servicio': return row.servicio ?? '';
    case 'tipo': return row.tipoInstrumento ?? '';
    case 'tecnologia': return row.tecnologia ?? '';
    case 'locacion': return row.ubicacion ?? '';
    case 'equipo_asociado': return row.equipoAsociadoTag ?? '';
    case 'instrumento_asociado': return ctx.grupoPorId.get(row.id) ?? '';
    case 'orden_instrumentos_asociados': return ctx.ordenPorId.get(row.id) ?? 99;
    default: return '';
  }
}

/**
 * Ordena el dataset según los criterios (en orden de prioridad, el primero
 * de la lista pesa más). No muta el arreglo de entrada.
 */
export function ordenarInstrumentosLdi(
  rows: LdiOrderableInstrumento[],
  criterios: CriterioOrden[],
  ordenTipoInstrumento: Array<{ prefijo: string; orden: number }>
): LdiOrderableInstrumento[] {
  const ordenPorPrefijo = new Map(ordenTipoInstrumento.map((o) => [o.prefijo, o.orden]));
  const ctx = buildContext(rows, ordenPorPrefijo);

  return [...rows].sort((a, b) => {
    for (const { campo, direccion } of criterios) {
      const va = resolveSortValue(a, campo, ctx);
      const vb = resolveSortValue(b, campo, ctx);

      // LOCACIÓN sin valor siempre al final, sin importar ASC/DESC —
      // pedido explícito del usuario: un instrumento sin locación
      // asignada no tiene un lugar "antes/después" natural en el
      // ordenamiento alfabético, así que no debe encabezar el listado
      // solo porque "" ordene primero. Los demás criterios no cambian
      // este comportamiento (no es una regla genérica para todo campo).
      if (campo === 'locacion') {
        const aVacia = !va;
        const bVacia = !vb;
        if (aVacia !== bVacia) return aVacia ? 1 : -1;
      }

      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
      }

      if (cmp !== 0) return direccion === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });
}
