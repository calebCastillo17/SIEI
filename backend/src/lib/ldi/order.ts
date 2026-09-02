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

import {
  obtenerPrefijoTag,
  resolverGrupoInstrumentoAsociado
} from '../instrumentGrouping.js';

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
  'orden_instrumentos_asociados',
  'pnid' // instrumento.plano_pnid — mismo nombre que la columna P&ID del LDI
]);

export function esCampoOrdenValido(campo: string): boolean {
  return CAMPOS_ORDEN_VALIDOS.has(campo);
}

// obtenerPrefijoTag / obtenerGrupoTagInferido / resolverGrupoInstrumentoAsociado
// se movieron a ../instrumentGrouping.ts (importadas arriba) — compartidas
// con el listado de Instrumentos del Master (instruments.ts), que pidió
// exactamente el mismo agrupamiento visual ("los PIT juntos" / "cada LV
// con su propio LY"). Nadie fuera de este archivo las importaba desde
// acá, así que no quedó re-export de compatibilidad.

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
  /** ids que son PADRE de al menos un grupo (algún otro row del dataset
   * los señala vía instrumentoAsociadoId) — usado solo para el desempate
   * "padre primero" del criterio instrumento_asociado, ver más abajo. */
  cabezaIds: Set<string>;
}

function buildContext(
  rows: LdiOrderableInstrumento[],
  ordenPorPrefijo: Map<string, number>
): OrderContext {
  const tagPorInstrumentoId = new Map(rows.map((r) => [r.id, r.tagInstrumento]));

  // Quién es padre de alguien — lo usa tanto resolverGrupoInstrumentoAsociado
  // (para decidir si un row sin relación propia es de todos modos cabeza de
  // otros) como el desempate "padre primero" del comparador principal (ver
  // ordenarInstrumentosLdi).
  const cabezaIds = new Set<string>();
  for (const row of rows) {
    if (row.instrumentoAsociadoId) cabezaIds.add(row.instrumentoAsociadoId);
  }

  const grupoPorId = new Map<string, string>();
  const ordenPorId = new Map<string, number>();

  for (const row of rows) {
    grupoPorId.set(row.id, resolverGrupoInstrumentoAsociado(row, tagPorInstrumentoId, cabezaIds));
    ordenPorId.set(row.id, resolverOrdenInstrumentosAsociados(row, ordenPorPrefijo));
  }

  return { grupoPorId, ordenPorId, cabezaIds };
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
    case 'pnid': return row.planoPnid ?? '';
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

      // Dentro del mismo grupo (mismo valor de instrumento_asociado), el
      // PADRE siempre va antes que sus hijos — pedido explícito del
      // usuario ("no se agrupa poniendo el padre primero?"). Sin esto, el
      // empate en este criterio caía en lo que viniera después (o el
      // orden original), y el padre podía terminar después de un hijo.
      // Independiente de ASC/DESC, igual que la regla de LOCACIÓN arriba
      // — no es un valor de dato que deba invertirse con la dirección.
      if (campo === 'instrumento_asociado' && va === vb) {
        const aCabeza = ctx.cabezaIds.has(a.id);
        const bCabeza = ctx.cabezaIds.has(b.id);
        if (aCabeza !== bCabeza) return aCabeza ? -1 : 1;
      }

      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
      }

      if (cmp !== 0) return direccion === 'DESC' ? -cmp : cmp;
    }

    /*
     * Desempate final IMPLÍCITO — pedido explícito del usuario: "el orden
     * principal para el entregable es el que tiene el listado [Master]...
     * dentro de cada locación sigue manteniendo el mismo orden que tenía
     * el Master". Si los criterios configurados (los que el usuario eligió
     * a mano, ej. solo P&ID) empatan, en vez de caer en un orden arbitrario
     * (el de llegada del arreglo, típicamente TAG alfabético plano de la
     * consulta SQL), se usa SIEMPRE el mismo orden agrupado que ya usa el
     * listado de Instrumentos del Master (`ctx.grupoPorId`/`cabezaIds`, ya
     * calculados arriba para el criterio "instrumento_asociado" — no hace
     * falta que el usuario lo agregue a mano para que esto aplique, y
     * agregarlo explícitamente sigue siendo válido si quiere subirlo de
     * prioridad por encima de otro criterio). Nunca ASC/DESC: es el orden
     * de base, no un valor de dato de la fila.
     */
    const grupoA = ctx.grupoPorId.get(a.id) ?? '';
    const grupoB = ctx.grupoPorId.get(b.id) ?? '';
    if (grupoA !== grupoB) {
      return grupoA.localeCompare(grupoB, 'es', { sensitivity: 'base' });
    }

    const aCabezaFinal = ctx.cabezaIds.has(a.id);
    const bCabezaFinal = ctx.cabezaIds.has(b.id);
    if (aCabezaFinal !== bCabezaFinal) {
      return aCabezaFinal ? -1 : 1;
    }

    return a.tagInstrumento.localeCompare(b.tagInstrumento, 'es', { sensitivity: 'base' });
  });
}
