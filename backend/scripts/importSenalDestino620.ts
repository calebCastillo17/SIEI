/*
 * Importa el DESTINO real de cada señal (hoja SENALES del master, columna
 * DESTINO — "la descripción corta de la señal", según la explicación
 * original del usuario) hacia nucleo.senal.descripcion — pedido explícito:
 * "también quiero que pongas el destino".
 *
 * Verificado con datos reales antes de tocar nada: DESTINO es un texto
 * MÁS CORTO que SERVICIO (migración 028) para la misma señal — ej.
 * 620-PPS-5005_RDY tiene DESTINO="MOTOR LISTO PARA FUNCIONAR" vs.
 * SERVICIO="BOMBA DE AGUA DE RELAVES (LINEA 01) - MOTOR LISTO PARA
 * FUNCIONAR" — y distinto de nombre_corto (solo el sufijo del tag, ej.
 * "RDY"). nucleo.senal.descripcion ya existía pero estaba 100% vacía en
 * este proyecto (0/269 señales CONTROL) — no hizo falta ninguna
 * migración, es la columna de descripción libre que el modelo ya tenía
 * sin usar para este dato.
 *
 * Este script importa TODAS las señales que ya existen en la base y
 * tienen un DESTINO no vacío en el Excel, sin filtrar por tipo de dueño.
 *
 * Idempotente: si la señal YA tiene exactamente ese destino cargado, se
 * salta (no cuenta como "actualizada"). Nunca pisa una descripción
 * existente con un valor distinto sin decirlo explícitamente en el log.
 *
 * Uso:
 *   npx tsx scripts/importSenalDestino620.ts --project 50050 --dry-run
 *   npx tsx scripts/importSenalDestino620.ts --project 50050 --apply
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

async function loadDestinoMap(file: string): Promise<Map<string, string>> {
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

  for (const col of ['TAG_SENAL', 'DESTINO']) {
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
    const destino = cellText(row.getCell(colIndex.get('DESTINO')!).value);
    // "RESERVA" en DESTINO significa "ese espacio es reserva, no hay
    // señal como tal" (explicación original del usuario) — no aplica acá
    // porque solo procesamos señales que YA existen en la base (una
    // reserva nunca tiene fila propia en nucleo.senal), pero se descarta
    // explícitamente por si el Excel algún día trae una fila real así.
    if (tagSenal && destino && destino.toUpperCase() !== 'RESERVA') map.set(tagSenal, destino);
  });
  return map;
}

async function main() {
  const { projectId, file, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`Leyendo ${file} ...`);
  const destinoPorTag = await loadDestinoMap(file);
  console.log(`  ${destinoPorTag.size} señales con DESTINO no vacío en el Excel.`);

  const { signals } = await apiFetch<{ signals: any[] }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/signals`
  );
  const signalByTag = new Map(signals.filter((s) => s.tagSenal).map((s) => [s.tagSenal as string, s]));

  let actualizadas = 0;
  let yaCorrectas = 0;
  let sinSenalEnBase = 0;
  let sobreescritas = 0;

  for (const [tagSenal, destino] of destinoPorTag) {
    const signal = signalByTag.get(tagSenal);
    if (!signal) {
      sinSenalEnBase++;
      continue;
    }

    if (signal.descripcion === destino) {
      yaCorrectas++;
      continue;
    }

    if (signal.descripcion && signal.descripcion !== destino) {
      console.log(`  [SOBRESCRIBE] ${tagSenal}: "${signal.descripcion}" -> "${destino}"`);
      sobreescritas++;
    } else {
      console.log(`${tagSenal}: "${destino}"`);
    }

    if (isDryRun) { actualizadas++; continue; }

    await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${signal.id}`, {
      method: 'PATCH',
      body: { descripcion: destino }
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
