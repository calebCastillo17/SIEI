/**
 * Vocabulario compartido para todo lo relacionado a P&ID / Plant 3D:
 * nombres de campo legibles para ingeniería y etiquetas de los 9 estados
 * de cat.cat_estado_pnid. Un solo lugar para no repetir estas listas en
 * el formulario/detalle de Instrumentos Y en las pantallas de importación
 * (misma idea que "no dupliques lógica" del resto del frontend).
 *
 * Las claves de campo son exactamente los `PnidField` de
 * backend/src/lib/pnidImport/headers.ts (y las columnas editables de
 * InstrumentInput que vienen de ahí) — no un vocabulario aparte.
 */

/** Campos sincronizables por la importación P&ID (sin tagInstrumento/
 * listado, que no son "contenido" — ver DIFFABLE_FIELDS en headers.ts).
 * `pnpid` tampoco es parte de DIFFABLE_FIELDS, pero SÍ puede aparecer en un
 * diff manual armado a mano para PNPID_ACTUALIZADO (ver compare.ts) — por
 * eso tiene label acá aunque el comparador nunca lo genere solo. */
export const PNID_FIELD_LABELS: Record<string, string> = {
  pnpid: 'PnPID',
  tagAnterior: 'TAG anterior',
  planoPnid: 'Plano P&ID',
  tipoInstrumento: 'Tipo de instrumento',
  descripcion: 'Descripción',
  funcionamiento: 'Funcionamiento',
  cuerpoInstrumento: 'Cuerpo del instrumento',
  tecnologia: 'Tecnología',
  conexionProceso: 'Conexión a proceso',
  tipoSenalPnid: 'Tipo de señal (P&ID)',
  lineaPnid: 'Línea P&ID',
  equipoAsociadoTag: 'Equipo asociado',
  instrumentoAsociadoTag: 'Instrumento asociado',
  servicio: 'Servicio',
  ubicacion: 'Ubicación',
  sistema: 'Sistema',
  nodo: 'Nodo'
};

export function pnidFieldLabel(campo: string): string {
  return PNID_FIELD_LABELS[campo] ?? campo;
}

/** Los 10 códigos de cat.cat_estado_pnid, en el orden en que conviene
 * presentarlos (ver database/migrations/004_pnid_import.sql y
 * 008_pnid_actualizacion_pnpid.sql). */
export const PNID_ESTADO_LABELS: Record<string, string> = {
  OK: 'Sin cambios',
  NUEVO_EN_PNID: 'Nuevo en P&ID',
  TAG_MODIFICADO: 'TAG modificado',
  DATOS_MODIFICADOS: 'Datos modificados',
  PNPID_ACTUALIZADO: 'PnPID actualizado',
  NO_LISTADO: 'No listado',
  NO_EXISTE_EN_PNID: 'No existe en P&ID',
  REQUIERE_REVISION: 'Requiere revisión',
  TAG_DUPLICADO: 'TAG duplicado',
  TAG_VACIO: 'TAG vacío'
};

export function pnidEstadoLabel(codigo: string | null): string {
  if (codigo === null) return '—';
  return PNID_ESTADO_LABELS[codigo] ?? codigo;
}

/** Estos 3 no se aplican automáticamente en APPLY (ver pnidImports.ts,
 * `applyNuevoInstrumento`/etc. los saltea con `continue`) — deben
 * destacarse en toda la UI, no solo en el detalle. */
export const PNID_ATTENTION_CODES: ReadonlySet<string> = new Set([
  'REQUIERE_REVISION',
  'TAG_DUPLICADO',
  'TAG_VACIO'
]);
