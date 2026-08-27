/*
 * Las 19 columnas del Listado de Instrumentos (LDI) para este entregable,
 * en el mismo orden que la hoja Hoja1 de la plantilla oficial vigente
 * (reference_excel/Lista_instrumentos_plantilla.xlsx, fila de encabezado
 * 9, columnas A:S).
 *
 * Historial: de las 20 originalmente confirmadas, una primera ronda de
 * correcciones quitó "N° TAG ANTERIOR" y "SISTEMA". La plantilla oficial
 * que reemplazó a la anterior ("Listado_formato_Macros - PLANTILLA
 * 1.xlsm") restauró SISTEMA como columna propia de esta plantilla — se
 * revierte esa parte acá — pero eliminó físicamente TAG ANTERIOR (ya no
 * existe ninguna columna para ese dato en la hoja). `instrumento.
 * tag_anterior` sigue existiendo íntegro en el Master; simplemente no se
 * imprime en este entregable ni aparece en su snapshot.
 *
 * `headerAliases` es la lista de textos de encabezado que identifican esa
 * columna en la plantilla — se busca por texto normalizado (mayúsculas,
 * sin tildes, espacios colapsados), igual filosofía que
 * backend/src/lib/pnidImport/headers.ts, para no depender de que la
 * columna esté siempre en la misma letra si otra plantilla la reordena.
 *
 * `newHeaderLabel` no lo usa ninguna columna de este entregable ahora
 * mismo (ya no hay "TAG ANTERIOR"/"TAG WSP" que renombrar en esta
 * plantilla) — se deja el mecanismo genérico por si un campo futuro lo
 * necesita.
 */

export type LdiFieldKey =
  | 'item'
  | 'tag'
  | 'descripcion'
  | 'tipo'
  | 'tecnologia'
  | 'conexionProceso'
  | 'linea'
  | 'equipoAsociado'
  | 'servicio'
  | 'locacion'
  | 'sistema'
  | 'hojaDeDatos'
  | 'pnid'
  | 'diagramaDeLazo'
  | 'planoDeUbicacion'
  | 'marcaModelo'
  | 'comentarios'
  | 'nodo'
  | 'rev';

export interface LdiColumnSpec {
  key: LdiFieldKey;
  headerAliases: string[];
  newHeaderLabel?: string;
}

export const LDI_COLUMNS: LdiColumnSpec[] = [
  { key: 'item', headerAliases: ['Item', 'Ítem'] },
  { key: 'tag', headerAliases: ['N° TAG', 'N TAG', 'NRO TAG'] },
  { key: 'descripcion', headerAliases: ['DESCRIPCIÓN', 'DESCRIPCION'] },
  { key: 'tipo', headerAliases: ['TIPO'] },
  { key: 'tecnologia', headerAliases: ['TECNOLOGÍA', 'TECNOLOGIA'] },
  { key: 'conexionProceso', headerAliases: ['CONEXIÓN A PROCESO', 'CONEXION A PROCESO'] },
  { key: 'linea', headerAliases: ['LÍNEA', 'LINEA'] },
  { key: 'equipoAsociado', headerAliases: ['EQUIPO ASOCIADO'] },
  { key: 'servicio', headerAliases: ['SERVICIO'] },
  { key: 'locacion', headerAliases: ['LOCACIÓN', 'LOCACION'] },
  { key: 'sistema', headerAliases: ['SISTEMA'] },
  { key: 'hojaDeDatos', headerAliases: ['HOJA DE DATOS'] },
  { key: 'pnid', headerAliases: ['P&ID', 'PID'] },
  { key: 'diagramaDeLazo', headerAliases: ['DIAGRAMA DE LAZO'] },
  { key: 'planoDeUbicacion', headerAliases: ['PLANO DE UBICACIÓN', 'PLANO DE UBICACION'] },
  { key: 'marcaModelo', headerAliases: ['MARCA/MODELO', 'MARCA MODELO'] },
  { key: 'comentarios', headerAliases: ['COMENTARIOS'] },
  { key: 'nodo', headerAliases: ['NODO'] },
  { key: 'rev', headerAliases: ['REV', 'REV.'] }
];

/** Campos sin fuente confirmada todavía — siempre producen "", nunca se
 * elimina la columna ni se genera advertencia por estar vacíos. */
export const LDI_FIELDS_SIN_FUENTE: ReadonlySet<LdiFieldKey> = new Set([
  'hojaDeDatos',
  'diagramaDeLazo',
  'planoDeUbicacion',
  'marcaModelo',
  'comentarios'
]);

/** Igual técnica que backend/src/lib/pnidImport/headers.ts stripDiacritics:
 * NFD + filtrar por code point las marcas diacríticas combinantes
 * (0x0300-0x036F), en vez de una lista fija de vocales acentuadas. */
function stripDiacritics(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x0300 && code <= 0x036f) continue;
    result += ch;
  }
  return result;
}

export function normalizeHeaderText(text: unknown): string {
  return stripDiacritics(String(text ?? '').normalize('NFD'))
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
