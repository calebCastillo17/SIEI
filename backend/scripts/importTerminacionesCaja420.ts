/*
 * Carga real de conductores/terminaciones a nivel de CAJA (bloque de
 * terminales + terminal + posición + conductor + tramo_conductor +
 * terminación, migración 015) para el proyecto 420 — pedido explícito
 * del usuario tras confirmar dos hallazgos reales:
 *   "pero los cables que tiene el ruteo estan conectados o alineados
 *   con los cables que tenemos" / "tambien se han especificado los TB
 *   y bornes asi como se establecieron en el 620" / "armalo ahora
 *   porfavor".
 *
 * Verificado antes de escribir una sola línea de creación: 420 tenía
 * 250 cables y 1411 rutas activas, pero CERO conductor/tramo_conductor/
 * terminacion — los cables existían sueltos, sin enlazar a la ruta real.
 * 620 sí los tiene (790/782/656) pero ningún script del repo los generó
 * — importControl620.ts declara esto explícitamente fuera de su
 * alcance — así que se reconstruyó la regla real por ingeniería
 * inversa contra la base de 620 (nunca inventada):
 *
 *   1. BLOQUE: NO es "TB-" + BORNERA_BLOQUE_CAJA (se probó, 60/113
 *      coincidían nomás — esa columna no es el bloque físico real).
 *      La agrupación real es por (caja, TAG_CABLE_INST) — todas las
 *      señales que comparten el mismo cable de campo comparten el
 *      mismo bloque físico (confirmado: 620-HV-5084 tiene 5 señales,
 *      un solo cable de 19 conductores "620HV5084-T01", y las 5 caen
 *      en el mismo bloque "TB-1" de la caja 620-TBC-5021). El código
 *      del bloque se asigna secuencial POR CAJA ("TB-1", "TB-2", ...)
 *      en el orden en que aparecen sus cables — la caja puede tener
 *      más de un bloque (620-TBJ-5016 real tiene 24).
 *   2. TERMINAL: los números de terminal usados son los PRIMEROS K
 *      valores de BORNE_JB (confirmado 113/113, 100%, sin una sola
 *      excepción) — BORNE_JB suele listar más bornes de los que esta
 *      señal usa realmente (reserva del bloque), nunca los últimos.
 *   3. K (cantidad de conductores): 2 para AI/DI/DO, confirmado en 165
 *      señales reales de 620 (97-100% de consistencia, únicos outliers
 *      con ruta incompleta). RTD queda FUERA de esta corrida — no hay
 *      un solo ejemplo con detalle de caja en 620 para confirmar su K
 *      (probablemente 3, por el cable "...Tr#..." blindado, pero no se
 *      inventa sin evidencia real).
 *   4. DOS conductores por terminal, DOS cables distintos, misma
 *      posición reservada por lado: el cable de CAMPO (TAG_CABLE_INST)
 *      aterriza en posición "A" (extremo=DESTINO del tramo 1,
 *      instrumento->caja); el cable INTERNO caja->gabinete (TAG_CABLE)
 *      aterriza en posición "B" del MISMO terminal físico (extremo=
 *      ORIGEN del tramo 2) — confirmado en 620-HV-5084: un mismo
 *      terminal ("1") sostiene ambos lados en A/B.
 *   5. El código del CONDUCTOR es literalmente el mismo número que el
 *      TERMINAL en el que aterriza (confirmado 100% en 620: conductor
 *      "16" -> terminal "16").
 *
 * FUERA DE ALCANCE en esta corrida (no se inventa nada):
 *   - Señales de dueño EQUIPO: solo traen UNA columna de cable
 *     (TAG_CABLE, con la forma "caja-internal" — nombrado por la
 *     caja, igual patrón que el cable interno de las de instrumento),
 *     nunca un TAG_CABLE_INST propio — no hay cable de campo
 *     documentado para reconstruir el lado del terminal (posición A).
 *   - Tipo de señal RTD (ver punto 3).
 *   - El tramo 3 (gabinete->módulo): en 620 tampoco tiene detalle de
 *     terminación a nivel de caja — usa el bloque de terminales
 *     automático del propio módulo, ya materializado, sin cambios.
 *   - Señales sin TAG_CABLE_INST o sin BORNE_JB en la hoja.
 *
 * Idempotente: busca bloque por (caja, código) y terminal por (bloque,
 * número) antes de crear; conductor por (cable, código) antes de crear;
 * tramo_conductor por (tramo, conductor) — si ya existe, no repite la
 * terminación.
 *
 * Uso:
 *   npx tsx scripts/importTerminacionesCaja420.ts --project <projectId> --dry-run
 *   npx tsx scripts/importTerminacionesCaja420.ts --project <projectId> --apply
 */

import ExcelJS from 'exceljs';
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

function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 || s === '-' ? null : s;
}

interface Row {
  tagSenal: string;
  tagInstrumento: string | null;
  tagInstrumentoAsociado: string | null;
  tipoInstrumento: string | null;
  modulo: string | null; // AI/DI/DO/RTD
  tagCaja: string | null;
  tagCableInst: string | null;
  tagCable: string | null;
  borneJb: string | null;
}

// Mismos 4 candidatos que importControl420.ts — reimplementado acá
// porque este script resuelve la señal de forma independiente (no
// reusa estado en memoria de otro proceso).
function candidatosTagSenal(asociado: string | null, tipo: string | null, tagSenalOriginal: string | null): string[] {
  const candidatos: string[] = [];
  if (tagSenalOriginal) candidatos.push(tagSenalOriginal);
  if (asociado && tipo) {
    candidatos.push(`${asociado}_${tipo}`);
    if (tipo.endsWith('T') && tipo.length > 1) candidatos.push(`${asociado}_${tipo.slice(0, -1)}I`);
    if (tipo.endsWith('SL')) candidatos.push(`${asociado}_${tipo.slice(0, -2)}AL`);
    if (tipo.endsWith('SH')) candidatos.push(`${asociado}_${tipo.slice(0, -2)}AH`);
  }
  return [...new Set(candidatos)];
}

async function readRows(filePath: string): Promise<Row[]> {
  const buf = await readFile(filePath);
  const normalized = await normalizeNamespacedXlsx(buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(normalized as any);
  const ws = wb.worksheets.find((w) => /SENALES_CONTROL/i.test(w.name))!;
  const headerRow = ws.getRow(1).values as any[];
  const idx: Record<string, number> = {};
  headerRow.forEach((v, i) => { if (v) idx[String(v).trim()] = i; });

  const rows: Row[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (h: string) => idx[h] ? row.getCell(idx[h]).value : undefined;
    const tagSenal = cleanText(get('TAG_SENAL'));
    const tagInstrumento = cleanText(get('TAG_INSTRUMENTO'));
    if (!tagSenal || !tagInstrumento) continue; // solo dueño instrumento (ver alcance)
    rows.push({
      tagSenal,
      tagInstrumento,
      tagInstrumentoAsociado: cleanText(get('TAG_INSTRUMENTO_ASOCIADO')),
      tipoInstrumento: cleanText(get('TIPO_INSTRUMENTO')),
      modulo: cleanText(get('MODULO')),
      tagCaja: cleanText(get('TAG_CAJA')),
      tagCableInst: cleanText(get('TAG_CABLE_INST')),
      tagCable: cleanText(get('TAG_CABLE')),
      borneJb: cleanText(get('BORNE_JB'))
    });
  }
  return rows;
}

async function main() {
  const { projectId, filePath, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';
  console.log(`=== importTerminacionesCaja420.ts (${mode.toUpperCase()}) ===`);

  const allRows = await readRows(filePath);
  console.log(`${allRows.length} filas de dueño instrumento en SENALES_CONTROL.`);

  const TIPOS_PERMITIDOS = new Set(['AI', 'DI', 'DO']);
  const K = 2;

  // Filas VIEJAS de la cadena de renumeración LIT-5028..5051 (ver
  // commit de esa corrección) — su propio TAG_SENAL/TAG_INSTRUMENTO
  // quedó obsoleto y hoy coincide, por casualidad de texto, con el tag
  // REAL de otra señal física distinta. El hardware/bornera de la fila
  // sigue siendo correcto para su propio PnPID (ya se usó así para el
  // canal/ruta), pero acá se excluyen del lote masivo para no volver a
  // pisar la señal equivocada — se procesan aparte, por PnPID, en
  // fixTerminacionesCadenaLit420.ts.
  const TAGS_CADENA_LIT_EXCLUIDOS = new Set([
    '420-LIT-5028_LI', '420-LIT-5030A_LI', '420-LIT-5030B_LI', '420-LIT-5032_LI',
    '420-LIT-5035_LI', '420-LIT-5036_LI', '420-LIT-5037_LI', '420-LIT-5038_LI',
    '420-LIT-5039_LI', '420-LIT-5040_LI', '420-LIT-5041_LI', '420-LIT-5042_LI',
    '420-LIT-5043_LI', '420-LIT-5044_LI', '420-LIT-5045_LI', '420-LIT-5046_LI', '420-LIT-5047_LI'
  ]);

  const elegibles = allRows.filter((r) =>
    r.tagCaja && r.tagCableInst && r.tagCable && r.borneJb && r.modulo && TIPOS_PERMITIDOS.has(r.modulo) &&
    !TAGS_CADENA_LIT_EXCLUIDOS.has(r.tagSenal)
  );
  console.log(`${elegibles.length} filas elegibles (AI/DI/DO, caja+cable de campo+BORNE_JB presentes).`);

  const excluidasPorTipo = allRows.filter((r) => r.modulo && !TIPOS_PERMITIDOS.has(r.modulo) && r.tagCaja && r.tagCableInst).length;
  console.log(`  (${excluidasPorTipo} más quedan fuera por tipo — RTD u otro, sin evidencia de K real.)`);

  // --- Señales, cajas, cables ya existentes ---
  const signalsResp = await apiFetch<{ signals: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/signals`);
  const signalByTagSenal = new Map<string, any>();
  for (const s of signalsResp.json.signals) if (s.tagSenal) signalByTagSenal.set(s.tagSenal, s);

  const cajasResp = await apiFetch<{ boxes: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/boxes`);
  const cajaIdByTag = new Map(cajasResp.json.boxes.map((c: any) => [c.tagCaja, c.id]));

  const cablesResp = await apiFetch<{ cables: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/cables`);
  const cableIdByTag = new Map(cablesResp.json.cables.map((c: any) => [c.tagCable, c.id]));

  // Caches de bloques/terminales/conductores ya creados en ESTA corrida
  // o ya existentes de una corrida previa (idempotencia real, vía API).
  const bloqueCache = new Map<string, any[]>(); // cajaId -> bloques[]
  const conductorCache = new Map<string, any[]>(); // cableId -> conductores[]

  async function getBloquesDeCaja(cajaId: string) {
    if (!bloqueCache.has(cajaId)) {
      const r = await apiFetch<{ bloquesTerminal: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal?cajaId=${cajaId}`);
      bloqueCache.set(cajaId, r.json.bloquesTerminal ?? []);
    }
    return bloqueCache.get(cajaId)!;
  }

  async function getConductoresDeCable(cableId: string) {
    if (!conductorCache.has(cableId)) {
      const r = await apiFetch<{ conductors: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/conductors?cableId=${cableId}`);
      conductorCache.set(cableId, r.json.conductors ?? []);
    }
    return conductorCache.get(cableId)!;
  }

  // bloqueKeyCache: (cajaId, tagCableInst) -> bloqueId ya asignado, para
  // que todas las señales del mismo cable de campo caigan en el MISMO
  // bloque sin tener que recorrer sus terminales cada vez.
  const bloquePorCajaYCable = new Map<string, string>();

  const counters = { bloques: { CREATE: 0, SKIP: 0, ERROR: 0 }, terminales: { CREATE: 0, SKIP: 0, ERROR: 0 }, posiciones: { CREATE: 0, SKIP: 0, ERROR: 0 }, conductores: { CREATE: 0, SKIP: 0, ERROR: 0 }, terminaciones: { CREATE: 0, SKIP: 0, ERROR: 0 } };
  const pendientes: string[] = [];
  let procesadas = 0;

  for (const row of elegibles) {
    const señal = signalByTagSenal.get(row.tagSenal) ??
      candidatosTagSenal(row.tagInstrumentoAsociado ?? row.tagInstrumento, row.tipoInstrumento, row.tagSenal)
        .map((c) => signalByTagSenal.get(c)).find(Boolean);
    if (!señal) { pendientes.push(`${row.tagSenal}: señal no encontrada.`); continue; }

    const cajaId = cajaIdByTag.get(row.tagCaja!);
    const cableCampoId = cableIdByTag.get(row.tagCableInst!);
    const cableInternoId = cableIdByTag.get(row.tagCable!);
    if (!cajaId || !cableCampoId || !cableInternoId) { pendientes.push(`${row.tagSenal}: caja/cable no resuelto (caja=${row.tagCaja}, cableCampo=${row.tagCableInst}, cableInterno=${row.tagCable}).`); continue; }

    // --- Ruta ya existente: se necesitan tramo1 (->caja) y tramo2 (caja->) ---
    const routesResp = await apiFetch<{ routes: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/routes?senalId=${señal.id}`);
    const route = routesResp.json.routes[0];
    if (!route) { pendientes.push(`${row.tagSenal}: sin ruta activa.`); continue; }
    const routeDetail = await apiFetch<{ route: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/routes/${route.id}`);
    const segs = (routeDetail.json.route.segments ?? []).sort((a: any, b: any) => a.numeroOrden - b.numeroOrden);
    const tramo1 = segs[0];
    const tramo2 = segs[1];
    if (!tramo1 || !tramo2 || segs.length < 3) { pendientes.push(`${row.tagSenal}: ruta con ${segs.length} tramos, se esperaban >=3 (instrumento->caja->gabinete->...).`); continue; }

    // --- Terminal numbers = primeros K de BORNE_JB ---
    const bornes = row.borneJb!.split(',').map((s) => s.trim()).filter(Boolean).slice(0, K);
    if (bornes.length < K) { pendientes.push(`${row.tagSenal}: BORNE_JB="${row.borneJb}" trae menos de ${K} bornes.`); continue; }

    procesadas++;

    // --- Bloque: (caja, tagCableInst) ---
    const bloqueKey = `${cajaId}|${row.tagCableInst}`;
    let bloqueId = bloquePorCajaYCable.get(bloqueKey);
    if (!bloqueId) {
      const bloques = await getBloquesDeCaja(cajaId);
      // Reutilizar un bloque ya creado en una corrida previa: se detecta
      // por tener ya un terminal con el primer número de BORNE_JB de
      // este grupo (no hay forma de "nombrar" el bloque por cable en el
      // propio modelo, así que la única pista persistente es su
      // contenido).
      let found: any = null;
      for (const b of bloques) {
        const detailResp = await apiFetch<{ bloqueTerminal: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal/${b.id}`);
        const terminales = detailResp.json.bloqueTerminal?.terminales ?? [];
        if (terminales.some((t: any) => t.numero === bornes[0])) { found = b; break; }
      }
      if (found) {
        bloqueId = found.id;
      } else {
        const nextIndex = bloques.length + 1;
        const codigo = `TB-${nextIndex}`;
        if (isDryRun) {
          bloqueId = `(dry-run:${codigo})`;
          counters.bloques.CREATE++;
          bloques.push({ id: bloqueId, codigo });
        } else {
          const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal`, { method: 'POST', body: { cajaId, codigo } });
          if (created.status === 201) { bloqueId = created.json.bloqueTerminal.id; counters.bloques.CREATE++; bloques.push(created.json.bloqueTerminal); }
          else { counters.bloques.ERROR++; console.log(`  ! ERROR bloque ${row.tagCaja}/${codigo}:`, JSON.stringify(created.json)); continue; }
        }
      }
      bloquePorCajaYCable.set(bloqueKey, bloqueId!);
    } else {
      counters.bloques.SKIP++;
    }

    // --- Terminal + posiciones A/B, por cada borne ---
    for (const numero of bornes) {
      let terminalId: string;
      let posicionAId: string | undefined;
      let posicionBId: string | undefined;

      if (isDryRun) {
        terminalId = `(dry-run:${bloqueId}:${numero})`;
        counters.terminales.CREATE++;
        posicionAId = `(dry-run-pos-A:${terminalId})`;
        posicionBId = `(dry-run-pos-B:${terminalId})`;
        counters.posiciones.CREATE += 2;
      } else {
        const bloqueDetail = await apiFetch<{ bloqueTerminal: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal/${bloqueId}`);
        let terminal = (bloqueDetail.json.bloqueTerminal.terminales ?? []).find((t: any) => t.numero === numero);
        if (!terminal) {
          const createdT = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal/${bloqueId}/terminales`, { method: 'POST', body: { numero } });
          if (createdT.status !== 201) { counters.terminales.ERROR++; console.log(`  ! ERROR terminal ${row.tagCaja}/${bloqueId}/${numero}:`, JSON.stringify(createdT.json)); continue; }
          terminal = createdT.json.terminal;
          terminal.posiciones = [];
          counters.terminales.CREATE++;
        } else counters.terminales.SKIP++;
        terminalId = terminal.id;

        const posiciones = terminal.posiciones ?? [];
        let posA = posiciones.find((p: any) => p.codigo === 'A');
        if (!posA) {
          const createdP = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal/${bloqueId}/terminales/${terminalId}/posiciones`, { method: 'POST', body: { codigo: 'A' } });
          if (createdP.status !== 201) { counters.posiciones.ERROR++; console.log(`  ! ERROR posicion A ${row.tagSenal}:`, JSON.stringify(createdP.json)); continue; }
          posA = createdP.json.posicionTerminal;
          counters.posiciones.CREATE++;
        } else counters.posiciones.SKIP++;
        posicionAId = posA.id;

        let posB = posiciones.find((p: any) => p.codigo === 'B');
        if (!posB) {
          const createdP = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/bloques-terminal/${bloqueId}/terminales/${terminalId}/posiciones`, { method: 'POST', body: { codigo: 'B' } });
          if (createdP.status !== 201) { counters.posiciones.ERROR++; console.log(`  ! ERROR posicion B ${row.tagSenal}:`, JSON.stringify(createdP.json)); continue; }
          posB = createdP.json.posicionTerminal;
          counters.posiciones.CREATE++;
        } else counters.posiciones.SKIP++;
        posicionBId = posB.id;
      }

      // --- Conductor de campo (cable TAG_CABLE_INST) -> tramo1, posición A, DESTINO ---
      if (isDryRun) {
        counters.conductores.CREATE++;
        counters.terminaciones.CREATE++;
      } else {
        const conductoresCampo = await getConductoresDeCable(cableCampoId);
        let condCampo = conductoresCampo.find((c: any) => c.codigo === numero);
        if (!condCampo) {
          const createdC = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/conductors`, { method: 'POST', body: { cableId: cableCampoId, codigo: numero } });
          if (createdC.status !== 201) { counters.conductores.ERROR++; console.log(`  ! ERROR conductor campo ${row.tagSenal}/${numero}:`, JSON.stringify(createdC.json)); continue; }
          condCampo = createdC.json.conductor;
          conductoresCampo.push(condCampo);
          counters.conductores.CREATE++;
        } else counters.conductores.SKIP++;

        const tcResp = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores`, { method: 'POST', body: { tramoConexionId: tramo1.id, conductorId: condCampo.id } });
        if (tcResp.status === 201) {
          const termResp = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores/${tcResp.json.tramoConductor.id}/terminaciones`, { method: 'POST', body: { extremo: 'DESTINO', posicionTerminalId: posicionAId } });
          if (termResp.status === 201) counters.terminaciones.CREATE++;
          else { counters.terminaciones.ERROR++; console.log(`  ! ERROR terminacion A ${row.tagSenal}:`, JSON.stringify(termResp.json)); }
        } else if (tcResp.status === 409) {
          counters.terminaciones.SKIP++;
        } else { counters.conductores.ERROR++; console.log(`  ! ERROR tramo_conductor campo ${row.tagSenal}:`, JSON.stringify(tcResp.json)); }

        // --- Conductor interno (cable TAG_CABLE) -> tramo2, posición B, ORIGEN ---
        const conductoresInterno = await getConductoresDeCable(cableInternoId);
        let condInterno = conductoresInterno.find((c: any) => c.codigo === numero);
        if (!condInterno) {
          const createdC2 = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/conductors`, { method: 'POST', body: { cableId: cableInternoId, codigo: numero } });
          if (createdC2.status !== 201) { counters.conductores.ERROR++; console.log(`  ! ERROR conductor interno ${row.tagSenal}/${numero}:`, JSON.stringify(createdC2.json)); continue; }
          condInterno = createdC2.json.conductor;
          conductoresInterno.push(condInterno);
          counters.conductores.CREATE++;
        } else counters.conductores.SKIP++;

        const tc2Resp = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores`, { method: 'POST', body: { tramoConexionId: tramo2.id, conductorId: condInterno.id } });
        if (tc2Resp.status === 201) {
          const term2Resp = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores/${tc2Resp.json.tramoConductor.id}/terminaciones`, { method: 'POST', body: { extremo: 'ORIGEN', posicionTerminalId: posicionBId } });
          if (term2Resp.status === 201) counters.terminaciones.CREATE++;
          else { counters.terminaciones.ERROR++; console.log(`  ! ERROR terminacion B ${row.tagSenal}:`, JSON.stringify(term2Resp.json)); }
        } else if (tc2Resp.status === 409) {
          counters.terminaciones.SKIP++;
        } else { counters.conductores.ERROR++; console.log(`  ! ERROR tramo_conductor interno ${row.tagSenal}:`, JSON.stringify(tc2Resp.json)); }
      }
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Filas procesadas: ${procesadas} / ${elegibles.length} elegibles`);
  for (const [name, c] of Object.entries(counters)) console.log(`  ${name.padEnd(14)} CREATE=${c.CREATE} SKIP=${c.SKIP} ERROR=${c.ERROR}`);
  console.log(`\nPendientes (${pendientes.length}):`);
  pendientes.slice(0, 30).forEach((p) => console.log(`  - ${p}`));
  if (pendientes.length > 30) console.log(`  ... y ${pendientes.length - 30} más.`);

  process.exit(0);
}

main().catch((error) => { console.error('Error inesperado:', error); process.exit(1); });
