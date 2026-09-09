/*
 * Carga de EQUIPOS + PANELES reales del proyecto 420, desde la hoja
 * EQUIPOS de reference_excel/02_MASTER_IO_420.xlsm — paso previo a cargar
 * las 123 señales de dueño equipo de SENALES_CONTROL (RIO 1).
 *
 * Hallazgo real, confirmado por el usuario tras una corrección mía:
 * "PANEL" (hoja EQUIPOS/SENALES_COM) y "CAJA_EQUIPO" (SENALES_CONTROL) son
 * el MISMO tag físico (verificado: 420-PPC-5007 -> panel/caja_equipo
 * 420-MCL-5007 en las 3 hojas) — el panel es la caja real por donde
 * físicamente se rutea la señal, no un campo descriptivo nada más.
 * nucleo.equipo.panel SÍ existe como texto libre (migración 007, mismo
 * patrón que sistema/nodo) — no hace falta ningún cambio de schema.
 *
 * "MCL no sería equipo sería panel, los equipos serían PCC" (palabras
 * del usuario): de las 51 filas de la hoja EQUIPOS, 3 tags (420-MCL-5006,
 * 420-MCL-5007, 420-SGL-606) NO son equipos reales — son paneles que
 * agrupan a otros equipos (aparecen como valor de PANEL de varias filas
 * distintas) — se excluyen de la creación de equipos y se crean como
 * CAJA en su lugar, junto con el resto de paneles (prefijos AFL, AFM, COA)
 * que nunca tienen su propia fila en EQUIPOS.
 *
 * Uso:
 *   npx tsx scripts/seedEquiposPaneles420.ts --project <projectId> --dry-run
 *   npx tsx scripts/seedEquiposPaneles420.ts --project <projectId> --apply
 *   [--file ../reference_excel/02_MASTER_IO_420.xlsm]
 *   [--api http://localhost:3000] [--user admin@siei.local]
 *
 * Idempotente: busca primero por tag (equipo o caja) antes de crear.
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
  if (!projectId) { console.error('Falta --project <projectId>.'); process.exit(1); }
  const dryRun = has('--dry-run');
  const apply = has('--apply');
  if (dryRun && apply) { console.error('No usar --dry-run y --apply al mismo tiempo.'); process.exit(1); }
  if (!dryRun && !apply) { console.error('Debe indicarse --dry-run o --apply explícitamente.'); process.exit(1); }

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

async function apiFetch<T = any>(apiBase: string, devUserEmail: string, urlPath: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: T }> {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const json = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, json };
}

function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  // "0" encontrado con datos reales en PANEL (BAC-5004/ATS-5005/UPS-5012/
  // 5013): mismo significado que "-" en el resto de la hoja — "sin panel
  // propio", nunca un tag real.
  if (s.length === 0 || s === '-' || s === '0') return null;
  return s;
}

// Paneles confirmados: son tags de EQUIPOS que en realidad son paneles
// (aparecen como PANEL de otras filas, nunca tienen descripción propia de
// equipo real) — confirmado por el usuario para estos 3.
const TAGS_QUE_SON_PANEL_NO_EQUIPO = new Set(['420-MCL-5006', '420-MCL-5007', '420-SGL-606']);

interface EquipoRow {
  tagEquipo: string;
  descripcion: string | null;
  panel: string | null;
  sistema: string | null;
  nodo: string | null;
  planoPnid: string | null;
}

async function leerHojas(filePath: string): Promise<{ equipos: EquipoRow[]; panelesDeSenalesCom: Set<string> }> {
  const rawBuffer = await readFile(filePath);
  const namespaced = await normalizeNamespacedXlsx(rawBuffer);
  const buffer = await stripDefinedNames(namespaced);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheetEquipos = workbook.getWorksheet('EQUIPOS');
  if (!sheetEquipos) throw new Error(`No se encontró la hoja EQUIPOS en ${filePath}`);
  const headerRow = sheetEquipos.getRow(1);
  const colByHeader = new Map<string, number>();
  for (let c = 1; c <= 20; c++) {
    const text = cleanText(headerRow.getCell(c).value);
    if (text) colByHeader.set(text, c);
  }
  const col = (h: string) => colByHeader.get(h)!;

  const equipos: EquipoRow[] = [];
  for (let r = 2; r <= sheetEquipos.rowCount; r++) {
    const row = sheetEquipos.getRow(r);
    const tagEquipo = cleanText(row.getCell(col('EQUIPO')).value);
    if (!tagEquipo) continue;
    equipos.push({
      tagEquipo,
      descripcion: cleanText(row.getCell(col('DESCRIPCIÓN')).value),
      panel: cleanText(row.getCell(col('PANEL')).value),
      sistema: cleanText(row.getCell(col('SISTEMA')).value),
      nodo: cleanText(row.getCell(col('NODO')).value),
      planoPnid: cleanText(row.getCell(col('P&ID')).value)
    });
  }

  const sheetCom = workbook.getWorksheet('SENALES_COM');
  const panelesDeSenalesCom = new Set<string>();
  if (sheetCom) {
    const headerRowCom = sheetCom.getRow(1);
    const colByHeaderCom = new Map<string, number>();
    for (let c = 1; c <= 60; c++) {
      const text = cleanText(headerRowCom.getCell(c).value);
      if (text) colByHeaderCom.set(text, c);
    }
    const panelCol = colByHeaderCom.get('PANEL');
    if (panelCol) {
      for (let r = 2; r <= sheetCom.rowCount; r++) {
        const v = cleanText(sheetCom.getRow(r).getCell(panelCol).value);
        if (v) panelesDeSenalesCom.add(v);
      }
    }
  }

  return { equipos, panelesDeSenalesCom };
}

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== seedEquiposPaneles420.ts (${mode.toUpperCase()}) ===`);
  console.log(`API: ${apiBase}  |  Usuario dev: ${devUserEmail}  |  Archivo: ${filePath}`);

  const { equipos, panelesDeSenalesCom } = await leerHojas(filePath);
  console.log(`\n${equipos.length} filas en EQUIPOS.`);

  const panelesDeEquipos = new Set(equipos.map((e) => e.panel).filter((p): p is string => Boolean(p)));
  const paneles = new Set([...panelesDeEquipos, ...panelesDeSenalesCom]);
  console.log(`${paneles.size} paneles distintos (unión EQUIPOS.PANEL + SENALES_COM.PANEL).`);

  const equiposReales = equipos.filter((e) => !TAGS_QUE_SON_PANEL_NO_EQUIPO.has(e.tagEquipo));
  console.log(`${equiposReales.length} equipos reales a crear (excluidos: ${[...TAGS_QUE_SON_PANEL_NO_EQUIPO].join(', ')}).`);

  // --- Tipo de equipo (ELECTRICO por defecto, mismo criterio que 620) ---
  const tiposResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/tipos-equipo');
  const tipoElectrico = (tiposResp.json.items ?? []).find((t) => t.codigo === 'ELECTRICO');
  if (!tipoElectrico) { console.error('No existe el tipo ELECTRICO en cat.cat_tipo_equipo.'); process.exit(1); }

  // --- Equipos existentes ---
  const existingEquipmentResp = await apiFetch<{ equipment: Array<{ id: string; tagEquipo: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/equipment`);
  const equipoIdByTag = new Map<string, string>();
  for (const e of existingEquipmentResp.json.equipment ?? []) equipoIdByTag.set(e.tagEquipo, e.id);

  console.log('\n--- Equipos ---');
  let equiposCreados = 0, equiposSkip = 0, equiposError = 0;
  for (const e of equiposReales) {
    if (equipoIdByTag.has(e.tagEquipo)) { equiposSkip++; continue; }
    if (isDryRun) { equiposCreados++; console.log(`  + ${e.tagEquipo} (panel=${e.panel ?? '—'})`); equipoIdByTag.set(e.tagEquipo, '(dry-run)'); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/equipment`, {
      method: 'POST',
      body: { tagEquipo: e.tagEquipo, descripcion: e.descripcion, panel: e.panel, sistema: e.sistema, nodo: e.nodo, planoPnid: e.planoPnid, tipoEquipoId: tipoElectrico.id }
    });
    if (created.status === 201) { equiposCreados++; equipoIdByTag.set(e.tagEquipo, created.json.equipment.id); console.log(`  + ${e.tagEquipo}`); }
    else if (created.status === 409) { equiposSkip++; }
    else { equiposError++; console.log(`  ! ERROR ${e.tagEquipo}: ${JSON.stringify(created.json)}`); }
  }

  // --- Paneles (como caja) ---
  const existingBoxesResp = await apiFetch<{ boxes: Array<{ id: string; tagCaja: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`);
  const cajaIdByTag = new Map<string, string>();
  for (const b of existingBoxesResp.json.boxes ?? []) cajaIdByTag.set(b.tagCaja, b.id);

  console.log('\n--- Paneles (creados como caja física) ---');
  let panelesCreados = 0, panelesSkip = 0, panelesError = 0;
  for (const tag of paneles) {
    if (cajaIdByTag.has(tag)) { panelesSkip++; continue; }
    if (isDryRun) { panelesCreados++; console.log(`  + ${tag}`); cajaIdByTag.set(tag, '(dry-run)'); continue; }
    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`, { method: 'POST', body: { tagCaja: tag, descripcion: 'Panel (importControl420.ts / seedEquiposPaneles420.ts)' } });
    if (created.status === 201) { panelesCreados++; cajaIdByTag.set(tag, created.json.box.id); console.log(`  + ${tag}`); }
    else if (created.status === 409) { panelesSkip++; }
    else { panelesError++; console.log(`  ! ERROR ${tag}: ${JSON.stringify(created.json)}`); }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Modo: ${mode}`);
  console.log(`Equipos:  CREATE=${equiposCreados} SKIP=${equiposSkip} ERROR=${equiposError}`);
  console.log(`Paneles:  CREATE=${panelesCreados} SKIP=${panelesSkip} ERROR=${panelesError}`);

  process.exit(equiposError > 0 || panelesError > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
