/*
 * Pruebas de API para el módulo de Señales (nucleo.senal).
 *
 * Es una prueba de integración HTTP real: levanta el backend (o reutiliza
 * uno que ya esté corriendo), llama a los endpoints con los 3 usuarios DEV
 * (ADMIN / EDITOR / VIEWER definidos en database/dev/001_dev_auth_seed.sql)
 * y verifica autorización + reglas de negocio de CONTROL/COM.
 *
 * No depende de datos residuales: crea su propio instrumento fixture con un
 * TAG único por corrida y, al terminar (pase o falle), desactiva todo lo que
 * creó — incluida la señal que ocupa un canal, para dejarlo libre otra vez.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV
 * (migraciones 001-003 + database/dev/001_dev_auth_seed.sql aplicados) y un
 * módulo de E/S con al menos un canal activo (lo deja tests/001_smoke_modulo.sql).
 *
 * Uso: npm run test:signals   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3100);
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
  const createdSignalIds: string[] = [];
  const createdInstrumentIds: string[] = [];
  let projectId: string | undefined;

  // 1. Reutiliza un backend que ya esté corriendo en ese puerto; si no
  //    responde, levanta uno propio para esta corrida.
  const alreadyRunning = await waitForHealth(500);

  if (!alreadyRunning) {
    console.log(`Ningún backend respondiendo en ${BASE}; levantando uno para la prueba...`);

    /*
     * `detached: true` hace que este proceso sea el líder de su propio
     * grupo (npx -> tsx -> node+loader quedan todos en ese grupo). Es
     * necesario para poder matarlos a todos de una vez al limpiar: matar
     * solo el PID de `npx` no propaga la señal a sus hijos y deja un
     * servidor huérfano escuchando el puerto.
     */
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
    const SIGNALS = `/api/projects/${projectId}/signals`;
    const INSTRUMENTS = `/api/projects/${projectId}/instruments`;

    const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // --- Fixture propio: instrumento activo para dueño de señales ---
    const instrTag = `SIG-TEST-${runId}`;
    const createInstr = await call('admin', 'POST', INSTRUMENTS, { tagInstrumento: instrTag });
    check('ADMIN crea instrumento fixture', createInstr.status === 201, createInstr.json);

    const instrumentoId: string | undefined = createInstr.json?.instrument?.id;
    if (instrumentoId) createdInstrumentIds.push(instrumentoId);

    // ===================== VIEWER =====================
    const viewerList = await call('viewer', 'GET', SIGNALS);
    check('VIEWER puede listar señales (200)', viewerList.status === 200, viewerList.json);

    const viewerCreate = await call('viewer', 'POST', SIGNALS, {
      tagSenal: `VIEWER-DENIED-${runId}`,
      claseSenalId: '1',
      instrumentoId
    });
    check('VIEWER no puede crear señal (403)', viewerCreate.status === 403, viewerCreate.json);

    // ===================== EDITOR =====================

    const editorNoOwner = await call('editor', 'POST', SIGNALS, {
      tagSenal: `NO-OWNER-${runId}`,
      claseSenalId: '1'
    });
    check('EDITOR: crear sin dueño -> 400', editorNoOwner.status === 400, editorNoOwner.json);

    const tagControl = `LT-${runId}`;
    const editorCreateControl = await call('editor', 'POST', SIGNALS, {
      tagSenal: tagControl,
      claseSenalId: '1', // CONTROL
      instrumentoId,
      tipoIoId: '1', // AI
      canalId: '1',
      descripcion: 'Nivel de prueba'
    });
    check(
      'EDITOR crea señal CONTROL válida (201)',
      editorCreateControl.status === 201 &&
        editorCreateControl.json?.signal?.claseSenalCodigo === 'CONTROL' &&
        editorCreateControl.json?.signal?.tipoIoCodigo === 'AI',
      editorCreateControl.json
    );
    const controlSignalId: string | undefined = editorCreateControl.json?.signal?.id;
    if (controlSignalId) createdSignalIds.push(controlSignalId);

    const tagCom = `COM-${runId}`;
    const editorCreateCom = await call('editor', 'POST', SIGNALS, {
      tagSenal: tagCom,
      claseSenalId: '2', // COM
      instrumentoId,
      direccionComId: '1' // IN
    });
    check(
      'EDITOR crea señal COM válida (201)',
      editorCreateCom.status === 201 &&
        editorCreateCom.json?.signal?.claseSenalCodigo === 'COM' &&
        editorCreateCom.json?.signal?.direccionComCodigo === 'IN',
      editorCreateCom.json
    );
    const comSignalId: string | undefined = editorCreateCom.json?.signal?.id;
    if (comSignalId) createdSignalIds.push(comSignalId);

    const invalidComTipoIo = await call('editor', 'POST', SIGNALS, {
      tagSenal: `BAD-COM-${runId}`,
      claseSenalId: '2',
      instrumentoId,
      tipoIoId: '1'
    });
    check(
      'EDITOR: COM con tipoIoId -> 400 validation_error',
      invalidComTipoIo.status === 400 && invalidComTipoIo.json?.error === 'validation_error',
      invalidComTipoIo.json
    );

    const invalidControlDireccion = await call('editor', 'POST', SIGNALS, {
      tagSenal: `BAD-CTRL-${runId}`,
      claseSenalId: '1',
      instrumentoId,
      direccionComId: '1'
    });
    check(
      'EDITOR: CONTROL con direccionComId -> 400 validation_error',
      invalidControlDireccion.status === 400 && invalidControlDireccion.json?.error === 'validation_error',
      invalidControlDireccion.json
    );

    const invalidBothExcl = await call('editor', 'POST', SIGNALS, {
      tagSenal: `BAD-EXCL-${runId}`,
      claseSenalId: '1',
      instrumentoId,
      tipoIoId: '1',
      direccionComId: '1'
    });
    check('EDITOR: tipoIoId+direccionComId juntos -> 400', invalidBothExcl.status === 400, invalidBothExcl.json);

    const dupTag = await call('editor', 'POST', SIGNALS, {
      tagSenal: tagControl,
      claseSenalId: '2',
      instrumentoId,
      direccionComId: '2'
    });
    check(
      'EDITOR: TAG duplicado -> 409 signal_tag_conflict',
      dupTag.status === 409 && dupTag.json?.error === 'signal_tag_conflict',
      dupTag.json
    );

    const dupCanal = await call('editor', 'POST', SIGNALS, {
      tagSenal: `LT2-${runId}`,
      claseSenalId: '1',
      instrumentoId,
      tipoIoId: '1',
      canalId: '1'
    });
    check(
      'EDITOR: canal ya asignado -> 409 signal_channel_conflict',
      dupCanal.status === 409 && dupCanal.json?.error === 'signal_channel_conflict',
      dupCanal.json
    );

    const badRef = await call('editor', 'POST', SIGNALS, {
      tagSenal: `BADREF-${runId}`,
      claseSenalId: '9999',
      instrumentoId
    });
    check(
      'EDITOR: claseSenalId inexistente -> 400 invalid_reference',
      badRef.status === 400 && badRef.json?.error === 'invalid_reference',
      badRef.json
    );

    const patchOk = await call('editor', 'PATCH', `${SIGNALS}/${controlSignalId}`, {
      descripcion: 'Nivel de prueba actualizado'
    });
    check(
      'EDITOR actualiza descripcion (200)',
      patchOk.status === 200 && patchOk.json?.signal?.descripcion === 'Nivel de prueba actualizado',
      patchOk.json
    );

    const editorDelete = await call('editor', 'DELETE', `${SIGNALS}/${comSignalId}`);
    check('EDITOR no puede desactivar (403)', editorDelete.status === 403, editorDelete.json);

    // ===================== VIEWER (lectura) =====================
    const viewerGetOne = await call('viewer', 'GET', `${SIGNALS}/${controlSignalId}`);
    check('VIEWER puede leer señal individual (200)', viewerGetOne.status === 200, viewerGetOne.json);

    const viewerPatch = await call('viewer', 'PATCH', `${SIGNALS}/${controlSignalId}`, { descripcion: 'hack' });
    check('VIEWER no puede editar (403)', viewerPatch.status === 403, viewerPatch.json);

    // ===================== ADMIN =====================
    const adminDelete = await call('admin', 'DELETE', `${SIGNALS}/${comSignalId}`);
    check(
      'ADMIN desactiva señal COM (200)',
      adminDelete.status === 200 && adminDelete.json?.signal?.active === false,
      adminDelete.json
    );

    const getDeactivated = await call('admin', 'GET', `${SIGNALS}/${comSignalId}`);
    check('Señal desactivada ya no aparece en GET (404)', getDeactivated.status === 404, getDeactivated.json);

    const listAfter = await call('viewer', 'GET', SIGNALS);
    const stillHasControl = listAfter.json?.signals?.some((s: any) => s.id === controlSignalId);
    const noLongerHasCom = !listAfter.json?.signals?.some((s: any) => s.id === comSignalId);
    check(
      'Lista final: CONTROL activa presente, COM desactivada ausente',
      listAfter.status === 200 && stillHasControl && noLongerHasCom,
      listAfter.json
    );

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/signals');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    // Limpieza: pase o falle la corrida, no debe quedar nada residual en
    // TEST-001. Se desactiva primero la(s) señal(es) -para liberar el canal
    // que ocupan- y despues el instrumento fixture.
    if (projectId) {
      for (const id of createdSignalIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/signals/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) {
          console.warn(`No se pudo limpiar la señal ${id} (status ${r?.status})`);
        }
      }

      for (const id of createdInstrumentIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/instruments/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) {
          console.warn(`No se pudo limpiar el instrumento ${id} (status ${r?.status})`);
        }
      }
    } else if (createdSignalIds.length || createdInstrumentIds.length) {
      console.warn('projectId no resuelto: no se pudo limpiar fixtures creados.');
    }

    if (serverProcess && serverProcess.pid) {
      try {
        // Grupo completo (npx -> tsx -> node+loader), no solo el PID de npx.
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
