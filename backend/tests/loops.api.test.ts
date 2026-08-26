/*
 * Pruebas de API para Lazo (nucleo.lazo).
 *
 * Mismo patrón que el resto: autocontenida, TAGs/IDs únicos por corrida,
 * limpieza total en `finally`.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV.
 *
 * Uso: npm run test:loops   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3105);
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

  const createdLoopIds: string[] = [];
  const createdInstrumentIds: string[] = [];

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

    const LOOPS = `/api/projects/${projectId}/loops`;
    const INSTRUMENTS = `/api/projects/${projectId}/instruments`;

    // --- Fixture: dos instrumentos activos ---
    const instrTag1 = `LOOP-TEST-1-${runId}`;
    const createInstr1 = await call('admin', 'POST', INSTRUMENTS, { tagInstrumento: instrTag1 });
    check('ADMIN crea instrumento fixture 1', createInstr1.status === 201, createInstr1.json);
    const instrumentoId1: string = createInstr1.json?.instrument?.id;
    if (instrumentoId1) createdInstrumentIds.push(instrumentoId1);

    const instrTag2 = `LOOP-TEST-2-${runId}`;
    const createInstr2 = await call('admin', 'POST', INSTRUMENTS, { tagInstrumento: instrTag2 });
    const instrumentoId2: string = createInstr2.json?.instrument?.id;
    if (instrumentoId2) createdInstrumentIds.push(instrumentoId2);

    // ===================== VIEWER =====================
    const viewerList = await call('viewer', 'GET', LOOPS);
    check('VIEWER puede listar lazos (200)', viewerList.status === 200, viewerList.json);

    const viewerCreate = await call('viewer', 'POST', LOOPS, { instrumentoId: instrumentoId1 });
    check('VIEWER no puede crear lazo (403)', viewerCreate.status === 403, viewerCreate.json);

    // ===================== EDITOR =====================

    const noInstrument = await call('editor', 'POST', LOOPS, { codigoDocumento: 'DOC-1' });
    check('EDITOR: crear sin instrumentoId -> 400', noInstrument.status === 400, noInstrument.json);

    const createLoop = await call('editor', 'POST', LOOPS, { instrumentoId: instrumentoId1, codigoDocumento: 'LAZO-DOC-01' });
    check(
      'EDITOR crea lazo válido (201)',
      createLoop.status === 201 && createLoop.json?.loop?.instrumentoId === instrumentoId1,
      createLoop.json
    );
    const loopId: string = createLoop.json?.loop?.id;
    if (loopId) createdLoopIds.push(loopId);

    const dupInstrument = await call('editor', 'POST', LOOPS, { instrumentoId: instrumentoId1 });
    check(
      'EDITOR: instrumento ya tiene lazo activo -> 409 loop_instrument_conflict',
      dupInstrument.status === 409 && dupInstrument.json?.error === 'loop_instrument_conflict',
      dupInstrument.json
    );

    const badRef = await call('editor', 'POST', LOOPS, { instrumentoId: '999999999' });
    check('EDITOR: instrumentoId inexistente -> 400 invalid_reference', badRef.status === 400 && badRef.json?.error === 'invalid_reference', badRef.json);

    const createLoop2 = await call('editor', 'POST', LOOPS, { instrumentoId: instrumentoId2 });
    check('EDITOR crea segundo lazo en otro instrumento (201)', createLoop2.status === 201, createLoop2.json);
    const loopId2: string = createLoop2.json?.loop?.id;
    if (loopId2) createdLoopIds.push(loopId2);

    const filtered = await call('viewer', 'GET', `${LOOPS}?instrumentoId=${instrumentoId1}`);
    check('GET loops?instrumentoId= filtra correctamente', filtered.status === 200 && filtered.json?.loops?.length === 1, filtered.json);

    const patchOk = await call('editor', 'PATCH', `${LOOPS}/${loopId}`, { codigoDocumento: 'LAZO-DOC-01-REV1' });
    check(
      'EDITOR actualiza codigoDocumento (200)',
      patchOk.status === 200 && patchOk.json?.loop?.codigoDocumento === 'LAZO-DOC-01-REV1',
      patchOk.json
    );

    const patchClear = await call('editor', 'PATCH', `${LOOPS}/${loopId}`, { codigoDocumento: null });
    check('EDITOR limpia codigoDocumento con null (200)', patchClear.status === 200 && patchClear.json?.loop?.codigoDocumento === null, patchClear.json);

    const editorDelete = await call('editor', 'DELETE', `${LOOPS}/${loopId}`);
    check('EDITOR no puede desactivar lazo (403)', editorDelete.status === 403, editorDelete.json);

    // ===================== VIEWER (lectura) =====================
    const viewerGetOne = await call('viewer', 'GET', `${LOOPS}/${loopId}`);
    check('VIEWER puede leer lazo individual (200)', viewerGetOne.status === 200, viewerGetOne.json);

    // ===================== ADMIN =====================
    const adminDelete = await call('admin', 'DELETE', `${LOOPS}/${loopId}`);
    check('ADMIN desactiva lazo (200)', adminDelete.status === 200 && adminDelete.json?.loop?.active === false, adminDelete.json);

    const getAfterDelete = await call('admin', 'GET', `${LOOPS}/${loopId}`);
    check('Lazo desactivado ya no aparece en GET (404)', getAfterDelete.status === 404, getAfterDelete.json);

    // El instrumento vuelve a estar libre para un lazo nuevo.
    const relink = await call('editor', 'POST', LOOPS, { instrumentoId: instrumentoId1 });
    check('Instrumento liberado admite un lazo nuevo tras desactivar el anterior (201)', relink.status === 201, relink.json);
    const relinkId: string = relink.json?.loop?.id;
    if (relinkId) createdLoopIds.push(relinkId);

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/loops');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    if (projectId) {
      for (const id of createdLoopIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/loops/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar loop ${id} (status ${r?.status})`);
      }
      for (const id of createdInstrumentIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/instruments/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar instrumento ${id} (status ${r?.status})`);
      }
    } else {
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
