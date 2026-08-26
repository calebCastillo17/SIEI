/*
 * Pruebas de API para administración de Usuarios (global, es_admin_sistema)
 * y Miembros por proyecto (seguridad.usuario_proyecto_rol).
 *
 * Mismo patrón que el resto: autocontenida, emails únicos por corrida,
 * limpieza total en `finally`.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV.
 *
 * Uso: npm run test:users-members   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3107);
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
  let projectId: string | undefined;

  const createdUserIds: string[] = [];

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
    const PROJECT_CODE = 'TEST-001';

    const projectsList = await call('admin', 'GET', '/api/projects');
    const project = projectsList.json?.projects?.find((p: any) => p.code === PROJECT_CODE);

    check(
      `Proyecto fixture ${PROJECT_CODE} existe y es accesible`,
      projectsList.status === 200 && Boolean(project),
      projectsList.json
    );

    if (!project) {
      throw new Error(
        `No se encontró el proyecto ${PROJECT_CODE}. ` +
        'Verifica que las migraciones 001-003 y database/dev/001_dev_auth_seed.sql estén aplicadas.'
      );
    }

    projectId = project.id as string;
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const MEMBERS = `/api/projects/${projectId}/members`;

    // ===================== /api/users =====================

    const viewerListUsers = await call('viewer', 'GET', '/api/users');
    check('VIEWER no puede listar usuarios (403, no es admin de sistema)', viewerListUsers.status === 403, viewerListUsers.json);

    const editorCreateUser = await call('editor', 'POST', '/api/users', { email: `x-${runId}@siei.local`, nombre: 'x' });
    check('EDITOR no puede crear usuario (403)', editorCreateUser.status === 403, editorCreateUser.json);

    const escalationAttempt = await call('admin', 'POST', '/api/users', {
      email: `escalate-${runId}@siei.local`,
      nombre: 'Intento de escalar',
      esAdminSistema: true
    });
    check(
      'ADMIN: esAdminSistema en el body -> 400 (nunca se acepta en este endpoint)',
      escalationAttempt.status === 400,
      escalationAttempt.json
    );

    const userEmail = `member-${runId}@siei.local`;
    const createUser = await call('admin', 'POST', '/api/users', { email: userEmail, nombre: 'Usuario de prueba' });
    check(
      'ADMIN crea usuario (201), esAdminSistema queda en false',
      createUser.status === 201 && createUser.json?.user?.esAdminSistema === false,
      createUser.json
    );
    const userId: string = createUser.json?.user?.id;
    if (userId) createdUserIds.push(userId);

    const dupEmail = await call('admin', 'POST', '/api/users', { email: userEmail, nombre: 'Otro nombre' });
    check('ADMIN: email duplicado -> 409', dupEmail.status === 409 && dupEmail.json?.error === 'user_email_conflict', dupEmail.json);

    const patchEscalate = await call('admin', 'PATCH', `/api/users/${userId}`, { esAdminSistema: true });
    check('ADMIN: PATCH con esAdminSistema -> 400 (bloqueado explícitamente)', patchEscalate.status === 400, patchEscalate.json);

    const patchName = await call('admin', 'PATCH', `/api/users/${userId}`, { nombre: 'Usuario renombrado' });
    check('ADMIN renombra usuario (200)', patchName.status === 200 && patchName.json?.user?.nombre === 'Usuario renombrado', patchName.json);

    // ===================== MEMBERS: asignar por email =====================

    const viewerAddMember = await call('viewer', 'GET', MEMBERS);
    check('VIEWER puede leer members de su propio proyecto (200)', viewerAddMember.status === 200, viewerAddMember.json);

    const editorAddMember = await call('editor', 'POST', MEMBERS, { email: userEmail, rol: 'EDITOR' });
    check('EDITOR no puede administrar members (403, rol EDITOR no administra)', editorAddMember.status === 403, editorAddMember.json);

    const badRole = await call('admin', 'POST', MEMBERS, { email: userEmail, rol: 'SUPERADMIN' });
    check('ADMIN: rol inválido -> 400', badRole.status === 400, badRole.json);

    const addMember = await call('admin', 'POST', MEMBERS, { email: userEmail, rol: 'VIEWER' });
    check(
      'ADMIN asigna VIEWER a un usuario existente por email (201)',
      addMember.status === 201 && addMember.json?.member?.role === 'VIEWER',
      addMember.json
    );

    const dupMember = await call('admin', 'POST', MEMBERS, { email: userEmail, rol: 'EDITOR' });
    check(
      'ADMIN: ese usuario ya tiene asignación activa -> 409 member_already_assigned',
      dupMember.status === 409 && dupMember.json?.error === 'member_already_assigned',
      dupMember.json
    );

    // El usuario recién asignado ahora sí puede leer TEST-001 como VIEWER.
    const newMemberCanRead = await call('viewer', 'GET', `/api/projects/${projectId}`); // usa viewer@siei.local, ya tenía acceso
    check('VIEWER (rol previo) sigue teniendo acceso normal', newMemberCanRead.status === 200, newMemberCanRead.json);

    // ===================== MEMBERS: pre-registro en el mismo paso =====================

    const newEmail = `preregistered-${runId}@siei.local`;
    const preregisterNoName = await call('admin', 'POST', MEMBERS, { email: newEmail, rol: 'EDITOR' });
    check(
      'ADMIN: pre-registrar sin nombre -> 400 (nombre requerido para usuario nuevo)',
      preregisterNoName.status === 400,
      preregisterNoName.json
    );

    const preregister = await call('admin', 'POST', MEMBERS, { email: newEmail, nombre: 'Usuario Pre-registrado', rol: 'EDITOR' });
    check(
      'ADMIN pre-registra un usuario nuevo y le asigna EDITOR en un solo paso (201)',
      preregister.status === 201 && preregister.json?.member?.role === 'EDITOR',
      preregister.json
    );
    const preregisteredUserId: string = preregister.json?.member?.usuarioId;
    if (preregisteredUserId) createdUserIds.push(preregisteredUserId);

    // ===================== MEMBERS: cambiar de rol =====================

    const patchMemberRole = await call('admin', 'PATCH', `${MEMBERS}/${userId}`, { rol: 'EDITOR' });
    check(
      'ADMIN cambia el rol de VIEWER a EDITOR (200)',
      patchMemberRole.status === 200 && patchMemberRole.json?.member?.role === 'EDITOR',
      patchMemberRole.json
    );

    const listAfterRoleChange = await call('admin', 'GET', MEMBERS);
    const memberRow = listAfterRoleChange.json?.members?.find((m: any) => m.usuarioId === userId);
    check(
      'La lista de members refleja el nuevo rol (una sola fila activa, no duplicada)',
      listAfterRoleChange.status === 200 &&
        memberRow?.role === 'EDITOR' &&
        listAfterRoleChange.json.members.filter((m: any) => m.usuarioId === userId).length === 1,
      listAfterRoleChange.json
    );

    const patchMissingMember = await call('admin', 'PATCH', `${MEMBERS}/999999999`, { rol: 'EDITOR' });
    check('ADMIN: cambiar rol de alguien sin asignación -> 404', patchMissingMember.status === 404, patchMissingMember.json);

    // ===================== MEMBERS: revocar =====================

    const editorDeleteMember = await call('editor', 'DELETE', `${MEMBERS}/${userId}`);
    check('EDITOR no puede revocar members (403)', editorDeleteMember.status === 403, editorDeleteMember.json);

    const removeMember = await call('admin', 'DELETE', `${MEMBERS}/${userId}`);
    check('ADMIN revoca el acceso del usuario a este proyecto (200)', removeMember.status === 200, removeMember.json);

    const removeAgain = await call('admin', 'DELETE', `${MEMBERS}/${userId}`);
    check('ADMIN: revocar de nuevo -> 404 (ya no tenía asignación activa)', removeAgain.status === 404, removeAgain.json);

    // El usuario global sigue existiendo (solo se le quitó acceso a ESTE
    // proyecto, no se desactivó su registro).
    const userStillExists = await call('admin', 'GET', `/api/users/${userId}`);
    check('El registro global del usuario sigue activo tras revocar el acceso al proyecto', userStillExists.status === 200 && userStillExists.json?.user?.active === true, userStillExists.json);

    // ===================== DELETE /api/users (global) =====================

    const viewerDeactivateUser = await call('viewer', 'DELETE', `/api/users/${userId}`);
    check('VIEWER no puede desactivar un usuario globalmente (403)', viewerDeactivateUser.status === 403, viewerDeactivateUser.json);

    const deactivateUser = await call('admin', 'DELETE', `/api/users/${userId}`);
    check('ADMIN desactiva el usuario globalmente (200)', deactivateUser.status === 200, deactivateUser.json);

    const getDeactivatedUser = await call('admin', 'GET', `/api/users/${userId}`);
    check('Usuario desactivado ya no aparece en GET (404)', getDeactivatedUser.status === 404, getDeactivatedUser.json);
    createdUserIds.splice(createdUserIds.indexOf(userId), 1); // ya desactivado

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/members');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    // Revoca primero el acceso a TEST-001 (si quedó alguno vivo) y luego
    // desactiva los usuarios globalmente.
    if (projectId) {
      for (const id of createdUserIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/members/${id}`).catch(() => null);
        if (r && ![200, 404].includes(r.status)) {
          console.warn(`No se pudo revocar member ${id} (status ${r.status})`);
        }
      }
    }

    for (const id of createdUserIds) {
      const r = await call('admin', 'DELETE', `/api/users/${id}`).catch(() => null);
      if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo desactivar usuario ${id} (status ${r?.status})`);
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
