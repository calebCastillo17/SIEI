/*
 * Terminaciones de caja para los 17 instrumentos de la cadena de
 * renumeración LIT-5028..5051 (ver commit de esa corrección) — quedaron
 * fuera del lote masivo (importTerminacionesCaja420.ts) porque su
 * propia fila del master tiene TAG_SENAL/TAG_INSTRUMENTO obsoleto, que
 * hoy coincide por casualidad de texto con el tag real de OTRA señal
 * física. El hardware/bornera de cada fila sigue siendo el correcto
 * para su propio PnPID (ya se usó así para el canal/ruta) — acá se
 * cruza cada fila por PnPID (no por tag) contra el tag_instrumento
 * REAL vigente, igual criterio que la corrección de canal/ruta.
 *
 * Misma regla que importTerminacionesCaja420.ts: bloque agrupado por
 * (caja, TAG_CABLE_INST); terminal = primeros 2 de BORNE_JB; conductor
 * de campo (TAG_CABLE_INST) en posición A/DESTINO de tramo1; conductor
 * interno (TAG_CABLE) en posición B/ORIGEN de tramo2.
 *
 * Uso:
 *   npx tsx scripts/fixTerminacionesCadenaLit420.ts --apply
 */
import ExcelJS from 'exceljs';
import { normalizeNamespacedXlsx } from '../src/lib/pnidImport/parseExcel.js';
import { readFile } from 'node:fs/promises';
import { getDbPool } from '../src/db/sql.js';
import sql from 'mssql';

const API_BASE = 'http://localhost:3000';
const DEV_USER = 'admin@siei.local';
const PROJECT_ID = '150086';
const PNPIDS = ['5245', '14004', '14104', '15706', '15904', '7844', '9979', '9988', '10034', '10633', '10612', '2100', '2670', '4172', '6127', '15690', '15520'];
const K = 2;

async function apiFetch<T = any>(urlPath: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: T }> {
  const response = await fetch(`${API_BASE}${urlPath}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': DEV_USER },
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

async function main() {
  const buf = await readFile('/workspaces/SIEI/reference_excel/02_MASTER_IO_420.xlsm');
  const normalized = await normalizeNamespacedXlsx(buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(normalized as any);
  const ws = wb.worksheets.find((w) => /SENALES_CONTROL/i.test(w.name))!;
  const headerRow = ws.getRow(1).values as any[];
  const idx: Record<string, number> = {};
  headerRow.forEach((v, i) => { if (v) idx[String(v).trim()] = i; });

  const filaPorPnpid = new Map<string, any>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const pnpid = cleanText(row.getCell(idx['PNPID'])?.value);
    if (pnpid && PNPIDS.includes(pnpid)) {
      filaPorPnpid.set(pnpid, {
        tagCaja: cleanText(row.getCell(idx['TAG_CAJA'])?.value),
        tagCableInst: cleanText(row.getCell(idx['TAG_CABLE_INST'])?.value),
        tagCable: cleanText(row.getCell(idx['TAG_CABLE'])?.value),
        borneJb: cleanText(row.getCell(idx['BORNE_JB'])?.value)
      });
    }
  }

  const pool = await getDbPool();
  const cajasResp = await apiFetch<{ boxes: any[] }>(`/api/projects/${PROJECT_ID}/boxes`);
  const cajaIdByTag = new Map(cajasResp.json.boxes.map((c: any) => [c.tagCaja, c.id]));
  const cablesResp = await apiFetch<{ cables: any[] }>(`/api/projects/${PROJECT_ID}/cables`);
  const cableIdByTag = new Map(cablesResp.json.cables.map((c: any) => [c.tagCable, c.id]));

  const bloqueCache = new Map<string, string>();

  for (const pnpid of PNPIDS) {
    const fila = filaPorPnpid.get(pnpid);
    if (!fila || !fila.tagCaja || !fila.tagCableInst || !fila.tagCable || !fila.borneJb) {
      console.log(`! PNPID ${pnpid}: fila incompleta, no se procesa.`);
      continue;
    }

    const instResp = await pool.request().input('p', sql.BigInt, PROJECT_ID).input('pnpid', sql.NVarChar(50), pnpid)
      .query(`SELECT id, tag_instrumento FROM nucleo.instrumento WHERE proyecto_id = @p AND pnpid = @pnpid`);
    const inst = instResp.recordset[0];
    if (!inst) { console.log(`! PNPID ${pnpid}: instrumento real no encontrado.`); continue; }
    const tagSenalReal = `${inst.tag_instrumento}_LI`;

    const sigResp = await apiFetch<{ signals: any[] }>(`/api/projects/${PROJECT_ID}/signals`);
    const señal = sigResp.json.signals.find((s: any) => s.tagSenal === tagSenalReal);
    if (!señal) { console.log(`! PNPID ${pnpid}: señal "${tagSenalReal}" no encontrada.`); continue; }

    const cajaId = cajaIdByTag.get(fila.tagCaja);
    const cableCampoId = cableIdByTag.get(fila.tagCableInst);
    const cableInternoId = cableIdByTag.get(fila.tagCable);
    if (!cajaId || !cableCampoId || !cableInternoId) { console.log(`! ${tagSenalReal}: caja/cable no resuelto (${fila.tagCaja}/${fila.tagCableInst}/${fila.tagCable}).`); continue; }

    const routesResp = await apiFetch<{ routes: any[] }>(`/api/projects/${PROJECT_ID}/routes?senalId=${señal.id}`);
    const route = routesResp.json.routes[0];
    if (!route) { console.log(`! ${tagSenalReal}: sin ruta activa.`); continue; }
    const routeDetail = await apiFetch<{ route: any }>(`/api/projects/${PROJECT_ID}/routes/${route.id}`);
    const segs = (routeDetail.json.route.segments ?? []).sort((a: any, b: any) => a.numeroOrden - b.numeroOrden);
    if (segs.length < 3) { console.log(`! ${tagSenalReal}: ruta con ${segs.length} tramos.`); continue; }
    const [tramo1, tramo2] = segs;

    const bornes = fila.borneJb.split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, K);
    if (bornes.length < K) { console.log(`! ${tagSenalReal}: BORNE_JB="${fila.borneJb}" trae menos de ${K}.`); continue; }

    // Bloque: (caja, tagCableInst)
    const bloqueKey = `${cajaId}|${fila.tagCableInst}`;
    let bloqueId = bloqueCache.get(bloqueKey);
    if (!bloqueId) {
      const bloquesResp = await apiFetch<{ bloquesTerminal: any[] }>(`/api/projects/${PROJECT_ID}/bloques-terminal?cajaId=${cajaId}`);
      let found: any = null;
      for (const b of bloquesResp.json.bloquesTerminal ?? []) {
        const d = await apiFetch<{ bloqueTerminal: any }>(`/api/projects/${PROJECT_ID}/bloques-terminal/${b.id}`);
        if ((d.json.bloqueTerminal.terminales ?? []).some((t: any) => t.numero === bornes[0])) { found = b; break; }
      }
      if (found) bloqueId = found.id;
      else {
        const codigo = `TB-${(bloquesResp.json.bloquesTerminal ?? []).length + 1}`;
        const created = await apiFetch(`/api/projects/${PROJECT_ID}/bloques-terminal`, { method: 'POST', body: { cajaId, codigo } });
        if (created.status !== 201) { console.log(`! ${tagSenalReal}: error creando bloque:`, JSON.stringify(created.json)); continue; }
        bloqueId = created.json.bloqueTerminal.id;
      }
      bloqueCache.set(bloqueKey, bloqueId!);
    }

    for (const numero of bornes) {
      const bloqueDetail = await apiFetch<{ bloqueTerminal: any }>(`/api/projects/${PROJECT_ID}/bloques-terminal/${bloqueId}`);
      let terminal = (bloqueDetail.json.bloqueTerminal.terminales ?? []).find((t: any) => t.numero === numero);
      if (!terminal) {
        const createdT = await apiFetch(`/api/projects/${PROJECT_ID}/bloques-terminal/${bloqueId}/terminales`, { method: 'POST', body: { numero } });
        if (createdT.status !== 201) { console.log(`! ${tagSenalReal}: error terminal ${numero}:`, JSON.stringify(createdT.json)); continue; }
        terminal = createdT.json.terminal; terminal.posiciones = [];
      }
      const posiciones = terminal.posiciones ?? [];
      let posA = posiciones.find((p: any) => p.codigo === 'A');
      if (!posA) {
        const c = await apiFetch(`/api/projects/${PROJECT_ID}/bloques-terminal/${bloqueId}/terminales/${terminal.id}/posiciones`, { method: 'POST', body: { codigo: 'A' } });
        if (c.status !== 201) { console.log(`! ${tagSenalReal}: error posicion A:`, JSON.stringify(c.json)); continue; }
        posA = c.json.posicionTerminal;
      }
      let posB = posiciones.find((p: any) => p.codigo === 'B');
      if (!posB) {
        const c = await apiFetch(`/api/projects/${PROJECT_ID}/bloques-terminal/${bloqueId}/terminales/${terminal.id}/posiciones`, { method: 'POST', body: { codigo: 'B' } });
        if (c.status !== 201) { console.log(`! ${tagSenalReal}: error posicion B:`, JSON.stringify(c.json)); continue; }
        posB = c.json.posicionTerminal;
      }

      const condCampoResp = await apiFetch<{ conductors: any[] }>(`/api/projects/${PROJECT_ID}/conductors?cableId=${cableCampoId}`);
      let condCampo = condCampoResp.json.conductors.find((c: any) => c.codigo === numero);
      if (!condCampo) {
        const c = await apiFetch(`/api/projects/${PROJECT_ID}/conductors`, { method: 'POST', body: { cableId: cableCampoId, codigo: numero } });
        if (c.status !== 201) { console.log(`! ${tagSenalReal}: error conductor campo:`, JSON.stringify(c.json)); continue; }
        condCampo = c.json.conductor;
      }
      const tc1 = await apiFetch(`/api/projects/${PROJECT_ID}/tramo-conductores`, { method: 'POST', body: { tramoConexionId: tramo1.id, conductorId: condCampo.id } });
      if (tc1.status === 201) {
        const t = await apiFetch(`/api/projects/${PROJECT_ID}/tramo-conductores/${tc1.json.tramoConductor.id}/terminaciones`, { method: 'POST', body: { extremo: 'DESTINO', posicionTerminalId: posA.id } });
        console.log(`${tagSenalReal} terminacion A (${numero}):`, t.status === 201 ? 'OK' : JSON.stringify(t.json));
      } else if (tc1.status !== 409) console.log(`! ${tagSenalReal}: error tramo_conductor campo:`, JSON.stringify(tc1.json));

      const condIntResp = await apiFetch<{ conductors: any[] }>(`/api/projects/${PROJECT_ID}/conductors?cableId=${cableInternoId}`);
      let condInt = condIntResp.json.conductors.find((c: any) => c.codigo === numero);
      if (!condInt) {
        const c = await apiFetch(`/api/projects/${PROJECT_ID}/conductors`, { method: 'POST', body: { cableId: cableInternoId, codigo: numero } });
        if (c.status !== 201) { console.log(`! ${tagSenalReal}: error conductor interno:`, JSON.stringify(c.json)); continue; }
        condInt = c.json.conductor;
      }
      const tc2 = await apiFetch(`/api/projects/${PROJECT_ID}/tramo-conductores`, { method: 'POST', body: { tramoConexionId: tramo2.id, conductorId: condInt.id } });
      if (tc2.status === 201) {
        const t = await apiFetch(`/api/projects/${PROJECT_ID}/tramo-conductores/${tc2.json.tramoConductor.id}/terminaciones`, { method: 'POST', body: { extremo: 'ORIGEN', posicionTerminalId: posB.id } });
        console.log(`${tagSenalReal} terminacion B (${numero}):`, t.status === 201 ? 'OK' : JSON.stringify(t.json));
      } else if (tc2.status !== 409) console.log(`! ${tagSenalReal}: error tramo_conductor interno:`, JSON.stringify(tc2.json));
    }
  }
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
