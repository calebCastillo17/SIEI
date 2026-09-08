/*
 * Carga real de SENALES_COM (scope 620) sobre el PROYECTO REAL YA
 * EXISTENTE — no crea un proyecto nuevo, mismo criterio que
 * importControl620.ts.
 *
 * Lee reference_excel/02_MASTER_IO_620.xlsm (hoja SENALES_COM, 762 filas
 * reales) y llama al backend real por HTTP (nunca INSERT SQL directo) para
 * crear señales clase COM en nucleo.senal. Reutiliza instrumentos/equipos
 * YA EXISTENTES como dueño — nunca crea ninguno.
 *
 * A diferencia de importControl620.ts, esta carga es deliberadamente de
 * UNA sola capa (SIGNAL_LOADED): SWITCH y PUERTO vienen 100% vacíos en la
 * fuente real (0 de 770 filas) — no hay topología de red que cargar
 * todavía, así que no se crea nucleo.enlace_com ni ninguna ruta. Decisión
 * explícita del usuario ("switch y puerto tampoco por ahora ignoremos
 * eso"), mismo principio de carga por capas que CONTROL (una señal puede
 * quedar sin ruta sin que eso sea un error).
 *
 * ESTADO_REVISION viene "PENDIENTE" en las 762 filas — también ignorado
 * por instrucción explícita del usuario, no se importa ese campo.
 *
 * Uso:
 *   npx tsx scripts/importSenalesCom620.ts --project <projectId> --dry-run
 *   npx tsx scripts/importSenalesCom620.ts --project <projectId> --apply
 *   [--file ../reference_excel/02_MASTER_IO_620.xlsm]
 *   [--api http://localhost:3000] [--user admin@siei.local]
 *
 * Idempotente: cada señal se busca por su codigoSenal (ID_SENAL) antes de
 * crear — una segunda ejecución produce SKIP, no duplicados.
 */

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { normalizeNamespacedXlsx } from '../src/lib/pnidImport/parseExcel.js';

// Mismo hallazgo que importControl620.ts: 02_MASTER_IO_620.xlsm arrastra
// nombres definidos rotos de la herramienta VBA legacy — se quitan antes
// de cargar con exceljs, no se leen por nombre definido en ningún lado.
async function stripDefinedNames(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) return buffer;
  const xml = await workbookFile.async('string');
  const rewritten = xml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
  if (rewritten === xml) return buffer;
  zip.file('xl/workbook.xml', rewritten);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ───────────────────────── CLI args ─────────────────────────

interface Args {
  projectId: string;
  filePath: string;
  apiBase: string;
  devUserEmail: string;
  mode: 'dry-run' | 'apply';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  const projectId = get('--project');
  if (!projectId) {
    console.error('Falta --project <projectId>.');
    process.exit(1);
  }

  const dryRun = has('--dry-run');
  const apply = has('--apply');
  if (dryRun && apply) {
    console.error('No usar --dry-run y --apply al mismo tiempo.');
    process.exit(1);
  }
  if (!dryRun && !apply) {
    console.error('Debe indicarse --dry-run o --apply explícitamente.');
    process.exit(1);
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '../..');

  return {
    projectId,
    filePath: get('--file') ?? path.resolve(repoRoot, 'reference_excel/02_MASTER_IO_620.xlsm'),
    apiBase: get('--api') ?? 'http://localhost:3000',
    devUserEmail: get('--user') ?? 'admin@siei.local',
    mode: dryRun ? 'dry-run' : 'apply'
  };
}

// ───────────────────────── HTTP helper ─────────────────────────

async function apiFetch<T = any>(
  apiBase: string,
  devUserEmail: string,
  urlPath: string,
  options: { method?: string; body?: unknown } = {}
): Promise<{ status: number; json: T }> {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const json = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, json };
}

// ───────────────────────── Excel reading ─────────────────────────

interface ComRow {
  idSenal: string | null;
  tagSenal: string | null;
  senal: string | null;
  tagInstrumento: string | null;
  tagInstrumentoAsociado: string | null;
  tagEquipoInst: string | null;
  tipoDato: string | null;
  estado: string | null; // IN/OUT -> direccion_com
  enclavamiento: string | null;
  alarmaHh: number | null;
  alarmaH: number | null;
  alarmaL: number | null;
  alarmaLl: number | null;
  rangoMin: number | null;
  rangoMax: number | null;
  unidadIngenieria: string | null;
  valorNormal: string | null;
  retardo: string | null;
  observacion: string | null;
}

const HEADER_MAP: Record<string, keyof ComRow> = {
  ID_SENAL: 'idSenal',
  TAG_SENAL: 'tagSenal',
  SENAL: 'senal',
  TAG_INSTRUMENTO: 'tagInstrumento',
  TAG_INSTRUMENTO_ASOCIADO: 'tagInstrumentoAsociado',
  TAG_EQUIPO_INST: 'tagEquipoInst',
  TIPO_DATO: 'tipoDato',
  ESTADO: 'estado',
  ENCLAVAMIENTO: 'enclavamiento',
  ALARMA_HH: 'alarmaHh',
  ALARMA_H: 'alarmaH',
  ALARMA_L: 'alarmaL',
  ALARMA_LL: 'alarmaLl',
  RANGO_MIN: 'rangoMin',
  RANGO_MAX: 'rangoMax',
  UNIDAD_INGENIERIA: 'unidadIngenieria',
  VALOR_NORMAL: 'valorNormal',
  RETARDO: 'retardo',
  OBSERVACION: 'observacion'
};

function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s.length === 0 || s === '-') return null;
  return s;
}

function cleanNumber(v: unknown): number | null {
  const s = cleanText(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function readComSheet(filePath: string): Promise<ComRow[]> {
  const rawBuffer = await readFile(filePath);
  const namespaced = await normalizeNamespacedXlsx(rawBuffer);
  const buffer = await stripDefinedNames(namespaced);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('SENALES_COM');
  if (!sheet) throw new Error(`No se encontró la hoja SENALES_COM en ${filePath}`);

  const headerRow = sheet.getRow(1);
  const colByField = new Map<keyof ComRow, number>();
  const maxCol = Math.min(headerRow.cellCount + 5, 200);
  for (let c = 1; c <= maxCol; c++) {
    const raw = headerRow.getCell(c).value;
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text in HEADER_MAP) colByField.set(HEADER_MAP[text as keyof typeof HEADER_MAP], c);
  }

  const missing = Object.values(HEADER_MAP).filter((f) => !colByField.has(f));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas esperadas en SENALES_COM: ${missing.join(', ')}`);
  }

  const rows: ComRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (field: keyof ComRow) => row.getCell(colByField.get(field)!).value;

    const idSenal = cleanText(get('idSenal'));
    if (!idSenal) continue; // fila totalmente en blanco (8 reales)

    rows.push({
      idSenal,
      tagSenal: cleanText(get('tagSenal')),
      senal: cleanText(get('senal')),
      tagInstrumento: cleanText(get('tagInstrumento')),
      tagInstrumentoAsociado: cleanText(get('tagInstrumentoAsociado')),
      tagEquipoInst: cleanText(get('tagEquipoInst')),
      tipoDato: cleanText(get('tipoDato')),
      estado: cleanText(get('estado')),
      enclavamiento: cleanText(get('enclavamiento')),
      alarmaHh: cleanNumber(get('alarmaHh')),
      alarmaH: cleanNumber(get('alarmaH')),
      alarmaL: cleanNumber(get('alarmaL')),
      alarmaLl: cleanNumber(get('alarmaLl')),
      rangoMin: cleanNumber(get('rangoMin')),
      rangoMax: cleanNumber(get('rangoMax')),
      unidadIngenieria: cleanText(get('unidadIngenieria')),
      valorNormal: cleanText(get('valorNormal')),
      retardo: cleanText(get('retardo')),
      observacion: cleanText(get('observacion'))
    });
  }
  return rows;
}

// ───────────────────────── Result tracking ─────────────────────────

interface Counters {
  CREATE: number; SKIP: number; PENDING: number; ERROR: number;
}
function makeCounters(): Counters {
  return { CREATE: 0, SKIP: 0, PENDING: 0, ERROR: 0 };
}

const pendingReasons: Array<{ tag: string; reason: string }> = [];
const errorLog: Array<{ tag: string; message: string }> = [];

// ───────────────────────── Main ─────────────────────────

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== importSenalesCom620.ts (${mode.toUpperCase()}) ===`);
  console.log(`API: ${apiBase}  |  Usuario dev: ${devUserEmail}  |  Archivo: ${filePath}`);

  // 0. Proyecto real
  const projResp = await apiFetch<{ project: { id: string; code: string; name: string } }>(
    apiBase, devUserEmail, `/api/projects/${projectId}`
  );
  if (projResp.status !== 200) {
    console.error('No se pudo leer el proyecto indicado:', projResp.json);
    process.exit(1);
  }
  const project = projResp.json.project;
  console.log(`\nProyecto real: id=${project.id} codigo=${project.code} nombre="${project.name}"`);

  // 1. Leer Excel
  console.log(`\nLeyendo ${filePath} ...`);
  const rows = await readComSheet(filePath);
  console.log(`${rows.length} filas de señal COM real (ID_SENAL poblado).`);

  // 2. Catálogos
  const claseSenalResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/signal-classes');
  const claseComId = (claseSenalResp.json.items ?? []).find((c) => c.codigo === 'COM')?.id;
  if (!claseComId) { console.error('No existe cat_clase_senal COM.'); process.exit(1); }

  const direccionResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/com-directions');
  const direccionIdByCode = new Map<string, string>();
  for (const d of direccionResp.json.items ?? []) direccionIdByCode.set(d.codigo, d.id);

  const tipoDatoResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/com-data-types');
  const tipoDatoIdByCode = new Map<string, string>();
  for (const t of tipoDatoResp.json.items ?? []) tipoDatoIdByCode.set(t.codigo, t.id);

  // 3. Instrumentos y equipos ya existentes (reutilizar, nunca recrear)
  const instrumentsResp = await apiFetch<{ instruments: Array<{ id: string; tagInstrumento: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/instruments`
  );
  const instrumentIdByTag = new Map<string, string>();
  for (const i of instrumentsResp.json.instruments ?? []) instrumentIdByTag.set(i.tagInstrumento, i.id);
  console.log(`Instrumentos existentes en el proyecto: ${instrumentIdByTag.size}`);

  const equipmentResp = await apiFetch<{ equipment: Array<{ id: string; tagEquipo: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/equipment`
  );
  const equipmentIdByTag = new Map<string, string>();
  for (const e of equipmentResp.json.equipment ?? []) equipmentIdByTag.set(e.tagEquipo, e.id);
  console.log(`Equipos existentes en el proyecto: ${equipmentIdByTag.size}`);

  // 4. Señales ya cargadas (idempotencia por codigoSenal = ID_SENAL)
  const existingSignalsResp = await apiFetch<{ signals: Array<{ id: string; codigoSenal: string | null }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/signals`
  );
  const signalIdByCodigo = new Map<string, string>();
  for (const s of existingSignalsResp.json.signals ?? []) if (s.codigoSenal) signalIdByCodigo.set(s.codigoSenal, s.id);

  // 5. Carga
  console.log('\n--- Señales COM ---');
  const counters = makeCounters();

  for (const row of rows) {
    const tagForLog = row.tagSenal ?? row.idSenal ?? '(sin tag)';

    if (signalIdByCodigo.has(row.idSenal!)) {
      counters.SKIP++;
      continue;
    }

    // --- Dueño: instrumento o equipo, ambos ya existentes ---
    let ownerField: 'instrumentoId' | 'equipoId' | null = null;
    let ownerId: string | null = null;
    if (row.tagInstrumento) {
      ownerId = instrumentIdByTag.get(row.tagInstrumento) ?? null;
      ownerField = 'instrumentoId';
      if (!ownerId) {
        pendingReasons.push({ tag: tagForLog, reason: `INSTRUMENT_NOT_FOUND: ${row.tagInstrumento}` });
        counters.PENDING++;
        continue;
      }
    } else if (row.tagEquipoInst) {
      // Hallazgo real: 63 filas traen en TAG_EQUIPO_INST un tag que en
      // realidad es de INSTRUMENTO (válvulas 620-HV-*, señales de estado
      // de la propia válvula), no de equipo — el nombre de la columna en
      // la fuente no distingue los dos casos. Se intenta equipo primero
      // (uso mayoritario real), y si no existe, se prueba como instrumento
      // antes de marcarlo pendiente.
      const equipoId = equipmentIdByTag.get(row.tagEquipoInst) ?? null;
      if (equipoId) {
        ownerId = equipoId;
        ownerField = 'equipoId';
      } else {
        const instId = instrumentIdByTag.get(row.tagEquipoInst) ?? null;
        if (instId) {
          ownerId = instId;
          ownerField = 'instrumentoId';
        }
      }
      if (!ownerId) {
        pendingReasons.push({ tag: tagForLog, reason: `EQUIPMENT_OR_INSTRUMENT_NOT_FOUND: ${row.tagEquipoInst}` });
        counters.PENDING++;
        continue;
      }
    } else {
      pendingReasons.push({ tag: tagForLog, reason: 'Sin TAG_INSTRUMENTO ni TAG_EQUIPO_INST — dueño ambiguo.' });
      counters.PENDING++;
      continue;
    }

    // --- Instrumento agrupador (solo si difiere del dueño y es instrumento) ---
    let instrumentoAgrupadorId: string | null = null;
    if (row.tagInstrumentoAsociado && row.tagInstrumentoAsociado !== row.tagInstrumento) {
      instrumentoAgrupadorId = instrumentIdByTag.get(row.tagInstrumentoAsociado) ?? null;
      if (!instrumentoAgrupadorId) {
        pendingReasons.push({ tag: tagForLog, reason: `Instrumento agrupador ${row.tagInstrumentoAsociado} no encontrado — se omite el campo, no bloquea la señal.` });
      }
    }

    // --- Dirección (ESTADO: IN/OUT) y tipo de dato ---
    const direccionComId = row.estado ? direccionIdByCode.get(row.estado) ?? null : null;
    if (row.estado && !direccionComId) {
      pendingReasons.push({ tag: tagForLog, reason: `ESTADO "${row.estado}" no coincide con ningún cat_direccion_com.` });
    }
    const tipoDatoComId = row.tipoDato ? tipoDatoIdByCode.get(row.tipoDato) ?? null : null;
    if (row.tipoDato && !tipoDatoComId) {
      pendingReasons.push({ tag: tagForLog, reason: `TIPO_DATO "${row.tipoDato}" no coincide con ningún cat_tipo_dato_com.` });
    }

    const body: Record<string, unknown> = {
      [ownerField]: ownerId,
      claseSenalId: claseComId,
      codigoSenal: row.idSenal,
      tagSenal: row.tagSenal,
      nombreCorto: row.senal,
      direccionComId,
      tipoDatoComId,
      enclavamiento: row.enclavamiento,
      alarmaHh: row.alarmaHh,
      alarmaH: row.alarmaH,
      alarmaL: row.alarmaL,
      alarmaLl: row.alarmaLl,
      rangoMin: row.rangoMin,
      rangoMax: row.rangoMax,
      unidadIngenieria: row.unidadIngenieria,
      valorNormal: row.valorNormal,
      retardo: row.retardo,
      observacion: row.observacion
    };
    if (instrumentoAgrupadorId) body.instrumentoAgrupadorId = instrumentoAgrupadorId;

    if (isDryRun) {
      counters.CREATE++;
      continue;
    }

    let created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals`, { method: 'POST', body });

    // Mismo defecto real de la fuente ya visto en CONTROL: TAG_SENAL
    // duplicado entre dos filas físicamente distintas (620-PPD-5015_RDY,
    // 2 filas). Se reintenta sin tagSenal en vez de perder la señal.
    if (created.status === 409 && created.json?.error === 'signal_tag_conflict' && body.tagSenal) {
      pendingReasons.push({ tag: tagForLog, reason: `TAG_SENAL duplicado en la fuente ("${body.tagSenal}") — se cargó con tagSenal=null; requiere corrección manual.` });
      created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals`, {
        method: 'POST', body: { ...body, tagSenal: null }
      });
    }

    if (created.status === 201) {
      counters.CREATE++;
      signalIdByCodigo.set(row.idSenal!, created.json.signal.id);
    } else {
      counters.ERROR++;
      errorLog.push({ tag: tagForLog, message: JSON.stringify(created.json) });
    }
  }

  // ───────────────────────── Reporte final ─────────────────────────
  console.log('\n=== RESUMEN ===');
  console.log(`Modo: ${mode}`);
  console.log(`Proyecto: ${project.code} — ${project.name} (id ${project.id})`);
  console.log(`Señales: CREATE=${counters.CREATE} SKIP=${counters.SKIP} PENDING=${counters.PENDING} ERROR=${counters.ERROR}`);
  console.log(`\nPendientes (${pendingReasons.length}):`);
  pendingReasons.slice(0, 40).forEach((p) => console.log(`  - [${p.tag}] ${p.reason}`));
  if (pendingReasons.length > 40) console.log(`  ... y ${pendingReasons.length - 40} más.`);
  if (errorLog.length > 0) {
    console.log(`\nErrores (${errorLog.length}):`);
    errorLog.slice(0, 30).forEach((e) => console.log(`  ! [${e.tag}] ${e.message}`));
    if (errorLog.length > 30) console.log(`  ... y ${errorLog.length - 30} más.`);
  }

  process.exit(errorLog.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
