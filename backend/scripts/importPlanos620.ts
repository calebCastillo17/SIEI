/*
 * Carga real de la hoja PLANOS (02_MASTER_IO_620.xlsm) sobre un proyecto
 * ya existente — mismo principio que importControl620.ts: llama a la API
 * real (nunca INSERT SQL directo), es idempotente (busca por descripción
 * exacta antes de crear), y clasifica por capas en vez de bloquear todo
 * por un dato faltante.
 *
 * FUERA DE ALCANCE en esta corrida, por instrucción explícita del
 * usuario: los 5 planos tipo LAYOUT (se agregan después manualmente).
 *
 * También fuera de alcance, por decisión de "no inventar dato": los 3
 * planos tipo INTERIOR_GABINETE que en teoría corresponden a
 * PLANO_CONEX_INTERIOR (uno por 620-RIO-5012/620-RIO-5013/620-PCC-5006)
 * — el Excel no trae una DESCRIPCION real para esas 3 filas sintéticas
 * (nucleo.plano.descripcion es NOT NULL) y no se fabrica una. Quedan
 * pendientes hasta que el usuario confirme el texto real.
 *
 * Uso:
 *   npx tsx scripts/importPlanos620.ts --project <projectId> --dry-run
 *   npx tsx scripts/importPlanos620.ts --project <projectId> --apply
 */

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { normalizeNamespacedXlsx } from '../src/lib/pnidImport/parseExcel.js';

interface Args {
  projectId: string;
  filePath: string;
  apiBase: string;
  devUserEmail: string;
  mode: 'dry-run' | 'apply';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const has = (flag: string) => args.includes(flag);

  const projectId = get('--project');
  if (!projectId) { console.error('Falta --project <projectId>.'); process.exit(1); }
  const dryRun = has('--dry-run'), apply = has('--apply');
  if (dryRun === apply) { console.error('Debe indicarse exactamente uno de --dry-run o --apply.'); process.exit(1); }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '../..');

  return {
    projectId,
    filePath: get('--file') ?? path.resolve(repoRoot, 'reference_excel/02_MASTER_IO_620.xlsm'),
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

interface PlanoRow {
  descripcion: string;
  codigoPlano: string | null;
  tablero: string | null;
  estado: string | null;
}

// Algunas celdas de PLANOS mezclan formato dentro del mismo texto (p. ej.
// una porción en rojo resaltando un cambio) — ExcelJS las devuelve como
// { richText: [{text,...}, ...] } en vez de un string plano. Se concatena
// el texto real en vez de dejar que String(v) produzca "[object Object]".
function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const rt = (v as { richText?: Array<{ text?: string }> }).richText;
    if (Array.isArray(rt)) {
      const joined = rt.map((part) => part.text ?? '').join('').trim();
      return joined.length === 0 ? null : joined;
    }
    const hyperlinkText = (v as { text?: unknown }).text;
    if (typeof hyperlinkText === 'string') return cellText(hyperlinkText);
    return null;
  }
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

async function readPlanosSheet(filePath: string): Promise<PlanoRow[]> {
  const raw = await readFile(filePath);
  const namespaced = await normalizeNamespacedXlsx(raw);
  const buffer = await stripDefinedNames(namespaced);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('PLANOS');
  if (!sheet) throw new Error('No se encontró la hoja PLANOS.');

  const headerRow = sheet.getRow(1);
  const colByHeader = new Map<string, number>();
  const maxCol = Math.min(headerRow.cellCount + 5, 50);
  for (let c = 1; c <= maxCol; c++) {
    const raw = headerRow.getCell(c).value;
    if (raw !== null && raw !== undefined) colByHeader.set(String(raw).trim(), c);
  }

  const rows: PlanoRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (header: string) => colByHeader.has(header) ? row.getCell(colByHeader.get(header)!).value : undefined;
    const descripcion = cellText(get('DESCRIPCION'));
    if (!descripcion) continue; // fila en blanco
    const codigoPlano = cellText(get('CODIGO'));
    // "ELECTRICIDAD" es un encabezado de sub-sección dentro de la propia
    // hoja PLANOS (separa el bloque de tableros del de motores/unifilares),
    // no un plano real — se distingue porque no trae CODIGO ni TABLERO
    // (todo plano real, incluso los tipo LAYOUT, trae al menos uno de los
    // dos). Filtrar por eso, no por el texto exacto, para no depender de
    // que la hoja siga usando esa palabra en particular.
    const tablero = cellText(get('TABLERO'));
    if (!codigoPlano && !tablero) continue;
    rows.push({
      descripcion,
      codigoPlano,
      tablero,
      estado: cellText(get('ESTAD0'))
    });
  }
  return rows;
}

function classify(descripcion: string): 'LAYOUT' | 'UNIFILAR' | 'CONEXIONADO' {
  const upper = descripcion.toUpperCase();
  if (upper.includes('LAYOUT')) return 'LAYOUT';
  if (upper.includes('UNIFILAR')) return 'UNIFILAR';
  return 'CONEXIONADO';
}

const isPlaceholder = (tag: string) => tag.includes('XXX') || /50X/.test(tag);

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== importPlanos620.ts (${mode.toUpperCase()}) ===`);

  const projResp = await apiFetch<{ project: { id: string; code: string; name: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}`);
  if (projResp.status !== 200) { console.error('Proyecto no accesible:', projResp.json); process.exit(1); }
  console.log(`Proyecto: ${projResp.json.project.code} — ${projResp.json.project.name}`);

  const allRows = await readPlanosSheet(filePath);
  console.log(`${allRows.length} filas reales en PLANOS.`);

  const byType = { LAYOUT: 0, UNIFILAR: 0, CONEXIONADO: 0 };
  for (const r of allRows) byType[classify(r.descripcion)]++;
  console.log(`  CONEXIONADO=${byType.CONEXIONADO} UNIFILAR=${byType.UNIFILAR} LAYOUT=${byType.LAYOUT} (LAYOUT se omite esta corrida, a pedido del usuario)`);

  const tiposResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/tipos-plano');
  const tipoIdByCode = new Map(tiposResp.json.items.map((t) => [t.codigo, t.id]));

  const existingResp = await apiFetch<{ planos: Array<{ id: string; descripcion: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/planos`);
  const existingByDescripcion = new Map((existingResp.json.planos ?? []).map((p) => [p.descripcion, p.id]));

  const gabinetesResp = await apiFetch<{ gabinetes: Array<{ id: string; tagGabinete: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/gabinetes`);
  const gabineteIdByTag = new Map(gabinetesResp.json.gabinetes.map((g) => [g.tagGabinete, g.id]));

  const cajasResp = await apiFetch<{ boxes: Array<{ id: string; tagCaja: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`);
  const cajaIdByTag = new Map(cajasResp.json.boxes.map((c) => [c.tagCaja, c.id]));

  let created = 0, skipped = 0, errors = 0, associated = 0, associationSkipped = 0, deactivated = 0;
  const sinAsociar: string[] = [];

  for (const row of allRows) {
    const tipo = classify(row.descripcion);
    if (tipo === 'LAYOUT') continue;

    if (existingByDescripcion.has(row.descripcion)) {
      skipped++;
      continue;
    }

    const tipoPlanoId = tipoIdByCode.get(tipo)!;
    let planoId: string | null = null;

    if (isDryRun) {
      created++;
      console.log(`  + [dry-run] (${tipo}) ${row.descripcion}`);
    } else {
      const result = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/planos`, {
        method: 'POST',
        body: { codigoPlano: row.codigoPlano, descripcion: row.descripcion, tipoPlanoId }
      });
      if (result.status === 201) {
        created++;
        planoId = result.json.plano.id;
        existingByDescripcion.set(row.descripcion, planoId!);
      } else {
        errors++;
        console.log(`  ! ERROR creando "${row.descripcion}":`, JSON.stringify(result.json));
        continue;
      }
    }

    // --- Asociación a gabinete o caja, según qué es TABLERO ---
    if (row.tablero) {
      const gabineteId = gabineteIdByTag.get(row.tablero);
      const cajaId = cajaIdByTag.get(row.tablero);

      if (gabineteId) {
        if (!isDryRun && planoId) {
          const assoc = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/planos/${planoId}/gabinetes`, { method: 'POST', body: { gabineteId } });
          if (assoc.status === 200 || assoc.status === 201) associated++;
          else { errors++; console.log(`  ! ERROR asociando gabinete a "${row.descripcion}":`, JSON.stringify(assoc.json)); }
        } else if (isDryRun) associated++;
      } else if (cajaId) {
        if (!isDryRun && planoId) {
          const assoc = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/planos/${planoId}/cajas`, { method: 'POST', body: { cajaId } });
          if (assoc.status === 200 || assoc.status === 201) associated++;
          else { errors++; console.log(`  ! ERROR asociando caja a "${row.descripcion}":`, JSON.stringify(assoc.json)); }
        } else if (isDryRun) associated++;
      } else if (isPlaceholder(row.tablero)) {
        associationSkipped++;
        sinAsociar.push(`${row.descripcion} — TABLERO placeholder "${row.tablero}", no materializado.`);
      } else {
        associationSkipped++;
        sinAsociar.push(`${row.descripcion} — TABLERO "${row.tablero}" no resuelto (ni gabinete ni caja).`);
      }
    }

    // --- ANULADO: se crea (preserva el hecho histórico) y se desactiva de inmediato ---
    if (row.estado === 'ANULADO' && !isDryRun && planoId) {
      const del = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/planos/${planoId}`, { method: 'DELETE' });
      if (del.status === 200) deactivated++;
      else { errors++; console.log(`  ! ERROR desactivando plano ANULADO "${row.descripcion}":`, JSON.stringify(del.json)); }
    } else if (row.estado === 'ANULADO' && isDryRun) {
      deactivated++;
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Planos creados: ${created}  |  ya existentes (SKIP): ${skipped}  |  errores: ${errors}`);
  console.log(`Asociados a gabinete/caja: ${associated}  |  sin asociar (TABLERO no resuelto): ${associationSkipped}`);
  console.log(`Marcados ANULADO -> desactivados tras crear: ${deactivated}`);
  if (sinAsociar.length > 0) {
    console.log('\nPlanos sin asociación (revisar):');
    sinAsociar.forEach((s) => console.log(`  - ${s}`));
  }
  console.log('\nPendiente, deliberadamente fuera de esta corrida:');
  console.log(`  - ${byType.LAYOUT} planos LAYOUT (el usuario los agrega manualmente después).`);
  console.log('  - 3 planos INTERIOR_GABINETE (620-RIO-5012/620-RIO-5013/620-PCC-5006) — el Excel no trae una descripción real para ellos, no se inventa.');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => { console.error('Error inesperado:', error); process.exit(1); });
