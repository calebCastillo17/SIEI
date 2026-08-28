/*
 * Pruebas de API para el módulo de Equipos — catálogo curado de
 * Instrumentación (migración 007: cat.cat_tipo_equipo,
 * nucleo.equipo.plano_pnid/tipo_equipo_id).
 *
 * Corre TODO en proyectos temporales propios (nunca TEST-001), archivados
 * al final. Cubre:
 *  - catálogo cat.cat_tipo_equipo (ELECTRICO/INSTRUMENTACION)
 *  - CRUD de equipo con los campos nuevos (planoPnid, tipoEquipoId) y
 *    campos NULL (casos reales sin panel/sistema/nodo/tipo)
 *  - el script de carga puntual (scripts/seedEquiposDesdeExcel.ts) contra
 *    el Excel real, 30 registros, todos ELECTRICO
 *  - el fix del importador P&ID: nunca escribe/pisa equipo_asociado_id,
 *    una asociación manual sobrevive a una reimportación
 *  - equipo en uso no se puede desactivar
 *
 * Uso: npm run test:equipos-instrumentacion
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';

const BASE = 'http://localhost:3000';
const ADMIN = 'admin@siei.local';
const VIEWER = 'viewer@siei.local';

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    console.log(`FAIL: ${label}` + (extra ? ` -- ${JSON.stringify(extra)}` : ''));
  }
}

async function call(email: string, method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': email },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

async function uploadPnidPreview(projectId: string, buffer: Buffer, filename: string) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  const res = await fetch(`${BASE}/api/projects/${projectId}/pnid-imports/preview`, {
    method: 'POST',
    headers: { 'X-Dev-User-Email': ADMIN },
    body: form
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

interface Row { [header: string]: string | number | null }

async function buildPnidWorkbook(rows: Row[]): Promise<Buffer> {
  const headers = ['PnPID', 'Tag', 'Listado', 'Equipo Asociado'];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Instrument List');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

async function createTempProject(code: string, name: string): Promise<string> {
  const clientsResp = await call(ADMIN, 'GET', '/api/clients');
  const clientId = clientsResp.json?.clients?.[0]?.id;
  check(`Hay al menos un cliente (para "${code}")`, Boolean(clientId));

  const createProject = await call(ADMIN, 'POST', '/api/projects', { clientId, code, name });
  check(`Proyecto temporal "${code}" creado (201)`, createProject.status === 201, createProject.json);
  const projectId = createProject.json?.project?.id;
  if (!projectId) throw new Error(`No se pudo crear el proyecto temporal ${code}.`);
  return projectId;
}

const runId = Date.now().toString(36);
const projectIds: string[] = [];

async function main() {
  // ==================== catálogo cat.cat_tipo_equipo ====================
  const tipos = await call(ADMIN, 'GET', '/api/catalogs/tipos-equipo');
  check('GET tipos-equipo (200)', tipos.status === 200, tipos.json);
  const tipoElectrico = tipos.json?.items?.find((t: any) => t.codigo === 'ELECTRICO');
  const tipoInstrumentacion = tipos.json?.items?.find((t: any) => t.codigo === 'INSTRUMENTACION');
  check('Existe ELECTRICO', Boolean(tipoElectrico), tipos.json);
  check('Existe INSTRUMENTACION', Boolean(tipoInstrumentacion), tipos.json);
  check('El catálogo tiene exactamente 2 items (lista cerrada por ahora)', tipos.json?.items?.length === 2);

  // ==================== proyecto temporal: CRUD de equipo ====================
  const projectId = await createTempProject(`TEST-EQ-${runId}`, 'Proyecto temporal — Equipos');
  projectIds.push(projectId);
  const EQUIPMENT = `/api/projects/${projectId}/equipment`;

  // --- equipo completo, con planoPnid y tipoEquipoId ---
  const full = await call(ADMIN, 'POST', EQUIPMENT, {
    tagEquipo: '620-AFL-5001',
    descripcion: 'Variador de velocidad 620-PPD-5014A',
    panel: '620-AFL-5001',
    sistema: ' LÍNEA DE IMPULSIÓN 1 A DIQUE CONTENEDOR',
    nodo: 'Nodo 7',
    planoPnid: '620-F-20019',
    tipoEquipoId: tipoElectrico.id
  });
  check('POST equipo completo (201)', full.status === 201, full.json);
  check('planoPnid persistido', full.json?.equipment?.planoPnid === '620-F-20019');
  check('tipoEquipoId persistido', full.json?.equipment?.tipoEquipoId === tipoElectrico.id);
  check('tipoEquipoCodigo resuelto = ELECTRICO', full.json?.equipment?.tipoEquipoCodigo === 'ELECTRICO');
  check('tipoEquipoNombre resuelto = Eléctrico', full.json?.equipment?.tipoEquipoNombre === 'Eléctrico');
  const equipoCompletoId = full.json?.equipment?.id;

  // --- equipo con campos NULL — caso real "Medidor multifunción" ---
  const minimal = await call(ADMIN, 'POST', EQUIPMENT, { tagEquipo: 'Medidor multifunción' });
  check('POST equipo solo con tagEquipo (201)', minimal.status === 201, minimal.json);
  check('descripcion/panel/sistema/nodo/planoPnid/tipoEquipoId quedan NULL', (() => {
    const e = minimal.json?.equipment;
    return e?.descripcion === null && e?.panel === null && e?.sistema === null &&
      e?.nodo === null && e?.planoPnid === null && e?.tipoEquipoId === null &&
      e?.tipoEquipoCodigo === null && e?.tipoEquipoNombre === null;
  })(), minimal.json);

  // --- tipoEquipoId inexistente -> 400 ---
  const badTipo = await call(ADMIN, 'POST', EQUIPMENT, { tagEquipo: '620-TEST-BADTIPO', tipoEquipoId: '999999999' });
  check('tipoEquipoId inexistente -> 400 invalid_reference', badTipo.status === 400 && badTipo.json?.error === 'invalid_reference', badTipo.json);

  // --- TAG duplicado -> 409 ---
  const dupe = await call(ADMIN, 'POST', EQUIPMENT, { tagEquipo: '620-AFL-5001' });
  check('TAG duplicado -> 409', dupe.status === 409, dupe.json);

  // --- PATCH: cambiar tipoEquipoId a INSTRUMENTACION y quitar planoPnid ---
  const patched = await call(ADMIN, 'PATCH', `${EQUIPMENT}/${equipoCompletoId}`, {
    tipoEquipoId: tipoInstrumentacion.id,
    planoPnid: null
  });
  check('PATCH cambia tipoEquipoId y limpia planoPnid (200)', patched.status === 200, patched.json);
  check('tipoEquipoCodigo actualizado a INSTRUMENTACION', patched.json?.equipment?.tipoEquipoCodigo === 'INSTRUMENTACION');
  check('planoPnid quedó NULL', patched.json?.equipment?.planoPnid === null);

  // --- GET list trae ambos ---
  const list = await call(ADMIN, 'GET', EQUIPMENT);
  check('GET lista trae 2 equipos activos', list.json?.equipment?.length === 2, list.json);

  // ==================== script de carga: 30 equipos reales ====================
  const seedProjectId = await createTempProject(`TEST-EQSEED-${runId}`, 'Proyecto temporal — Carga equipos_620');
  projectIds.push(seedProjectId);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const backendRoot = path.resolve(__dirname, '..');

  const seedResult = spawnSync('npx', ['tsx', 'scripts/seedEquiposDesdeExcel.ts', '--project', seedProjectId, '--user', ADMIN], {
    cwd: backendRoot,
    encoding: 'utf-8'
  });
  const seedOutput = `${seedResult.stdout}\n${seedResult.stderr}`;
  check('Script de carga corre sin errores', seedResult.status === 0, seedOutput);
  check('Script reporta 30 leídos', /30 le[ií]dos/i.test(seedOutput) || seedOutput.includes('30 registros encontrados'), seedOutput);
  check('Script reporta 30 creados, 0 duplicados, 0 errores', /30 creados, 0 duplicados, 0 errores/.test(seedOutput), seedOutput);

  const seededList = await call(ADMIN, 'GET', `/api/projects/${seedProjectId}/equipment`);
  check('Quedaron 30 equipos activos en el proyecto', seededList.json?.equipment?.length === 30, seededList.json?.equipment?.length);
  check('Los 30 quedaron como ELECTRICO', seededList.json?.equipment?.every((e: any) => e.tipoEquipoCodigo === 'ELECTRICO'));
  const bombaRelaves = seededList.json?.equipment?.find((e: any) => e.tagEquipo === '620-PPS-5005');
  check('620-PPS-5005 (bomba real del Excel) está presente', Boolean(bombaRelaves), seededList.json?.equipment?.map((e: any) => e.tagEquipo));

  // ==================== P&ID nunca toca equipo_asociado_id ====================
  // El instrumento tiene que nacer de un P&ID real (fuente_pnpid=PLANT3D,
  // mismo PnPID en ambas corridas) — si naciera manual (pnpid NULL), la
  // segunda importación con un PnPID nuevo bajo el mismo TAG caería en
  // "reutilización de TAG" (REQUIERE_REVISION, nunca aplicado
  // automáticamente, ver CLAUDE.md), no en DATOS_MODIFICADOS.
  const INSTRUMENTS = `/api/projects/${seedProjectId}/instruments`;

  const firstPnidBuffer = await buildPnidWorkbook([
    { PnPID: 'PNID-9001', Tag: '620-PIT-9001', Listado: 'SI', 'Equipo Asociado': '620-EQUIPO-ORIGINAL-DEL-PID' }
  ]);
  const firstPreview = await uploadPnidPreview(seedProjectId, firstPnidBuffer, 'reporte-inicial.xlsx');
  check('Preview P&ID inicial (201)', firstPreview.status === 201, firstPreview.json);
  const firstApply = await call(ADMIN, 'POST', `/api/projects/${seedProjectId}/pnid-imports/${firstPreview.json.import.id}/apply`, {});
  check('Apply P&ID inicial (200)', firstApply.status === 200, firstApply.json);

  const instrumentsAfterFirst = await call(ADMIN, 'GET', INSTRUMENTS);
  const createdInst = instrumentsAfterFirst.json?.instruments?.find((i: any) => i.tagInstrumento === '620-PIT-9001');
  check('El instrumento nació del primer P&ID', Boolean(createdInst), instrumentsAfterFirst.json);
  const instId = createdInst.id;

  const manualLink = await call(ADMIN, 'PATCH', `${INSTRUMENTS}/${instId}`, { equipoAsociadoId: bombaRelaves.id });
  check('PATCH instrumento: asociación manual curada a 620-PPS-5005 (200)', manualLink.status === 200, manualLink.json);
  check('equipoAsociadoId quedó seteado', manualLink.json?.instrument?.equipoAsociadoId === bombaRelaves.id);

  // Reimporta el MISMO PnPID/TAG con un "Equipo Asociado" DISTINTO —
  // ahora sí es DATOS_MODIFICADOS, se aplica de verdad.
  const secondPnidBuffer = await buildPnidWorkbook([
    { PnPID: 'PNID-9001', Tag: '620-PIT-9001', Listado: 'SI', 'Equipo Asociado': '620-OTRO-EQUIPO-DEL-PID' }
  ]);
  const preview = await uploadPnidPreview(seedProjectId, secondPnidBuffer, 'reporte-equipo-asociado.xlsx');
  check('Preview P&ID (reimport) (201)', preview.status === 201, preview.json);
  const applyResp = await call(ADMIN, 'POST', `/api/projects/${seedProjectId}/pnid-imports/${preview.json.import.id}/apply`, {});
  check('Apply P&ID (reimport) (200)', applyResp.status === 200, applyResp.json);

  const afterApply = await call(ADMIN, 'GET', `${INSTRUMENTS}/${instId}`);
  check(
    'equipoAsociadoTag se actualizó al texto del nuevo P&ID',
    afterApply.json?.instrument?.equipoAsociadoTag === '620-OTRO-EQUIPO-DEL-PID',
    afterApply.json
  );
  check(
    'equipoAsociadoId NO cambió (sigue siendo la curación manual)',
    afterApply.json?.instrument?.equipoAsociadoId === bombaRelaves.id,
    afterApply.json
  );

  // ==================== equipo en uso no se puede desactivar ====================
  const deactivateBlocked = await call(ADMIN, 'DELETE', `/api/projects/${seedProjectId}/equipment/${bombaRelaves.id}`);
  check('DELETE equipo en uso -> 409 equipment_in_use', deactivateBlocked.status === 409 && deactivateBlocked.json?.error === 'equipment_in_use', deactivateBlocked.json);

  const clearAssoc = await call(ADMIN, 'PATCH', `${INSTRUMENTS}/${instId}`, { equipoAsociadoId: null });
  check('PATCH instrumento: se quita la asociación manual (200)', clearAssoc.status === 200, clearAssoc.json);

  const deactivateOk = await call(ADMIN, 'DELETE', `/api/projects/${seedProjectId}/equipment/${bombaRelaves.id}`);
  check('DELETE equipo ya libre -> 200', deactivateOk.status === 200, deactivateOk.json);

  // ==================== permisos ====================
  const viewerCreate = await call(VIEWER, 'POST', EQUIPMENT, { tagEquipo: '620-VIEWER-NOPE' });
  check('VIEWER sin acceso al proyecto temporal -> 403/404', viewerCreate.status === 403 || viewerCreate.status === 404, viewerCreate.json);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
}

main()
  .catch((error) => {
    console.error('Error inesperado en la suite:', error);
    fail++;
  })
  .finally(async () => {
    for (const id of projectIds) {
      const archive = await call(ADMIN, 'DELETE', `/api/projects/${id}`);
      console.log(`Proyecto temporal ${id} archivado: status ${archive.status}`);
    }
    console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
  });
