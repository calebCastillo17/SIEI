/*
 * Importa el SERVICIO real de cada señal (hoja SENALES del master, columna
 * SERVICIO) hacia nucleo.senal.servicio (migración 028) — pedido explícito
 * del usuario: "solo has puesto un servicio de un equipo, lista todos los
 * que faltan".
 *
 * Verificado con datos reales antes de escribir la migración: SERVICIO en
 * el Excel es un texto POR SEÑAL, distinto (más granular) de
 * instrumento.servicio — aplica igual para señales de instrumento y de
 * equipo. Este script importa TODAS las señales que ya existen en la base
 * y tienen un SERVICIO no vacío en el Excel, sin filtrar por tipo de dueño.
 *
 * Idempotente: si la señal YA tiene exactamente ese servicio cargado, se
 * salta (no cuenta como "actualizada"). Nunca pisa un servicio existente
 * con uno distinto sin decirlo explícitamente en el log.
 *
 * Uso:
 *   npx tsx scripts/importSenalServicio620.ts --project 50050 --dry-run
 *   npx tsx scripts/importSenalServicio620.ts --project 50050 --apply
 *   [--file ../reference_excel/02_MASTER_IO_620.xlsm]
 */

import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { normalizeNamespacedXlsx } from '../src/lib/pnidImport/parseExcel.js';
import { limpiarVinculosExternosYNombres } from '../src/lib/ldi/templateSanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Args {
  projectId: string;
  file: string;
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
  if (dryRun === apply) {
    console.error('Especificá exactamente uno de --dry-run / --apply.');
    process.exit(1);
  }

  return {
    projectId,
    file: get('--file') ?? path.join(__dirname, '../../reference_excel/02_MASTER_IO_620.xlsm'),
    apiBase: get('--api') ?? 'http://localhost:3000',
    devUserEmail: get('--user') ?? 'admin@siei.local',
    mode: dryRun ? 'dry-run' : 'apply'
  };
}

async function apiFetch<T = any>(
  apiBase: string,
  devUserEmail: string,
  urlPath: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${urlPath} -> ${response.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

async function loadServicioMap(file: string): Promise<Map<string, string>> {
  const rawBuffer = await readFile(file);
  const namespaced = await normalizeNamespacedXlsx(rawBuffer);
  const saneado = await limpiarVinculosExternosYNombres(namespaced);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(saneado as unknown as ExcelJS.Buffer);
  const ws = workbook.getWorksheet('SENALES');
  if (!ws) throw new Error('No se encontró la hoja SENALES.');

  const headerRow = ws.getRow(1);
  const colIndex = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const text = String(cell.value ?? '').trim();
    if (text) colIndex.set(text, colNumber);
  });

  for (const col of ['TAG_SENAL', 'SERVICIO']) {
    if (!colIndex.has(col)) throw new Error(`Falta la columna ${col} en SENALES.`);
  }

  // SENALES trae fórmulas vivas (no valores cacheados) — leer siempre
  // `.result`, nunca el objeto {formula,result} completo (mismo gotcha ya
  // documentado en fixCablePanelesElectricos620.ts).
  const cellText = (value: ExcelJS.CellValue): string => {
    if (value !== null && typeof value === 'object' && 'result' in value) {
      return String((value as { result: unknown }).result ?? '').trim();
    }
    return String(value ?? '').trim();
  };

  const map = new Map<string, string>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const tagSenal = cellText(row.getCell(colIndex.get('TAG_SENAL')!).value);
    const servicio = cellText(row.getCell(colIndex.get('SERVICIO')!).value);
    if (tagSenal && servicio) map.set(tagSenal, servicio);
  });
  return map;
}

async function main() {
  const { projectId, file, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`Leyendo ${file} ...`);
  const servicioPorTag = await loadServicioMap(file);
  console.log(`  ${servicioPorTag.size} señales con SERVICIO no vacío en el Excel.`);

  const { signals } = await apiFetch<{ signals: any[] }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/signals`
  );
  const signalByTag = new Map(signals.filter((s) => s.tagSenal).map((s) => [s.tagSenal as string, s]));

  let actualizadas = 0;
  let yaCorrectas = 0;
  let sinSenalEnBase = 0;
  let sobreescritas = 0;

  for (const [tagSenal, servicio] of servicioPorTag) {
    const signal = signalByTag.get(tagSenal);
    if (!signal) {
      sinSenalEnBase++;
      continue;
    }

    if (signal.servicio === servicio) {
      yaCorrectas++;
      continue;
    }

    if (signal.servicio && signal.servicio !== servicio) {
      console.log(`  [SOBRESCRIBE] ${tagSenal}: "${signal.servicio}" -> "${servicio}"`);
      sobreescritas++;
    } else {
      console.log(`${tagSenal}: "${servicio}"`);
    }

    if (isDryRun) { actualizadas++; continue; }

    await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${signal.id}`, {
      method: 'PATCH',
      body: { servicio }
    });
    actualizadas++;
  }

  console.log(`\n=== Resumen (${mode}) ===`);
  console.log(`Señales actualizadas:      ${actualizadas}`);
  console.log(`  (de las cuales sobrescritas con un valor distinto: ${sobreescritas})`);
  console.log(`Ya estaban correctas:      ${yaCorrectas}`);
  console.log(`Sin señal en la base:      ${sinSenalEnBase}`);
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
