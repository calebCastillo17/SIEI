/*
 * Carga TAG_PROCESO (condiciones de proceso por tag fisico) desde la
 * hoja "Tags" del Excel "DB HD.xlsx" — columnas O:AM, deliberadamente
 * dejadas afuera de importHojasDeDatos620.ts porque necesitaban su
 * propio mapeo.
 *
 * Consolidacion de sinonimos: la propia usuaria ya identifico en su hoja
 * _MAPEO que varias columnas son LA MISMA variable segun el tipo de
 * documento (ej. "Flujo maximo"/"Flujo nominal"/"Flujo minimo"/"Flujo
 * nom." son todas "Flujo"). Este script consolida esas columnas en una
 * sola variable de tag_proceso, tomando el primer valor no vacio que
 * encuentre para cada slot (min/nominal/max) — nunca pisa un valor ya
 * resuelto.
 *
 * Parser POR CELDA, no solo por columna — verificado con TODOS los
 * valores reales antes de escribir esto, se encontraron 2 anomalias que
 * una regla fija por columna no cubria:
 *   - "Densidad operación (kg/m3)" es casi siempre un valor simple, pero
 *     algunas filas reales traen el prefijo explicito "máx. 1850" (osea
 *     ESE valor puntual es el maximo, no el nominal que asumiria el
 *     nombre de columna) — se detecta el prefijo máx./mín./nom. en
 *     cualquier columna de valor simple, no solo en las combinadas.
 *   - "Densidad de operación (kg/m3)" y, en 3 filas, "Porcentaje de
 *     sólidos (%)" resultaron ser SIEMPRE/A VECES un triple "X / X / X"
 *     pese a sonar como columnas de un solo valor — si una celda trae
 *     mas partes separadas por "/" de las que la columna declara, se
 *     usa el orden generico min/nom/max (2 partes -> min/max) en vez de
 *     forzar la declaracion original de la columna.
 *   - Cualquier pieza igual a "-" se trata como sin dato en ese slot
 *     puntual, nunca como el texto literal "-".
 *
 * Uso:
 *   npx tsx scripts/importTagProceso620.ts --project 50050 --dry-run
 *   npx tsx scripts/importTagProceso620.ts --project 50050 --apply
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

/* ---- Mapeo de columnas O:AM -> variable canonica -------------------- */

type Slot = 'min' | 'nominal' | 'max';

interface ColumnaProceso {
  header: string;
  variable: string;
  unidad: string | null;
  /** Orden de slots cuando la celda viene combinada CON el mismo numero
   * de partes que esta lista (ej. "nom/máx" -> ['nominal','max']). Si la
   * celda trae un numero de partes distinto, se usa el orden generico
   * min/nominal/max — ver resolverCelda. */
  slotsCombinado: Slot[];
  /** Slot que recibe un valor SIN "/" y sin prefijo máx./mín./nom.
   * explicito. */
  slotPorDefecto: Slot;
}

const COLUMNAS_PROCESO: ColumnaProceso[] = [
  { header: 'Flujo máx. (m3/h)', variable: 'Flujo', unidad: 'm3/h', slotsCombinado: ['max'], slotPorDefecto: 'max' },
  { header: 'Flujo nominal (m3/h)', variable: 'Flujo', unidad: 'm3/h', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Flujo mín. (m3/h)', variable: 'Flujo', unidad: 'm3/h', slotsCombinado: ['min'], slotPorDefecto: 'min' },
  { header: 'Flujo nom. (m3/h)', variable: 'Flujo', unidad: 'm3/h', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Presión nom. (psi)', variable: 'Presión', unidad: 'psi', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Presión máx. (psi)', variable: 'Presión', unidad: 'psi', slotsCombinado: ['max'], slotPorDefecto: 'max' },
  { header: 'Temp. operación (°C) min/máx', variable: 'Temperatura de operación', unidad: '°C', slotsCombinado: ['min', 'max'], slotPorDefecto: 'nominal' },
  { header: 'Temp. operación máx. (°C)', variable: 'Temperatura de operación', unidad: '°C', slotsCombinado: ['max'], slotPorDefecto: 'max' },
  { header: 'Temp. operación nom. (°C)', variable: 'Temperatura de operación', unidad: '°C', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Temp. operación mín/nom/máx (°C)', variable: 'Temperatura de operación', unidad: '°C', slotsCombinado: ['min', 'nominal', 'max'], slotPorDefecto: 'nominal' },
  { header: 'Densidad operación (kg/m3)', variable: 'Densidad', unidad: 'kg/m3', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Densidad de operación (kg/m3)', variable: 'Densidad', unidad: 'kg/m3', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Densidad mín. (kg/m3)', variable: 'Densidad', unidad: 'kg/m3', slotsCombinado: ['min'], slotPorDefecto: 'min' },
  { header: 'Densidad nom. (kg/m3)', variable: 'Densidad', unidad: 'kg/m3', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Densidad máx. (kg/m3)', variable: 'Densidad', unidad: 'kg/m3', slotsCombinado: ['max'], slotPorDefecto: 'max' },
  { header: 'Densidad (kg/m3) nom/máx', variable: 'Densidad', unidad: 'kg/m3', slotsCombinado: ['nominal', 'max'], slotPorDefecto: 'nominal' },
  { header: 'Viscosidad (cP)', variable: 'Viscosidad', unidad: 'cP', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'pH', variable: 'pH', unidad: null, slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: '% Sólidos min/máx', variable: '% Sólidos', unidad: '%', slotsCombinado: ['min', 'max'], slotPorDefecto: 'nominal' },
  { header: 'Porcentaje de sólidos (%)', variable: '% Sólidos', unidad: '%', slotsCombinado: ['nominal'], slotPorDefecto: 'nominal' },
  { header: 'Presión de entrada mín/nom/máx (psi)', variable: 'Presión de entrada', unidad: 'psi', slotsCombinado: ['min', 'nominal', 'max'], slotPorDefecto: 'nominal' },
  { header: 'Presión de salida mín/nom/máx (psi)', variable: 'Presión de salida', unidad: 'psi', slotsCombinado: ['min', 'nominal', 'max'], slotPorDefecto: 'nominal' },
  { header: 'Presión máx. evento transitorio (psi)', variable: 'Presión máx. evento transitorio', unidad: 'psi', slotsCombinado: ['max'], slotPorDefecto: 'max' },
  { header: 'Cv requerido mín/nom/máx', variable: 'Cv requerido', unidad: null, slotsCombinado: ['min', 'nominal', 'max'], slotPorDefecto: 'nominal' }
];

const ORDEN_GENERICO: Record<number, Slot[]> = {
  2: ['min', 'max'],
  3: ['min', 'nominal', 'max']
};

function limpiarPieza(v: string): string | null {
  const t = v.trim();
  return t === '-' || t.length === 0 ? null : t;
}

/** Resuelve una celda real a { slot: valor } — ver comentario de
 * cabecera para las 2 anomalias reales que motivan este parser por
 * celda en vez de una regla fija por columna. */
function resolverCelda(raw: string, columna: ColumnaProceso): Partial<Record<Slot, string>> {
  const resultado: Partial<Record<Slot, string>> = {};

  if (raw.includes('/')) {
    const partes = raw.split('/').map(limpiarPieza);
    const slots = partes.length === columna.slotsCombinado.length
      ? columna.slotsCombinado
      : (ORDEN_GENERICO[partes.length] ?? columna.slotsCombinado);

    slots.forEach((slot, i) => {
      const v = partes[i];
      if (v !== null && v !== undefined) resultado[slot] = v;
    });
    return resultado;
  }

  const limpio = limpiarPieza(raw);
  if (limpio === null) return resultado;

  const prefijoMax = limpio.match(/^m[aá]x\.?\s*/i);
  const prefijoMin = limpio.match(/^m[ií]n\.?\s*/i);
  const prefijoNom = limpio.match(/^nom\.?\s*/i);

  if (prefijoMax) { resultado.max = limpio.slice(prefijoMax[0].length).trim(); return resultado; }
  if (prefijoMin) { resultado.min = limpio.slice(prefijoMin[0].length).trim(); return resultado; }
  if (prefijoNom) { resultado.nominal = limpio.slice(prefijoNom[0].length).trim(); return resultado; }

  resultado[columna.slotPorDefecto] = limpio;
  return resultado;
}

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';
  const excelPath = path.join(process.cwd(), '..', 'reference_excel', 'DB HD.xlsx');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  const ws = workbook.getWorksheet('Tags')!;
  const headers = sheetHeaders(ws);
  const iTag = colIndex(headers, 'tag');

  const { instruments } = await apiFetch<{ instruments: Array<{ id: string; tagInstrumento: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/instruments`
  );
  const instrumentoIdPorTag = new Map(instruments.map((i) => [i.tagInstrumento, i.id]));

  let creados = 0;
  let tagsSinMatch = 0;
  let tagsSinDatosProceso = 0;
  let omitidos = 0;

  for (const row of sheetRows(ws)) {
    const tag = cell(row, iTag);
    if (!tag) continue;
    const instrumentoId = instrumentoIdPorTag.get(tag);
    if (!instrumentoId) { tagsSinMatch++; continue; }

    // Acumula por variable canonica — el primer valor no vacio que
    // aparezca para cada slot gana, nunca se pisa uno ya resuelto.
    const acumulado = new Map<string, { unidad: string | null; min: string | null; nominal: string | null; max: string | null }>();

    for (const colDef of COLUMNAS_PROCESO) {
      const idx = headers.indexOf(colDef.header);
      if (idx < 0) continue;
      const raw = cell(row, idx);
      if (raw === null) continue;

      const resuelto = resolverCelda(raw, colDef);
      if (Object.keys(resuelto).length === 0) continue;

      if (!acumulado.has(colDef.variable)) {
        acumulado.set(colDef.variable, { unidad: colDef.unidad, min: null, nominal: null, max: null });
      }
      const entry = acumulado.get(colDef.variable)!;
      (['min', 'nominal', 'max'] as Slot[]).forEach((slot) => {
        const v = resuelto[slot];
        if (v !== undefined && entry[slot] === null) entry[slot] = v;
      });
    }

    if (acumulado.size === 0) { tagsSinDatosProceso++; continue; }

    for (const [variable, valores] of acumulado.entries()) {
      if (valores.min === null && valores.nominal === null && valores.max === null) continue;

      console.log(`  ${tag} | ${variable}${valores.unidad ? ` (${valores.unidad})` : ''} -> min=${valores.min} nom=${valores.nominal} max=${valores.max}`);

      if (!isDryRun) {
        try {
          await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/instruments/${instrumentoId}/tag-proceso`, {
            method: 'POST',
            body: { variable, valorMin: valores.min, valorNominal: valores.nominal, valorMax: valores.max, unidad: valores.unidad }
          });
          creados++;
        } catch (err) {
          console.warn(`  [WARN] ${tag}/${variable}: ${err instanceof Error ? err.message : err}`);
          omitidos++;
        }
      } else {
        creados++;
      }
    }
  }

  console.log('\n=== Resumen ===');
  console.log({ creados, tagsSinMatch, tagsSinDatosProceso, omitidos });
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
