/*
 * Carga real de SENALES_CONTROL (scope 620) sobre el PROYECTO REAL YA
 * EXISTENTE — no crea un proyecto nuevo. "620" es un scope dentro de la
 * data de ese proyecto (tags 620-..., hardware 620, fuente Excel 620), no
 * una entidad SIEI propia (ver CLAUDE.md, sección "Subproyectos —
 * requerimiento futuro documentado, no implementado").
 *
 * Lee reference_excel/02_MASTER_IO_620.xlsm (hoja SENALES_CONTROL) y llama
 * al backend real por HTTP (nunca INSERT SQL directo) para: catálogos de
 * módulo (cat.cat_modulo_io / cat.cat_modulo_io_terminal), hardware
 * (gabinete/rack/slot/modulo — con generación automática de canal/terminal
 * de módulo vía los triggers de 015), señales CONTROL, cables y rutas
 * lógicas. Nunca toca 001–015 ni crea tablas nuevas.
 *
 * Carga por capas (ver CLAUDE.md): una señal puede quedar con
 * SIGNAL_LOADED=true pero ROUTE_LOADED=false — eso NO es un error, es el
 * principio explícito de esta carga. Las terminaciones finas (BORNE_JB /
 * BORNERA / T_MODULO -> tramo_conductor/terminacion) quedan deliberadamente
 * fuera de esta fase, sin excepción, sin importar cuántos bornes/terminales
 * "cuadren" en cantidad — esa evidencia fue retirada explícitamente como
 * criterio de completitud (ver docs/DIAGNOSTICO_SENALES_GABINETES.md
 * sección 43 y la instrucción de la fase "IMPLEMENTACIÓN REAL — CONTROL
 * 620 + DATA REAL + INTERFAZ DE CONEXIONADO").
 *
 * Uso:
 *   npx tsx scripts/importControl620.ts --project <projectId> --dry-run
 *   npx tsx scripts/importControl620.ts --project <projectId> --apply
 *   [--file ../reference_excel/02_MASTER_IO_620.xlsm]
 *   [--api http://localhost:3000] [--user admin@siei.local]
 *
 * Idempotente: cada recurso se busca por su clave natural antes de crear
 * (GET primero); una segunda ejecución produce SKIP donde ya existía, no
 * duplicados. No hay una única transacción cruzando proyecto+catálogo+
 * hardware+señal+ruta — cada POST individual ya es transaccional a nivel
 * de su propia tabla (igual que cualquier otro endpoint del backend); este
 * script no inventa una transacción de más alto nivel que el backend no
 * ofrece.
 */

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { normalizeNamespacedXlsx } from '../src/lib/pnidImport/parseExcel.js';

/*
 * 02_MASTER_IO_620.xlsm arrastra ~cientos de nombres definidos rotos de la
 * herramienta VBA legacy que lo generaba (referencias #REF!, funciones
 * LAMBDA `_xlpm.*`, vínculos a libros externos como '[1]PS P-514') —
 * exceljs intenta decodificar TODOS los nombres definidos del libro al
 * cargarlo (workbook-xform.js) y revienta con `decodeEx` al toparse con
 * una referencia que no es un rango de celda simple. Mismo tipo de
 * hallazgo ya documentado para otros dos archivos (el parser P&ID con
 * namespaces con prefijo, y la plantilla LDI con nombres/vínculos
 * heredados de un libro ajeno) — este script nunca lee por nombre
 * definido (siempre por nombre de hoja + texto de encabezado), así que
 * quitar `<definedNames>` de xl/workbook.xml antes de cargar es un
 * no-op funcional y seguro, no una pérdida de dato real.
 */
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

interface ControlRow {
  rio: string | null;
  chasis: string | null;
  slot: string | null;
  modelo: string | null;
  modulo: string | null;
  canal: number | null;
  tModulo: string | null;
  bornera: string | null;
  tagCable: string | null;
  tipoCable: string | null;
  nParCable: number | null;
  cajaEquipo: string | null;
  tagCaja: string | null;
  borneraBloqueCaja: number | null;
  borneJb: string | null;
  tagSenal: string | null;
  senal: string | null;
  tagCableInst: string | null;
  tipoCableInst: string | null;
  destino: string | null;
  tagEquipoInst: string | null;
  tagInstrumento: string | null;
  tagInstrumentoAsociado: string | null;
  idSenal: string | null;
  idInstrumento: string | null;
  tipoSenal: string | null;
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

const HEADER_MAP: Record<string, keyof ControlRow> = {
  RIO: 'rio',
  CHASIS: 'chasis',
  SLOT: 'slot',
  MODELO: 'modelo',
  MODULO: 'modulo',
  CANAL: 'canal',
  T_MODULO: 'tModulo',
  BORNERA: 'bornera',
  TAG_CABLE: 'tagCable',
  TIPO_CABLE: 'tipoCable',
  N_PAR_CABLE: 'nParCable',
  CAJA_EQUIPO: 'cajaEquipo',
  TAG_CAJA: 'tagCaja',
  BORNERA_BLOQUE_CAJA: 'borneraBloqueCaja',
  BORNE_JB: 'borneJb',
  TAG_SENAL: 'tagSenal',
  SENAL: 'senal',
  TAG_CABLE_INST: 'tagCableInst',
  TIPO_CABLE_INST: 'tipoCableInst',
  DESTINO: 'destino',
  TAG_EQUIPO_INST: 'tagEquipoInst',
  TAG_INSTRUMENTO: 'tagInstrumento',
  TAG_INSTRUMENTO_ASOCIADO: 'tagInstrumentoAsociado',
  ID_SENAL: 'idSenal',
  ID_INSTRUMENTO: 'idInstrumento',
  TIPO_SENAL: 'tipoSenal',
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

async function readControlSheet(filePath: string): Promise<ControlRow[]> {
  // 02_MASTER_IO_620.xlsm declara namespaces OOXML con prefijo explícito y
  // referencia una Excel Table por relationship absoluto — mismo problema ya
  // documentado y resuelto para el importador P&ID (ver CLAUDE.md, sección
  // "Real-world parsing gotcha"). Se reutiliza el mismo fix en vez de
  // reimplementarlo.
  const rawBuffer = await readFile(filePath);
  const namespaced = await normalizeNamespacedXlsx(rawBuffer);
  const buffer = await stripDefinedNames(namespaced);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('SENALES_CONTROL');
  if (!sheet) throw new Error(`No se encontró la hoja SENALES_CONTROL en ${filePath}`);

  const headerRow = sheet.getRow(1);
  const colByField = new Map<keyof ControlRow, number>();
  const maxCol = Math.min(headerRow.cellCount + 5, 200);
  for (let c = 1; c <= maxCol; c++) {
    const raw = headerRow.getCell(c).value;
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text in HEADER_MAP) colByField.set(HEADER_MAP[text as keyof typeof HEADER_MAP], c);
  }

  const missing = Object.values(HEADER_MAP).filter((f) => !colByField.has(f));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas esperadas en SENALES_CONTROL: ${missing.join(', ')}`);
  }

  const rows: ControlRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (field: keyof ControlRow) => row.getCell(colByField.get(field)!).value;

    const rio = cleanText(get('rio'));
    if (!rio) continue; // fila totalmente en blanco

    rows.push({
      rio,
      chasis: cleanText(get('chasis')),
      slot: cleanText(get('slot')),
      modelo: cleanText(get('modelo')),
      modulo: cleanText(get('modulo')),
      canal: cleanNumber(get('canal')),
      tModulo: cleanText(get('tModulo')),
      bornera: cleanText(get('bornera')),
      tagCable: cleanText(get('tagCable')),
      tipoCable: cleanText(get('tipoCable')),
      nParCable: cleanNumber(get('nParCable')),
      cajaEquipo: cleanText(get('cajaEquipo')),
      tagCaja: cleanText(get('tagCaja')),
      borneraBloqueCaja: cleanNumber(get('borneraBloqueCaja')),
      borneJb: cleanText(get('borneJb')),
      tagSenal: cleanText(get('tagSenal')),
      senal: cleanText(get('senal')),
      tagCableInst: cleanText(get('tagCableInst')),
      tipoCableInst: cleanText(get('tipoCableInst')),
      destino: cleanText(get('destino')),
      tagEquipoInst: cleanText(get('tagEquipoInst')),
      tagInstrumento: cleanText(get('tagInstrumento')),
      tagInstrumentoAsociado: cleanText(get('tagInstrumentoAsociado')),
      idSenal: cleanText(get('idSenal')),
      idInstrumento: cleanText(get('idInstrumento')),
      tipoSenal: cleanText(get('tipoSenal')),
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

// ───────────────────────── Module catalog (real hardware) ─────────────────────────

const MODULE_MODELS: Array<{ modelo: string; tipoIo: string; canalesMax: number }> = [
  { modelo: '1756-IA16I', tipoIo: 'DI', canalesMax: 16 },
  { modelo: '1756-IF8IH', tipoIo: 'AI', canalesMax: 8 },
  { modelo: '1756-IRT8I', tipoIo: 'RTD', canalesMax: 8 },
  { modelo: '1756-OF8IH', tipoIo: 'AO', canalesMax: 8 },
  { modelo: '1756-OW16I', tipoIo: 'DO', canalesMax: 16 }
];
const FABRICANTE = 'Rockwell Automation';

// TAG_EQUIPO_INST -> tag real vigente, confirmado por el usuario (no una
// inferencia): el Excel quedó desactualizado, el equipo ya existe en el
// catálogo con otro TAG. 620-PPC-XXX3 -> 620-PPD-5016 además resuelve lo
// que antes era un placeholder. 420-UPS-5010/5011 quedan deliberadamente
// FUERA de este mapa: el usuario las corrige él mismo desde la web
// (renombrando el equipo ya existente 420-UPS-* a 620-UPS-*), no las toca
// este importador.
const EQUIPO_TAG_RENOMBRADO: Record<string, string> = {
  '620-PPC-5009': '620-PPD-5014',
  '620-PPC-5010': '620-PPD-5015',
  '620-PPC-XXX3': '620-PPD-5016'
};

// ID_SENAL -> número de canal real confirmado por el usuario. Hallazgo real
// de la fuente: SLOT-11 de 620-PCC-5006 repite CANAL 0 y 1 para 4 señales
// "ST" distintas (620-PPS-5006/620-PPC-5010 ya ocupan legítimamente 0/1;
// 620-PPC-XXX3/620-AGA-5001A decían también 0/1, un choque real, no un bug
// del importador — el módulo es un 1756-OW16I de 16 canales, hay espacio).
// No se adivina: son los 2 únicos casos confirmados explícitamente.
const CANAL_CORREGIDO: Record<string, number> = {
  '620-SIG-001036': 2, // 620-PPC-XXX3_ST
  '620-SIG-001037': 3  // 620-AGA-5001A_ST
};

// TAG_INSTRUMENTO -> tag real vigente, confirmado por el usuario: el
// instrumento con tag placeholder del Excel ya existe en el proyecto
// (cargado por P&ID) bajo su tag definitivo. Verificado contra la
// instancia real: los 3 son huérfanos (sin ninguna señal) antes de este
// mapeo, y su tipo de instrumento calza con el tipo de señal esperado
// (PIT->PI, ZT->ZI, FY->DIC).
const INSTRUMENTO_TAG_RENOMBRADO: Record<string, string> = {
  '620-PIT-XXX5': '620-PIT-5063',
  '620-ZT-XXX1': '620-ZT-5003',
  '620-FY-XXX1': '620-FY-5003'
};

// Regla de derivación de capacidad de cable a partir de TIPO_CABLE, ya
// presentada al usuario en el preview previo (sección 10 del análisis) —
// "{n}-{m}{c|p|Tr}#..." -> m * (1 si c, 2 si p, 3 si Tr).
function parseCapacidadConductores(tipoCable: string): number | null {
  const m = tipoCable.match(/^\s*\d+-(\d+)(c|p|Tr)#/i);
  if (!m) return null;
  const count = Number(m[1]);
  const unit = m[2].toLowerCase();
  const factor = unit === 'c' ? 1 : unit === 'p' ? 2 : 3; // Tr = tríada
  return count * factor;
}

// ───────────────────────── Result tracking ─────────────────────────

type Action = 'CREATE' | 'SKIP' | 'UPDATE' | 'WARNING' | 'ERROR' | 'PENDING';

interface Counters {
  [key: string]: { CREATE: number; SKIP: number; UPDATE: number; WARNING: number; ERROR: number; PENDING: number };
}

function makeCounters(names: string[]): Counters {
  const c: Counters = {};
  for (const n of names) c[n] = { CREATE: 0, SKIP: 0, UPDATE: 0, WARNING: 0, ERROR: 0, PENDING: 0 };
  return c;
}

const pendingReasons: Array<{ tag: string; layer: string; reason: string }> = [];
const errorLog: Array<{ tag: string; layer: string; message: string }> = [];

// ───────────────────────── Main ─────────────────────────

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== importControl620.ts (${mode.toUpperCase()}) ===`);
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
  const allRows = await readControlSheet(filePath);
  const signalRows = allRows.filter((r) => r.idSenal !== null);
  const reserveRows = allRows.filter((r) => r.destino === 'RESERVA');
  console.log(`${allRows.length} filas totales (${signalRows.length} señal real, ${reserveRows.length} RESERVA — no se cargan como señal).`);

  const counters = makeCounters([
    'moduleTypes', 'moduleTerminals', 'gabinetes', 'racks', 'slots', 'modules',
    'equipment', 'cables', 'signals', 'boxes', 'routes'
  ]);

  // 2. Catálogo de modelos de módulo (cat.cat_modulo_io)
  console.log('\n--- Catálogo cat.cat_modulo_io ---');
  const existingModuleTypesResp = await apiFetch<{ moduleTypes: Array<{ id: string; fabricante: string; modelo: string; tipoIoId: string; tipoIoCodigo: string }> }>(
    apiBase, devUserEmail, '/api/catalogs/module-types'
  );
  const moduleTypeIdByModel = new Map<string, { id: string; tipoIoId: string }>();
  for (const row of existingModuleTypesResp.json.moduleTypes ?? []) {
    if (row.fabricante === FABRICANTE) moduleTypeIdByModel.set(row.modelo, { id: row.id, tipoIoId: row.tipoIoId });
  }

  const tipoIoResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/io-types');
  const tipoIoIdByCode = new Map<string, string>();
  for (const t of tipoIoResp.json.items ?? []) tipoIoIdByCode.set(t.codigo, t.id);

  for (const model of MODULE_MODELS) {
    if (moduleTypeIdByModel.has(model.modelo)) {
      counters.moduleTypes.SKIP++;
      console.log(`  = ${model.modelo} (ya existe)`);
      continue;
    }
    const tipoIoId = tipoIoIdByCode.get(model.tipoIo);
    if (!tipoIoId) {
      counters.moduleTypes.ERROR++;
      errorLog.push({ tag: model.modelo, layer: 'moduleTypes', message: `No existe cat_tipo_io con codigo ${model.tipoIo}` });
      continue;
    }
    if (isDryRun) {
      counters.moduleTypes.CREATE++;
      console.log(`  + ${model.modelo} (dry-run)`);
      moduleTypeIdByModel.set(model.modelo, { id: '(dry-run)', tipoIoId });
      continue;
    }
    const created = await apiFetch(apiBase, devUserEmail, '/api/catalogs/module-types', {
      method: 'POST',
      body: { fabricante: FABRICANTE, modelo: model.modelo, tipoIoId, canalesMax: model.canalesMax }
    });
    if (created.status === 201) {
      counters.moduleTypes.CREATE++;
      moduleTypeIdByModel.set(model.modelo, { id: created.json.moduleType.id, tipoIoId });
      console.log(`  + ${model.modelo} creado (id=${created.json.moduleType.id})`);
    } else {
      counters.moduleTypes.ERROR++;
      errorLog.push({ tag: model.modelo, layer: 'moduleTypes', message: JSON.stringify(created.json) });
    }
  }

  // 3. Terminales de catálogo (cat.cat_modulo_io_terminal), derivados de T_MODULO (partido por ';')
  console.log('\n--- Catálogo cat.cat_modulo_io_terminal (derivado de T_MODULO) ---');
  const terminalRowsByModel = new Map<string, Set<string>>(); // modelo -> set("canal|orden|etiqueta")
  for (const row of allRows) {
    if (!row.modelo || !row.tModulo || row.canal === null) continue;
    const labels = row.tModulo.split(';');
    const set = terminalRowsByModel.get(row.modelo) ?? new Set<string>();
    labels.forEach((label, i) => set.add(`${row.canal}|${i + 1}|${label}`));
    terminalRowsByModel.set(row.modelo, set);
  }

  for (const [modelo, entries] of terminalRowsByModel) {
    const modelInfo = moduleTypeIdByModel.get(modelo);
    if (!modelInfo) continue; // ya reportado como ERROR arriba
    const existingTerminalsResp = isDryRun && modelInfo.id === '(dry-run)'
      ? { json: { terminals: [] as Array<{ numeroCanal: number; ordenTerminal: number }> } }
      : await apiFetch<{ terminals: Array<{ numeroCanal: number; ordenTerminal: number }> }>(
          apiBase, devUserEmail, `/api/catalogs/module-types/${modelInfo.id}/terminals`
        );
    const existingKeys = new Set((existingTerminalsResp.json.terminals ?? []).map((t) => `${t.numeroCanal}|${t.ordenTerminal}`));

    for (const entry of entries) {
      const [canalStr, ordenStr, etiqueta] = entry.split('|');
      const key = `${canalStr}|${ordenStr}`;
      if (existingKeys.has(key)) {
        counters.moduleTerminals.SKIP++;
        continue;
      }
      if (isDryRun) {
        counters.moduleTerminals.CREATE++;
        continue;
      }
      const created = await apiFetch(apiBase, devUserEmail, `/api/catalogs/module-types/${modelInfo.id}/terminals`, {
        method: 'POST',
        body: { numeroCanal: Number(canalStr), ordenTerminal: Number(ordenStr), etiquetaTerminal: etiqueta }
      });
      if (created.status === 201) counters.moduleTerminals.CREATE++;
      else if (created.status === 409) counters.moduleTerminals.SKIP++;
      else {
        counters.moduleTerminals.ERROR++;
        errorLog.push({ tag: `${modelo} canal ${canalStr} orden ${ordenStr}`, layer: 'moduleTerminals', message: JSON.stringify(created.json) });
      }
    }
  }
  console.log(`  Terminales de catálogo: CREATE=${counters.moduleTerminals.CREATE} SKIP=${counters.moduleTerminals.SKIP} ERROR=${counters.moduleTerminals.ERROR}`);

  // 4. Hardware real: gabinetes / racks / slots / modulos (a partir de las 488 filas, incluidas RESERVA)
  console.log('\n--- Hardware 620: gabinetes / racks / slots / módulos ---');

  const tiposGabineteResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/tipos-gabinete');
  const tipoGabineteIdByCode = new Map<string, string>();
  for (const t of tiposGabineteResp.json.items ?? []) tipoGabineteIdByCode.set(t.codigo, t.id);

  const GABINETE_TIPO: Record<string, string> = {
    '620-PCC-5006': 'CONTROL',
    '620-RIO-5012': 'RIO',
    '620-RIO-5013': 'RIO'
  };

  const existingGabinetesResp = await apiFetch<{ gabinetes: Array<{ id: string; tagGabinete: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/gabinetes`
  );
  const gabineteIdByTag = new Map<string, string>();
  for (const g of existingGabinetesResp.json.gabinetes ?? []) gabineteIdByTag.set(g.tagGabinete, g.id);

  const distinctGabinetes = [...new Set(allRows.map((r) => r.rio))];
  for (const tag of distinctGabinetes) {
    if (gabineteIdByTag.has(tag)) { counters.gabinetes.SKIP++; continue; }
    const tipoCodigo = GABINETE_TIPO[tag];
    if (!tipoCodigo) {
      counters.gabinetes.ERROR++;
      errorLog.push({ tag, layer: 'gabinetes', message: 'Tipo de gabinete no determinado — gabinete no listado en GABINETE_TIPO.' });
      continue;
    }
    const tipoId = tipoGabineteIdByCode.get(tipoCodigo);
    if (isDryRun) { counters.gabinetes.CREATE++; gabineteIdByTag.set(tag, `(dry-run:gabinete:${tag})`); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/gabinetes`, {
      method: 'POST', body: { tagGabinete: tag, tipoGabineteId: tipoId }
    });
    if (created.status === 201) { counters.gabinetes.CREATE++; gabineteIdByTag.set(tag, created.json.gabinete.id); }
    else { counters.gabinetes.ERROR++; errorLog.push({ tag, layer: 'gabinetes', message: JSON.stringify(created.json) }); }
  }

  const existingRacksResp = await apiFetch<{ racks: Array<{ id: string; gabineteId: string; numeroRack: number }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/racks`
  );
  const rackIdByKey = new Map<string, string>(); // `${gabineteId}|${numeroRack}`
  for (const r of existingRacksResp.json.racks ?? []) rackIdByKey.set(`${r.gabineteId}|${r.numeroRack}`, r.id);

  const distinctRacks = [...new Set(allRows.map((r) => `${r.rio}|${r.chasis}`))];
  for (const combo of distinctRacks) {
    const [rio, chasis] = combo.split('|');
    const gabineteId = gabineteIdByTag.get(rio);
    if (!gabineteId) continue; // ya reportado
    const numeroRack = Number((chasis ?? '').replace(/\D/g, '')) || 1;
    const key = `${gabineteId}|${numeroRack}`;
    if (rackIdByKey.has(key)) { counters.racks.SKIP++; continue; }
    if (isDryRun) { counters.racks.CREATE++; rackIdByKey.set(key, `(dry-run:rack:${key})`); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/racks`, {
      method: 'POST', body: { gabineteId, numeroRack }
    });
    if (created.status === 201) { counters.racks.CREATE++; rackIdByKey.set(key, created.json.rack.id); }
    else { counters.racks.ERROR++; errorLog.push({ tag: combo, layer: 'racks', message: JSON.stringify(created.json) }); }
  }

  const existingSlotsResp = await apiFetch<{ slots: Array<{ id: string; rackId: string; numeroSlot: number }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/slots`
  );
  const slotIdByKey = new Map<string, string>(); // `${rackId}|${numeroSlot}`
  for (const s of existingSlotsResp.json.slots ?? []) slotIdByKey.set(`${s.rackId}|${s.numeroSlot}`, s.id);

  const distinctSlots = [...new Set(allRows.map((r) => `${r.rio}|${r.chasis}|${r.slot}|${r.modelo}`))];
  const slotIdByRowKey = new Map<string, string>(); // `${rio}|${chasis}|${slot}` -> slotId (para módulo)
  for (const combo of distinctSlots) {
    const [rio, chasis, slot, modelo] = combo.split('|');
    const gabineteId = gabineteIdByTag.get(rio);
    if (!gabineteId) continue;
    const numeroRack = Number((chasis ?? '').replace(/\D/g, '')) || 1;
    const rackId = rackIdByKey.get(`${gabineteId}|${numeroRack}`);
    if (!rackId) continue;
    const numeroSlot = Number((slot ?? '').replace(/\D/g, ''));
    const key = `${rackId}|${numeroSlot}`;
    const rowKey = `${rio}|${chasis}|${slot}`;
    if (slotIdByKey.has(key)) { counters.slots.SKIP++; slotIdByRowKey.set(rowKey, slotIdByKey.get(key)!); continue; }
    if (isDryRun) { counters.slots.CREATE++; slotIdByKey.set(key, `(dry-run:slot:${key})`); slotIdByRowKey.set(rowKey, `(dry-run:slot:${key})`); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/slots`, {
      method: 'POST', body: { rackId, numeroSlot }
    });
    if (created.status === 201) {
      counters.slots.CREATE++;
      slotIdByKey.set(key, created.json.slot.id);
      slotIdByRowKey.set(rowKey, created.json.slot.id);
    } else { counters.slots.ERROR++; errorLog.push({ tag: combo, layer: 'slots', message: JSON.stringify(created.json) }); }
  }

  const existingModulesResp = await apiFetch<{ modules: Array<{ id: string; slotId: string; catalogoModuloId: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/modules`
  );
  const moduleIdBySlotId = new Map<string, string>();
  for (const m of existingModulesResp.json.modules ?? []) moduleIdBySlotId.set(m.slotId, m.id);

  const moduleIdByRowKey = new Map<string, string>(); // `${rio}|${chasis}|${slot}` -> moduleId
  for (const combo of distinctSlots) {
    const [rio, chasis, slot, modelo] = combo.split('|');
    const rowKey = `${rio}|${chasis}|${slot}`;
    const slotId = slotIdByRowKey.get(rowKey);
    const modelInfo = moduleTypeIdByModel.get(modelo);
    if (!slotId || !modelInfo) continue;
    if (moduleIdBySlotId.has(slotId)) { counters.modules.SKIP++; moduleIdByRowKey.set(rowKey, moduleIdBySlotId.get(slotId)!); continue; }
    if (isDryRun) { counters.modules.CREATE++; const placeholder = `(dry-run:module:${rowKey})`; moduleIdByRowKey.set(rowKey, placeholder); moduleIdBySlotId.set(slotId, placeholder); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/modules`, {
      method: 'POST', body: { slotId, catalogoModuloId: modelInfo.id }
    });
    if (created.status === 201) {
      counters.modules.CREATE++;
      moduleIdByRowKey.set(rowKey, created.json.module.id);
      moduleIdBySlotId.set(slotId, created.json.module.id);
    } else { counters.modules.ERROR++; errorLog.push({ tag: combo, layer: 'modules', message: JSON.stringify(created.json) }); }
  }

  console.log(`  Gabinetes: +${counters.gabinetes.CREATE} =${counters.gabinetes.SKIP}  |  Racks: +${counters.racks.CREATE} =${counters.racks.SKIP}  |  Slots: +${counters.slots.CREATE} =${counters.slots.SKIP}  |  Módulos: +${counters.modules.CREATE} =${counters.modules.SKIP}`);

  // Canales: leer los canales generados automáticamente por cada módulo (para asignar canal_id a la señal)
  const canalIdByModuleAndNumero = new Map<string, string>(); // `${moduleId}|${numero}` -> canalId
  if (!isDryRun) {
    for (const [rowKey, moduleId] of moduleIdByRowKey) {
      if (canalIdByModuleAndNumero.has(`${moduleId}|0`) || moduleId === '(dry-run)') continue;
      const chResp = await apiFetch<{ channels: Array<{ id: string; numeroCanal: number }> }>(
        apiBase, devUserEmail, `/api/projects/${projectId}/channels?moduloId=${moduleId}`
      );
      for (const ch of chResp.json.channels ?? []) canalIdByModuleAndNumero.set(`${moduleId}|${ch.numeroCanal}`, ch.id);
    }
  }

  // 5. Instrumentos y equipos ya existentes (reutilizar, nunca recrear)
  console.log('\n--- Instrumentos y equipos existentes (reutilizados) ---');
  const instrumentsResp = await apiFetch<{ instruments: Array<{ id: string; tagInstrumento: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/instruments`
  );
  const instrumentIdByTag = new Map<string, string>();
  for (const i of instrumentsResp.json.instruments ?? []) instrumentIdByTag.set(i.tagInstrumento, i.id);
  console.log(`  Instrumentos existentes en el proyecto: ${instrumentIdByTag.size}`);

  const equipmentResp = await apiFetch<{ equipment: Array<{ id: string; tagEquipo: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/equipment`
  );
  const equipmentIdByTag = new Map<string, string>();
  for (const e of equipmentResp.json.equipment ?? []) equipmentIdByTag.set(e.tagEquipo, e.id);
  console.log(`  Equipos existentes en el proyecto: ${equipmentIdByTag.size}`);

  // 6. Señales CONTROL, IO, cables, cajas y rutas
  console.log('\n--- Señales CONTROL (269 filas reales) ---');

  const existingSignalsResp = await apiFetch<{ signals: Array<{ id: string; codigoSenal: string | null }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/signals`
  );
  const signalIdByCodigo = new Map<string, string>();
  for (const s of existingSignalsResp.json.signals ?? []) if (s.codigoSenal) signalIdByCodigo.set(s.codigoSenal, s.id);

  const claseSenalResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/signal-classes');
  const claseControlId = (claseSenalResp.json.items ?? []).find((c) => c.codigo === 'CONTROL')?.id;
  if (!claseControlId) { console.error('No existe cat_clase_senal CONTROL.'); process.exit(1); }

  const cableIdByTag = new Map<string, string>();
  const existingCablesResp = await apiFetch<{ cables: Array<{ id: string; tagCable: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/cables`
  );
  for (const c of existingCablesResp.json.cables ?? []) cableIdByTag.set(c.tagCable, c.id);

  const cajaIdByTag = new Map<string, string>();
  const existingCajasResp = await apiFetch<{ boxes: Array<{ id: string; tagCaja: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/boxes`
  );
  for (const c of existingCajasResp.json.boxes ?? []) cajaIdByTag.set(c.tagCaja, c.id);

  // Puntos de conexión reutilizables (uno por dueño/caja/gabinete/módulo — la ruta es lógica, la terminación fina se difiere).
  const puntoIdByOwnerKey = new Map<string, string>();
  async function ensurePunto(owner: { instrumentoId?: string; equipoId?: string; cajaId?: string; gabineteId?: string; moduloId?: string }, key: string): Promise<string | null> {
    if (puntoIdByOwnerKey.has(key)) return puntoIdByOwnerKey.get(key)!;
    if (isDryRun) { puntoIdByOwnerKey.set(key, '(dry-run)'); return '(dry-run)'; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/connection-points`, {
      method: 'POST', body: owner
    });
    if (created.status === 201) { puntoIdByOwnerKey.set(key, created.json.connectionPoint.id); return created.json.connectionPoint.id; }
    return null;
  }

  const isPlaceholder = (tag: string) => tag.includes('XXX') || /50X/.test(tag);

  let signalLoaded = 0, ioLoaded = 0, routeLoaded = 0;

  for (const row of signalRows) {
    const tagForLog = row.tagSenal ?? row.idSenal ?? '(sin tag)';

    // --- Dueño ---
    let ownerField: 'instrumentoId' | 'equipoId' | null = null;
    let ownerId: string | null = null;
    if (row.tagInstrumento) {
      // Renombres confirmados por el usuario: el tag placeholder del Excel
      // (XXX) quedó obsoleto, el instrumento real ya existe en el proyecto
      // (cargado por P&ID) con su tag definitivo.
      const tagInstResuelto = INSTRUMENTO_TAG_RENOMBRADO[row.tagInstrumento] ?? row.tagInstrumento;
      ownerId = instrumentIdByTag.get(tagInstResuelto) ?? null;
      ownerField = 'instrumentoId';
      if (!ownerId) {
        pendingReasons.push({ tag: tagForLog, layer: 'signal', reason: `INSTRUMENT_NOT_FOUND: ${row.tagInstrumento}` });
        counters.signals.PENDING++;
        continue;
      }
    } else if (row.tagEquipoInst) {
      // Renombres confirmados por el usuario (no una inferencia del
      // importador): el TAG del Excel quedó obsoleto, el equipo real ya
      // existe con otro TAG. PPC-XXX3 -> PPD-5016 además reemplaza un
      // placeholder por un tag definitivo.
      const tagResuelto = EQUIPO_TAG_RENOMBRADO[row.tagEquipoInst] ?? row.tagEquipoInst;
      ownerId = equipmentIdByTag.get(tagResuelto) ?? null;
      ownerField = 'equipoId';
      if (!ownerId) {
        pendingReasons.push({ tag: tagForLog, layer: 'signal', reason: `EQUIPMENT_PENDING: ${row.tagEquipoInst} no existe en fuente autoritativa/proyecto` });
        counters.signals.PENDING++;
        continue;
      }
    } else {
      pendingReasons.push({ tag: tagForLog, layer: 'signal', reason: 'Sin TAG_INSTRUMENTO ni TAG_EQUIPO_INST — dueño ambiguo.' });
      counters.signals.PENDING++;
      continue;
    }

    // --- Instrumento agrupador (solo si difiere del dueño y es instrumento) ---
    let instrumentoAgrupadorId: string | null = null;
    if (row.tagInstrumentoAsociado && row.tagInstrumentoAsociado !== row.tagInstrumento) {
      instrumentoAgrupadorId = instrumentIdByTag.get(row.tagInstrumentoAsociado) ?? null;
      if (!instrumentoAgrupadorId) {
        pendingReasons.push({ tag: tagForLog, layer: 'agrupador', reason: `Instrumento agrupador ${row.tagInstrumentoAsociado} no encontrado — se omite el campo, no bloquea la señal.` });
      }
    }

    // --- Tipo IO ---
    const tipoIoId = row.modulo ? tipoIoIdByCode.get(row.modulo) ?? null : null;

    // --- IO: canal ---
    const rowKey = `${row.rio}|${row.chasis}|${row.slot}`;
    const moduleId = moduleIdByRowKey.get(rowKey) ?? null;
    // Corrección confirmada por el usuario: el Excel repite CANAL 0 y 1 de
    // SLOT-11 (620-PCC-5006) para 4 señales "ST" distintas (defecto real de
    // la fuente, no un bug del importador — 620-PPS-5006_ST y
    // 620-PPC-5010_ST ya ocupan 0 y 1 legítimamente). El usuario confirmó
    // los canales físicos reales para las otras dos.
    const canalNumeroReal = CANAL_CORREGIDO[row.idSenal ?? ''] ?? row.canal;
    let canalId: string | null = null;
    if (moduleId && canalNumeroReal !== null) {
      canalId = isDryRun ? '(dry-run)' : canalIdByModuleAndNumero.get(`${moduleId}|${canalNumeroReal}`) ?? null;
    }
    if (!canalId) {
      pendingReasons.push({ tag: tagForLog, layer: 'io', reason: `Canal no resuelto (${rowKey} canal ${row.canal}).` });
    }

    // --- Crear/actualizar señal ---
    if (signalIdByCodigo.has(row.idSenal!)) {
      counters.signals.SKIP++;
      signalLoaded++;
      if (canalId) ioLoaded++;
      continue;
    }

    const body: Record<string, unknown> = {
      [ownerField]: ownerId,
      claseSenalId: claseControlId,
      codigoSenal: row.idSenal,
      tagSenal: row.tagSenal,
      nombreCorto: row.senal,
      tipoIoId,
      canalId,
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
      counters.signals.CREATE++;
      signalLoaded++;
      if (canalId) ioLoaded++;
    } else {
      let created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals`, { method: 'POST', body });

      // Defecto real de la fuente encontrado en APPLY (no del importador):
      // 2 pares de filas físicamente distintas (distinto ID_SENAL, distinto
      // SENAL, distinto instrumento, distinto canal) comparten el mismo
      // TAG_SENAL por un error de copia en el Excel (p. ej. 620-HV-5078_ZIO
      // usado tanto para ZIO como para ZIC). tagSenal es opcional desde 013
      // — no se inventa el valor correcto, se reintenta sin tag en vez de
      // perder la señal completa por un campo secundario ya demostrado
      // incorrecto. Se reporta explícitamente como hallazgo de calidad de
      // dato, no como una corrección silenciosa.
      if (created.status === 409 && created.json?.error === 'signal_tag_conflict' && body.tagSenal) {
        pendingReasons.push({ tag: tagForLog, layer: 'data-quality', reason: `TAG_SENAL duplicado en la fuente ("${body.tagSenal}") — se cargó la señal con tagSenal=null; requiere corrección manual del Excel/otra señal ya cargada con ese tag.` });
        created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals`, {
          method: 'POST', body: { ...body, tagSenal: null }
        });
      }

      if (created.status === 201) {
        counters.signals.CREATE++;
        signalIdByCodigo.set(row.idSenal!, created.json.signal.id);
        signalLoaded++;
        if (canalId) ioLoaded++;
      } else {
        counters.signals.ERROR++;
        errorLog.push({ tag: tagForLog, layer: 'signal', message: JSON.stringify(created.json) });
        continue;
      }
    }

    // --- Cable(s) ---
    // Solo se crea cuando el tipo es interpretable sin ambigüedad. Caso RTD
    // (TAG_CABLE == TAG_CABLE_INST con TIPO_CABLE/TIPO_CABLE_INST distintos)
    // queda deliberadamente CABLE_PENDING — no se inventa cuál de los dos
    // tipos es el real.
    const cableAmbiguo = row.modulo === 'RTD' && row.tagCable && row.tagCable === row.tagCableInst && row.tipoCable !== row.tipoCableInst;
    for (const [tagCable, tipoCable] of [[row.tagCable, row.tipoCable], [row.tagCableInst, row.tipoCableInst]] as const) {
      if (!tagCable || !tipoCable) continue;
      if (cableAmbiguo) {
        pendingReasons.push({ tag: tagForLog, layer: 'cable', reason: `CABLE_PENDING: ${tagCable} — TIPO_CABLE/TIPO_CABLE_INST ambiguos (RTD, ver sección 10 del diagnóstico).` });
        continue;
      }
      if (cableIdByTag.has(tagCable)) { counters.cables.SKIP++; continue; }
      const capacidad = parseCapacidadConductores(tipoCable);
      if (!capacidad) {
        pendingReasons.push({ tag: tagForLog, layer: 'cable', reason: `CABLE_PENDING: ${tagCable} — no se pudo derivar capacidadConductores de "${tipoCable}".` });
        continue;
      }
      if (isDryRun) { counters.cables.CREATE++; cableIdByTag.set(tagCable, '(dry-run)'); continue; }
      const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/cables`, {
        method: 'POST', body: { tagCable, tipoCable, capacidadConductores: capacidad }
      });
      if (created.status === 201) { counters.cables.CREATE++; cableIdByTag.set(tagCable, created.json.cable.id); }
      else if (created.status === 409) { counters.cables.SKIP++; }
      else { counters.cables.ERROR++; errorLog.push({ tag: tagCable, layer: 'cable', message: JSON.stringify(created.json) }); }
    }

    // --- Caja (si hay TAG_CAJA real, no placeholder) ---
    let cajaId: string | null = null;
    if (row.tagCaja) {
      if (isPlaceholder(row.tagCaja)) {
        pendingReasons.push({ tag: tagForLog, layer: 'route', reason: `ROUTE_PENDING: caja placeholder ${row.tagCaja} — tag no definitivo, no se materializa todavía.` });
      } else if (cajaIdByTag.has(row.tagCaja)) {
        cajaId = cajaIdByTag.get(row.tagCaja)!;
      } else if (isDryRun) {
        cajaId = '(dry-run)';
        cajaIdByTag.set(row.tagCaja, cajaId);
        counters.boxes.CREATE++;
      } else {
        const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`, {
          method: 'POST', body: { tagCaja: row.tagCaja }
        });
        if (created.status === 201) { cajaId = created.json.box.id; cajaIdByTag.set(row.tagCaja, cajaId); counters.boxes.CREATE++; }
        else if (created.status === 409) { counters.boxes.SKIP++; }
        else { counters.boxes.ERROR++; errorLog.push({ tag: row.tagCaja, layer: 'boxes', message: JSON.stringify(created.json) }); }
      }
    }

    // --- Ruta lógica ---
    if (!moduleId) {
      pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: módulo no resuelto.' });
      continue;
    }
    const gabineteId = gabineteIdByTag.get(row.rio);
    if (!gabineteId) {
      pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: gabinete no resuelto.' });
      continue;
    }

    // Origen físico: para dueño equipo, solo si CAJA_EQUIPO coincide con el
    // propio dueño (sin ambigüedad tipo PPS/AFM); si difiere, no se asume
    // cuál es el nodo físico real -> ROUTE_PENDING (ver sección 18 de la
    // instrucción de esta fase).
    let originField: 'instrumentoId' | 'equipoId' = ownerField;
    let originId = ownerId;
    if (ownerField === 'equipoId' && row.cajaEquipo && row.cajaEquipo !== row.tagEquipoInst && !row.tagCaja) {
      pendingReasons.push({ tag: tagForLog, layer: 'route', reason: `ROUTE_PENDING: nodo físico de origen ambiguo (dueño=${row.tagEquipoInst} vs CAJA_EQUIPO=${row.cajaEquipo}) — no se asume cuál es el origen real.` });
      continue;
    }

    if (row.tagCaja && !isPlaceholder(row.tagCaja) && cajaId) {
      // instrumento/equipo -> caja -> gabinete -> modulo (4 nodos, 3 tramos)
      const puntoOrigen = await ensurePunto({ [originField]: originId } as any, `owner:${originField}:${originId}`);
      const puntoCaja = await ensurePunto({ cajaId }, `caja:${cajaId}`);
      const puntoGabinete = await ensurePunto({ gabineteId }, `gabinete:${gabineteId}`);
      const puntoModulo = await ensurePunto({ moduloId: moduleId }, `modulo:${moduleId}`);
      if (!puntoOrigen || !puntoCaja || !puntoGabinete || !puntoModulo) {
        pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: no se pudo crear algún punto_conexion.' });
        continue;
      }
      if (isDryRun) { counters.routes.CREATE++; routeLoaded++; continue; }
      const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/routes`, {
        method: 'POST',
        body: {
          senalId: signalIdByCodigo.get(row.idSenal!),
          segments: [
            { puntoOrigenId: puntoOrigen, puntoDestinoId: puntoCaja, parConductorId: null },
            { puntoOrigenId: puntoCaja, puntoDestinoId: puntoGabinete, parConductorId: null },
            { puntoOrigenId: puntoGabinete, puntoDestinoId: puntoModulo, parConductorId: null }
          ]
        }
      });
      if (created.status === 201) { counters.routes.CREATE++; routeLoaded++; }
      else if (created.status === 409) { counters.routes.SKIP++; routeLoaded++; }
      else { counters.routes.ERROR++; errorLog.push({ tag: tagForLog, layer: 'route', message: JSON.stringify(created.json) }); }
    } else if (!row.tagCaja) {
      // instrumento/equipo -> gabinete -> modulo (3 nodos, 2 tramos)
      const puntoOrigen = await ensurePunto({ [originField]: originId } as any, `owner:${originField}:${originId}`);
      const puntoGabinete = await ensurePunto({ gabineteId }, `gabinete:${gabineteId}`);
      const puntoModulo = await ensurePunto({ moduloId: moduleId }, `modulo:${moduleId}`);
      if (!puntoOrigen || !puntoGabinete || !puntoModulo) {
        pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: no se pudo crear algún punto_conexion.' });
        continue;
      }
      if (isDryRun) { counters.routes.CREATE++; routeLoaded++; continue; }
      const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/routes`, {
        method: 'POST',
        body: {
          senalId: signalIdByCodigo.get(row.idSenal!),
          segments: [
            { puntoOrigenId: puntoOrigen, puntoDestinoId: puntoGabinete, parConductorId: null },
            { puntoOrigenId: puntoGabinete, puntoDestinoId: puntoModulo, parConductorId: null }
          ]
        }
      });
      if (created.status === 201) { counters.routes.CREATE++; routeLoaded++; }
      else if (created.status === 409) { counters.routes.SKIP++; routeLoaded++; }
      else { counters.routes.ERROR++; errorLog.push({ tag: tagForLog, layer: 'route', message: JSON.stringify(created.json) }); }
    }
    // (else: caja placeholder ya reportada como ROUTE_PENDING arriba)
  }

  // ───────────────────────── Reporte final ─────────────────────────
  console.log('\n=== RESUMEN ===');
  console.log(`Modo: ${mode}`);
  console.log(`Proyecto: ${project.code} — ${project.name} (id ${project.id})`);
  for (const [name, c] of Object.entries(counters)) {
    console.log(`  ${name.padEnd(16)} CREATE=${c.CREATE} SKIP=${c.SKIP} UPDATE=${c.UPDATE} PENDING=${c.PENDING} ERROR=${c.ERROR}`);
  }
  console.log(`\nSeñales con capa SIGNAL_LOADED: ${signalLoaded} / ${signalRows.length}`);
  console.log(`Señales con capa IO_LOADED (canal asignado): ${ioLoaded} / ${signalRows.length}`);
  console.log(`Señales con capa ROUTE_LOADED: ${routeLoaded} / ${signalRows.length}`);
  console.log(`\nPendientes (${pendingReasons.length}):`);
  const pendingByLayer = new Map<string, number>();
  for (const p of pendingReasons) pendingByLayer.set(p.layer, (pendingByLayer.get(p.layer) ?? 0) + 1);
  for (const [layer, n] of pendingByLayer) console.log(`  ${layer}: ${n}`);
  if (errorLog.length > 0) {
    console.log(`\nErrores (${errorLog.length}):`);
    errorLog.slice(0, 30).forEach((e) => console.log(`  ! [${e.layer}] ${e.tag}: ${e.message}`));
    if (errorLog.length > 30) console.log(`  ... y ${errorLog.length - 30} más.`);
  }

  process.exit(errorLog.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
