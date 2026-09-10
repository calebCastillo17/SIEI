/*
 * Carga real de SENALES_CONTROL (scope 420) sobre el PROYECTO REAL YA
 * EXISTENTE — adaptado de importControl620.ts, misma disciplina general
 * (idempotente, nunca inventa, PENDING en vez de adivinar), pero con un
 * cambio de fondo en cómo se resuelve el DUEÑO de cada señal:
 *
 * En 620, SENALES_CONTROL.TAG_INSTRUMENTO apuntaba directo a un
 * instrumento YA existente en el proyecto (el importador original nunca
 * creó instrumentos-fantasma — esos ya existían de un import P&ID viejo,
 * anterior a la regla ES_SENAL). En 420 partimos de una base limpia: las
 * 522 señales CONTROL reales YA fueron creadas directo con su dueño real
 * (crearSenalesControl420DesdeReporte.ts, a partir del reporte P&ID nuevo
 * — "Instrumento Asociado" + Type). Este script entonces NO crea
 * señales — busca la señal YA CREADA que corresponde a cada fila de
 * SENALES_CONTROL y le cuelga lo que el P&ID no trae: hardware real
 * (gabinete/rack/slot/módulo/canal), cable y ruta física.
 *
 * El cruce es por TAG_SENAL, con varios candidatos (pedido explícito del
 * usuario tras confirmar el caso real 420-TE-5048/S420-TI-5048, y
 * verificado con datos reales de las 522 señales creadas — 353/363,
 * 97%, de las filas con dueño instrumento matchean con esto):
 *   1. El propio TAG_SENAL de la fila, tal cual — a veces ya está
 *      actualizado (ej. transmisores: TIPO_INSTRUMENTO="LIT" pero
 *      TAG_SENAL="...∗_LI", que es justo el que el reporte nuevo usa).
 *   2. Recalculado como "{instrumento asociado}_{TIPO_INSTRUMENTO}" — a
 *      veces el TAG_SENAL de la fila está desactualizado (ej.
 *      TAG_SENAL="...ZIC" pero TIPO_INSTRUMENTO="ZSC", que es el vigente).
 *   3. TIPO_INSTRUMENTO terminado en "T" (transmisor) -> mismo con "I" al
 *      final (LIT->LI, FIT->FI, PIT->PI) — mismo hallazgo T->I ya
 *      validado en 620.
 *   4. TIPO_INSTRUMENTO terminado en "SL"/"SH" (switch) -> mismo con
 *      "AL"/"AH" (alarma): FSL->FAL, LSL->LAL — encontrado con datos
 *      reales de 420, análogo al S->A de 620.
 * Si ninguno de los 4 candidatos matchea una señal ya creada, la fila
 * queda PENDING (no se inventa a cuál señal pertenece) — ejemplos reales
 * encontrados: granularidad distinta entre el maestro interno y el
 * reporte nuevo (SENALES_CONTROL dice "420-LIT-5035", el reporte nuevo ya
 * separó esa misma señal en "420-LIT-5035A"/"420-LIT-5035B").
 *
 * Dueño EQUIPO (TAG_EQUIPO_INST, ~123 filas reales) queda deliberadamente
 * FUERA de este script: crearSenalesControl420DesdeReporte.ts solo creó
 * señales para dueño INSTRUMENTO (vía "Instrumento Asociado"); una señal
 * de equipo es un paso aparte, no implementado todavía — se reporta como
 * PENDING, no se inventa.
 *
 * Uso:
 *   npx tsx scripts/importControl420.ts --project <projectId> --dry-run
 *   npx tsx scripts/importControl420.ts --project <projectId> --apply
 *   [--file ../reference_excel/02_MASTER_IO_420.xlsm]
 *   [--api http://localhost:3000] [--user admin@siei.local]
 */

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { normalizeNamespacedXlsx } from '../src/lib/pnidImport/parseExcel.js';

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
    filePath: get('--file') ?? path.resolve(repoRoot, 'reference_excel/02_MASTER_IO_420.xlsm'),
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
  cajaEquipo: string | null;
  tagCaja: string | null;
  destino: string | null;
  servicio: string | null;
  tagSenal: string | null;
  tagCableInst: string | null;
  tipoCableInst: string | null;
  tagEquipoInst: string | null;
  tagInstrumento: string | null;
  tagInstrumentoAsociado: string | null;
  idSenal: string | null;
  tipoInstrumento: string | null;
  senal: string | null;
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
  CAJA_EQUIPO: 'cajaEquipo',
  TAG_CAJA: 'tagCaja',
  DESTINO: 'destino',
  SERVICIO: 'servicio',
  TAG_SENAL: 'tagSenal',
  TAG_CABLE_INST: 'tagCableInst',
  TIPO_CABLE_INST: 'tipoCableInst',
  TAG_EQUIPO_INST: 'tagEquipoInst',
  TAG_INSTRUMENTO: 'tagInstrumento',
  TAG_INSTRUMENTO_ASOCIADO: 'tagInstrumentoAsociado',
  ID_SENAL: 'idSenal',
  TIPO_INSTRUMENTO: 'tipoInstrumento',
  SENAL: 'senal',
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

// Typo real encontrado en el Excel (64 filas): "11756-IA16I" con un "1" de
// más al principio — mismo modelo real que "1756-IA16I" (confirmado: no
// existe ningún módulo "11756-*" real de Rockwell, y el resto de las
// filas de esos mismos RIO/CHASIS/SLOT usan "1756-IA16I" normal).
function normalizarModelo(modelo: string | null): string | null {
  if (modelo === '11756-IA16I') return '1756-IA16I';
  return modelo;
}

async function readControlSheet(filePath: string): Promise<ControlRow[]> {
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
    if (!rio) continue;

    rows.push({
      rio,
      chasis: cleanText(get('chasis')),
      slot: cleanText(get('slot')),
      modelo: normalizarModelo(cleanText(get('modelo'))),
      modulo: cleanText(get('modulo')),
      canal: cleanNumber(get('canal')),
      tModulo: cleanText(get('tModulo')),
      bornera: cleanText(get('bornera')),
      tagCable: cleanText(get('tagCable')),
      tipoCable: cleanText(get('tipoCable')),
      cajaEquipo: cleanText(get('cajaEquipo')),
      tagCaja: cleanText(get('tagCaja')),
      destino: cleanText(get('destino')),
      servicio: cleanText(get('servicio')),
      tagSenal: cleanText(get('tagSenal')),
      tagCableInst: cleanText(get('tagCableInst')),
      tipoCableInst: cleanText(get('tipoCableInst')),
      tagEquipoInst: cleanText(get('tagEquipoInst')),
      tagInstrumento: cleanText(get('tagInstrumento')),
      tagInstrumentoAsociado: cleanText(get('tagInstrumentoAsociado')),
      idSenal: cleanText(get('idSenal')),
      tipoInstrumento: cleanText(get('tipoInstrumento')),
      senal: cleanText(get('senal')),
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

// 1756-IE2C: confirmado con datos reales — su propia columna MODULO/
// MODULO_VISTA en el Excel ya dice "AI" para las 28 filas que lo usan
// (analógico, 2 canales — modelo real de Rockwell).
const MODULE_MODELS: Array<{ modelo: string; tipoIo: string; canalesMax: number }> = [
  { modelo: '1756-IA16I', tipoIo: 'DI', canalesMax: 16 },
  { modelo: '1756-IF8IH', tipoIo: 'AI', canalesMax: 8 },
  { modelo: '1756-IRT8I', tipoIo: 'RTD', canalesMax: 8 },
  { modelo: '1756-OF8IH', tipoIo: 'AO', canalesMax: 8 },
  { modelo: '1756-OW16I', tipoIo: 'DO', canalesMax: 16 },
  { modelo: '1756-IE2C', tipoIo: 'AI', canalesMax: 2 }
];
const FABRICANTE = 'Rockwell Automation';

// Todos los RIO de 420 son gabinetes tipo RIO (a diferencia de 620, que
// tenía un 620-PCC-5006 tipo CONTROL) — confirmado: las 10 filas
// distintas de RIO en SENALES_CONTROL siguen el patrón "420-RIO-00XX".
function tipoGabinete(_tag: string): string {
  return 'RIO';
}

function parseCapacidadConductores(tipoCable: string): number | null {
  const m = tipoCable.match(/^\s*\d+-(\d+)(c|p|Tr)#/i);
  if (!m) return null;
  const count = Number(m[1]);
  const unit = m[2].toLowerCase();
  const factor = unit === 'c' ? 1 : unit === 'p' ? 2 : 3;
  return count * factor;
}

// ───────────────────────── Candidatos de TAG_SENAL ─────────────────────────

// Ver comentario de cabecera — 4 candidatos, en orden de confianza. No
// inventa: si ninguno matchea contra una señal ya creada, la fila queda
// PENDING (ver main()).
function candidatosTagSenal(asociado: string | null, tipo: string | null, tagSenalOriginal: string | null): string[] {
  const candidatos: string[] = [];
  if (tagSenalOriginal) candidatos.push(tagSenalOriginal);
  if (asociado && tipo) {
    candidatos.push(`${asociado}_${tipo}`);
    if (tipo.endsWith('T') && tipo.length > 1) candidatos.push(`${asociado}_${tipo.slice(0, -1)}I`);
    if (tipo.endsWith('SL')) candidatos.push(`${asociado}_${tipo.slice(0, -2)}AL`);
    if (tipo.endsWith('SH')) candidatos.push(`${asociado}_${tipo.slice(0, -2)}AH`);
  }
  return [...new Set(candidatos)];
}

// ───────────────────────── Result tracking ─────────────────────────

interface Counters {
  [key: string]: { CREATE: number; SKIP: number; UPDATE: number; PENDING: number; ERROR: number };
}

function makeCounters(names: string[]): Counters {
  const c: Counters = {};
  for (const n of names) c[n] = { CREATE: 0, SKIP: 0, UPDATE: 0, PENDING: 0, ERROR: 0 };
  return c;
}

const pendingReasons: Array<{ tag: string; layer: string; reason: string }> = [];
const errorLog: Array<{ tag: string; layer: string; message: string }> = [];

// ───────────────────────── Main ─────────────────────────

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== importControl420.ts (${mode.toUpperCase()}) ===`);
  console.log(`API: ${apiBase}  |  Usuario dev: ${devUserEmail}  |  Archivo: ${filePath}`);

  const projResp = await apiFetch<{ project: { id: string; code: string; name: string } }>(
    apiBase, devUserEmail, `/api/projects/${projectId}`
  );
  if (projResp.status !== 200) {
    console.error('No se pudo leer el proyecto indicado:', projResp.json);
    process.exit(1);
  }
  const project = projResp.json.project;
  console.log(`\nProyecto real: id=${project.id} codigo=${project.code} nombre="${project.name}"`);

  console.log(`\nLeyendo ${filePath} ...`);
  const allRows = await readControlSheet(filePath);
  const signalRows = allRows.filter((r) => r.idSenal !== null && r.destino !== 'RESERVA');
  const reserveRows = allRows.filter((r) => r.destino === 'RESERVA');
  console.log(`${allRows.length} filas totales (${signalRows.length} señal real, ${reserveRows.length} RESERVA — no se cargan).`);

  const counters = makeCounters(['moduleTypes', 'moduleTerminals', 'gabinetes', 'racks', 'slots', 'modules', 'cables', 'boxes', 'signals', 'routes']);

  // --- Catálogo de modelos de módulo ---
  console.log('\n--- Catálogo cat.cat_modulo_io ---');
  const existingModuleTypesResp = await apiFetch<{ moduleTypes: Array<{ id: string; fabricante: string; modelo: string; tipoIoId: string }> }>(
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
    if (moduleTypeIdByModel.has(model.modelo)) { counters.moduleTypes.SKIP++; continue; }
    const tipoIoId = tipoIoIdByCode.get(model.tipoIo);
    if (!tipoIoId) { counters.moduleTypes.ERROR++; errorLog.push({ tag: model.modelo, layer: 'moduleTypes', message: `No existe cat_tipo_io con codigo ${model.tipoIo}` }); continue; }
    if (isDryRun) { counters.moduleTypes.CREATE++; moduleTypeIdByModel.set(model.modelo, { id: '(dry-run)', tipoIoId }); continue; }
    const created = await apiFetch(apiBase, devUserEmail, '/api/catalogs/module-types', { method: 'POST', body: { fabricante: FABRICANTE, modelo: model.modelo, tipoIoId, canalesMax: model.canalesMax } });
    if (created.status === 201) { counters.moduleTypes.CREATE++; moduleTypeIdByModel.set(model.modelo, { id: created.json.moduleType.id, tipoIoId }); }
    else { counters.moduleTypes.ERROR++; errorLog.push({ tag: model.modelo, layer: 'moduleTypes', message: JSON.stringify(created.json) }); }
  }

  // --- Terminales de catálogo ---
  console.log('--- Catálogo cat.cat_modulo_io_terminal ---');
  const terminalRowsByModel = new Map<string, Set<string>>();
  for (const row of allRows) {
    if (!row.modelo || !row.tModulo || row.canal === null) continue;
    const labels = row.tModulo.split(';');
    const set = terminalRowsByModel.get(row.modelo) ?? new Set<string>();
    labels.forEach((label, i) => set.add(`${row.canal}|${i + 1}|${label}`));
    terminalRowsByModel.set(row.modelo, set);
  }
  for (const [modelo, entries] of terminalRowsByModel) {
    const modelInfo = moduleTypeIdByModel.get(modelo);
    if (!modelInfo) continue;
    const existingTerminalsResp = isDryRun && modelInfo.id === '(dry-run)'
      ? { json: { terminals: [] as Array<{ numeroCanal: number; ordenTerminal: number }> } }
      : await apiFetch<{ terminals: Array<{ numeroCanal: number; ordenTerminal: number }> }>(apiBase, devUserEmail, `/api/catalogs/module-types/${modelInfo.id}/terminals`);
    const existingKeys = new Set((existingTerminalsResp.json.terminals ?? []).map((t) => `${t.numeroCanal}|${t.ordenTerminal}`));
    for (const entry of entries) {
      const [canalStr, ordenStr, etiqueta] = entry.split('|');
      const key = `${canalStr}|${ordenStr}`;
      if (existingKeys.has(key)) { counters.moduleTerminals.SKIP++; continue; }
      if (isDryRun) { counters.moduleTerminals.CREATE++; continue; }
      const created = await apiFetch(apiBase, devUserEmail, `/api/catalogs/module-types/${modelInfo.id}/terminals`, { method: 'POST', body: { numeroCanal: Number(canalStr), ordenTerminal: Number(ordenStr), etiquetaTerminal: etiqueta } });
      if (created.status === 201) counters.moduleTerminals.CREATE++;
      else if (created.status === 409) counters.moduleTerminals.SKIP++;
      else { counters.moduleTerminals.ERROR++; errorLog.push({ tag: `${modelo} canal ${canalStr} orden ${ordenStr}`, layer: 'moduleTerminals', message: JSON.stringify(created.json) }); }
    }
  }
  console.log(`  Terminales: CREATE=${counters.moduleTerminals.CREATE} SKIP=${counters.moduleTerminals.SKIP} ERROR=${counters.moduleTerminals.ERROR}`);

  // --- Hardware: gabinetes / racks / slots / módulos ---
  console.log('\n--- Hardware 420: gabinetes / racks / slots / módulos ---');
  const tiposGabineteResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/tipos-gabinete');
  const tipoGabineteIdByCode = new Map<string, string>();
  for (const t of tiposGabineteResp.json.items ?? []) tipoGabineteIdByCode.set(t.codigo, t.id);

  const existingGabinetesResp = await apiFetch<{ gabinetes: Array<{ id: string; tagGabinete: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/gabinetes`);
  const gabineteIdByTag = new Map<string, string>();
  for (const g of existingGabinetesResp.json.gabinetes ?? []) gabineteIdByTag.set(g.tagGabinete, g.id);

  const distinctGabinetes = [...new Set(allRows.map((r) => r.rio))];
  for (const tag of distinctGabinetes) {
    if (gabineteIdByTag.has(tag)) { counters.gabinetes.SKIP++; continue; }
    const tipoId = tipoGabineteIdByCode.get(tipoGabinete(tag));
    if (isDryRun) { counters.gabinetes.CREATE++; gabineteIdByTag.set(tag, `(dry-run:gabinete:${tag})`); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/gabinetes`, { method: 'POST', body: { tagGabinete: tag, tipoGabineteId: tipoId } });
    if (created.status === 201) { counters.gabinetes.CREATE++; gabineteIdByTag.set(tag, created.json.gabinete.id); }
    else { counters.gabinetes.ERROR++; errorLog.push({ tag, layer: 'gabinetes', message: JSON.stringify(created.json) }); }
  }

  const existingRacksResp = await apiFetch<{ racks: Array<{ id: string; gabineteId: string; numeroRack: number }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/racks`);
  const rackIdByKey = new Map<string, string>();
  for (const r of existingRacksResp.json.racks ?? []) rackIdByKey.set(`${r.gabineteId}|${r.numeroRack}`, r.id);
  const distinctRacks = [...new Set(allRows.map((r) => `${r.rio}|${r.chasis}`))];
  for (const combo of distinctRacks) {
    const [rio, chasis] = combo.split('|');
    const gabineteId = gabineteIdByTag.get(rio);
    if (!gabineteId) continue;
    const numeroRack = Number((chasis ?? '').replace(/\D/g, '')) || 1;
    const key = `${gabineteId}|${numeroRack}`;
    if (rackIdByKey.has(key)) { counters.racks.SKIP++; continue; }
    if (isDryRun) { counters.racks.CREATE++; rackIdByKey.set(key, `(dry-run:rack:${key})`); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/racks`, { method: 'POST', body: { gabineteId, numeroRack } });
    if (created.status === 201) { counters.racks.CREATE++; rackIdByKey.set(key, created.json.rack.id); }
    else { counters.racks.ERROR++; errorLog.push({ tag: combo, layer: 'racks', message: JSON.stringify(created.json) }); }
  }

  const existingSlotsResp = await apiFetch<{ slots: Array<{ id: string; rackId: string; numeroSlot: number }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/slots`);
  const slotIdByKey = new Map<string, string>();
  for (const s of existingSlotsResp.json.slots ?? []) slotIdByKey.set(`${s.rackId}|${s.numeroSlot}`, s.id);
  const distinctSlots = [...new Set(allRows.map((r) => `${r.rio}|${r.chasis}|${r.slot}|${r.modelo}`))];
  const slotIdByRowKey = new Map<string, string>();
  for (const combo of distinctSlots) {
    const [rio, chasis, slot] = combo.split('|');
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
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/slots`, { method: 'POST', body: { rackId, numeroSlot } });
    if (created.status === 201) { counters.slots.CREATE++; slotIdByKey.set(key, created.json.slot.id); slotIdByRowKey.set(rowKey, created.json.slot.id); }
    else { counters.slots.ERROR++; errorLog.push({ tag: combo, layer: 'slots', message: JSON.stringify(created.json) }); }
  }

  const existingModulesResp = await apiFetch<{ modules: Array<{ id: string; slotId: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/modules`);
  const moduleIdBySlotId = new Map<string, string>();
  for (const m of existingModulesResp.json.modules ?? []) moduleIdBySlotId.set(m.slotId, m.id);
  const moduleIdByRowKey = new Map<string, string>();
  for (const combo of distinctSlots) {
    const [rio, chasis, slot, modelo] = combo.split('|');
    const rowKey = `${rio}|${chasis}|${slot}`;
    const slotId = slotIdByRowKey.get(rowKey);
    const modelInfo = moduleTypeIdByModel.get(modelo);
    if (!slotId || !modelInfo) continue;
    if (moduleIdBySlotId.has(slotId)) { counters.modules.SKIP++; moduleIdByRowKey.set(rowKey, moduleIdBySlotId.get(slotId)!); continue; }
    if (isDryRun) { counters.modules.CREATE++; const placeholder = `(dry-run:module:${rowKey})`; moduleIdByRowKey.set(rowKey, placeholder); moduleIdBySlotId.set(slotId, placeholder); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/modules`, { method: 'POST', body: { slotId, catalogoModuloId: modelInfo.id } });
    if (created.status === 201) { counters.modules.CREATE++; moduleIdByRowKey.set(rowKey, created.json.module.id); moduleIdBySlotId.set(slotId, created.json.module.id); }
    else { counters.modules.ERROR++; errorLog.push({ tag: combo, layer: 'modules', message: JSON.stringify(created.json) }); }
  }
  console.log(`  Gabinetes: +${counters.gabinetes.CREATE} =${counters.gabinetes.SKIP}  |  Racks: +${counters.racks.CREATE} =${counters.racks.SKIP}  |  Slots: +${counters.slots.CREATE} =${counters.slots.SKIP}  |  Módulos: +${counters.modules.CREATE} =${counters.modules.SKIP}`);

  const canalIdByModuleAndNumero = new Map<string, string>();
  if (!isDryRun) {
    for (const [, moduleId] of moduleIdByRowKey) {
      if (canalIdByModuleAndNumero.has(`${moduleId}|0`)) continue;
      const chResp = await apiFetch<{ channels: Array<{ id: string; numeroCanal: number }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/channels?moduloId=${moduleId}`);
      for (const ch of chResp.json.channels ?? []) canalIdByModuleAndNumero.set(`${moduleId}|${ch.numeroCanal}`, ch.id);
    }
  }

  // --- Señales YA CREADAS (por crearSenalesControl420DesdeReporte.ts) ---
  console.log('\n--- Señales CONTROL ya creadas (dueño real, vía P&ID) ---');
  const existingSignalsResp = await apiFetch<{ signals: Array<{ id: string; tagSenal: string | null; codigoSenal: string | null; canalId: string | null; tipoIoId: string | null; servicio: string | null; descripcion: string | null }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/signals`
  );
  const signalByTagSenal = new Map<string, { id: string; canalId: string | null; tipoIoId: string | null; servicio: string | null; descripcion: string | null }>();
  const signalByCodigoSenal = new Map<string, { id: string; canalId: string | null; tipoIoId: string | null; servicio: string | null; descripcion: string | null }>();
  for (const s of existingSignalsResp.json.signals ?? []) {
    if (s.tagSenal) signalByTagSenal.set(s.tagSenal, s);
    // codigoSenal para señales CONTROL de dueño equipo = ID_SENAL de
    // SENALES_CONTROL (formato "420-SIG-XXXXXX") — NUNCA un PnPID
    // numérico (esas son las de dueño instrumento, ver el filtro
    // NOT LIKE '%[^0-9]%' que usa el motor de reimportación en
    // pnidImports.ts para no confundir ambos orígenes).
    if (s.codigoSenal) signalByCodigoSenal.set(s.codigoSenal, s);
  }
  console.log(`  Señales existentes con tagSenal: ${signalByTagSenal.size}`);

  const cableIdByTag = new Map<string, string>();
  const existingCablesResp = await apiFetch<{ cables: Array<{ id: string; tagCable: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/cables`);
  for (const c of existingCablesResp.json.cables ?? []) cableIdByTag.set(c.tagCable, c.id);

  const cajaIdByTag = new Map<string, string>();
  const existingCajasResp = await apiFetch<{ boxes: Array<{ id: string; tagCaja: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`);
  for (const c of existingCajasResp.json.boxes ?? []) cajaIdByTag.set(c.tagCaja, c.id);

  // --- Equipos (para señales de dueño equipo — RIO 1, ver seedEquiposPaneles420.ts) ---
  const equipoIdByTag = new Map<string, string>();
  const existingEquipmentResp = await apiFetch<{ equipment: Array<{ id: string; tagEquipo: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/equipment`);
  for (const e of existingEquipmentResp.json.equipment ?? []) equipoIdByTag.set(e.tagEquipo, e.id);

  const claseSenalResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/signal-classes');
  const claseControlId = (claseSenalResp.json.items ?? []).find((c) => c.codigo === 'CONTROL')?.id;
  if (!claseControlId) { console.error('No existe cat_clase_senal CONTROL.'); process.exit(1); }

  const existingRoutesResp = await apiFetch<{ routes: Array<{ id: string; senalId: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/routes`);
  const routeIdBySenalId = new Map<string, string>();
  for (const r of existingRoutesResp.json.routes ?? []) routeIdBySenalId.set(r.senalId, r.id);

  const puntoIdByOwnerKey = new Map<string, string>();
  async function ensurePunto(owner: Record<string, string>, key: string): Promise<string | null> {
    if (puntoIdByOwnerKey.has(key)) return puntoIdByOwnerKey.get(key)!;
    if (isDryRun) { puntoIdByOwnerKey.set(key, '(dry-run)'); return '(dry-run)'; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/connection-points`, { method: 'POST', body: owner });
    if (created.status === 201) { puntoIdByOwnerKey.set(key, created.json.connectionPoint.id); return created.json.connectionPoint.id; }
    return null;
  }

  const isPlaceholder = (tag: string) => tag.includes('XXX') || /50X/.test(tag);

  let matched = 0, routeLoaded = 0;

  console.log('\n--- Cruce SENALES_CONTROL <-> señales ya creadas ---');
  for (const row of signalRows) {
    const tagForLog = row.tagSenal ?? row.idSenal ?? '(sin tag)';

    let señal: { id: string; canalId: string | null; tipoIoId: string | null; servicio: string | null; descripcion: string | null } | undefined;
    // TAG_EQUIPO_INST está poblado en TODAS las filas reales (en las de
    // dueño instrumento repite el mismo tag que TAG_INSTRUMENTO) — no
    // sirve para distinguir dueño, solo la rama que efectivamente se tomó.
    let esDueñoEquipo = false;

    if (row.tagInstrumento) {
      // Dueño instrumento: la señal YA fue creada por
      // crearSenalesControl420DesdeReporte.ts (vía el reporte P&ID) — acá
      // solo se busca y se completa lo que el P&ID no trae.
      const asociado = row.tagInstrumentoAsociado ?? row.tagInstrumento;
      const candidatos = candidatosTagSenal(asociado, row.tipoInstrumento, row.tagSenal);
      for (const cand of candidatos) {
        señal = signalByTagSenal.get(cand);
        if (señal) break;
      }
      if (!señal) {
        counters.signals.PENDING++;
        pendingReasons.push({ tag: tagForLog, layer: 'signal', reason: `SIGNAL_NOT_FOUND: ninguno de los candidatos [${candidatos.join(', ')}] coincide con una señal ya creada.` });
        continue;
      }
    } else if (row.tagEquipoInst) {
      esDueñoEquipo = true;
      // Dueño equipo: a diferencia del instrumento, el P&ID no tiene un
      // concepto de "señal de equipo" (ES_SENAL solo resuelve por
      // Instrumento Asociado, ver compare.ts) — se crea directo desde
      // SENALES_CONTROL, mismo criterio que importControl620.ts original
      // (codigoSenal = ID_SENAL, el único identificador persistente que
      // existe para estas).
      const equipoId = equipoIdByTag.get(row.tagEquipoInst);
      if (!equipoId) {
        counters.signals.PENDING++;
        pendingReasons.push({ tag: tagForLog, layer: 'signal', reason: `EQUIPMENT_NOT_FOUND: ${row.tagEquipoInst} no existe como equipo activo — no se crea ningún equipo para sostenerla.` });
        continue;
      }
      const yaExiste = row.idSenal ? signalByCodigoSenal.get(row.idSenal) : undefined;
      if (yaExiste) {
        señal = yaExiste;
      } else if (isDryRun) {
        counters.signals.CREATE++;
        console.log(`  + [equipo] ${tagForLog} -> dueño=${row.tagEquipoInst} | tagSenal=${row.tagSenal ?? '(sin tag)'}`);
        señal = { id: '(dry-run)', canalId: null, tipoIoId: null, servicio: null, descripcion: null };
      } else {
        const body: Record<string, unknown> = {
          equipoId,
          claseSenalId: claseControlId,
          codigoSenal: row.idSenal,
          nombreCorto: row.senal,
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
        if (row.tagSenal) body.tagSenal = row.tagSenal;
        // DESTINO y SERVICIO son dos columnas DISTINTAS en la hoja (ej.
        // DESTINO="MOTOR PREPARADO" / SERVICIO="BOMBA DE AGUA DE SELLO
        // (LINEA 05) STAND BY") — DESTINO es la descripción puntual de
        // ESTA señal, SERVICIO es el contexto del equipo/sistema al que
        // sirve. nucleo.senal.descripcion es el campo correcto para
        // DESTINO (nunca usado hasta ahora); servicio es SERVICIO tal
        // cual, no DESTINO.
        if (row.destino) body.descripcion = row.destino;
        if (row.servicio) body.servicio = row.servicio;
        let created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals`, { method: 'POST', body });

        // Defecto real de la fuente (no del importador) — mismo hallazgo
        // que importControl620.ts original: dos filas físicamente
        // distintas (distinto ID_SENAL, distinto canal) comparten el
        // mismo TAG_SENAL por un error de copia en el Excel (ej.
        // "420-PPS-5001_ST" repetido en los canales 0 y 1 de
        // 420-RIO-5001/SLOT-10). tagSenal es opcional desde 013 — se
        // reintenta sin tag en vez de perder la señal completa por un
        // campo secundario ya demostrado incorrecto.
        if (created.status === 409 && created.json?.error === 'signal_tag_conflict' && body.tagSenal) {
          pendingReasons.push({ tag: tagForLog, layer: 'data-quality', reason: `TAG_SENAL duplicado en la fuente ("${body.tagSenal}") — se cargó la señal con tagSenal=null; requiere corrección manual del Excel.` });
          created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals`, { method: 'POST', body: { ...body, tagSenal: null } });
        }

        if (created.status === 201) {
          counters.signals.CREATE++;
          señal = { id: created.json.signal.id, canalId: null, tipoIoId: null, servicio: body.servicio as string | null ?? null, descripcion: body.descripcion as string | null ?? null };
          if (row.idSenal) signalByCodigoSenal.set(row.idSenal, señal);
          console.log(`  + [equipo] ${tagForLog} -> dueño=${row.tagEquipoInst} | señal id=${señal.id}`);
        } else {
          counters.signals.ERROR++;
          errorLog.push({ tag: tagForLog, layer: 'signal-create-equipo', message: JSON.stringify(created.json) });
          continue;
        }
      }
    } else {
      counters.signals.PENDING++;
      pendingReasons.push({ tag: tagForLog, layer: 'signal', reason: 'Sin TAG_INSTRUMENTO ni TAG_EQUIPO_INST — dueño ambiguo.' });
      continue;
    }
    matched++;

    // dry-run de una señal de equipo NUEVA: no existe un id real que
    // consultar (nunca se llega a crear en dry-run) — se cuenta como
    // ruta potencial y se sigue con la siguiente fila, sin intentar
    // resolver canal/cable/caja/ruta contra un id que no existe.
    if (isDryRun && señal.id === '(dry-run)') {
      counters.routes.CREATE++;
      routeLoaded++;
      continue;
    }

    // --- Canal / tipoIo: completar si la señal creada por el P&ID no lo tenía (más autoritativo acá, viene de hardware real) ---
    const rowKey = `${row.rio}|${row.chasis}|${row.slot}`;
    const moduleId = moduleIdByRowKey.get(rowKey) ?? null;
    const canalId = moduleId && row.canal !== null ? (isDryRun ? '(dry-run)' : canalIdByModuleAndNumero.get(`${moduleId}|${row.canal}`) ?? null) : null;
    const tipoIoId = row.modulo ? tipoIoIdByCode.get(row.modulo) ?? null : null;

    const patchBody: Record<string, unknown> = {};
    if (canalId && !señal.canalId) patchBody.canalId = canalId;
    if (tipoIoId && !señal.tipoIoId) patchBody.tipoIoId = tipoIoId;
    // Backfill/corrección de descripcion+servicio. DESTINO y SERVICIO son
    // columnas DISTINTAS en la hoja (ver comentario en la creación más
    // arriba); una corrida anterior de este mismo script metió DESTINO en
    // "servicio" por error — acá se corrige (no solo se rellena si está
    // vacío) comparando contra el valor real de la hoja.
    //
    // Dueño equipo: se corrigen descripcion Y servicio, ambos vienen de
    // esta misma hoja (crearSenalesControl420DesdeReporte.ts no las creó).
    //
    // Dueño instrumento: SOLO se backfillea descripcion (DESTINO) — el
    // reporte P&ID (crearSenalesControl420DesdeReporte.ts) no tiene
    // concepto de DESTINO, así que esta hoja es la única fuente y
    // quedaba vacía por un vacío entre los dos scripts, no por decisión
    // de negocio. servicio NO se toca en esta rama: ya viene confirmado
    // 100% idéntico al reporte P&ID (fuente autoritativa para servicio
    // de dueño instrumento) y SENALES_CONTROL.SERVICIO podría ser legacy
    // desactualizado — sobreescribirlo sería regresar el dato bueno.
    if (esDueñoEquipo) {
      if (row.destino && señal.descripcion !== row.destino) patchBody.descripcion = row.destino;
      if ((row.servicio ?? null) !== señal.servicio) patchBody.servicio = row.servicio ?? null;
    } else {
      if (row.destino && señal.descripcion !== row.destino) patchBody.descripcion = row.destino;
    }
    if (Object.keys(patchBody).length > 0) {
      counters.signals.UPDATE++;
      if (!isDryRun) {
        const patched = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${señal.id}`, { method: 'PATCH', body: patchBody });
        if (patched.status !== 200) { errorLog.push({ tag: tagForLog, layer: 'signal-patch', message: JSON.stringify(patched.json) }); }
      }
    } else {
      counters.signals.SKIP++;
    }
    if (!canalId) pendingReasons.push({ tag: tagForLog, layer: 'io', reason: `Canal no resuelto (${rowKey} canal ${row.canal}).` });

    // --- Cable(s) ---
    for (const [tagCable, tipoCable] of [[row.tagCable, row.tipoCable], [row.tagCableInst, row.tipoCableInst]] as const) {
      if (!tagCable || !tipoCable) continue;
      if (cableIdByTag.has(tagCable)) { counters.cables.SKIP++; continue; }
      const capacidad = parseCapacidadConductores(tipoCable);
      if (!capacidad) { pendingReasons.push({ tag: tagForLog, layer: 'cable', reason: `CABLE_PENDING: ${tagCable} — no se pudo derivar capacidadConductores de "${tipoCable}".` }); continue; }
      if (isDryRun) { counters.cables.CREATE++; cableIdByTag.set(tagCable, '(dry-run)'); continue; }
      const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/cables`, { method: 'POST', body: { tagCable, tipoCable, capacidadConductores: capacidad } });
      if (created.status === 201) { counters.cables.CREATE++; cableIdByTag.set(tagCable, created.json.cable.id); }
      else if (created.status === 409) { counters.cables.SKIP++; }
      else { counters.cables.ERROR++; errorLog.push({ tag: tagCable, layer: 'cable', message: JSON.stringify(created.json) }); }
    }

    // --- Caja ---
    // Dueño instrumento: TAG_CAJA, mismo criterio de siempre (crea la caja
    // si no existía — son tags TBC/TBJ conocidos y consistentes).
    // Dueño equipo: CAJA_EQUIPO — a diferencia de TAG_CAJA, encontré con
    // datos reales que varios valores son inconsistentes/con typos
    // respecto a los paneles ya creados (ej. "AFL-XXX7" vs el "AFL-XXXX"
    // real de la hoja EQUIPOS, "ACA-T921"/"COA-T945" que no tienen
    // ninguna fila propia en EQUIPOS) — acá NUNCA se crea una caja
    // nueva sobre la marcha, solo se reutiliza una ya confirmada
    // (seedEquiposPaneles420.ts) o el propio dueño (auto-referencia, sin
    // caja intermedia); lo que no calza queda ROUTE_PENDING para que el
    // usuario lo revise, no se inventa.
    let cajaId: string | null = null;
    let cajaOmitida = false; // true = auto-referencia al propio dueño equipo, ruta directa sin caja intermedia
    if (row.tagInstrumento && row.tagCaja) {
      if (isPlaceholder(row.tagCaja)) {
        pendingReasons.push({ tag: tagForLog, layer: 'route', reason: `ROUTE_PENDING: caja placeholder ${row.tagCaja}.` });
      } else if (cajaIdByTag.has(row.tagCaja)) {
        cajaId = cajaIdByTag.get(row.tagCaja)!;
      } else if (isDryRun) {
        cajaId = '(dry-run)'; cajaIdByTag.set(row.tagCaja, cajaId); counters.boxes.CREATE++;
      } else {
        const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`, { method: 'POST', body: { tagCaja: row.tagCaja } });
        if (created.status === 201) { cajaId = created.json.box.id; cajaIdByTag.set(row.tagCaja, cajaId); counters.boxes.CREATE++; }
        else if (created.status === 409) { counters.boxes.SKIP++; }
        else { counters.boxes.ERROR++; errorLog.push({ tag: row.tagCaja, layer: 'boxes', message: JSON.stringify(created.json) }); }
      }
    } else if (row.tagEquipoInst && row.cajaEquipo) {
      if (row.cajaEquipo === row.tagEquipoInst) {
        cajaOmitida = true; // el propio equipo es su panel — ruta directa
      } else if (cajaIdByTag.has(row.cajaEquipo)) {
        cajaId = cajaIdByTag.get(row.cajaEquipo)!;
      } else {
        pendingReasons.push({ tag: tagForLog, layer: 'route', reason: `ROUTE_PENDING: CAJA_EQUIPO "${row.cajaEquipo}" no coincide con ningún panel/caja ya confirmado — revisar (posible tag inconsistente en el Excel).` });
      }
    }

    // --- Ruta física (ya existe si esta señal ya tiene ruta cargada) ---
    if (routeIdBySenalId.has(señal.id)) { counters.routes.SKIP++; routeLoaded++; continue; }
    if (!moduleId) { pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: módulo no resuelto.' }); continue; }
    const gabineteId = gabineteIdByTag.get(row.rio);
    if (!gabineteId) { pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: gabinete no resuelto.' }); continue; }

    // Origen físico: el dueño REAL de la señal — instrumento O equipo,
    // resuelto desde la señal ya creada/encontrada (nunca desde
    // TAG_INSTRUMENTO/TAG_EQUIPO_INST de la fila directamente, que puede
    // estar desactualizado).
    const señalDetalleResp = await apiFetch<{ signal: { instrumentoId: string | null; equipoId: string | null } }>(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${señal.id}`);
    const duenoInstrumentoId = señalDetalleResp.json.signal?.instrumentoId ?? null;
    const duenoEquipoId = señalDetalleResp.json.signal?.equipoId ?? null;
    if (!duenoInstrumentoId && !duenoEquipoId) { pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: la señal ya creada no tiene instrumentoId ni equipoId (inesperado).' }); continue; }
    const origenOwner = duenoInstrumentoId ? { instrumentoId: duenoInstrumentoId } : { equipoId: duenoEquipoId! };
    const origenKey = duenoInstrumentoId ? `owner:instrumentoId:${duenoInstrumentoId}` : `owner:equipoId:${duenoEquipoId}`;

    if (cajaId) {
      const puntoOrigen = await ensurePunto(origenOwner, origenKey);
      const puntoCaja = await ensurePunto({ cajaId }, `caja:${cajaId}`);
      const puntoGabinete = await ensurePunto({ gabineteId }, `gabinete:${gabineteId}`);
      const puntoModulo = await ensurePunto({ moduloId: moduleId }, `modulo:${moduleId}`);
      if (!puntoOrigen || !puntoCaja || !puntoGabinete || !puntoModulo) { pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: no se pudo crear algún punto_conexion.' }); continue; }
      if (isDryRun) { counters.routes.CREATE++; routeLoaded++; continue; }
      const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/routes`, { method: 'POST', body: { senalId: señal.id, segments: [{ puntoOrigenId: puntoOrigen, puntoDestinoId: puntoCaja, parConductorId: null }, { puntoOrigenId: puntoCaja, puntoDestinoId: puntoGabinete, parConductorId: null }, { puntoOrigenId: puntoGabinete, puntoDestinoId: puntoModulo, parConductorId: null }] } });
      if (created.status === 201) { counters.routes.CREATE++; routeLoaded++; } else if (created.status === 409) { counters.routes.SKIP++; routeLoaded++; } else { counters.routes.ERROR++; errorLog.push({ tag: tagForLog, layer: 'route', message: JSON.stringify(created.json) }); }
    } else if (cajaOmitida || (!row.tagCaja && !row.cajaEquipo)) {
      const puntoOrigen = await ensurePunto(origenOwner, origenKey);
      const puntoGabinete = await ensurePunto({ gabineteId }, `gabinete:${gabineteId}`);
      const puntoModulo = await ensurePunto({ moduloId: moduleId }, `modulo:${moduleId}`);
      if (!puntoOrigen || !puntoGabinete || !puntoModulo) { pendingReasons.push({ tag: tagForLog, layer: 'route', reason: 'ROUTE_PENDING: no se pudo crear algún punto_conexion.' }); continue; }
      if (isDryRun) { counters.routes.CREATE++; routeLoaded++; continue; }
      const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/routes`, { method: 'POST', body: { senalId: señal.id, segments: [{ puntoOrigenId: puntoOrigen, puntoDestinoId: puntoGabinete, parConductorId: null }, { puntoOrigenId: puntoGabinete, puntoDestinoId: puntoModulo, parConductorId: null }] } });
      if (created.status === 201) { counters.routes.CREATE++; routeLoaded++; } else if (created.status === 409) { counters.routes.SKIP++; routeLoaded++; } else { counters.routes.ERROR++; errorLog.push({ tag: tagForLog, layer: 'route', message: JSON.stringify(created.json) }); }
    }
    // else: CAJA_EQUIPO no resolvió a ningún panel/caja confirmado — ya
    // quedó ROUTE_PENDING más arriba, no se intenta ninguna ruta a ciegas.
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Modo: ${mode}`);
  console.log(`Proyecto: ${project.code} — ${project.name} (id ${project.id})`);
  for (const [name, c] of Object.entries(counters)) {
    console.log(`  ${name.padEnd(16)} CREATE=${c.CREATE} SKIP=${c.SKIP} UPDATE=${c.UPDATE} PENDING=${c.PENDING} ERROR=${c.ERROR}`);
  }
  console.log(`\nFilas con señal encontrada (matched): ${matched} / ${signalRows.length}`);
  console.log(`Filas con ruta cargada: ${routeLoaded} / ${signalRows.length}`);
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
