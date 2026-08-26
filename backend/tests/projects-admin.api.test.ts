/*
 * Pruebas de API para administración de Clientes y Proyectos.
 *
 * Mismo patrón que el resto: autocontenida, IDs únicos por corrida,
 * limpieza total en `finally`. Como cliente/proyecto no tienen ningún
 * endpoint de desactivación bloqueado por uso, la limpieza es directa.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV.
 *
 * Uso: npm run test:projects-admin   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

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
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, {
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


async function main(): Promise<void> {
  let serverProcess: ChildProcess | null = null;

  const createdProjectIds: string[] = [];
  const createdClientIds: string[] = [];

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
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ===================== CLIENTES =====================
    const viewerListClients = await call('viewer', 'GET', '/api/clients');
    check('VIEWER puede leer /api/clients (200)', viewerListClients.status === 200, viewerListClients.json);

    const editorCreateClient = await call('editor', 'POST', '/api/clients', { nombre: `Cliente EDITOR ${runId}` });
    check('EDITOR no puede crear cliente (403, no es admin de sistema)', editorCreateClient.status === 403, editorCreateClient.json);

    const clientCode = `CLI-${runId}`;
    const createClient = await call('admin', 'POST', '/api/clients', { nombre: `Cliente de prueba ${runId}`, codigoInterno: clientCode });
    check('ADMIN (es_admin_sistema) crea cliente (201)', createClient.status === 201, createClient.json);
    const clientId: string = createClient.json?.client?.id;
    if (clientId) createdClientIds.push(clientId);

    const dupClientCode = await call('admin', 'POST', '/api/clients', { nombre: 'Otro nombre', codigoInterno: clientCode });
    check('ADMIN: codigoInterno duplicado -> 409', dupClientCode.status === 409 && dupClientCode.json?.error === 'client_code_conflict', dupClientCode.json);

    const patchClient = await call('admin', 'PATCH', `/api/clients/${clientId}`, { nombre: `Cliente renombrado ${runId}` });
    check('ADMIN renombra cliente (200)', patchClient.status === 200 && patchClient.json?.client?.nombre === `Cliente renombrado ${runId}`, patchClient.json);

    // ===================== PROYECTOS: crear =====================
    const viewerCreateProject = await call('viewer', 'POST', '/api/projects', { clientId, code: `PRJ-DENIED-${runId}`, name: 'x' });
    check('VIEWER no puede crear proyecto (403)', viewerCreateProject.status === 403, viewerCreateProject.json);

    const editorCreateProject = await call('editor', 'POST', '/api/projects', { clientId, code: `PRJ-DENIED-${runId}`, name: 'x' });
    check('EDITOR no puede crear proyecto (403, no es admin de sistema)', editorCreateProject.status === 403, editorCreateProject.json);

    const projectCode = `PRJ-${runId}`;
    const createProject = await call('admin', 'POST', '/api/projects', { clientId, code: projectCode, name: `Proyecto de prueba ${runId}` });
    check('ADMIN crea proyecto (201)', createProject.status === 201 && createProject.json?.project?.code === projectCode, createProject.json);
    const projectId: string = createProject.json?.project?.id;
    if (projectId) createdProjectIds.push(projectId);

    const dupProjectCode = await call('admin', 'POST', '/api/projects', { clientId, code: projectCode, name: 'Otro nombre' });
    check('ADMIN: código de proyecto duplicado para el mismo cliente -> 409', dupProjectCode.status === 409 && dupProjectCode.json?.error === 'project_code_conflict', dupProjectCode.json);

    const badClientRef = await call('admin', 'POST', '/api/projects', { clientId: '999999999', code: `PRJ-BAD-${runId}`, name: 'x' });
    check('ADMIN: clientId inexistente -> 400 invalid_reference', badClientRef.status === 400 && badClientRef.json?.error === 'invalid_reference', badClientRef.json);

    // Un es_admin_sistema tiene acceso ADMIN implícito al proyecto recién creado,
    // sin necesitar ninguna asignación explícita en usuario_proyecto_rol.
    const adminGetNewProject = await call('admin', 'GET', `/api/projects/${projectId}`);
    check(
      'ADMIN global tiene acceso ADMIN implícito al proyecto recién creado',
      adminGetNewProject.status === 200 && adminGetNewProject.json?.project?.access?.role === 'ADMIN',
      adminGetNewProject.json
    );

    // Un EDITOR sin asignación a este proyecto nuevo no tiene acceso.
    const editorNoAccessYet = await call('editor', 'GET', `/api/projects/${projectId}`);
    check('EDITOR sin asignación no tiene acceso al proyecto nuevo (403)', editorNoAccessYet.status === 403, editorNoAccessYet.json);

    // ===================== PROYECTOS: editar =====================
    // ADMIN (es_admin_sistema) tiene permiso 'administer' implícito sobre
    // cualquier proyecto activo.
    const patchProject = await call('admin', 'PATCH', `/api/projects/${projectId}`, { name: 'Proyecto renombrado' });
    check('ADMIN renombra el proyecto (200)', patchProject.status === 200 && patchProject.json?.project?.name === 'Proyecto renombrado', patchProject.json);

    // TEST-001 no le pertenece a EDITOR con permiso administer (rol EDITOR no
    // tiene puede_administrar) -> 403 aunque tenga acceso de lectura/escritura.
    const editorPatchTest001 = await call('editor', 'PATCH', '/api/projects/1', { name: 'hack' });
    check('EDITOR no puede administrar TEST-001 (403, rol EDITOR no administra)', editorPatchTest001.status === 403, editorPatchTest001.json);

    const emptyPatch = await call('admin', 'PATCH', `/api/projects/${projectId}`, {});
    check('PATCH sin campos editables -> 400', emptyPatch.status === 400, emptyPatch.json);

    // ===================== PROYECTOS: archivar =====================
    const editorDeleteProject = await call('editor', 'DELETE', `/api/projects/${projectId}`);
    check('EDITOR no puede archivar proyecto (403)', editorDeleteProject.status === 403, editorDeleteProject.json);

    const archiveProject = await call('admin', 'DELETE', `/api/projects/${projectId}`);
    check('ADMIN archiva el proyecto (200)', archiveProject.status === 200 && archiveProject.json?.project?.active === false, archiveProject.json);

    // Un proyecto archivado desaparece de seguridad.vw_acceso_proyecto para
    // TODOS, incluido es_admin_sistema (CLAUDE.md: "nobody sees it through
    // vw_acceso_proyecto") — requireProjectPermission da 403, no 404,
    // porque ni siquiera puede resolver que el usuario tenga acceso de
    // lectura a ese proyecto en particular.
    const getArchived = await call('admin', 'GET', `/api/projects/${projectId}`);
    check('Proyecto archivado ya no es accesible vía requireProjectPermission (403)', getArchived.status === 403, getArchived.json);

    const listAfterArchive = await call('admin', 'GET', '/api/projects');
    const stillListed = listAfterArchive.json?.projects?.some((p: any) => p.id === projectId);
    check('Proyecto archivado ausente de GET /api/projects', listAfterArchive.status === 200 && !stillListed, listAfterArchive.json);

    // ===================== LIMPIEZA DE CLIENTE =====================
    const viewerDeleteClient = await call('viewer', 'DELETE', `/api/clients/${clientId}`);
    check('VIEWER no puede desactivar cliente (403)', viewerDeleteClient.status === 403, viewerDeleteClient.json);

    const deleteClient = await call('admin', 'DELETE', `/api/clients/${clientId}`);
    check('ADMIN desactiva el cliente (200)', deleteClient.status === 200, deleteClient.json);
    createdClientIds.length = 0; // ya desactivado

    const getDeletedClient = await call('admin', 'GET', `/api/clients/${clientId}`);
    check('Cliente desactivado ya no aparece en GET (404)', getDeletedClient.status === 404, getDeletedClient.json);

  } finally {
    // Un proyecto ya archivado no es re-alcanzable (403, ver arriba) — eso
    // también cuenta como "ya no queda activo" para efectos de limpieza.
    for (const id of createdProjectIds) {
      const r = await call('admin', 'DELETE', `/api/projects/${id}`).catch(() => null);
      if (!r || ![200, 403, 404].includes(r.status)) console.warn(`No se pudo limpiar project ${id} (status ${r?.status})`);
    }
    for (const id of createdClientIds) {
      const r = await call('admin', 'DELETE', `/api/clients/${id}`).catch(() => null);
      if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar client ${id} (status ${r?.status})`);
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
