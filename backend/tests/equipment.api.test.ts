/*
 * Pruebas de API para el módulo de Equipos (nucleo.equipo).
 *
 * Mismo patrón que backend/tests/signals.api.test.ts: prueba de integración
 * HTTP real contra los 3 usuarios DEV (ADMIN / EDITOR / VIEWER), autocontenida
 * (levanta su propio backend si no hay uno corriendo, en un puerto propio) y
 * sin dejar datos residuales — todo lo que crea se desactiva en un `finally`.
 *
 * Incluye además una prueba de integración con Señales: un EQUIPO (a
 * diferencia de un INSTRUMENTO) es el otro lado válido de la XOR
 * instrumento/equipo de nucleo.senal (CK_senal_origen_xor) — se crea una
 * señal COM con equipoId como dueño para probar ese camino, que la suite de
 * Señales no podía cubrir todavía porque no existía ningún equipo activo.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV
 * (migraciones 001-003 + database/dev/001_dev_auth_seed.sql aplicados).
 *
 * Uso: npm run test:equipment   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3101);
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
  const createdEquipmentIds: string[] = [];
  const createdSignalIds: string[] = [];
  let projectId: string | undefined;

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
    const project = projectsList.json?.projects?.find(
      (p: any) => p.code === PROJECT_CODE
    );

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
    const EQUIPMENT = `/api/projects/${projectId}/equipment`;
    const SIGNALS = `/api/projects/${projectId}/signals`;

    const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ===================== VIEWER =====================
    const viewerList = await call('viewer', 'GET', EQUIPMENT);
    check('VIEWER puede listar equipos (200)', viewerList.status === 200, viewerList.json);

    const viewerCreate = await call('viewer', 'POST', EQUIPMENT, {
      tagEquipo: `VIEWER-DENIED-${runId}`
    });
    check('VIEWER no puede crear equipo (403)', viewerCreate.status === 403, viewerCreate.json);

    // ===================== EDITOR =====================

    const editorMissingTag = await call('editor', 'POST', EQUIPMENT, {
      descripcion: 'sin tag'
    });
    check('EDITOR: crear sin tagEquipo -> 400', editorMissingTag.status === 400, editorMissingTag.json);

    const tagEquipo = `PNL-${runId}`;
    const editorCreate = await call('editor', 'POST', EQUIPMENT, {
      tagEquipo,
      descripcion: 'Panel de prueba',
      sistema: 'ELECTRICO',
      nodo: 'N1',
      panel: 'P-01'
    });
    check(
      'EDITOR crea equipo válido (201)',
      editorCreate.status === 201 && editorCreate.json?.equipment?.tagEquipo === tagEquipo,
      editorCreate.json
    );
    const equipmentId: string | undefined = editorCreate.json?.equipment?.id;
    if (equipmentId) createdEquipmentIds.push(equipmentId);

    const dupTag = await call('editor', 'POST', EQUIPMENT, { tagEquipo });
    check(
      'EDITOR: TAG duplicado -> 409 equipment_tag_conflict',
      dupTag.status === 409 && dupTag.json?.error === 'equipment_tag_conflict',
      dupTag.json
    );

    const tooLong = await call('editor', 'POST', EQUIPMENT, {
      tagEquipo: 'X'.repeat(51)
    });
    check('EDITOR: tagEquipo > 50 caracteres -> 400', tooLong.status === 400, tooLong.json);

    const patchOk = await call('editor', 'PATCH', `${EQUIPMENT}/${equipmentId}`, {
      descripcion: 'Panel de prueba actualizado'
    });
    check(
      'EDITOR actualiza descripcion (200)',
      patchOk.status === 200 && patchOk.json?.equipment?.descripcion === 'Panel de prueba actualizado',
      patchOk.json
    );

    const patchEmptyTag = await call('editor', 'PATCH', `${EQUIPMENT}/${equipmentId}`, {
      tagEquipo: '   '
    });
    check('EDITOR: PATCH con tagEquipo vacío -> 400', patchEmptyTag.status === 400, patchEmptyTag.json);

    const editorDelete = await call('editor', 'DELETE', `${EQUIPMENT}/${equipmentId}`);
    check('EDITOR no puede desactivar (403)', editorDelete.status === 403, editorDelete.json);

    // ===================== VIEWER (lectura) =====================
    const viewerGetOne = await call('viewer', 'GET', `${EQUIPMENT}/${equipmentId}`);
    check('VIEWER puede leer equipo individual (200)', viewerGetOne.status === 200, viewerGetOne.json);

    const viewerPatch = await call('viewer', 'PATCH', `${EQUIPMENT}/${equipmentId}`, { panel: 'hack' });
    check('VIEWER no puede editar (403)', viewerPatch.status === 403, viewerPatch.json);

    const getInvalidId = await call('viewer', 'GET', `${EQUIPMENT}/not-a-number`);
    check('GET con id inválido -> 400', getInvalidId.status === 400, getInvalidId.json);

    const getMissing = await call('viewer', 'GET', `${EQUIPMENT}/999999999`);
    check('GET equipo inexistente -> 404', getMissing.status === 404, getMissing.json);

    // ===================== Integración con Señales =====================
    // Un EQUIPO es el otro lado válido de CK_senal_origen_xor (instrumento
    // XOR equipo). Se prueba una señal COM con equipoId como dueño.
    const comTag = `COM-EQ-${runId}`;
    const comWithEquipo = await call('editor', 'POST', SIGNALS, {
      tagSenal: comTag,
      claseSenalId: '2', // COM
      equipoId: equipmentId,
      direccionComId: '2' // OUT
    });
    check(
      'EDITOR crea señal COM con equipoId como dueño (201)',
      comWithEquipo.status === 201 &&
        comWithEquipo.json?.signal?.equipoId === equipmentId &&
        comWithEquipo.json?.signal?.instrumentoId === null,
      comWithEquipo.json
    );
    const comWithEquipoId: string | undefined = comWithEquipo.json?.signal?.id;
    if (comWithEquipoId) createdSignalIds.push(comWithEquipoId);

    // instrumentoId y equipoId a la vez -> rechazado antes de llegar a la base
    const bothOwners = await call('editor', 'POST', SIGNALS, {
      tagSenal: `BAD-BOTH-OWNERS-${runId}`,
      claseSenalId: '2',
      equipoId: equipmentId,
      instrumentoId: '1',
      direccionComId: '1'
    });
    check('EDITOR: instrumentoId + equipoId juntos -> 400', bothOwners.status === 400, bothOwners.json);

    // ===================== ADMIN =====================
    const adminDelete = await call('admin', 'DELETE', `${EQUIPMENT}/${equipmentId}`);
    check(
      'ADMIN desactiva equipo (200)',
      adminDelete.status === 200 && adminDelete.json?.equipment?.active === false,
      adminDelete.json
    );

    const getDeactivated = await call('admin', 'GET', `${EQUIPMENT}/${equipmentId}`);
    check('Equipo desactivado ya no aparece en GET (404)', getDeactivated.status === 404, getDeactivated.json);

    const listAfter = await call('viewer', 'GET', EQUIPMENT);
    const stillListed = listAfter.json?.equipment?.some((e: any) => e.id === equipmentId);
    check(
      'Equipo desactivado ausente del listado',
      listAfter.status === 200 && !stillListed,
      listAfter.json
    );

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/equipment');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    // Limpieza: pase o falle la corrida, TEST-001 no debe quedar con
    // residuos. Se desactiva primero la señal (dependiente del equipo vía
    // FK_senal_equipo) y despues el equipo.
    if (projectId) {
      for (const id of createdSignalIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/signals/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) {
          console.warn(`No se pudo limpiar la señal ${id} (status ${r?.status})`);
        }
      }

      for (const id of createdEquipmentIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/equipment/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) {
          console.warn(`No se pudo limpiar el equipo ${id} (status ${r?.status})`);
        }
      }
    } else if (createdEquipmentIds.length || createdSignalIds.length) {
      console.warn('projectId no resuelto: no se pudo limpiar fixtures creados.');
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
