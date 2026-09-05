/*
 * Corrige una asignación de cable equivocada hecha en una carga de datos
 * anterior (la de bornas/terminaciones de las cajas del proyecto 22043/620,
 * ~55 rutas instrumento->caja->gabinete->módulo): el cable que se ató al
 * tramo 1 (instrumento->caja) era en realidad el del RIO->caja, y el cable
 * de caja->instrumento (el que realmente corresponde ahí) nunca se llegó a
 * cablear — quedó como una fila huérfana en nucleo.cable, con 0 conductores.
 *
 * Confirmado por el usuario en conversación:
 *   - TAG_CABLE        = cable RIO -> caja (el que YA tiene conductores
 *     reales, con la fórmula 2*N_PAR_CABLE-1 / 2*N_PAR_CABLE ya aplicada
 *     en la carga anterior — eso no se toca, solo se re-ubica).
 *   - TAG_CABLE_INST   = cable caja -> instrumento (el que faltaba).
 *   - BORNE_JB (columna con lista separada por comas, ej. "1,2,3") son
 *     bornes REALES del mismo TB de la caja (ya materializados como
 *     nucleo.terminal en la carga anterior) — cada uno recibe DOS
 *     landings: el hilo de TAG_CABLE_INST en una posición, y el hilo de
 *     TAG_CABLE en la OTRA posición del MISMO borne (nunca un borne
 *     nuevo) — confirmado explícitamente por el usuario.
 *   - BORNERA_BLOQUE_CAJA NO es un borne físico — es una columna de
 *     trabajo del propio Excel del usuario, sin contraparte en la base.
 *   - Qué números de BORNE_JB corresponden a qué hilo REAL de la señal
 *     (ej. una señal que solo usa 2 hilos pero lista 3 bornes) no está
 *     especificado en el Excel — se copian TODOS tal cual, sin adivinar
 *     cuáles "sobran". Un mecanismo para curar eso explícitamente queda
 *     pendiente para después (fuera de alcance de este script).
 *
 * Por cada conductor de TAG_CABLE mal ubicado en el tramo 1 de una ruta:
 *   1. Se desactiva su tramo_conductor actual (cascada: desactiva también
 *      su terminación) — el conductor de TAG_CABLE queda libre y su
 *      posición ("A") del borne también.
 *   2. Se crea un tramo_conductor NUEVO para ESE MISMO conductor de
 *      TAG_CABLE, ahora sobre el tramo 2 (caja->gabinete) de la misma
 *      ruta — con una terminación nueva en una posición NUEVA ("B") del
 *      mismo borne, extremo ORIGEN (la caja es el origen del tramo 2).
 *   3. Se crea el conductor que faltaba de TAG_CABLE_INST (código = el
 *      propio número de BORNE_JB), con un tramo_conductor nuevo sobre el
 *      tramo 1, terminación en la posición "A" (ahora libre), extremo
 *      DESTINO (la caja sigue siendo el destino del tramo 1).
 *
 * Nada se borra físicamente — todo vía desactivar + crear (mismo criterio
 * que el resto del proyecto: nunca UPDATE directo sobre nucleo.tramo_
 * conductor/terminacion, esas tablas no tienen PATCH en la API a propósito).
 * Idempotente: una señal cuyo tramo 1 ya tenga el cable de TAG_CABLE_INST
 * puesto (re-ejecución parcial) se saltea sola.
 *
 * Uso:
 *   npx tsx scripts/fixCableRioCajaVsCampo620.ts --project 50050 --dry-run
 *   npx tsx scripts/fixCableRioCajaVsCampo620.ts --project 50050 --apply
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
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User-Email': devUserEmail
    },
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
  tagCableInst: string;
}

async function loadExcelMap(file: string): Promise<Map<string, ExcelRow>> {
  const rawBuffer = await readFile(file);
  const namespaced = await normalizeNamespacedXlsx(rawBuffer);
  // Este libro (mucho más grande y antiguo que la plantilla LDI) trae un
  // Print_Area con una referencia que exceljs no puede decodificar
  // (col-cache.decodeEx revienta al reconciliar defined names) — mismo
  // saneo ya usado para la plantilla LDI, reutilizado tal cual acá.
  const saneado = await limpiarVinculosExternosYNombres(namespaced);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(saneado as unknown as ExcelJS.Buffer);
  const ws = workbook.getWorksheet('SENALES_CONTROL');
  if (!ws) throw new Error('No se encontró la hoja SENALES_CONTROL.');

  const headerRow = ws.getRow(1);
  const colIndex = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const text = String(cell.value ?? '').trim();
    if (text) colIndex.set(text, colNumber);
  });

  const need = ['TAG_SENAL', 'TAG_INSTRUMENTO', 'TAG_CABLE_INST'];
  for (const col of need) {
    if (!colIndex.has(col)) throw new Error(`Falta la columna ${col} en SENALES_CONTROL.`);
  }

  const map = new Map<string, ExcelRow>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const tagSenal = String(row.getCell(colIndex.get('TAG_SENAL')!).value ?? '').trim();
    const tagInstrumento = String(row.getCell(colIndex.get('TAG_INSTRUMENTO')!).value ?? '').trim();
    const tagCableInst = String(row.getCell(colIndex.get('TAG_CABLE_INST')!).value ?? '').trim();
    if (tagSenal && tagInstrumento && tagCableInst) {
      map.set(tagSenal, { tagCableInst });
    }
  });
  return map;
}

async function main() {
  const { projectId, file, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`Leyendo ${file} ...`);
  const excelMap = await loadExcelMap(file);
  console.log(`  ${excelMap.size} señales con TAG_CABLE_INST en el Excel.`);

  const { signals } = await apiFetch<{ signals: any[] }>(
    apiBase,
    devUserEmail,
    `/api/projects/${projectId}/control/signals`
  );
  const signalByTag = new Map(signals.filter((s) => s.tagSenal).map((s) => [s.tagSenal as string, s]));

  const { cables } = await apiFetch<{ cables: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/cables`);
  const cableIdByTag = new Map(cables.map((c) => [c.tagCable as string, c.id as string]));

  let procesadas = 0;
  let yaCorrectas = 0;
  let sinConductorEnTramo1 = 0;
  let sinCableInstEnBase = 0;
  let conductoresMovidos = 0;
  let conductoresCreados = 0;

  for (const [tagSenal, { tagCableInst }] of excelMap) {
    const signal = signalByTag.get(tagSenal);
    if (!signal || !signal.rutaId) continue;

    const cableInstId = cableIdByTag.get(tagCableInst);
    if (!cableInstId) {
      console.warn(`  [WARN] ${tagSenal}: cable ${tagCableInst} no existe en nucleo.cable — se salta.`);
      sinCableInstEnBase++;
      continue;
    }

    const { route } = await apiFetch<{ route: { segments: Array<{ id: string; numeroOrden: number }> } }>(
      apiBase,
      devUserEmail,
      `/api/projects/${projectId}/routes/${signal.rutaId}`
    );
    const tramo1 = route.segments.find((s) => s.numeroOrden === 1);
    const tramo2 = route.segments.find((s) => s.numeroOrden === 2);
    if (!tramo1 || !tramo2) continue;

    const { conexionado } = await apiFetch<{ conexionado: Array<{ numeroOrden: number; conductores: any[] }> }>(
      apiBase,
      devUserEmail,
      `/api/projects/${projectId}/routes/${signal.rutaId}/conexionado`
    );
    const seg1 = conexionado.find((s) => s.numeroOrden === 1);
    const conductoresTramo1 = seg1?.conductores ?? [];

    if (conductoresTramo1.length === 0) {
      sinConductorEnTramo1++;
      continue;
    }
    if (conductoresTramo1.every((c: any) => c.cableTag === tagCableInst)) {
      yaCorrectas++;
      continue; // idempotente: ya corregida en una corrida anterior.
    }

    procesadas++;
    console.log(`\n${tagSenal} (ruta ${signal.rutaId}) — ${conductoresTramo1.length} conductor(es) a mover:`);

    for (const cond of conductoresTramo1) {
      const destino = cond.terminaciones.find((t: any) => t.extremo === 'DESTINO');
      if (!destino) {
        console.warn(`  [WARN] conductor ${cond.conductorCodigo} (${cond.cableTag}) sin terminación DESTINO — se salta.`);
        continue;
      }
      const terminalId = destino.terminal.id;
      const terminalNumero = destino.terminal.numero;
      const bloqueId = destino.bloqueTerminal.id;
      const posicionAId = destino.posicionTerminal.id;

      console.log(
        `  borne ${terminalNumero} (terminal #${terminalId}, bloque #${bloqueId}): ` +
          `RIO conductor ${cond.conductorCodigo} (${cond.cableTag}) tramo1->tramo2, ` +
          `nuevo conductor ${tagCableInst}#${terminalNumero} en tramo1`
      );

      if (isDryRun) continue;

      // 1. Desactivar el tramo_conductor actual (cascada: desactiva su terminación).
      await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores/${cond.tramoConductorId}`, {
        method: 'DELETE'
      });

      // 2. Recrear el MISMO conductor RIO, ahora en el tramo 2, en una posición B nueva.
      const posB = await apiFetch<{ posicionTerminal: { id: string } }>(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/bloques-terminal/${bloqueId}/terminales/${terminalId}/posiciones`,
        { method: 'POST', body: { codigo: 'B' } }
      );
      const nuevoTramoConductorRio = await apiFetch<{ tramoConductor: { id: string } }>(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/tramo-conductores`,
        { method: 'POST', body: { tramoConexionId: tramo2.id, conductorId: cond.conductorId } }
      );
      await apiFetch(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/tramo-conductores/${nuevoTramoConductorRio.tramoConductor.id}/terminaciones`,
        { method: 'POST', body: { extremo: 'ORIGEN', posicionTerminalId: posB.posicionTerminal.id } }
      );
      conductoresMovidos++;

      // 3. Crear el conductor de campo (TAG_CABLE_INST) que faltaba, en la posición A ahora libre.
      const nuevoConductorCampo = await apiFetch<{ conductor: { id: string } }>(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/conductors`,
        { method: 'POST', body: { cableId: cableInstId, codigo: String(terminalNumero) } }
      );
      const nuevoTramoConductorCampo = await apiFetch<{ tramoConductor: { id: string } }>(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/tramo-conductores`,
        { method: 'POST', body: { tramoConexionId: tramo1.id, conductorId: nuevoConductorCampo.conductor.id } }
      );
      await apiFetch(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/tramo-conductores/${nuevoTramoConductorCampo.tramoConductor.id}/terminaciones`,
        { method: 'POST', body: { extremo: 'DESTINO', posicionTerminalId: posicionAId } }
      );
      conductoresCreados++;
    }
  }

  console.log(`\n=== Resumen (${mode}) ===`);
  console.log(`Señales procesadas:        ${procesadas}`);
  console.log(`Ya estaban correctas:      ${yaCorrectas}`);
  console.log(`Sin conductor en tramo 1:  ${sinConductorEnTramo1}`);
  console.log(`Sin cable TAG_CABLE_INST en la base: ${sinCableInstEnBase}`);
  console.log(`Conductores RIO reubicados (tramo1->tramo2): ${conductoresMovidos}`);
  console.log(`Conductores de campo creados (tramo1):       ${conductoresCreados}`);
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
