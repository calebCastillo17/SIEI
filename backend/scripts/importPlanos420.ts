/*
 * Carga real de la hoja PLANOS (02_MASTER_IO_420.xlsm) sobre el proyecto
 * ya existente — adaptado de importPlanos620.ts, mismo principio: llama
 * a la API real (nunca INSERT SQL directo), es idempotente (busca por
 * descripción exacta antes de crear), clasifica por capas en vez de
 * bloquear todo por un dato faltante.
 *
 * Diferencias reales encontradas respecto a 620 (documentadas, no
 * asumidas):
 *   - No hay planos tipo INTERIOR_GABINETE sintéticos que fabricar: de
 *     los 7 valores distintos de PLANO_CONEX_INTERIOR referenciados,
 *     6 ya tienen su propia fila real en la hoja (se cargan como
 *     CONEXIONADO normal) y el séptimo ("620-J-20019") pertenece al
 *     OTRO proyecto (620) — queda sin asociar, no se inventa.
 *   - ESTADO acá no es un estado de ciclo de vida ("ANULADO" como en
 *     620) — los valores reales son A/B/INI/vacío, que leen como letra
 *     de revisión, no como cancelación. No se desactiva ningún plano
 *     por ESTADO en esta corrida (no se encontró evidencia de un valor
 *     equivalente a ANULADO).
 *   - 2 códigos son placeholders reales del Excel, confirmados y
 *     corregidos por el usuario explícitamente en esta sesión:
 *       "420-J-202X7" -> "420-J-20241"
 *       "420-J-202X1" -> "420-J-2030"
 *   - 16 filas son "S. ELÉCTRICA - DIAGRAMA ESQUEMÁTICO DE MOTOR..."
 *     (diagramas esquemáticos de motor, MT/BT) — un tipo de documento
 *     real que no existe en cat.cat_tipo_plano (solo CONEXIONADO/
 *     INTERIOR_GABINETE/LAYOUT/UNIFILAR). Quedan FUERA de esta corrida
 *     — no se inventa una categoría nueva sin confirmar con el usuario
 *     si corresponde agregarla al catálogo global (afecta a 620
 *     también, es cat.* sin proyecto_id).
 *
 * Uso:
 *   npx tsx scripts/importPlanos420.ts --project <projectId> --dry-run
 *   npx tsx scripts/importPlanos420.ts --project <projectId> --apply
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
  codigoAnterior: string | null;
  tablero: string | null;
}

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

// Placeholders reales del Excel, confirmados por el usuario explícitamente
// en esta sesión ("420-J-202X7 será 420-J-20241 y 420-J-202X1 será
// 420-J-2030") — el CODIGO_PRREV de esas 2 filas nunca cambió (sigue
// siendo el código de una fila hermana), así que la única forma de
// identificarlas es el propio texto placeholder.
const CODIGO_CORRECTIONS: Record<string, string> = {
  '420-J-202X7': '420-J-20241',
  '420-J-202X1': '420-J-2030'
};

async function readPlanosSheet(filePath: string): Promise<{ rows: PlanoRow[]; esquematicos: PlanoRow[] }> {
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
  const esquematicos: PlanoRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (header: string) => colByHeader.has(header) ? row.getCell(colByHeader.get(header)!).value : undefined;
    const descripcion = cellText(get('DESCRIPCION'));
    if (!descripcion) continue; // fila en blanco
    let codigoPlano = cellText(get('CODIGO'));
    const tablero = cellText(get('TABLERO'));
    // Mismo criterio que 620: fila real si trae CODIGO o TABLERO (los
    // encabezados de subsección dentro de la propia hoja no traen
    // ninguno de los dos).
    if (!codigoPlano && !tablero) continue;

    if (codigoPlano && CODIGO_CORRECTIONS[codigoPlano]) {
      codigoPlano = CODIGO_CORRECTIONS[codigoPlano];
    }

    const parsedRow: PlanoRow = {
      descripcion,
      codigoPlano,
      codigoAnterior: cellText(get('CODIGO_PRREV')),
      tablero
    };

    if (descripcion.toUpperCase().includes('DIAGRAMA ESQUEMÁTICO') || descripcion.toUpperCase().includes('DIAGRAMA ESQUEMATICO')) {
      esquematicos.push(parsedRow);
      continue;
    }
    rows.push(parsedRow);
  }
  return { rows, esquematicos };
}

function classify(descripcion: string): 'LAYOUT' | 'UNIFILAR' | 'CONEXIONADO' {
  const upper = descripcion.toUpperCase();
  if (upper.includes('LAYOUT')) return 'LAYOUT';
  if (upper.includes('UNIFILAR')) return 'UNIFILAR';
  return 'CONEXIONADO';
}

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== importPlanos420.ts (${mode.toUpperCase()}) ===`);

  const projResp = await apiFetch<{ project: { id: string; code: string; name: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}`);
  if (projResp.status !== 200) { console.error('Proyecto no accesible:', projResp.json); process.exit(1); }
  console.log(`Proyecto: ${projResp.json.project.code} — ${projResp.json.project.name}`);

  const { rows: allRows, esquematicos } = await readPlanosSheet(filePath);
  console.log(`${allRows.length} filas reales en PLANOS (+ ${esquematicos.length} DIAGRAMA ESQUEMÁTICO, fuera de alcance — ver RESUMEN).`);

  const byType = { LAYOUT: 0, UNIFILAR: 0, CONEXIONADO: 0 };
  for (const r of allRows) byType[classify(r.descripcion)]++;
  console.log(`  CONEXIONADO=${byType.CONEXIONADO} UNIFILAR=${byType.UNIFILAR} LAYOUT=${byType.LAYOUT}`);

  const tiposResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/tipos-plano');
  const tipoIdByCode = new Map(tiposResp.json.items.map((t) => [t.codigo, t.id]));

  const existingResp = await apiFetch<{ planos: Array<{ id: string; descripcion: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/planos`);
  const existingByDescripcion = new Map((existingResp.json.planos ?? []).map((p) => [p.descripcion, p.id]));

  const gabinetesResp = await apiFetch<{ gabinetes: Array<{ id: string; tagGabinete: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/gabinetes`);
  const gabineteIdByTag = new Map(gabinetesResp.json.gabinetes.map((g) => [g.tagGabinete, g.id]));

  const cajasResp = await apiFetch<{ boxes: Array<{ id: string; tagCaja: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`);
  const cajaIdByTag = new Map(cajasResp.json.boxes.map((c) => [c.tagCaja, c.id]));

  let created = 0, skipped = 0, errors = 0, associated = 0, associationSkipped = 0;
  const sinAsociar: string[] = [];

  for (const row of allRows) {
    const tipo = classify(row.descripcion);

    if (existingByDescripcion.has(row.descripcion)) {
      skipped++;
      continue;
    }

    const tipoPlanoId = tipoIdByCode.get(tipo)!;
    let planoId: string | null = null;

    if (isDryRun) {
      created++;
      console.log(`  + [dry-run] (${tipo}) ${row.descripcion} [${row.codigoPlano ?? 'sin código'}]`);
    } else {
      const result = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/planos`, {
        method: 'POST',
        body: { codigoPlano: row.codigoPlano, codigoAnterior: row.codigoAnterior, descripcion: row.descripcion, tipoPlanoId }
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
      } else {
        associationSkipped++;
        sinAsociar.push(`${row.descripcion} — TABLERO "${row.tablero}" no resuelto (ni gabinete ni caja).`);
      }
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Planos creados: ${created}  |  ya existentes (SKIP): ${skipped}  |  errores: ${errors}`);
  console.log(`Asociados a gabinete/caja: ${associated}  |  sin asociar (TABLERO no resuelto): ${associationSkipped}`);
  if (sinAsociar.length > 0) {
    console.log('\nPlanos sin asociación (revisar):');
    sinAsociar.forEach((s) => console.log(`  - ${s}`));
  }
  console.log('\nFuera de esta corrida, deliberadamente (no se inventa nada):');
  console.log(`  - ${esquematicos.length} planos "DIAGRAMA ESQUEMÁTICO DE MOTOR" — no existe ese tipo en cat.cat_tipo_plano (catálogo global, afecta también a 620). Pendiente confirmar con el usuario si se agrega.`);
  console.log('  - La fila "SISTEMAS AUXILIARES - LAYOUT TABLERO TBJ" (420-J-20252) referencia PLANO_CONEX_INTERIOR="620-J-20019" — pertenece al proyecto 620, no a este. No se asocia nada ahí.');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => { console.error('Error inesperado:', error); process.exit(1); });
