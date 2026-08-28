/*
 * Carga puntual de datos de UN proyecto — no es una migración ni un
 * catálogo global. Lee reference_excel/equipos_620.xlsx y crea cada fila
 * como un nucleo.equipo del proyecto indicado, llamando al mismo
 * POST /api/projects/:projectId/equipment que usa el formulario — nunca
 * un INSERT SQL directo, para no bypasear ninguna validación del backend
 * (longitudes, TAG duplicado activo, etc.).
 *
 * No crea ninguna asociación con instrumentos (equipo_asociado_id se deja
 * para curación manual, como en todo el resto del sistema).
 *
 * Uso:
 *   npx tsx scripts/seedEquiposDesdeExcel.ts --project <projectId> \
 *     [--file ../reference_excel/equipos_620.xlsx] \
 *     [--api http://localhost:3000] [--user admin@siei.local]
 */

import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeHeaderText } from '../src/lib/ldi/columns.js';

interface Args {
  projectId: string;
  filePath: string;
  apiBase: string;
  devUserEmail: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const projectId = get('--project');
  if (!projectId) {
    console.error('Falta --project <projectId>. Uso: npx tsx scripts/seedEquiposDesdeExcel.ts --project <projectId> [--file ...] [--api ...] [--user ...]');
    process.exit(1);
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '../..');

  return {
    projectId,
    filePath: get('--file') ?? path.resolve(repoRoot, 'reference_excel/equipos_620.xlsx'),
    apiBase: get('--api') ?? 'http://localhost:3000',
    devUserEmail: get('--user') ?? 'admin@siei.local'
  };
}

/* Encabezados esperados — validados por texto normalizado (mismo criterio
 * que el resto de SIEI: accent/case-insensitive), no por posición fija. */
const EXPECTED_HEADERS = ['EQUIPO', 'DESCRIPCIÓN', 'PANEL', 'SISTEMA', 'NODO', 'P&ID'];

interface EquipoRow {
  tagEquipo: string;
  descripcion: string | null;
  panel: string | null;
  sistema: string | null;
  nodo: string | null;
  planoPnid: string | null;
}

async function leerExcel(filePath: string): Promise<EquipoRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`El archivo ${filePath} no tiene ninguna hoja.`);

  const headerRow = sheet.getRow(1);
  const colIndexByHeader = new Map<string, number>();
  for (let c = 1; c <= 20; c++) {
    const text = normalizeHeaderText(headerRow.getCell(c).value);
    if (text) colIndexByHeader.set(text, c);
  }

  const missing = EXPECTED_HEADERS.filter((h) => !colIndexByHeader.has(normalizeHeaderText(h)));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas esperadas en ${filePath}: ${missing.join(', ')}. Encabezados encontrados: ${[...colIndexByHeader.keys()].join(', ')}`);
  }

  const col = (header: string) => colIndexByHeader.get(normalizeHeaderText(header))!;
  const cellText = (row: ExcelJS.Row, header: string): string | null => {
    const raw = row.getCell(col(header)).value;
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    return text.length > 0 ? text : null;
  };

  const rows: EquipoRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const tagEquipo = cellText(row, 'EQUIPO');
    if (!tagEquipo) continue; // fila en blanco al final de la hoja

    rows.push({
      tagEquipo,
      descripcion: cellText(row, 'DESCRIPCIÓN'),
      panel: cellText(row, 'PANEL'),
      sistema: cellText(row, 'SISTEMA'),
      nodo: cellText(row, 'NODO'),
      planoPnid: cellText(row, 'P&ID')
    });
  }

  return rows;
}

async function apiFetch<T>(apiBase: string, devUserEmail: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: T | { error?: string; message?: string } }> {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function main() {
  const { projectId, filePath, apiBase, devUserEmail } = parseArgs();

  console.log(`Leyendo ${filePath} ...`);
  const rows = await leerExcel(filePath);
  console.log(`${rows.length} registros encontrados en el Excel.`);

  const tiposResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/tipos-equipo');
  if (tiposResp.status !== 200) {
    console.error('No se pudo leer cat.cat_tipo_equipo — ¿está corriendo el backend y aplicada la migración 007?', tiposResp.json);
    process.exit(1);
  }
  const tipoElectrico = (tiposResp.json as { items: Array<{ id: string; codigo: string }> }).items.find((t) => t.codigo === 'ELECTRICO');
  if (!tipoElectrico) {
    console.error('No existe el tipo ELECTRICO en cat.cat_tipo_equipo.');
    process.exit(1);
  }

  const creados: string[] = [];
  const duplicados: string[] = [];
  const errores: Array<{ tag: string; message: string }> = [];

  for (const row of rows) {
    const result = await apiFetch<{ equipment: { id: string; tagEquipo: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}/equipment`, {
      method: 'POST',
      body: {
        tagEquipo: row.tagEquipo,
        descripcion: row.descripcion,
        panel: row.panel,
        sistema: row.sistema,
        nodo: row.nodo,
        planoPnid: row.planoPnid,
        tipoEquipoId: tipoElectrico.id
      }
    });

    if (result.status === 201) {
      creados.push(row.tagEquipo);
    } else if (result.status === 409) {
      duplicados.push(row.tagEquipo);
    } else {
      const message = (result.json as { message?: string }).message ?? `HTTP ${result.status}`;
      errores.push({ tag: row.tagEquipo, message });
    }
  }

  console.log('\n=== Resultado de la carga ===');
  console.log(`Creados (${creados.length}):`);
  creados.forEach((tag) => console.log(`  + ${tag}`));
  console.log(`Duplicados / ya existentes (${duplicados.length}):`);
  duplicados.forEach((tag) => console.log(`  = ${tag}`));
  console.log(`Errores (${errores.length}):`);
  errores.forEach(({ tag, message }) => console.log(`  ! ${tag}: ${message}`));

  console.log(`\nTotal: ${rows.length} leídos, ${creados.length} creados, ${duplicados.length} duplicados, ${errores.length} errores.`);

  process.exit(errores.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
