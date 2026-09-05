/*
 * Completa el cable/conductor que faltaba en las rutas equipo->gabinete->
 * módulo (proyecto 620), en dos grupos:
 *   - 26 señales donde el equipo ES su propio panel eléctrico (TSA-5001,
 *     TSM-5002, UPS-5010, UPS-5011 — CAJA_EQUIPO == TAG_EQUIPO_INST en el
 *     Excel), cuyas rutas ya existían como esqueleto desde antes de esta
 *     sesión.
 *   - 6 señales de 620-PPS-5005, cuyo panel real (620-AFM-5005) tiene un
 *     TAG distinto del dueño — estas rutas NO existían y se crearon en
 *     esta misma sesión (origen=PPS-5005 el dueño, destino=gabinete
 *     directo, SIN el panel como nodo): TR_tramo_conexion_validar_
 *     secuencia rechaza un EQUIPO como nodo intermedio (solo admite
 *     CAJA, o GABINETE en el penúltimo), y POST /routes exige que el
 *     origen del tramo 1 sea el dueño real de la señal — con esas dos
 *     reglas, un tercer nodo "AFM-5005" entre PPS-5005 y el gabinete es
 *     estructuralmente imposible hoy. AFM-5005 queda sin representar
 *     como nodo de ruta por esta limitación de esquema (documentado,
 *     aceptado por el usuario) — el cable se carga igual, el panel sigue
 *     existiendo como curación (`equipo`), solo no aparece en /control/
 *     cajas todavía.
 *
 * En ambos grupos, el cable (nucleo.cable) ya existía, con 0 conductores.
 * Solo falta:
 *   1. El conductor (código = 2*N_PAR_CABLE-1 / 2*N_PAR_CABLE, misma
 *      fórmula ya confirmada y usada para el cable RIO->caja).
 *   2. El tramo_conductor que lo asocia al tramo 1 de la ruta.
 *
 * Sin terminación en ningún extremo — ni el equipo ni el gabinete (a
 * secas, sin caja/módulo/panel-con-TB) tienen bloque_terminal acá, y eso
 * es un estado válido (0/1/2 terminaciones, ver migración 015). El
 * usuario decidió explícitamente que estos paneles NO necesitan bornas
 * modeladas ("no tiene TB o no nos interesa, solamente se sabe que
 * llega").
 *
 * Uso:
 *   npx tsx scripts/fixCablePanelesElectricos620.ts --project 50050 --dry-run
 *   npx tsx scripts/fixCablePanelesElectricos620.ts --project 50050 --apply
 *   [--file ../reference_excel/02_MASTER_IO_620.xlsm]
 *   [--api http://localhost:3000] [--user admin@siei.local]
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
  if (dryRun && apply) {
    console.error('No usar --dry-run y --apply al mismo tiempo.');
    process.exit(1);
  }
  if (!dryRun && !apply) {
    console.error('Especificá --dry-run o --apply.');
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

interface ExcelRow {
  tagCable: string;
  nParCable: number;
  cajaEquipo: string | null;
  tagEquipoInst: string | null;
}

async function loadExcelMap(file: string): Promise<Map<string, ExcelRow>> {
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

  const need = ['TAG_SENAL', 'TAG_CABLE', 'N_PAR_CABLE', 'CAJA_EQUIPO', 'TAG_EQUIPO_INST'];
  for (const col of need) {
    if (!colIndex.has(col)) throw new Error(`Falta la columna ${col} en SENALES.`);
  }

  // SENALES (a diferencia de SENALES_CONTROL) trae fórmulas vivas, no
  // valores cacheados — TAG_SENAL/TAG_CABLE/N_PAR_CABLE se calculan con
  // fórmulas reales del propio Excel. exceljs, al cargar el .xlsx tal
  // cual (no vía LibreOffice/Excel recalculando), devuelve
  // `{ formula, result }` en vez del valor plano — hay que leer
  // `.result`, nunca el objeto entero (encontrado en vivo: sin esto,
  // todas las comparaciones fallaban silenciosamente).
  const cellText = (value: ExcelJS.CellValue): string => {
    if (value !== null && typeof value === 'object' && 'result' in value) {
      return String((value as { result: unknown }).result ?? '').trim();
    }
    return String(value ?? '').trim();
  };

  const map = new Map<string, ExcelRow>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const tagSenal = cellText(row.getCell(colIndex.get('TAG_SENAL')!).value);
    const tagCable = cellText(row.getCell(colIndex.get('TAG_CABLE')!).value);
    const nParCable = Number(cellText(row.getCell(colIndex.get('N_PAR_CABLE')!).value));
    const cajaEquipo = cellText(row.getCell(colIndex.get('CAJA_EQUIPO')!).value) || null;
    const tagEquipoInst = cellText(row.getCell(colIndex.get('TAG_EQUIPO_INST')!).value) || null;

    // Antes solo cubría "el equipo ES su propio panel" (CAJA_EQUIPO ==
    // TAG_EQUIPO_INST). El caso con panel DISTINTO del dueño (ej.
    // PPS-5005/AFM-5005) también entra ahora: TR_tramo_conexion_
    // validar_secuencia rechaza un EQUIPO como nodo intermedio (solo
    // admite CAJA, o GABINETE en el penúltimo) y el propio POST /routes
    // exige que el origen del tramo 1 sea el dueño real de la señal —
    // por eso esas 6 rutas (620-PPS-5005) se armaron igual que las de
    // panel-propio (origen=dueño, destino=gabinete directo, sin el panel
    // como nodo) — el panel (AFM-5005) queda sin representar como nodo
    // de ruta por esta limitación de esquema, documentado y aceptado por
    // el usuario; el cable se carga igual.
    if (tagSenal && tagCable && Number.isFinite(nParCable)) {
      map.set(tagSenal, { tagCable, nParCable, cajaEquipo, tagEquipoInst });
    }
  });
  return map;
}

async function main() {
  const { projectId, file, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`Leyendo ${file} ...`);
  const excelMap = await loadExcelMap(file);
  console.log(`  ${excelMap.size} señales de panel-propio (CAJA_EQUIPO == TAG_EQUIPO_INST) con TAG_CABLE en el Excel.`);

  const { signals } = await apiFetch<{ signals: any[] }>(
    apiBase,
    devUserEmail,
    `/api/projects/${projectId}/control/signals`
  );
  const signalByTag = new Map(signals.filter((s) => s.tagSenal).map((s) => [s.tagSenal as string, s]));

  const { cables } = await apiFetch<{ cables: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/cables`);
  const cableByTag = new Map(cables.map((c) => [c.tagCable as string, c]));

  let procesadas = 0;
  let yaCorrectas = 0;
  let sinRuta = 0;
  let sinCableEnBase = 0;
  let conductoresCreados = 0;

  for (const [tagSenal, { tagCable, nParCable }] of excelMap) {
    const signal = signalByTag.get(tagSenal);
    if (!signal || !signal.rutaId) {
      sinRuta++;
      continue;
    }

    const cable = cableByTag.get(tagCable);
    if (!cable) {
      console.warn(`  [WARN] ${tagSenal}: cable ${tagCable} no existe en nucleo.cable — se salta.`);
      sinCableEnBase++;
      continue;
    }

    const { route } = await apiFetch<{ route: { segments: Array<{ id: string; numeroOrden: number }> } }>(
      apiBase,
      devUserEmail,
      `/api/projects/${projectId}/routes/${signal.rutaId}`
    );
    const tramo1 = route.segments.find((s) => s.numeroOrden === 1);
    if (!tramo1) continue;

    const { conexionado } = await apiFetch<{ conexionado: Array<{ numeroOrden: number; conductores: any[] }> }>(
      apiBase,
      devUserEmail,
      `/api/projects/${projectId}/routes/${signal.rutaId}/conexionado`
    );
    const seg1 = conexionado.find((s) => s.numeroOrden === 1);
    if ((seg1?.conductores.length ?? 0) > 0) {
      yaCorrectas++;
      continue; // idempotente: ya corregida en una corrida anterior.
    }

    procesadas++;
    const codigo1 = String(2 * nParCable - 1);
    const codigo2 = String(2 * nParCable);
    console.log(`${tagSenal} (ruta ${signal.rutaId}, tramo1 ${tramo1.id}): conductores ${codigo1}/${codigo2} de ${tagCable}`);

    if (isDryRun) continue;

    for (const codigo of [codigo1, codigo2]) {
      const nuevoConductor = await apiFetch<{ conductor: { id: string } }>(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/conductors`,
        { method: 'POST', body: { cableId: cable.id, codigo } }
      );
      await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores`, {
        method: 'POST',
        body: { tramoConexionId: tramo1.id, conductorId: nuevoConductor.conductor.id }
      });
      conductoresCreados++;
    }
  }

  console.log(`\n=== Resumen (${mode}) ===`);
  console.log(`Señales procesadas:        ${procesadas}`);
  console.log(`Ya estaban correctas:      ${yaCorrectas}`);
  console.log(`Sin ruta:                  ${sinRuta}`);
  console.log(`Sin cable en la base:      ${sinCableEnBase}`);
  console.log(`Conductores creados:       ${conductoresCreados}`);
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
