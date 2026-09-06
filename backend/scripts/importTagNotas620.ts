/*
 * Carga nucleo.instrumento_nota (relación N:M tag<->nota) desde la hoja
 * "Tag_Notas" del Excel "DB HD.xlsx" (1116 filas) — la última pieza
 * pendiente del módulo Hojas de Datos.
 *
 * Tag_Notas usa el tag_id INTERNO de la usuaria ("T-0001"), no el tag
 * real ("620-PI-5072") — se resuelve primero contra la hoja "Tags"
 * (tag_id -> tag), igual que ya hizo importHojasDeDatos620.ts con
 * documento_id ("DOC-01" -> id real) y con las notas (documento_id +
 * numero -> nota_id real, vía GET .../documentos/:id/notas ya cargadas
 * en la pasada anterior).
 *
 * POST /projects/:projectId/documentos/:documentoId/notas/:notaId/instrumentos/:instrumentoId
 * ya reactiva en vez de duplicar si la asociación existiera inactiva —
 * mismo patrón que toda asociación N:M de este proyecto — así que este
 * script puede correrse más de una vez sin generar duplicados.
 *
 * Uso:
 *   npx tsx scripts/importTagNotas620.ts --project 50050 --dry-run
 *   npx tsx scripts/importTagNotas620.ts --project 50050 --apply
 */

import ExcelJS from 'exceljs';
import path from 'node:path';

interface Args {
  projectId: string;
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
  if (dryRun === apply) { console.error('Especificá exactamente uno de --dry-run / --apply.'); process.exit(1); }
  return {
    projectId,
    apiBase: get('--api') ?? 'http://localhost:3000',
    devUserEmail: get('--user') ?? 'admin@siei.local',
    mode: dryRun ? 'dry-run' : 'apply'
  };
}

async function apiFetch<T = any>(
  apiBase: string, devUserEmail: string, urlPath: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${urlPath} -> ${response.status}: ${JSON.stringify(json)}`);
  return json as T;
}

function sheetHeaders(ws: ExcelJS.Worksheet): string[] {
  const raw = ws.getRow(1).values as any[];
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    result[i] = v === undefined || v === null ? '' : String(v).trim();
  }
  return result;
}

function sheetRows(ws: ExcelJS.Worksheet): any[][] {
  const rows: any[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.values && (row.values as any[]).some((v) => v !== undefined && v !== null && String(v).trim() !== '')) {
      rows.push(row.values as any[]);
    }
  }
  return rows;
}

function colIndex(headers: string[], text: string): number {
  const idx = headers.findIndex((h) => h === text);
  if (idx < 0) throw new Error(`No se encontró la columna "${text}".`);
  return idx;
}

function cell(row: any[], idx: number): string | null {
  const v = row[idx];
  if (v === undefined || v === null) return null;
  const s = typeof v === 'object' && 'result' in v ? String((v as any).result ?? '') : String(v);
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';
  const excelPath = path.join(process.cwd(), '..', 'reference_excel', 'DB HD.xlsx');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  // --- 1) tag_id interno ("T-0001") -> tag real ("620-PI-5072") ---
  const wsTags = workbook.getWorksheet('Tags')!;
  const hTags = sheetHeaders(wsTags);
  const iTagId = colIndex(hTags, 'tag_id');
  const iTag = colIndex(hTags, 'tag');
  const tagRealPorTagId = new Map<string, string>();
  for (const row of sheetRows(wsTags)) {
    const tagId = cell(row, iTagId);
    const tagReal = cell(row, iTag);
    if (tagId && tagReal) tagRealPorTagId.set(tagId, tagReal);
  }

  // --- 2) tag real -> instrumento_id real ---
  const { instruments } = await apiFetch<{ instruments: Array<{ id: string; tagInstrumento: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/instruments`
  );
  const instrumentoIdPorTag = new Map(instruments.map((i) => [i.tagInstrumento, i.id]));

  // --- 3) documento_id texto ("DOC-01") -> documento real + sus notas
  // (numero -> nota_id real) ---
  const { documentos } = await apiFetch<{ documentos: Array<{ id: string; codigoDocumento: string | null; descripcion: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/documentos`
  );
  const wsDoc = workbook.getWorksheet('Documentos')!;
  const hDoc = sheetHeaders(wsDoc);
  const iDocId = colIndex(hDoc, 'documento_id');
  const iDocCodigo = colIndex(hDoc, 'codigo_hd');
  const documentoRealIdPorCodigo = new Map<string, string>();
  for (const row of sheetRows(wsDoc)) {
    const docCode = cell(row, iDocId)!;
    const codigoHd = cell(row, iDocCodigo);
    const real = documentos.find((d) => d.codigoDocumento === codigoHd);
    if (real) documentoRealIdPorCodigo.set(docCode, real.id);
  }

  const notaIdPorClave = new Map<string, string>(); // "DOC-01::3" -> nota_id real
  for (const [docCode, documentoRealId] of documentoRealIdPorCodigo.entries()) {
    const { notas } = await apiFetch<{ notas: Array<{ id: string; numero: number }> }>(
      apiBase, devUserEmail, `/api/projects/${projectId}/documentos/${documentoRealId}/notas`
    );
    for (const n of notas) notaIdPorClave.set(`${docCode}::${n.numero}`, n.id);
  }

  // --- 4) Tag_Notas: tag_id + documento_id + numero -> asociar ---
  const wsTN = workbook.getWorksheet('Tag_Notas')!;
  const hTN = sheetHeaders(wsTN);
  const iTNTagId = colIndex(hTN, 'tag_id');
  const iTNDoc = colIndex(hTN, 'documento_id');
  const iTNNum = colIndex(hTN, 'numero');

  let asociadas = 0;
  let sinTagReal = 0;
  let sinInstrumento = 0;
  let sinNota = 0;
  let errores = 0;

  for (const row of sheetRows(wsTN)) {
    const tagId = cell(row, iTNTagId);
    const docCode = cell(row, iTNDoc);
    const numero = cell(row, iTNNum);
    if (!tagId || !docCode || !numero) continue;

    const tagReal = tagRealPorTagId.get(tagId);
    if (!tagReal) { sinTagReal++; continue; }

    const instrumentoId = instrumentoIdPorTag.get(tagReal);
    if (!instrumentoId) { sinInstrumento++; continue; }

    const documentoRealId = documentoRealIdPorCodigo.get(docCode);
    const notaId = documentoRealId ? notaIdPorClave.get(`${docCode}::${numero}`) : undefined;
    if (!documentoRealId || !notaId) { sinNota++; continue; }

    if (!isDryRun) {
      try {
        await apiFetch(
          apiBase, devUserEmail,
          `/api/projects/${projectId}/documentos/${documentoRealId}/notas/${notaId}/instrumentos/${instrumentoId}`,
          { method: 'POST' }
        );
        asociadas++;
      } catch (err) {
        console.warn(`  [WARN] ${tagReal} / nota ${docCode}#${numero}: ${err instanceof Error ? err.message : err}`);
        errores++;
      }
    } else {
      asociadas++;
    }
  }

  console.log('\n=== Resumen ===');
  console.log({ asociadas, sinTagReal, sinInstrumento, sinNota, errores });
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
