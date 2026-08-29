/*
 * Pruebas de API para la eliminación definitiva de instrumentos
 * (DELETE /instruments/:id con { eliminarDefinitivamente: true }).
 *
 * Motivación real: el usuario tiene instrumentos con estado P&ID
 * NO_EXISTE_EN_PNID en un proyecto real, todos ya congelados dentro de
 * una revisión LDI EMITIDA — la migración 011 hizo
 * revision_entregable_fila.instrumento_id opcional para que borrar el
 * instrumento del Master ya no dependa de tocar esa revisión (ver
 * CLAUDE.md, "Eliminación definitiva de instrumentos").
 *
 * Corre en un proyecto temporal propio contra el backend ya corriendo en
 * localhost:3000 (mismo patrón que entregablesLdi.api.test.ts) — nunca en
 * TEST-001.
 *
 * Uso: npm run test:instrumento-eliminacion
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';

const BASE = 'http://localhost:3000';
const USERS = {
  admin: 'admin@siei.local',
  editor: 'editor@siei.local',
  viewer: 'viewer@siei.local'
} as const;
type UserKey = keyof typeof USERS;

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

async function call(user: UserKey, method: string, p: string, body?: unknown) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': USERS[user] },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

interface Row { [header: string]: string | number | boolean | null | undefined; }

async function buildWorkbookBuffer(headers: string[], rows: Row[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Instrument List');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadPnidPreview(projectId: string, buffer: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'reporte.xlsx');
  const res = await fetch(`${BASE}/api/projects/${projectId}/pnid-imports/preview`, {
    method: 'POST',
    headers: { 'X-Dev-User-Email': USERS.admin },
    body: form
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

async function uploadPlantilla(projectId: string, buffer: Buffer, tipoEntregableId: string) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'PLANTILLA.xlsx');
  form.append('tipoEntregableId', tipoEntregableId);
  const res = await fetch(`${BASE}/api/projects/${projectId}/plantillas-entregable`, {
    method: 'POST',
    headers: { 'X-Dev-User-Email': USERS.admin },
    body: form
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

const runId = Date.now().toString(36);
let projectId: string | undefined;

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '../..');
  const templatePath = path.resolve(repoRoot, 'reference_excel/Lista_instrumentos_plantilla.xlsx');

  // ==================== SETUP: proyecto temporal + miembros ====================
  const clientsResp = await call('admin', 'GET', '/api/clients');
  const clientId = clientsResp.json?.clients?.[0]?.id;

  const createProject = await call('admin', 'POST', '/api/projects', {
    clientId,
    code: `TEST-DELINST-${runId}`,
    name: 'Proyecto temporal — eliminación definitiva de instrumentos'
  });
  check('Proyecto temporal creado (201)', createProject.status === 201, createProject.json);
  projectId = createProject.json?.project?.id;
  if (!projectId) throw new Error('No se pudo crear el proyecto temporal.');

  const addEditor = await call('admin', 'POST', `/api/projects/${projectId}/members`, { email: USERS.editor, rol: 'EDITOR' });
  check('EDITOR agregado como miembro (201) — sin permiso administer', addEditor.status === 201, addEditor.json);

  const INSTRUMENTS = `/api/projects/${projectId}/instruments`;

  // ==================== reporte P&ID v1: 3 instrumentos ====================
  const HEADERS = ['PnPID', 'Tag', 'Listado', 'Descripcion', 'Type'];
  const pnpidQueSeVaAIr = `Q${runId}`;
  const tagQueSeVaAIr = `PIT-Q-${runId}`;
  const pnpidSobrevive = `S${runId}`;
  const tagSobrevive = `PIT-S-${runId}`;

  const bufferV1 = await buildWorkbookBuffer(HEADERS, [
    { PnPID: pnpidQueSeVaAIr, Tag: tagQueSeVaAIr, Listado: true, Descripcion: 'Va a desaparecer del P&ID', Type: 'PIT' },
    { PnPID: pnpidSobrevive, Tag: tagSobrevive, Listado: true, Descripcion: 'Sigue en el P&ID', Type: 'PIT' }
  ]);

  const preview1 = await uploadPnidPreview(projectId, bufferV1);
  check('Preview v1 (201)', preview1.status === 201, preview1.json);
  const apply1 = await call('admin', 'POST', `/api/projects/${projectId}/pnid-imports/${preview1.json.import.id}/apply`);
  check('Apply v1 (200)', apply1.status === 200, apply1.json);

  const listAfterV1 = await call('admin', 'GET', INSTRUMENTS);
  const instQueSeVaAIr = listAfterV1.json.instruments.find((i: any) => i.tagInstrumento === tagQueSeVaAIr);
  const instSobrevive = listAfterV1.json.instruments.find((i: any) => i.tagInstrumento === tagSobrevive);
  check('Ambos instrumentos creados tras apply v1', Boolean(instQueSeVaAIr && instSobrevive), listAfterV1.json);

  // ==================== reporte P&ID v2: uno de los dos desaparece ====================
  const bufferV2 = await buildWorkbookBuffer(HEADERS, [
    { PnPID: pnpidSobrevive, Tag: tagSobrevive, Listado: true, Descripcion: 'Sigue en el P&ID', Type: 'PIT' }
  ]);
  const preview2 = await uploadPnidPreview(projectId, bufferV2);
  check('Preview v2 (201)', preview2.status === 201, preview2.json);
  const apply2 = await call('admin', 'POST', `/api/projects/${projectId}/pnid-imports/${preview2.json.import.id}/apply`);
  check('Apply v2 (200)', apply2.status === 200, apply2.json);

  const getQueSeVaAIr = await call('admin', 'GET', `${INSTRUMENTS}/${instQueSeVaAIr.id}`);
  const estadosResp = await call('admin', 'GET', '/api/catalogs/pnid-states');
  const noExisteId = estadosResp.json.items.find((e: any) => e.codigo === 'NO_EXISTE_EN_PNID')?.id;
  check(
    'El instrumento ausente en v2 quedó NO_EXISTE_EN_PNID',
    getQueSeVaAIr.json.instrument.estadoPnidId === noExisteId,
    { estadoPnidId: getQueSeVaAIr.json.instrument.estadoPnidId, noExisteId }
  );

  // ==================== LDI: entregable + revisión EMITIDA que congela a ambos ====================
  const tipos = await call('admin', 'GET', '/api/catalogs/tipos-entregable');
  const tipoLdi = tipos.json.items.find((t: any) => t.codigo === 'LDI');

  const templateBuffer = await readFile(templatePath).catch(() => null);
  if (!templateBuffer) {
    console.error(`No se encontró la plantilla real en ${templatePath} — se aborta.`);
    process.exit(1);
  }
  const plantilla = await uploadPlantilla(projectId, templateBuffer, tipoLdi.id);
  check('Plantilla LDI subida (201)', plantilla.status === 201, plantilla.json);

  const entregable = await call('admin', 'POST', `/api/projects/${projectId}/entregables`, {
    tipoEntregableId: tipoLdi.id,
    componenteArea: '620',
    componenteDisciplina: 'J',
    componenteCorrelativo: '0001'
  });
  check('Entregable LDI creado (201)', entregable.status === 201, entregable.json);
  const entregableId = entregable.json.entregable.id;
  const REVISIONES = `/api/projects/${projectId}/entregables/${entregableId}/revisiones`;

  const revA = await call('admin', 'POST', REVISIONES, {
    codigoRevision: 'A',
    descripcion: 'Congela a ambos instrumentos',
    inicialesPor: 'X.X.X.',
    inicialesRevisado: 'Y.Y.Y.',
    inicialesAprobado: 'Z.Z.Z.',
    criterios: [{ campo: 'tag', direccion: 'ASC' }]
  });
  check('BORRADOR "A" creado (201)', revA.status === 201, revA.json);
  const revAId = revA.json.revision.id;

  const filasBorrador = revA.json.filas as any[];
  check(
    'El preview de la revisión incluye ambos instrumentos',
    filasBorrador.some((f) => f.snapshot.tag === tagQueSeVaAIr) && filasBorrador.some((f) => f.snapshot.tag === tagSobrevive),
    filasBorrador.map((f) => f.snapshot.tag)
  );

  const emitir = await call('admin', 'POST', `${REVISIONES}/${revAId}/emitir`);
  check('Revisión "A" emitida (200)', emitir.status === 200 && emitir.json.revision.estado === 'EMITIDA', emitir.json);

  // ==================== intento de eliminación definitiva sobre el que SÍ sigue en el P&ID ====================
  const intentoSobreOk = await call('admin', 'DELETE', `${INSTRUMENTS}/${instSobrevive.id}`, { eliminarDefinitivamente: true });
  check(
    'Eliminación definitiva sobre un instrumento con estado != NO_EXISTE_EN_PNID -> 409',
    intentoSobreOk.status === 409 && intentoSobreOk.json?.error === 'instrumento_no_elegible_para_eliminacion',
    intentoSobreOk.json
  );

  // ==================== permisos: EDITOR (con acceso, sin administer) -> 403 ====================
  const intentoEditor = await call('editor', 'DELETE', `${INSTRUMENTS}/${instQueSeVaAIr.id}`, { eliminarDefinitivamente: true });
  check(
    'EDITOR (con acceso pero sin administer) -> 403',
    intentoEditor.status === 403 && intentoEditor.json?.error === 'forbidden',
    intentoEditor.json
  );

  // ==================== eliminación definitiva real, como ADMIN ====================
  const eliminacion = await call('admin', 'DELETE', `${INSTRUMENTS}/${instQueSeVaAIr.id}`, { eliminarDefinitivamente: true });
  check(
    'ADMIN elimina definitivamente el instrumento NO_EXISTE_EN_PNID (200)',
    eliminacion.status === 200 && eliminacion.json?.eliminado === true,
    eliminacion.json
  );
  check(
    'La respuesta reporta la fila de revisión desvinculada',
    eliminacion.json?.limpieza?.filasRevisionEntregableDesvinculadas === 1,
    eliminacion.json
  );

  const getTrasEliminar = await call('admin', 'GET', `${INSTRUMENTS}/${instQueSeVaAIr.id}`);
  check('GET del instrumento eliminado -> 404', getTrasEliminar.status === 404, getTrasEliminar.json);

  const eliminarDeNuevo = await call('admin', 'DELETE', `${INSTRUMENTS}/${instQueSeVaAIr.id}`, { eliminarDefinitivamente: true });
  check('Eliminar de nuevo el mismo instrumento -> 404', eliminarDeNuevo.status === 404, eliminarDeNuevo.json);

  // ==================== la revisión EMITIDA sigue intacta, solo pierde el enlace ====================
  const revisionTrasEliminar = await call('admin', 'GET', `${REVISIONES}/${revAId}`);
  const filasTrasEliminar = revisionTrasEliminar.json.filas as any[];
  const filaQueSeVaAIr = filasTrasEliminar.find((f) => f.snapshot.tag === tagQueSeVaAIr);
  check(
    'La fila del instrumento eliminado sigue en el snapshot, con su contenido intacto',
    Boolean(filaQueSeVaAIr) && filaQueSeVaAIr.snapshot.descripcion === 'Va a desaparecer del P&ID',
    filaQueSeVaAIr
  );
  check(
    'Esa fila ya no tiene instrumentoId (el instrumento fue borrado)',
    filaQueSeVaAIr.instrumentoId === undefined,
    filaQueSeVaAIr
  );
  const filaSobrevive = filasTrasEliminar.find((f) => f.snapshot.tag === tagSobrevive);
  check('La fila del instrumento que sigue existiendo conserva su instrumentoId', filaSobrevive.instrumentoId === instSobrevive.id, filaSobrevive);
  check('La revisión sigue EMITIDA (no se tocó su estado)', revisionTrasEliminar.json.revision.estado === 'EMITIDA');

  // ==================== permisos: sin acceso al proyecto temporal ====================
  const sinAcceso = await fetch(`${BASE}${INSTRUMENTS}/${instSobrevive.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': 'viewer@siei.local' },
    body: JSON.stringify({ eliminarDefinitivamente: true })
  });
  check('VIEWER sin acceso al proyecto temporal -> 403', sinAcceso.status === 403);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
}

main()
  .catch((error) => {
    console.error('Error inesperado en la suite:', error);
    fail++;
  })
  .finally(async () => {
    if (projectId) {
      const archive = await call('admin', 'DELETE', `/api/projects/${projectId}`);
      console.log(`Proyecto temporal ${projectId} archivado: status ${archive.status}`);
    }
    console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
  });
