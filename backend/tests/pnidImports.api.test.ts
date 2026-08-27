/*
 * Pruebas de API para la importación P&ID / Plant 3D
 * (integracion.importacion_pnid / _fila / _resultado, ver
 * database/migrations/004_pnid_import.sql).
 *
 * Corre TODO en proyectos temporales propios (Fase A y Fase B usan uno
 * cada una), nunca en TEST-001 — así no deja instrumentos/imports/
 * resultados de prueba mezclados con el proyecto fixture que usan el
 * resto de las suites. Ambos proyectos temporales se archivan al final
 * (archivar no borra su información de ingeniería, por diseño, pero deja
 * de aparecer para cualquier usuario — ver seguridad.vw_acceso_proyecto).
 *
 * Fase A: archivo sintético chico, para controlar con precisión cada caso
 * límite (TAG_MODIFICADO, DATOS_MODIFICADOS, REQUIERE_REVISION, etc.).
 * Fase B: una COPIA EN MEMORIA del reporte real de referencia
 * (reference_excel/162281-620-Instrument List.xlsx) con su encabezado
 * "Tag WSP" renombrado a "Tag Anterior" (el contrato nuevo aprobado) —
 * nunca se modifica el archivo original en disco.
 *
 * Uso: npm run test:pnid-imports
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';

import { normalizeNamespacedXlsx } from '../src/lib/pnidImport/parseExcel.js';

const PORT = Number(process.env.TEST_PORT ?? 3106);
const BASE = `http://localhost:${PORT}`;

const USERS = {
  admin: 'admin@siei.local',
  editor: 'editor@siei.local',
  viewer: 'viewer@siei.local'
} as const;

type UserKey = keyof typeof USERS;

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function call(
  user: UserKey,
  method: string,
  path_: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path_, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User-Email': USERS[user]
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let json: any = null;
  try { json = await res.json(); } catch { /* sin body */ }

  return { status: res.status, json };
}

async function uploadPreview(
  user: UserKey,
  projectId: string,
  buffer: Buffer,
  filename = 'reporte.xlsx'
): Promise<{ status: number; json: any }> {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);

  const res = await fetch(`${BASE}/api/projects/${projectId}/pnid-imports/preview`, {
    method: 'POST',
    headers: { 'X-Dev-User-Email': USERS[user] },
    body: form
  });

  let json: any = null;
  try { json = await res.json(); } catch { /* sin body */ }

  return { status: res.status, json };
}

function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`FAIL: ${label}` + (extra ? ` -- ${JSON.stringify(extra)}` : ''));
  }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health/db`);
      if (res.ok) {
        const json = await res.json();
        if (json?.connection === true) return true;
      }
    } catch {
      // el servidor todavía no acepta conexiones
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

interface Row {
  [header: string]: string | number | boolean | null | undefined;
}

/** Construye un .xlsx en memoria con la hoja "Instrument List" y los
 * encabezados/filas indicados — sin depender de ningún archivo en disco. */
async function buildWorkbookBuffer(headers: string[], rows: Row[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Instrument List');
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(headers.map((h) => row[h] ?? null));
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function findResultado(resultados: any[], tagInstrumento: string): any {
  return resultados.find((r: any) => r.tagInstrumento === tagInstrumento);
}

async function createTempProject(runId: string, suffix: string, name: string): Promise<string> {
  const clientsResp = await call('admin', 'GET', '/api/clients');
  const clientId = clientsResp.json?.clients?.[0]?.id;

  const createProject = await call('admin', 'POST', '/api/projects', {
    clientId,
    code: `TEST-PNID-${suffix}-${runId}`,
    name
  });
  check(`Proyecto temporal "${suffix}" creado (201)`, createProject.status === 201, createProject.json);

  const projectId: string | undefined = createProject.json?.project?.id;
  if (!projectId) throw new Error(`No se pudo crear el proyecto temporal ${suffix}.`);

  return projectId;
}

async function addMembers(projectId: string): Promise<void> {
  // Un proyecto recien creado no tiene asignaciones — sin esto, EDITOR/VIEWER
  // reciben 403 "no access" (no por falta de permiso, por falta de acceso).
  const addEditor = await call('admin', 'POST', `/api/projects/${projectId}/members`, {
    email: USERS.editor,
    rol: 'EDITOR'
  });
  check('EDITOR agregado como miembro del proyecto temporal', addEditor.status === 201, addEditor.json);

  const addViewer = await call('admin', 'POST', `/api/projects/${projectId}/members`, {
    email: USERS.viewer,
    rol: 'VIEWER'
  });
  check('VIEWER agregado como miembro del proyecto temporal', addViewer.status === 201, addViewer.json);
}

async function main(): Promise<void> {
  let serverProcess: ChildProcess | null = null;
  let tempProjectIdA: string | undefined;
  let tempProjectIdB: string | undefined;

  const alreadyRunning = await waitForHealth(500);

  if (!alreadyRunning) {
    console.log(`Ningún backend respondiendo en ${BASE}; levantando uno para la prueba...`);

    serverProcess = spawn(
      'npx',
      ['tsx', 'src/server.ts'],
      {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, PORT: String(PORT) },
        stdio: 'pipe',
        detached: true
      }
    );

    serverProcess.stdout?.on('data', () => {});
    serverProcess.stderr?.on('data', (chunk) => process.stderr.write(chunk));

    const ready = await waitForHealth(20_000);

    if (!ready) {
      console.error('El backend no respondió a tiempo.');
      serverProcess.kill();
      process.exit(1);
    }
  }

  try {
    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // ===================== FASE A: proyecto temporal propio =====================

    tempProjectIdA = await createTempProject(runId, 'A', 'Proyecto temporal — pruebas sintéticas import P&ID');
    await addMembers(tempProjectIdA);

    const projectId = tempProjectIdA;
    const IMPORTS = `/api/projects/${projectId}/pnid-imports`;
    const INSTRUMENTS = `/api/projects/${projectId}/instruments`;
    const SIGNALS = `/api/projects/${projectId}/signals`;

    const HEADERS = [
      'PnPID', 'Tag', 'Listado', 'Tag Anterior', 'Descripcion', 'Type',
      'Servicio', 'Sistema', 'Equipo Asociado', 'Instrumento Asociado', 'Tipo de Senal'
    ];

    const pnpidA = `A${runId}`;
    const pnpidB = `B${runId}`;
    const pnpidC1 = `C${runId}`; // duplicado dentro del archivo
    const pnpidD1 = `D1-${runId}`;
    const pnpidD2 = `D2-${runId}`;
    const pnpidE = `E${runId}`;

    const tagA = `PIT-A-${runId}`;
    const tagB = `PIT-B-${runId}`;
    const tagC1 = `PIT-C1-${runId}`;
    const tagC2 = `PIT-C2-${runId}`;
    const tagD = `PIT-D-${runId}`;

    const baseRowA: Row = {
      PnPID: pnpidA, Tag: tagA, Listado: true, 'Tag Anterior': 'LEGACY-TAG-A',
      Descripcion: 'Descripcion original A', Type: 'PIT', Servicio: 'Servicio A',
      Sistema: 'Sistema A', 'Tipo de Senal': '4 a 20 mA + HART'
    };

    const rowsV1: Row[] = [
      baseRowA,
      { PnPID: pnpidB, Tag: tagB, Listado: false, Descripcion: 'No listado B' },
      { PnPID: pnpidC1, Tag: tagC1, Listado: true, Descripcion: 'Duplicado 1' },
      { PnPID: pnpidC1, Tag: tagC2, Listado: true, Descripcion: 'Duplicado 2' },
      { PnPID: pnpidD1, Tag: tagD, Listado: true, Descripcion: 'Primero con este TAG' },
      { PnPID: pnpidE, Tag: '', Listado: true, Descripcion: 'Tag vacio' }
    ];

    // ===================== INSTRUMENTO MANUAL (para la prueba de alcance NO_EXISTE_EN_PNID) =====================

    const manualTag = `MANUAL-SIN-PNID-${runId}`;
    const createManual = await call('editor', 'POST', INSTRUMENTS, { tagInstrumento: manualTag });
    check('Instrumento manual creado sin PnPID (201)', createManual.status === 201, createManual.json);
    const manualInstrumentId: string = createManual.json?.instrument?.id;

    // ===================== PERMISOS =====================

    const bufferV1 = await buildWorkbookBuffer(HEADERS, rowsV1);

    const viewerPreview = await uploadPreview('viewer', projectId, bufferV1);
    check('VIEWER no puede hacer preview (403)', viewerPreview.status === 403, viewerPreview.json);

    // ===================== PREVIEW V1 =====================

    const previewV1 = await uploadPreview('editor', projectId, bufferV1);
    check('EDITOR: preview V1 (201)', previewV1.status === 201, previewV1.json);

    const importId1: string = previewV1.json?.import?.id;
    const resultadosV1: any[] = previewV1.json?.resultados ?? [];

    check(
      'PREVIEW V1: fila A -> NUEVO_EN_PNID',
      findResultado(resultadosV1, tagA)?.resultado === 'NUEVO_EN_PNID',
      resultadosV1
    );
    check(
      'PREVIEW V1: fila B (Listado=False) -> NO_LISTADO',
      findResultado(resultadosV1, tagB)?.resultado === 'NO_LISTADO'
    );
    check(
      'PREVIEW V1: PnPID duplicado en archivo -> REQUIERE_REVISION en ambas filas',
      findResultado(resultadosV1, tagC1)?.resultado === 'REQUIERE_REVISION' &&
        findResultado(resultadosV1, tagC2)?.resultado === 'REQUIERE_REVISION'
    );
    check(
      'PREVIEW V1: fila D1 -> NUEVO_EN_PNID',
      findResultado(resultadosV1, tagD)?.resultado === 'NUEVO_EN_PNID'
    );
    check(
      'PREVIEW V1: fila con TAG vacío -> TAG_VACIO',
      resultadosV1.some((r: any) => r.resultado === 'TAG_VACIO' && r.pnpid === pnpidE)
    );
    check(
      'PREVIEW V1 no creó ninguna señal (proyecto nuevo, debe seguir en 0)',
      (await call('admin', 'GET', SIGNALS)).json?.signals?.length === 0
    );
    check(
      'PREVIEW no modificó nucleo.instrumento (fila A todavía no existe)',
      (await call('admin', 'GET', `${INSTRUMENTS}`)).json?.instruments?.every((i: any) => i.tagInstrumento !== tagA)
    );

    // ===================== APPLY V1 =====================

    const viewerApply = await call('viewer', 'POST', `${IMPORTS}/${importId1}/apply`);
    check('VIEWER no puede aplicar (403)', viewerApply.status === 403, viewerApply.json);

    const applyV1 = await call('editor', 'POST', `${IMPORTS}/${importId1}/apply`);
    check('EDITOR aplica V1 (200)', applyV1.status === 200, applyV1.json);

    const afterApplyInstruments = (await call('admin', 'GET', INSTRUMENTS)).json?.instruments ?? [];
    const instrA = afterApplyInstruments.find((i: any) => i.tagInstrumento === tagA);
    const instrD = afterApplyInstruments.find((i: any) => i.tagInstrumento === tagD);

    check('Instrumento A fue creado por APPLY', Boolean(instrA), afterApplyInstruments);
    check('Instrumento D fue creado por APPLY', Boolean(instrD));
    check(
      'Instrumento A NO existe con TAG C1/C2 (fila duplicada nunca se aplicó)',
      !afterApplyInstruments.some((i: any) => i.tagInstrumento === tagC1 || i.tagInstrumento === tagC2)
    );
    check(
      'Instrumento con TAG vacío nunca se creó',
      !afterApplyInstruments.some((i: any) => i.tagInstrumento === '')
    );
    check(
      'tag_anterior de A quedó exactamente el valor del archivo (LEGACY-TAG-A), no autogenerado',
      instrA?.tagAnterior === 'LEGACY-TAG-A'
    );
    check('fuentePnpid de A quedó en PLANT3D', instrA?.fuentePnpid === 'PLANT3D');
    check('estadoPnidId de A corresponde a NUEVO_EN_PNID (no se colapsa a OK)', Boolean(instrA?.estadoPnidId));

    // Verificar puntualmente el código de estado_pnid vigente tras el primer apply.
    const estadoPnidCatalog = (await call('admin', 'GET', '/api/catalogs/pnid-states')).json?.items ?? [];
    const nuevoEnPnidId = estadoPnidCatalog.find((c: any) => c.codigo === 'NUEVO_EN_PNID')?.id;
    check(
      'estado_pnid de A es literalmente NUEVO_EN_PNID (no OK) inmediatamente después del primer apply',
      instrA?.estadoPnidId === nuevoEnPnidId
    );

    // ===================== EL INSTRUMENTO MANUAL NO SE TOCA (alcance NO_EXISTE_EN_PNID) =====================

    const manualAfterApplyV1 = (await call('admin', 'GET', `${INSTRUMENTS}/${manualInstrumentId}`)).json?.instrument;
    check(
      'Instrumento manual (sin PnPID, fuente_pnpid NULL) sigue sin estado_pnid tras un apply que no lo menciona',
      manualAfterApplyV1?.estadoPnidId === null && manualAfterApplyV1?.pnpid === null,
      manualAfterApplyV1
    );

    // pnpid/fuentePnpid ya no editables por el endpoint normal de instrumentos (POST y PATCH).
    const patchPnpid = await call('editor', 'PATCH', `${INSTRUMENTS}/${instrA.id}`, { pnpid: '999999' });
    check('PATCH normal de instrumento rechaza pnpid (400)', patchPnpid.status === 400, patchPnpid.json);
    const patchFuente = await call('editor', 'PATCH', `${INSTRUMENTS}/${instrA.id}`, { fuentePnpid: 'MANUAL' });
    check('PATCH normal de instrumento rechaza fuentePnpid (400)', patchFuente.status === 400, patchFuente.json);
    const postWithPnpid = await call('editor', 'POST', INSTRUMENTS, { tagInstrumento: `MANUAL-${runId}-1`, pnpid: '1' });
    check('POST normal de instrumento rechaza pnpid (400)', postWithPnpid.status === 400, postWithPnpid.json);
    const postWithFuente = await call('editor', 'POST', INSTRUMENTS, { tagInstrumento: `MANUAL-${runId}-2`, fuentePnpid: 'PLANT3D' });
    check('POST normal de instrumento rechaza fuentePnpid (400)', postWithFuente.status === 400, postWithFuente.json);

    // ===================== PREVIEW V1 DE NUEVO (SIN_CAMBIOS) =====================

    const previewV1Again = await uploadPreview('editor', projectId, bufferV1, 'reporte-v1-otra-vez.xlsx');
    check('Segundo preview del MISMO archivo (201)', previewV1Again.status === 201, previewV1Again.json);
    const importId1b: string = previewV1Again.json?.import?.id;

    check(
      'Reimportar exactamente el mismo archivo: fila A -> SIN_CAMBIOS (OK)',
      findResultado(previewV1Again.json?.resultados ?? [], tagA)?.resultado === 'OK'
    );
    check(
      'El segundo preview avisa que este archivo ya se importó antes (hash)',
      Boolean(previewV1Again.json?.import?.advertencias?.archivoYaImportadoAntes)
    );

    const applyV1Again = await call('editor', 'POST', `${IMPORTS}/${importId1b}/apply`);
    check('Aplicar el reimport sin cambios (200)', applyV1Again.status === 200, applyV1Again.json);

    const instrAAfterNoChange = (await call('admin', 'GET', `${INSTRUMENTS}/${instrA.id}`)).json?.instrument;
    const estadoOkId = estadoPnidCatalog.find((c: any) => c.codigo === 'OK')?.id;
    check(
      'Tras un SIN_CAMBIOS aplicado, estado_pnid de A pasa a OK',
      instrAAfterNoChange?.estadoPnidId === estadoOkId
    );

    // ===================== V2: DATOS_MODIFICADOS =====================

    const rowsV2: Row[] = [
      { ...baseRowA, Descripcion: 'Descripcion CAMBIADA A' },
      { PnPID: pnpidB, Tag: tagB, Listado: false },
      { PnPID: pnpidD1, Tag: tagD, Listado: true, Descripcion: 'Primero con este TAG' },
      // pnpidD2 nuevo, pero reclama el TAG que ya tiene pnpidD1 -> REQUIERE_REVISION
      { PnPID: pnpidD2, Tag: tagD, Listado: true, Descripcion: 'Conflicto de tag' }
    ];

    const bufferV2 = await buildWorkbookBuffer(HEADERS, rowsV2);
    const previewV2 = await uploadPreview('editor', projectId, bufferV2, 'reporte-v2.xlsx');
    check('Preview V2 (201)', previewV2.status === 201, previewV2.json);
    const importId2: string = previewV2.json?.import?.id;

    const resultadosV2: any[] = previewV2.json?.resultados ?? [];

    check(
      'PREVIEW V2: fila A con Descripcion cambiada -> DATOS_MODIFICADOS',
      findResultado(resultadosV2, tagA)?.resultado === 'DATOS_MODIFICADOS',
      findResultado(resultadosV2, tagA)
    );
    check(
      'PREVIEW V2: diferencias incluye el campo descripcion',
      Array.isArray(findResultado(resultadosV2, tagA)?.diferencias) &&
        findResultado(resultadosV2, tagA).diferencias.some((d: any) => d.campo === 'descripcion')
    );
    check(
      'PREVIEW V2: PnPID nuevo D2 reclamando el TAG de D1 -> REQUIERE_REVISION',
      resultadosV2.find((r: any) => r.pnpid === pnpidD2)?.resultado === 'REQUIERE_REVISION',
      resultadosV2.find((r: any) => r.pnpid === pnpidD2)
    );

    const applyV2 = await call('editor', 'POST', `${IMPORTS}/${importId2}/apply`);
    check('Apply V2 (200)', applyV2.status === 200, applyV2.json);

    const instrAAfterV2 = (await call('admin', 'GET', `${INSTRUMENTS}/${instrA.id}`)).json?.instrument;
    check('Descripcion de A quedó actualizada tras DATOS_MODIFICADOS', instrAAfterV2?.descripcion === 'Descripcion CAMBIADA A');
    check('tag_anterior de A sigue igual (no se autogenera nunca)', instrAAfterV2?.tagAnterior === 'LEGACY-TAG-A');

    const instrD2Created = (await call('admin', 'GET', INSTRUMENTS)).json?.instruments?.find((i: any) => i.tagInstrumento === tagD && i.pnpid === pnpidD2);
    check('El conflicto D2 (REQUIERE_REVISION) NUNCA creó un instrumento', !instrD2Created);

    // ===================== V2b: COLUMNA PRESENTE PERO CELDA VACIA -> SI PARTICIPA EN EL DIFF =====================

    const rowsV2b: Row[] = [
      { ...baseRowA, Descripcion: 'Descripcion CAMBIADA A', Sistema: '' } // Sistema: columna presente, celda vacía
    ];
    const bufferV2b = await buildWorkbookBuffer(HEADERS, rowsV2b);
    const previewV2b = await uploadPreview('editor', projectId, bufferV2b, 'reporte-v2b.xlsx');
    const resultadoV2b = findResultado(previewV2b.json?.resultados ?? [], tagA);

    check(
      'Columna "Sistema" presente pero con celda vacía -> SI genera diferencia (DATOS_MODIFICADOS)',
      resultadoV2b?.resultado === 'DATOS_MODIFICADOS' &&
        Array.isArray(resultadoV2b?.diferencias) &&
        resultadoV2b.diferencias.some((d: any) => d.campo === 'sistema' && d.anterior === 'Sistema A' && d.nuevo === null),
      resultadoV2b
    );

    // ===================== V3: TAG_MODIFICADO =====================

    const tagANew = `${tagA}-REV`;
    const rowsV3: Row[] = [
      { ...baseRowA, Tag: tagANew, Descripcion: 'Descripcion CAMBIADA A' },
      { PnPID: pnpidD1, Tag: tagD, Listado: true, Descripcion: 'Primero con este TAG' }
    ];
    const bufferV3 = await buildWorkbookBuffer(HEADERS, rowsV3);
    const previewV3 = await uploadPreview('editor', projectId, bufferV3, 'reporte-v3.xlsx');
    const importId3: string = previewV3.json?.import?.id;

    const resultadosV3: any[] = previewV3.json?.resultados ?? [];

    check(
      'PREVIEW V3: TAG cambiado con mismo PnPID -> TAG_MODIFICADO',
      findResultado(resultadosV3, tagANew)?.resultado === 'TAG_MODIFICADO',
      findResultado(resultadosV3, tagANew)
    );

    const applyV3 = await call('editor', 'POST', `${IMPORTS}/${importId3}/apply`);
    check('Apply V3 (200)', applyV3.status === 200, applyV3.json);

    const instrAAfterV3 = (await call('admin', 'GET', `${INSTRUMENTS}/${instrA.id}`)).json?.instrument;
    check('TAG de A quedó actualizado tras TAG_MODIFICADO', instrAAfterV3?.tagInstrumento === tagANew, instrAAfterV3);
    check('tag_anterior de A SIGUE sin autogenerarse tras TAG_MODIFICADO', instrAAfterV3?.tagAnterior === 'LEGACY-TAG-A');

    // ===================== V4: fila A ausente por completo -> NO_EXISTE_EN_PNID =====================

    const rowsV4: Row[] = [
      { PnPID: pnpidD1, Tag: tagD, Listado: true, Descripcion: 'Primero con este TAG' }
    ];
    const bufferV4 = await buildWorkbookBuffer(HEADERS, rowsV4);
    const previewV4 = await uploadPreview('editor', projectId, bufferV4, 'reporte-v4.xlsx');
    const importId4: string = previewV4.json?.import?.id;

    const resultadosV4: any[] = previewV4.json?.resultados ?? [];
    const noExisteA = resultadosV4.find((r: any) => r.pnpid === pnpidA);
    check(
      'PREVIEW V4: A ya no aparece en el archivo -> NO_EXISTE_EN_PNID, sin fila fuente',
      noExisteA?.resultado === 'NO_EXISTE_EN_PNID' && noExisteA?.filaIndex === null,
      noExisteA
    );
    check(
      'PREVIEW V4: el instrumento manual (sin fuente PLANT3D) NO aparece como NO_EXISTE_EN_PNID',
      !resultadosV4.some((r: any) => r.instrumentoId === manualInstrumentId),
      resultadosV4.filter((r: any) => r.resultado === 'NO_EXISTE_EN_PNID')
    );

    const applyV4 = await call('editor', 'POST', `${IMPORTS}/${importId4}/apply`);
    check('Apply V4 (200)', applyV4.status === 200, applyV4.json);

    const instrAAfterV4 = (await call('admin', 'GET', `${INSTRUMENTS}/${instrA.id}`)).json?.instrument;
    const estadoNoExisteId = estadoPnidCatalog.find((c: any) => c.codigo === 'NO_EXISTE_EN_PNID')?.id;
    check('estado_pnid de A pasó a NO_EXISTE_EN_PNID', instrAAfterV4?.estadoPnidId === estadoNoExisteId);
    check('A sigue ACTIVO (NO_EXISTE_EN_PNID nunca desactiva)', instrAAfterV4?.active === true);

    const manualAfterApplyV4 = (await call('admin', 'GET', `${INSTRUMENTS}/${manualInstrumentId}`)).json?.instrument;
    check(
      'Instrumento manual sigue con estado_pnid NULL tras Apply V4 (nunca entra al alcance NO_EXISTE_EN_PNID)',
      manualAfterApplyV4?.estadoPnidId === null,
      manualAfterApplyV4
    );

    // ===================== CONCURRENCIA: 409 + rollback total =====================

    const rowsV5: Row[] = [
      { ...baseRowA, Tag: tagANew, Descripcion: 'Otra descripcion mas' },
      { PnPID: `NUEVO-CONCURRENCIA-${runId}`, Tag: `TAG-CONCURRENCIA-${runId}`, Listado: true, Descripcion: 'Nuevo en este batch' }
    ];
    const bufferV5 = await buildWorkbookBuffer(HEADERS, rowsV5);
    const previewV5 = await uploadPreview('editor', projectId, bufferV5, 'reporte-v5.xlsx');
    const importId5: string = previewV5.json?.import?.id;

    // Modificar el instrumento A por fuera del import, DESPUES del preview.
    await call('editor', 'PATCH', `${INSTRUMENTS}/${instrA.id}`, { servicio: 'Modificado durante la carrera' });

    const applyV5 = await call('editor', 'POST', `${IMPORTS}/${importId5}/apply`);
    check('Apply con instrumento modificado desde el preview -> 409 stale_pnid_preview', applyV5.status === 409 && applyV5.json?.error === 'stale_pnid_preview', applyV5.json);

    const nuevoConcurrenciaExiste = (await call('admin', 'GET', INSTRUMENTS)).json?.instruments?.find((i: any) => i.tagInstrumento === `TAG-CONCURRENCIA-${runId}`);
    check('El 409 abortó TODO el batch: el instrumento nuevo del mismo apply NO se creó', !nuevoConcurrenciaExiste);

    // ===================== WARNINGS: columna desconocida + columna ausente =====================

    const HEADERS_CON_DESCONOCIDA = [...HEADERS, 'Fabricante'];
    const rowsV6: Row[] = [
      { PnPID: `W1-${runId}`, Tag: `TAG-W1-${runId}`, Listado: true, Fabricante: 'ACME' }
    ];
    const bufferV6 = await buildWorkbookBuffer(HEADERS_CON_DESCONOCIDA, rowsV6);
    const previewV6 = await uploadPreview('editor', projectId, bufferV6, 'reporte-v6.xlsx');
    const importId6: string = previewV6.json?.import?.id;

    check(
      'Columna desconocida "Fabricante" NO bloquea el preview (201) y aparece en unknownColumns',
      previewV6.status === 201 && previewV6.json?.import?.advertencias?.unknownColumns?.includes('Fabricante'),
      previewV6.json?.import?.advertencias
    );

    const applyV6 = await call('editor', 'POST', `${IMPORTS}/${importId6}/apply`);
    check('Columna desconocida tampoco bloquea el APPLY (200)', applyV6.status === 200, applyV6.json);

    const HEADERS_SIN_SERVICIO = HEADERS.filter((h) => h !== 'Servicio');
    const rowsV7: Row[] = [
      // Repite TODOS los valores vigentes de A (tag ya renombrado, descripcion
      // ya cambiada) salvo Servicio, cuya columna se omite del todo — así el
      // único efecto que se está probando es "columna ausente", no un cambio
      // de contenido real en otro campo.
      { ...baseRowA, Tag: tagANew, Descripcion: 'Descripcion CAMBIADA A' }
    ];
    const bufferV7 = await buildWorkbookBuffer(HEADERS_SIN_SERVICIO, rowsV7);
    const previewV7 = await uploadPreview('editor', projectId, bufferV7, 'reporte-v7.xlsx');
    const importId7: string = previewV7.json?.import?.id;

    check(
      'Columna conocida ausente "Servicio" genera warning en missingKnownColumns',
      previewV7.json?.import?.advertencias?.missingKnownColumns?.includes('Servicio'),
      previewV7.json?.import?.advertencias
    );
    check(
      'Con Servicio ausente del archivo, esa columna no participa en la comparación (SIN_CAMBIOS, no DATOS_MODIFICADOS)',
      findResultado(previewV7.json?.resultados ?? [], tagANew)?.resultado === 'OK',
      findResultado(previewV7.json?.resultados ?? [], tagANew)
    );

    // Se relee el valor actual justo antes de aplicar (no se reutiliza un
    // snapshot viejo): el paso de concurrencia (V5) ya cambió `servicio`
    // por fuera del import, así que el valor "antes" real es ESE, no el
    // que tenía en V3.
    const servicioAntesDeV7 = (await call('admin', 'GET', `${INSTRUMENTS}/${instrA.id}`)).json?.instrument?.servicio;
    const applyV7 = await call('editor', 'POST', `${IMPORTS}/${importId7}/apply`);
    check('Apply V7 (200) — con Servicio ausente del archivo', applyV7.status === 200, applyV7.json);

    const instrAAfterV7 = (await call('admin', 'GET', `${INSTRUMENTS}/${instrA.id}`)).json?.instrument;
    check(
      'Tras aplicar un archivo sin la columna Servicio, el valor existente de servicio NO se borró',
      instrAAfterV7?.servicio === servicioAntesDeV7 && instrAAfterV7?.servicio !== null,
      { antes: servicioAntesDeV7, despues: instrAAfterV7?.servicio }
    );

    // ===================== ARCHIVO INVALIDO =====================

    const bufferInvalido = await buildWorkbookBuffer(['Tag', 'Listado'], [{ Tag: 'X', Listado: true }]);
    const previewInvalido = await uploadPreview('editor', projectId, bufferInvalido, 'invalido.xlsx');
    check(
      'Archivo sin columna PnPID -> 422 invalid_file_structure',
      previewInvalido.status === 422 && previewInvalido.json?.error === 'invalid_file_structure',
      previewInvalido.json
    );

    // ===================== DESCARTAR =====================

    const bufferDescartar = await buildWorkbookBuffer(HEADERS, [
      { PnPID: `DESCARTAR-${runId}`, Tag: `TAG-DESCARTAR-${runId}`, Listado: true }
    ]);
    const previewDescartar = await uploadPreview('editor', projectId, bufferDescartar, 'descartar.xlsx');
    const importIdDescartar: string = previewDescartar.json?.import?.id;

    const discard = await call('editor', 'DELETE', `${IMPORTS}/${importIdDescartar}`);
    check('DELETE descarta un import PREVISUALIZADO (200)', discard.status === 200 && discard.json?.import?.estado === 'DESCARTADO', discard.json);

    const applyAfterDiscard = await call('editor', 'POST', `${IMPORTS}/${importIdDescartar}/apply`);
    check('No se puede aplicar un import DESCARTADO (409)', applyAfterDiscard.status === 409, applyAfterDiscard.json);

    // ===================== LISTAR / DETALLE =====================

    const listImports = await call('viewer', 'GET', IMPORTS);
    check('VIEWER puede listar imports (200)', listImports.status === 200 && Array.isArray(listImports.json?.imports));

    const detailImport = await call('viewer', 'GET', `${IMPORTS}/${importId1}`);
    check('VIEWER puede ver el detalle de un import (200)', detailImport.status === 200 && Array.isArray(detailImport.json?.resultados));

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/pnid-imports');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status));

    // ===================== TIPO DE SENAL NUNCA CREA SEÑALES =====================

    check(
      'Ninguna de las importaciones de la Fase A creó una fila en nucleo.senal (a pesar de "Tipo de Senal" en el archivo)',
      (await call('admin', 'GET', SIGNALS)).json?.signals?.length === 0
    );

    // ===================== CIERRE FASE A: archivar el proyecto temporal =====================

    const archiveA = await call('admin', 'DELETE', `/api/projects/${tempProjectIdA}`);
    check('Fase A: proyecto temporal archivado al finalizar (no queda nada en TEST-001)', archiveA.status === 200, archiveA.json);
    tempProjectIdA = undefined; // ya se archivó, no reintentar en el finally

    // ===================== FASE B: ARCHIVO REAL, PROYECTO NUEVO =====================

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const realFilePath = path.resolve(__dirname, '../../reference_excel/162281-620-Instrument List.xlsx');

    const originalStatBefore = await readFile(realFilePath).catch(() => null);

    let realFileBuffer: Buffer | null = null;
    try {
      realFileBuffer = await readFile(realFilePath);
    } catch {
      console.warn(`No se encontró el reporte real en ${realFilePath} — se omite la Fase B.`);
    }

    if (realFileBuffer) {
      const realWorkbook = new ExcelJS.Workbook();
      // El reporte real de Plant 3D declara el namespace principal de OOXML
      // con un prefijo explícito ("x:") en vez de dejarlo default — la misma
      // normalización que usa el parser de producción hace falta acá para
      // poder siquiera abrirlo con exceljs (ver parseExcel.ts).
      const normalizedRealBuffer = await normalizeNamespacedXlsx(realFileBuffer);
      await realWorkbook.xlsx.load(normalizedRealBuffer as unknown as ExcelJS.Buffer);
      const sheet = realWorkbook.worksheets.find((ws) => ws.name === 'Instrument List') ?? realWorkbook.worksheets[0];

      const headerRow = sheet.getRow(1);
      let hadTagWsp = false;
      let renamed = false;
      headerRow.eachCell((cell) => {
        const value = String(cell.value).trim();
        if (value === 'Tag WSP') {
          hadTagWsp = true;
          cell.value = 'Tag Anterior';
          renamed = true;
        }
        if (value === 'Tag Anterior') {
          // Ya viene con el nombre nuevo en el archivo de origen -> nada que renombrar,
          // pero igual es el contrato objetivo probado.
          renamed = true;
        }
      });
      check(
        'Copia EN MEMORIA del reporte real: encabezado "Tag WSP" reemplazado por "Tag Anterior" (contrato objetivo, no el legacy)',
        renamed,
        { hadTagWsp }
      );

      // El archivo original en disco NUNCA se toca -- se compara el contenido
      // crudo leído antes de cualquier manipulación en memoria contra una
      // relectura posterior.
      const originalStatAfter = await readFile(realFilePath).catch(() => null);
      check(
        'El archivo original en reference_excel/ quedó exactamente igual (no se escribió nada en disco)',
        Boolean(originalStatBefore) && Boolean(originalStatAfter) && Buffer.compare(originalStatBefore!, originalStatAfter!) === 0
      );

      const totalDataRows = sheet.rowCount - 1;
      const listadoTrueCount = (() => {
        let count = 0;
        const idx = (() => {
          let i = -1;
          headerRow.eachCell((cell, col) => { if (String(cell.value).trim() === 'Listado') i = col; });
          return i;
        })();
        for (let r = 2; r <= sheet.rowCount; r++) {
          const v = String(sheet.getRow(r).getCell(idx).value ?? '').trim().toLowerCase();
          if (v === 'true') count++;
        }
        return count;
      })();

      check(`Reporte real: ${totalDataRows} filas de datos (se esperaban ~480)`, totalDataRows > 400 && totalDataRows < 520);
      check(`Reporte real: ${listadoTrueCount} filas con Listado=True (se esperaban ~352)`, listadoTrueCount > 300 && listadoTrueCount < 400);

      const renamedBuffer = Buffer.from(await realWorkbook.xlsx.writeBuffer());

      tempProjectIdB = await createTempProject(runId, 'B', 'Proyecto temporal — import P&ID real (Tag Anterior)');

      if (tempProjectIdB) {
        const REAL_IMPORTS = `/api/projects/${tempProjectIdB}/pnid-imports`;
        const REAL_INSTRUMENTS = `/api/projects/${tempProjectIdB}/instruments`;

        const firstPreview = await uploadPreview('admin', tempProjectIdB, renamedBuffer, 'plant3d-real-tag-anterior.xlsx');
        check(
          'Fase B: primer preview del reporte real CON "Tag Anterior" (201) — contrato objetivo probado, no solo el legacy',
          firstPreview.status === 201,
          firstPreview.json
        );
        const firstImportId: string = firstPreview.json?.import?.id;

        // Confirma que el dato de Tag Anterior efectivamente se leyó de la columna renombrada.
        const anyRowWithTagAnterior = firstPreview.json?.resultados?.some((r: any) => r.resultado === 'NUEVO_EN_PNID');
        check('Fase B: el preview procesó filas con la columna "Tag Anterior" sin errores', Boolean(anyRowWithTagAnterior));

        check(
          `Fase B: ~${listadoTrueCount} filas Listado=True producen NUEVO_EN_PNID en un proyecto vacío`,
          firstPreview.json?.import?.conteos?.nuevos === listadoTrueCount - (firstPreview.json?.import?.conteos?.requiereRevision ?? 0),
          firstPreview.json?.import?.conteos
        );

        const firstApply = await call('admin', 'POST', `${REAL_IMPORTS}/${firstImportId}/apply`);
        check('Fase B: apply del primer import real (200)', firstApply.status === 200, firstApply.json);

        const instrumentsAfterFirstApply = (await call('admin', 'GET', REAL_INSTRUMENTS)).json?.instruments ?? [];
        check(
          `Fase B: ~${listadoTrueCount} instrumentos activos tras el primer apply`,
          Math.abs(instrumentsAfterFirstApply.length - firstPreview.json?.import?.conteos?.nuevos) <= 1,
          instrumentsAfterFirstApply.length
        );

        const instrumentWithTagAnterior = instrumentsAfterFirstApply.find((i: any) => Boolean(i.tagAnterior));
        check(
          'Fase B: al menos un instrumento quedó con tag_anterior poblado desde la columna "Tag Anterior"',
          Boolean(instrumentWithTagAnterior),
          instrumentWithTagAnterior
        );

        const secondPreview = await uploadPreview('admin', tempProjectIdB, renamedBuffer, 'plant3d-real-otra-vez.xlsx');
        check(
          'Fase B: reimportar el mismo archivo (con Tag Anterior) -> 0 nuevos, todos SIN_CAMBIOS',
          secondPreview.json?.import?.conteos?.nuevos === 0 &&
            secondPreview.json?.import?.conteos?.sinCambios === firstPreview.json?.import?.conteos?.nuevos,
          secondPreview.json?.import?.conteos
        );

        // Limpieza: archivar el proyecto temporal (no borra su información de ingeniería, por diseño).
        const archiveB = await call('admin', 'DELETE', `/api/projects/${tempProjectIdB}`);
        check('Fase B: proyecto temporal archivado al finalizar', archiveB.status === 200, archiveB.json);
        tempProjectIdB = undefined; // ya se archivó, no reintentar en el finally
      }
    }

  } finally {
    if (tempProjectIdA) {
      await call('admin', 'DELETE', `/api/projects/${tempProjectIdA}`).catch(() => null);
    }
    if (tempProjectIdB) {
      await call('admin', 'DELETE', `/api/projects/${tempProjectIdB}`).catch(() => null);
    }

    if (serverProcess && serverProcess.pid) {
      try {
        process.kill(-serverProcess.pid, 'SIGTERM');
      } catch {
        // ya estaba muerto
      }
    }
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) {
    console.log('Fallas:', failures.join(', '));
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR FATAL', err);
  process.exit(1);
});
