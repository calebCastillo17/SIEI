import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import {
  HEADER_TO_FIELD,
  REQUIRED_HEADERS,
  isKnownUnsyncedHeader,
  normalizeHeader,
  type PnidField
} from './headers.js';

export interface ParsedRow {
  /** 1-based, relativo a las filas de datos (fila 2 del Excel = numeroFila 1). */
  numeroFila: number;
  pnpid: string | null;
  tagInstrumento: string | null;
  listado: boolean;
  /** JSON-safe, con TODAS las columnas del archivo, indexado por el
   * encabezado ORIGINAL tal como llegó (para el snapshot de auditoría). */
  datosFuente: Record<string, unknown>;
  /** Solo los campos cuya columna existe en este archivo. */
  fields: Partial<Record<PnidField, string | null>>;
}

export interface ParsedFile {
  rows: ParsedRow[];
  /** Encabezados canónicos conocidos que NO aparecieron en el archivo. */
  missingKnownColumns: string[];
  /** Encabezados presentes que SIEI no reconoce en absoluto. */
  unknownColumns: string[];
  /** Campos sincronizables cuya columna sí está presente en este archivo. */
  presentFields: Set<PnidField>;
}

export class PnidFileStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PnidFileStructureError';
  }
}

/**
 * Namespaces que exceljs espera encontrar SIN prefijo (así es como el
 * propio exceljs los escribe, y así es como su parser los busca) pero que
 * algunos exports reales de Plant 3D (confirmado con el reporte de
 * referencia) declaran con un prefijo explícito — ej.
 * `<x:worksheet xmlns:x=".../spreadsheetml/2006/main">...<x:row>...` en
 * vez de `<worksheet xmlns="...">...<row>...`. Es XML válido, pero el
 * parser SAX de exceljs busca los nombres de elemento sin prefijo y
 * termina sin reconocer nada (`workbook.sheets` queda undefined).
 *
 * Deliberadamente NO se generaliza a "cualquier prefijo declarado": otras
 * partes del paquete (ej. docProps/core.xml) sí esperan sus namespaces
 * PREFIJADOS ("dc:creator", "cp:coreProperties" — Dublin Core estándar) y
 * quitarles el prefijo rompe el parser de esas partes en vez de arreglarlo
 * (se verificó empíricamente). Por eso la lista es explícita, no un
 * "quitar todo".
 */
const NAMESPACES_EXPECTED_UNPREFIXED = [
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recorre todas las partes XML del paquete y, solo para los namespaces de
 * `NAMESPACES_EXPECTED_UNPREFIXED`, quita el prefijo de los nombres de
 * elemento (nunca de nombres de atributo — por eso "r:id" de
 * relationships, que sí es estándar y va como atributo, queda intacto).
 * Si el archivo no usa esta variante (el caso normal, ej. los que genera
 * el propio exceljs), esta función lo deja exactamente igual.
 */
export async function normalizeNamespacedXlsx(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let changedAny = false;

  const entries = Object.values(zip.files).filter((file) => !file.dir && file.name.endsWith('.xml'));

  for (const file of entries) {
    let xml = await file.async('string');
    let fileChanged = false;

    for (const namespaceUri of NAMESPACES_EXPECTED_UNPREFIXED) {
      const nsMatch = new RegExp(`xmlns:([A-Za-z0-9_]+)="${escapeRegExp(namespaceUri)}"`).exec(xml);
      if (!nsMatch) continue;

      const prefix = nsMatch[1];
      const escapedPrefix = escapeRegExp(prefix);

      xml = xml
        .replace(new RegExp(`<${escapedPrefix}:`, 'g'), '<')
        .replace(new RegExp(`</${escapedPrefix}:`, 'g'), '</')
        .replace(new RegExp(`\\s*xmlns:${escapedPrefix}="${escapeRegExp(namespaceUri)}"`), '');

      fileChanged = true;
    }

    if (fileChanged) {
      zip.file(file.name, xml);
      changedAny = true;
    }
  }

  if (await stripExcelTableObjects(zip)) {
    changedAny = true;
  }

  if (!changedAny) return buffer;

  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Quita por completo los objetos "Tabla" de Excel (ListObject) del
 * paquete: `xl/tables/*.xml`, su referencia en cada `_rels/*.rels` y su
 * entrada en `[Content_Types].xml`.
 *
 * Se verificó con el reporte real que exceljs no logra terminar de cargar
 * el libro cuando existe una Tabla cuya relación usa un target absoluto
 * (`Target="/xl/tables/table11.xml"` en vez de relativo) — el parser deja
 * el modelo de esa tabla a medias y revienta leyendo `table.name`.
 *
 * SIEI nunca lee la definición de Tabla de Excel (los datos se leen
 * directamente de sheetData por fila/columna) — quitarla del paquete no
 * pierde ninguna información que este importador use.
 */
async function stripExcelTableObjects(zip: JSZip): Promise<boolean> {
  const tableFiles = Object.keys(zip.files).filter((name) => /^xl\/tables\//.test(name));
  if (tableFiles.length === 0) return false;

  for (const name of tableFiles) {
    zip.remove(name);
  }

  const relsFiles = Object.values(zip.files).filter(
    (file) => !file.dir && file.name.endsWith('.rels')
  );

  for (const file of relsFiles) {
    const xml = await file.async('string');
    const rewritten = xml.replace(
      /<Relationship[^>]*Type="[^"]*\/relationships\/table"[^>]*\/>/g,
      ''
    );
    if (rewritten !== xml) zip.file(file.name, rewritten);
  }

  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    const xml = await contentTypesFile.async('string');
    const rewritten = xml.replace(
      /<Override PartName="\/xl\/tables\/[^"]*"[^>]*\/>/g,
      ''
    );
    if (rewritten !== xml) zip.file('[Content_Types].xml', rewritten);
  }

  // La propia hoja referencia la Tabla vía <tableParts><tablePart r:id="..."/>
  // </tableParts> — sin esto, exceljs intenta resolver esa relación (que ya
  // se borró arriba) y revienta leyendo `.Target` de un objeto inexistente.
  const worksheetFiles = Object.values(zip.files).filter(
    (file) => !file.dir && /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name)
  );

  for (const file of worksheetFiles) {
    const xml = await file.async('string');
    const rewritten = xml.replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/g, '');
    if (rewritten !== xml) zip.file(file.name, rewritten);
  }

  return true;
}

/** Encabezados opcionales conocidos (todos los mapeados salvo los 3
 * obligatorios) — se usa para calcular `missingKnownColumns`. */
const OPTIONAL_KNOWN_HEADERS = [
  'Tag Anterior',
  'DWG Number',
  'Type',
  'Descripcion',
  'Funcionamiento',
  'CuerpoInstrumento',
  'Tecnologia',
  'Conexion a Proceso',
  'Tipo de Senal',
  'Line',
  'Equipo Asociado',
  'Servicio',
  'Location',
  'Sistema',
  'Nodo'
];

const TRUE_LISTADO_VALUES = new Set(['true', 'verdadero', 'si', 'sí', '1', 'x', 'yes']);

function parseListado(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value ?? '').trim().toLowerCase();
  return TRUE_LISTADO_VALUES.has(text);
}

/** PnPID puede venir como texto ("66939") o como número (66939) según cómo
 * Plant 3D haya exportado la celda — normalizado siempre a texto, sin
 * artefactos de punto flotante (ver riesgo documentado en el diseño). */
function normalizePnpid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value));
  }
  const text = String(value).trim();
  if (text.length === 0) return null;
  const floatArtifact = /^(\d+)\.0+$/.exec(text);
  return floatArtifact ? floatArtifact[1] : text;
}

function normalizeTag(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

/** Convierte el valor crudo de una celda de exceljs a algo JSON-safe para
 * el snapshot (datos_fuente) — exceljs devuelve objetos especiales para
 * fórmulas, texto enriquecido, fechas, etc. */
function cellToJsonValue(raw: ExcelJS.CellValue): unknown {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date) return raw.toISOString();

  if (typeof raw === 'object') {
    if ('richText' in raw && Array.isArray((raw as { richText: Array<{ text: string }> }).richText)) {
      return (raw as { richText: Array<{ text: string }> }).richText.map((part) => part.text).join('');
    }
    if ('result' in raw) {
      return cellToJsonValue((raw as { result: ExcelJS.CellValue }).result);
    }
    if ('text' in raw) {
      return String((raw as { text: unknown }).text);
    }
    if ('error' in raw) {
      return null;
    }
    return String(raw);
  }

  return raw;
}

export function cellToFieldValue(jsonValue: unknown): string | null {
  if (jsonValue === null || jsonValue === undefined) return null;
  const text = String(jsonValue).trim();
  return text.length === 0 ? null : text;
}

/**
 * Reconstruye los campos mapeables a partir del snapshot JSON ya guardado
 * (importacion_pnid_fila.datos_fuente) — usado en APPLY para no depender
 * de haber conservado el archivo original ni de un cálculo cacheado del
 * PREVIEW: el snapshot persistente es la única fuente de verdad.
 */
export function extractFieldsFromSnapshot(
  datosFuente: Record<string, unknown>
): Partial<Record<PnidField, string | null>> {
  const fields: Partial<Record<PnidField, string | null>> = {};

  for (const [header, value] of Object.entries(datosFuente)) {
    const normalized = normalizeHeader(header);
    const field = HEADER_TO_FIELD.get(normalized);
    if (!field || field === 'pnpid' || field === 'tagInstrumento' || field === 'listado') continue;
    fields[field] = cellToFieldValue(value);
  }

  return fields;
}

/**
 * Parsea el buffer de un reporte P&ID/Plant 3D. Lanza PnidFileStructureError
 * si falta alguno de los 3 encabezados mínimos (PnPID, Tag, Listado) — ese
 * es el único caso que impide procesar el archivo en absoluto.
 */
export async function parsePnidExcelBuffer(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  const normalizedBuffer = await normalizeNamespacedXlsx(buffer);
  await workbook.xlsx.load(normalizedBuffer as unknown as ExcelJS.Buffer);

  const worksheet =
    workbook.worksheets.find((ws) => normalizeHeader(ws.name) === normalizeHeader('Instrument List')) ??
    workbook.worksheets[0];

  if (!worksheet) {
    throw new PnidFileStructureError('El archivo no tiene ninguna hoja de cálculo.');
  }

  const headerRow = worksheet.getRow(1);
  const originalHeaders: string[] = [];
  const columnToOriginalHeader = new Map<number, string>();

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const value = cellToFieldValue(cellToJsonValue(cell.value));
    if (value === null) return;
    originalHeaders.push(value);
    columnToOriginalHeader.set(colNumber, value);
  });

  const normalizedPresent = new Set(originalHeaders.map(normalizeHeader));

  const missingRequired = REQUIRED_HEADERS.filter(
    (header) => !normalizedPresent.has(normalizeHeader(header))
  );

  if (missingRequired.length > 0) {
    throw new PnidFileStructureError(
      `Faltan columnas obligatorias en el archivo: ${missingRequired.join(', ')}.`
    );
  }

  const presentFields = new Set<PnidField>();
  const unknownColumns: string[] = [];

  for (const header of originalHeaders) {
    const normalized = normalizeHeader(header);
    const field = HEADER_TO_FIELD.get(normalized);
    if (field) {
      presentFields.add(field);
      continue;
    }
    if (isKnownUnsyncedHeader(header)) continue;
    unknownColumns.push(header);
  }

  const missingKnownColumns = OPTIONAL_KNOWN_HEADERS.filter(
    (header) => !normalizedPresent.has(normalizeHeader(header))
  );

  const rows: ParsedRow[] = [];
  const totalRows = worksheet.rowCount;

  for (let rowNumber = 2; rowNumber <= totalRows; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const datosFuente: Record<string, unknown> = {};
    const fields: Partial<Record<PnidField, string | null>> = {};
    let pnpid: string | null = null;
    let tagInstrumento: string | null = null;
    let listadoRaw: unknown = null;
    let hasAnyValue = false;

    for (const [colNumber, header] of columnToOriginalHeader) {
      const cell = row.getCell(colNumber);
      const jsonValue = cellToJsonValue(cell.value);
      datosFuente[header] = jsonValue;
      if (jsonValue !== null && jsonValue !== undefined && String(jsonValue).trim().length > 0) {
        hasAnyValue = true;
      }

      const normalized = normalizeHeader(header);
      const field = HEADER_TO_FIELD.get(normalized);

      if (field === 'pnpid') {
        pnpid = normalizePnpid(jsonValue);
      } else if (field === 'tagInstrumento') {
        tagInstrumento = normalizeTag(jsonValue);
      } else if (field === 'listado') {
        listadoRaw = jsonValue;
      } else if (field) {
        fields[field] = cellToFieldValue(jsonValue);
      }
    }

    if (!hasAnyValue) continue; // fila completamente vacía (cola de la hoja)

    rows.push({
      numeroFila: rowNumber - 1,
      pnpid,
      tagInstrumento,
      listado: parseListado(listadoRaw),
      datosFuente,
      fields
    });
  }

  return {
    rows,
    missingKnownColumns,
    unknownColumns,
    presentFields
  };
}
