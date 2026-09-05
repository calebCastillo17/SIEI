/*
 * Rellena, sobre el hardware YA CARGADO por importControl620.ts (gabinete/
 * rack/slot/módulo reales del proyecto 22043/620), los 3 tags reales que
 * trae el Excel fuente y que hasta ahora quedaban en blanco/sugerido:
 *
 *   - nucleo.modulo.tag              <- SENALES_CONTROL.MODULO_VISTA_ORDEN
 *     (ej. "DI-01") — YA coincide exactamente con la convención de
 *     sugerencia automática implementada en modules.ts (TIPO-orden,
 *     contando por tipo dentro del rack en orden de slot), así que este
 *     script confirma esa lógica contra el dato real en vez de inventar
 *     nada nuevo.
 *   - nucleo.modulo.surge_protector_tag <- SENALES_CONTROL.DISPR (ej.
 *     "DISPR01" — SIN guion, tal como viene en el Excel, no se normaliza).
 *   - nucleo.bloque_terminal.codigo  <- SENALES_CONTROL.TB (ej. "TB-01"),
 *     reemplazando el centinela "MODULO" que dejó la materialización
 *     automática (migración 015/017).
 *
 * Match por (RIO, CHASIS, SLOT) -> gabinete/rack/slot/módulo ya existentes
 * — el mismo criterio de resolución que importControl620.ts (numeroRack/
 * numeroSlot = dígitos de CHASIS/SLOT). Nunca crea gabinete/rack/slot/
 * módulo nuevo: si no encuentra el slot ya instalado, es ERROR, no CREATE
 * (este script asume que importControl620.ts ya corrió).
 *
 * Uso:
 *   npx tsx scripts/importControlTags620.ts --project <projectId> --dry-run
 *   npx tsx scripts/importControlTags620.ts --project <projectId> --apply
 *   [--file ../reference_excel/02_MASTER_IO_620.xlsm]
 *   [--api http://localhost:3000] [--user admin@siei.local]
 *
 * Idempotente: vuelve a poner el mismo valor si ya coincide (SKIP), y
 * sobreescribe si difiere (UPDATE) — el Excel es la fuente de verdad para
 * estos 3 campos específicos, así que una segunda corrida siempre
 * converge al mismo estado.
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
    console.error('Especifica --dry-run o --apply.');
    process.exit(1);
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  return {
    projectId: projectId!,
    filePath: get('--file') ?? path.resolve(__dirname, '../../reference_excel/02_MASTER_IO_620.xlsm'),
    apiBase: get('--api') ?? 'http://localhost:3000',
    devUserEmail: get('--user') ?? 'admin@siei.local',
    mode: dryRun ? 'dry-run' : 'apply'
  };
}

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

function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s.length === 0 || s === '-') return null;
  return s;
}

interface TagRow {
  rio: string;
  chasis: string;
  slot: string;
  moduloVistaOrden: string | null;
  dispr: string | null;
  tb: string | null;
}

const HEADERS = ['RIO', 'CHASIS', 'SLOT', 'DISPR', 'TB', 'MODULO_VISTA_ORDEN'] as const;

async function readTagRows(filePath: string): Promise<TagRow[]> {
  const rawBuffer = await readFile(filePath);
  const namespaced = await normalizeNamespacedXlsx(rawBuffer);
  const buffer = await stripDefinedNames(namespaced);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('SENALES_CONTROL');
  if (!sheet) throw new Error(`No se encontró la hoja SENALES_CONTROL en ${filePath}`);

  const headerRow = sheet.getRow(1);
  const colByHeader = new Map<string, number>();
  const maxCol = Math.min(headerRow.cellCount + 5, 200);
  for (let c = 1; c <= maxCol; c++) {
    const raw = headerRow.getCell(c).value;
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if ((HEADERS as readonly string[]).includes(text)) colByHeader.set(text, c);
  }

  const missing = HEADERS.filter((h) => !colByHeader.has(h));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas esperadas en SENALES_CONTROL: ${missing.join(', ')}`);
  }

  const get = (row: ExcelJS.Row, header: string) => row.getCell(colByHeader.get(header)!).value;

  const seen = new Map<string, TagRow>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const rio = cleanText(get(row, 'RIO'));
    const chasis = cleanText(get(row, 'CHASIS'));
    const slot = cleanText(get(row, 'SLOT'));
    if (!rio || !chasis || !slot) continue;

    const key = `${rio}|${chasis}|${slot}`;
    if (seen.has(key)) continue; // 1 fila por (rio,chasis,slot) — repite por cada señal del canal

    seen.set(key, {
      rio,
      chasis,
      slot,
      moduloVistaOrden: cleanText(get(row, 'MODULO_VISTA_ORDEN')),
      dispr: cleanText(get(row, 'DISPR')),
      tb: cleanText(get(row, 'TB'))
    });
  }

  return [...seen.values()];
}

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`\n=== importControlTags620.ts (${mode}) ===`);
  console.log(`Proyecto: ${projectId}  |  Archivo: ${filePath}\n`);

  const rows = await readTagRows(filePath);
  console.log(`Filas (rio,chasis,slot) distintas leídas: ${rows.length}`);

  const gabinetesResp = await apiFetch<{ gabinetes: Array<{ id: string; tagGabinete: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/gabinetes`
  );
  const gabineteIdByTag = new Map<string, string>();
  for (const g of gabinetesResp.json.gabinetes ?? []) gabineteIdByTag.set(g.tagGabinete, g.id);

  const racksResp = await apiFetch<{ racks: Array<{ id: string; gabineteId: string; numeroRack: number }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/racks`
  );
  const rackIdByKey = new Map<string, string>(); // `${gabineteId}|${numeroRack}`
  for (const r of racksResp.json.racks ?? []) rackIdByKey.set(`${r.gabineteId}|${r.numeroRack}`, r.id);

  const slotsResp = await apiFetch<{ slots: Array<{ id: string; rackId: string; numeroSlot: number }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/slots`
  );
  const slotIdByKey = new Map<string, string>(); // `${rackId}|${numeroSlot}`
  for (const s of slotsResp.json.slots ?? []) slotIdByKey.set(`${s.rackId}|${s.numeroSlot}`, s.id);

  const modulesResp = await apiFetch<{
    modules: Array<{ id: string; slotId: string; tag: string | null; surgeProtectorTag: string | null }>;
  }>(apiBase, devUserEmail, `/api/projects/${projectId}/modules`);
  const moduleBySlotId = new Map<string, { id: string; tag: string | null; surgeProtectorTag: string | null }>();
  for (const m of modulesResp.json.modules ?? []) moduleBySlotId.set(m.slotId, m);

  const bloquesResp = await apiFetch<{ bloquesTerminal: Array<{ id: string; moduloId: string | null; codigo: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal`
  );
  const bloqueByModuloId = new Map<string, { id: string; codigo: string }>();
  for (const b of bloquesResp.json.bloquesTerminal ?? []) {
    if (b.moduloId) bloqueByModuloId.set(b.moduloId, b);
  }

  const counters = {
    modulo: { UPDATE: 0, SKIP: 0, ERROR: 0 },
    bloque: { UPDATE: 0, SKIP: 0, ERROR: 0 }
  };
  const errorLog: Array<{ tag: string; layer: string; message: string }> = [];

  for (const row of rows) {
    const combo = `${row.rio}|${row.chasis}|${row.slot}`;
    const gabineteId = gabineteIdByTag.get(row.rio);
    if (!gabineteId) { counters.modulo.ERROR++; errorLog.push({ tag: combo, layer: 'gabinete', message: `RIO no encontrado: ${row.rio}` }); continue; }

    const numeroRack = Number(row.chasis.replace(/\D/g, '')) || 1;
    const rackId = rackIdByKey.get(`${gabineteId}|${numeroRack}`);
    if (!rackId) { counters.modulo.ERROR++; errorLog.push({ tag: combo, layer: 'rack', message: `Rack no encontrado (CHASIS=${row.chasis})` }); continue; }

    const numeroSlot = Number(row.slot.replace(/\D/g, ''));
    const slotId = slotIdByKey.get(`${rackId}|${numeroSlot}`);
    if (!slotId) { counters.modulo.ERROR++; errorLog.push({ tag: combo, layer: 'slot', message: `Slot no encontrado (SLOT=${row.slot})` }); continue; }

    const modulo = moduleBySlotId.get(slotId);
    if (!modulo) { counters.modulo.ERROR++; errorLog.push({ tag: combo, layer: 'modulo', message: 'Módulo no instalado en ese slot todavía.' }); continue; }

    // tag / surgeProtectorTag del módulo
    const needsModuloUpdate =
      (row.moduloVistaOrden !== null && modulo.tag !== row.moduloVistaOrden) ||
      (row.dispr !== null && modulo.surgeProtectorTag !== row.dispr);

    if (!needsModuloUpdate) {
      counters.modulo.SKIP++;
    } else if (isDryRun) {
      counters.modulo.UPDATE++;
    } else {
      const body: Record<string, string> = {};
      if (row.moduloVistaOrden !== null) body.tag = row.moduloVistaOrden;
      if (row.dispr !== null) body.surgeProtectorTag = row.dispr;
      const result = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/modules/${modulo.id}`, {
        method: 'PATCH', body
      });
      if (result.status === 200) counters.modulo.UPDATE++;
      else { counters.modulo.ERROR++; errorLog.push({ tag: combo, layer: 'modulo', message: JSON.stringify(result.json) }); }
    }

    // codigo del bloque_terminal (TB) de ese módulo
    const bloque = bloqueByModuloId.get(modulo.id);
    if (!bloque) { counters.bloque.ERROR++; errorLog.push({ tag: combo, layer: 'bloque_terminal', message: 'bloque_terminal no encontrado para ese módulo.' }); continue; }

    if (row.tb === null || bloque.codigo === row.tb) {
      counters.bloque.SKIP++;
    } else if (isDryRun) {
      counters.bloque.UPDATE++;
    } else {
      const result = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal/${bloque.id}`, {
        method: 'PATCH', body: { codigo: row.tb }
      });
      if (result.status === 200) counters.bloque.UPDATE++;
      else { counters.bloque.ERROR++; errorLog.push({ tag: combo, layer: 'bloque_terminal', message: JSON.stringify(result.json) }); }
    }
  }

  console.log(`\nMódulos (tag/surgeProtectorTag): ~${counters.modulo.UPDATE} actualizados, =${counters.modulo.SKIP} sin cambio, !${counters.modulo.ERROR} error`);
  console.log(`Bloques terminal (TB):           ~${counters.bloque.UPDATE} actualizados, =${counters.bloque.SKIP} sin cambio, !${counters.bloque.ERROR} error`);

  if (errorLog.length > 0) {
    console.log('\n--- Errores ---');
    for (const e of errorLog) console.log(`[${e.layer}] ${e.tag}: ${e.message}`);
  }

  console.log(`\n${isDryRun ? 'DRY-RUN — nada se escribió.' : 'APPLY — cambios aplicados.'}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
