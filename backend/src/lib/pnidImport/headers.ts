/*
 * Mapeo de encabezados del reporte P&ID / Plant 3D hacia los campos de
 * nucleo.instrumento que sincroniza la importación (ver
 * database/migrations/004_pnid_import.sql y el diseño aprobado).
 *
 * La normalización replica — y generaliza — la función VBA
 * `NormalizarTextoEncabezado` del Master legacy
 * (reference_excel/01_MASTER_INSTRUMENTOS_620.xlsm, módulo
 * importarReporte.bas): minúsculas, sin tildes/diacríticos, ñ→n, "_"/"-"→
 * espacio, espacios colapsados. Acá se usa descomposición Unicode NFD en
 * vez de una lista fija de vocales acentuadas — cubre cualquier acento,
 * no solo los que el VBA tenía hardcodeados.
 */

export type PnidField =
  | 'pnpid'
  | 'tagInstrumento'
  | 'listado'
  | 'tagAnterior'
  | 'planoPnid'
  | 'tipoInstrumento'
  | 'descripcion'
  | 'funcionamiento'
  | 'cuerpoInstrumento'
  | 'tecnologia'
  | 'conexionProceso'
  | 'tipoSenalPnid'
  | 'lineaPnid'
  | 'equipoAsociadoTag'
  | 'instrumentoAsociadoTag'
  | 'servicio'
  | 'ubicacion'
  | 'sistema'
  | 'nodo';

/** Rango Unicode de las marcas diacríticas combinantes (0x0300-0x036F) que
 * `String.prototype.normalize('NFD')` separa de la letra base — quitarlas
 * después de NFD elimina cualquier tilde/diéresis, no solo una lista fija
 * de vocales como hacía el VBA legacy. Se filtra por code point en vez de
 * un literal de regex para no depender de cómo una herramienta de edición
 * externa reserialice el propio archivo fuente. */
function stripDiacritics(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x0300 && code <= 0x036f) continue;
    result += ch;
  }
  return result;
}

export function normalizeHeader(text: string): string {
  return stripDiacritics(text.toLowerCase().normalize('NFD'))
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Encabezado canónico del reporte -> campo que sincroniza. */
const CANONICAL_HEADERS: Array<{ header: string; field: PnidField }> = [
  { header: 'PnPID', field: 'pnpid' },
  { header: 'Tag', field: 'tagInstrumento' },
  { header: 'Listado', field: 'listado' },
  { header: 'Tag Anterior', field: 'tagAnterior' },
  { header: 'DWG Number', field: 'planoPnid' },
  { header: 'Type', field: 'tipoInstrumento' },
  { header: 'Descripcion', field: 'descripcion' },
  { header: 'Funcionamiento', field: 'funcionamiento' },
  { header: 'CuerpoInstrumento', field: 'cuerpoInstrumento' },
  { header: 'Tecnologia', field: 'tecnologia' },
  { header: 'Conexion a Proceso', field: 'conexionProceso' },
  { header: 'Tipo de Senal', field: 'tipoSenalPnid' },
  { header: 'Line', field: 'lineaPnid' },
  { header: 'Equipo Asociado', field: 'equipoAsociadoTag' },
  { header: 'Instrumento Asociado', field: 'instrumentoAsociadoTag' },
  { header: 'Servicio', field: 'servicio' },
  { header: 'Location', field: 'ubicacion' },
  { header: 'Sistema', field: 'sistema' },
  { header: 'Nodo', field: 'nodo' }
];

/** Mínimo estructural: sin estos 3, el archivo no se puede procesar en absoluto. */
export const REQUIRED_HEADERS = ['PnPID', 'Tag', 'Listado'] as const;

/**
 * Reconocidos pero deliberadamente NO sincronizados — su valor queda en el
 * snapshot (datos_fuente) igual que cualquier otro, pero no generan el
 * warning de "columna no reconocida" porque SIEI sí los conoce, solo
 * eligió no mapearlos (ver diseño aprobado, sección de mapeo principal):
 * Description (inglés, ≠ Descripcion), Tipo de Instrumento (≠ Type, y en
 * la práctica casi duplica Descripcion), Diagrama de Lazo (documento,
 * vacío en el reporte real) y Loop Number (sin uso decidido todavía).
 */
export const KNOWN_UNSYNCED_HEADERS = [
  'Description',
  'Tipo de Instrumento',
  'Diagrama de Lazo',
  'Loop Number'
] as const;

export const HEADER_TO_FIELD: ReadonlyMap<string, PnidField> = new Map(
  CANONICAL_HEADERS.map((entry) => [normalizeHeader(entry.header), entry.field])
);

export const FIELD_TO_HEADER: ReadonlyMap<PnidField, string> = new Map(
  CANONICAL_HEADERS.map((entry) => [entry.field, entry.header])
);

const KNOWN_UNSYNCED_NORMALIZED: ReadonlySet<string> = new Set(
  KNOWN_UNSYNCED_HEADERS.map(normalizeHeader)
);

export function isKnownUnsyncedHeader(originalHeader: string): boolean {
  return KNOWN_UNSYNCED_NORMALIZED.has(normalizeHeader(originalHeader));
}

/** Todos los campos sincronizables excepto los 3 que dirigen el matching
 * (pnpid/tagInstrumento/listado no son "datos de contenido" a diferenciar
 * campo por campo — pnpid define la identidad, tagInstrumento tiene su
 * propio resultado TAG_MODIFICADO, listado no vive en nucleo.instrumento). */
export const DIFFABLE_FIELDS: PnidField[] = CANONICAL_HEADERS
  .map((entry) => entry.field)
  .filter((field) => field !== 'pnpid' && field !== 'tagInstrumento' && field !== 'listado');

/** Reconstruye el conjunto de campos "presentes en el archivo" a partir de
 * la lista de encabezados conocidos ausentes que quedó guardada en
 * importacion_pnid.advertencias — usado en APPLY, que no vuelve a leer el
 * Excel original. */
export function computePresentFields(missingKnownColumnHeaders: string[]): Set<PnidField> {
  const missingNormalized = new Set(missingKnownColumnHeaders.map(normalizeHeader));
  const present = new Set<PnidField>();

  for (const [normalized, field] of HEADER_TO_FIELD) {
    if (field === 'pnpid' || field === 'tagInstrumento' || field === 'listado') continue;
    if (!missingNormalized.has(normalized)) present.add(field);
  }

  return present;
}

export const PNID_FIELD_MAX_LENGTH: Record<PnidField, number> = {
  pnpid: 50,
  tagInstrumento: 50,
  listado: 0,
  tagAnterior: 50,
  planoPnid: 30,
  tipoInstrumento: 50,
  descripcion: 300,
  funcionamiento: 50,
  cuerpoInstrumento: 50,
  tecnologia: 100,
  conexionProceso: 100,
  tipoSenalPnid: 50,
  lineaPnid: 100,
  equipoAsociadoTag: 50,
  instrumentoAsociadoTag: 50,
  servicio: 200,
  ubicacion: 100,
  sistema: 50,
  nodo: 50
};
