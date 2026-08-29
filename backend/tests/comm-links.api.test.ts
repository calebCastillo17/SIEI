/*
 * Pruebas de API para Comunicaciones: SWITCH -> PUERTO -> ENLACE_COM.
 *
 * Mismo patrón que los demás tests de este directorio: autocontenida,
 * TAGs/números únicos por corrida, limpieza total en `finally`.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV
 * (migraciones 001-003 + database/dev/001_dev_auth_seed.sql aplicados).
 * Usa el instrumento fixture inactivo DEV-PIT-001 como referencia solo
 * para el caso de "referencia inválida" — reactivar/crear instrumentos
 * activos propios vía POST /instruments para las pruebas positivas.
 *
 * Uso: npm run test:comm-links   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3103);
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

  const createdCommLinkIds: string[] = [];
  const createdPortIds: string[] = [];
  const createdSwitchIds: string[] = [];
  const createdInstrumentIds: string[] = [];
  const createdGabineteIds: string[] = [];

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

    const SWITCHES = `/api/projects/${projectId}/switches`;
    const PORTS = `/api/projects/${projectId}/ports`;
    const COMM_LINKS = `/api/projects/${projectId}/comm-links`;
    const INSTRUMENTS = `/api/projects/${projectId}/instruments`;
    const GABINETES = `/api/projects/${projectId}/gabinetes`;
    const TIPOS_GABINETE = '/api/catalogs/tipos-gabinete';

    // --- Fixture propio: gabinete tipo COMUNICACION para asociar al switch ---
    const tiposGabinete = await call('viewer', 'GET', TIPOS_GABINETE);
    const tipoComunicacionId: string | undefined = tiposGabinete.json?.items?.find((t: any) => t.codigo === 'COMUNICACION')?.id;
    check('Existe el tipo COMUNICACION en el catálogo tipos-gabinete', Boolean(tipoComunicacionId), tiposGabinete.json);

    const createGabinete = await call('admin', 'POST', GABINETES, {
      tagGabinete: `GAB-COMM-${runId}`,
      tipoGabineteId: tipoComunicacionId
    });
    check('ADMIN crea gabinete fixture tipo COMUNICACION (201)', createGabinete.status === 201, createGabinete.json);
    const gabineteId: string | undefined = createGabinete.json?.gabinete?.id;
    if (gabineteId) createdGabineteIds.push(gabineteId);

    // --- Fixture propio: instrumento activo para dueño de enlaces ---
    const instrTag = `COMM-TEST-${runId}`;
    const createInstr = await call('admin', 'POST', INSTRUMENTS, { tagInstrumento: instrTag });
    check('ADMIN crea instrumento fixture', createInstr.status === 201, createInstr.json);
    const instrumentoId: string | undefined = createInstr.json?.instrument?.id;
    if (instrumentoId) createdInstrumentIds.push(instrumentoId);

    const instrTag2 = `COMM-TEST-2-${runId}`;
    const createInstr2 = await call('admin', 'POST', INSTRUMENTS, { tagInstrumento: instrTag2 });
    const instrumentoId2: string | undefined = createInstr2.json?.instrument?.id;
    if (instrumentoId2) createdInstrumentIds.push(instrumentoId2);

    // ===================== VIEWER =====================
    const viewerListSwitches = await call('viewer', 'GET', SWITCHES);
    check('VIEWER puede listar switches (200)', viewerListSwitches.status === 200, viewerListSwitches.json);

    const viewerCreateSwitch = await call('viewer', 'POST', SWITCHES, { tagSwitch: `VIEWER-DENIED-${runId}` });
    check('VIEWER no puede crear switch (403)', viewerCreateSwitch.status === 403, viewerCreateSwitch.json);

    // ===================== EDITOR: construir la cadena =====================

    const switchTag = `SW-${runId}`;
    const createSwitch = await call('editor', 'POST', SWITCHES, { tagSwitch: switchTag, marcaModelo: 'Cisco Test' });
    check(
      'EDITOR crea SWITCH sin gabinete (201, gabineteId null)',
      createSwitch.status === 201 && createSwitch.json?.switch?.tagSwitch === switchTag && createSwitch.json?.switch?.gabineteId === null,
      createSwitch.json
    );
    const switchId: string | undefined = createSwitch.json?.switch?.id;
    if (switchId) createdSwitchIds.push(switchId);

    const dupSwitch = await call('editor', 'POST', SWITCHES, { tagSwitch: switchTag });
    check('EDITOR: TAG de switch duplicado -> 409', dupSwitch.status === 409 && dupSwitch.json?.error === 'switch_tag_conflict', dupSwitch.json);

    // --- SWITCH con gabinete asignado desde su creación ---
    const switchWithGabineteTag = `SW-GAB-${runId}`;
    const createSwitchWithGabinete = await call('editor', 'POST', SWITCHES, {
      tagSwitch: switchWithGabineteTag,
      gabineteId
    });
    check(
      'EDITOR crea SWITCH con gabinete (201)',
      createSwitchWithGabinete.status === 201 && createSwitchWithGabinete.json?.switch?.gabineteId === gabineteId,
      createSwitchWithGabinete.json
    );
    const switchWithGabineteId: string | undefined = createSwitchWithGabinete.json?.switch?.id;
    if (switchWithGabineteId) createdSwitchIds.push(switchWithGabineteId);

    const switchBadGabinete = await call('editor', 'POST', SWITCHES, { tagSwitch: `SW-BADGAB-${runId}`, gabineteId: '999999999' });
    check('EDITOR: gabineteId inexistente -> 400 invalid_reference', switchBadGabinete.status === 400 && switchBadGabinete.json?.error === 'invalid_reference', switchBadGabinete.json);

    const patchAddGabinete = await call('editor', 'PATCH', `${SWITCHES}/${switchId}`, { gabineteId });
    check('EDITOR asigna gabinete a un switch existente vía PATCH (200)', patchAddGabinete.status === 200 && patchAddGabinete.json?.switch?.gabineteId === gabineteId, patchAddGabinete.json);

    const patchClearGabinete = await call('editor', 'PATCH', `${SWITCHES}/${switchId}`, { gabineteId: null });
    check('EDITOR limpia el gabinete de un switch vía PATCH (200, gabineteId null)', patchClearGabinete.status === 200 && patchClearGabinete.json?.switch?.gabineteId === null, patchClearGabinete.json);

    const createPort1 = await call('editor', 'POST', PORTS, { switchId, numeroPuerto: 1 });
    check('EDITOR crea PUERTO 1 (201)', createPort1.status === 201, createPort1.json);
    const portId1: string | undefined = createPort1.json?.port?.id;
    if (portId1) createdPortIds.push(portId1);

    const createPort2 = await call('editor', 'POST', PORTS, { switchId, numeroPuerto: 2 });
    const portId2: string | undefined = createPort2.json?.port?.id;
    if (portId2) createdPortIds.push(portId2);

    const dupPort = await call('editor', 'POST', PORTS, { switchId, numeroPuerto: 1 });
    check('EDITOR: número de puerto duplicado en el mismo switch -> 409', dupPort.status === 409 && dupPort.json?.error === 'port_number_conflict', dupPort.json);

    const filteredPorts = await call('viewer', 'GET', `${PORTS}?switchId=${switchId}`);
    check('GET ports?switchId= filtra correctamente (2 puertos)', filteredPorts.status === 200 && filteredPorts.json?.ports?.length === 2, filteredPorts.json);

    // ===================== ENLACE_COM =====================

    // Se prueba con instrumentoId2 ANTES de que tenga ningún enlace activo:
    // si se probara después de "gastarlo" en un enlace real, la violación
    // del índice único (instrumento ya enlazado) podría ganarle a la del FK
    // (puerto inexistente) y el test dejaría de aislar lo que quiere probar.
    const badPortRef = await call('editor', 'POST', COMM_LINKS, { puertoId: '999999999', instrumentoId: instrumentoId2 });
    check('EDITOR: puertoId inexistente -> 400 invalid_reference', badPortRef.status === 400 && badPortRef.json?.error === 'invalid_reference', badPortRef.json);

    const noOwner = await call('editor', 'POST', COMM_LINKS, { puertoId: portId1 });
    check('EDITOR: crear enlace sin dueño -> 400', noOwner.status === 400, noOwner.json);

    const bothOwners = await call('editor', 'POST', COMM_LINKS, {
      puertoId: portId1, equipoId: '1', instrumentoId
    });
    check('EDITOR: equipoId + instrumentoId juntos -> 400', bothOwners.status === 400, bothOwners.json);

    const createLink = await call('editor', 'POST', COMM_LINKS, {
      puertoId: portId1,
      instrumentoId,
      tagMedio: 'Fibra-01'
    });
    check(
      'EDITOR crea ENLACE_COM válido (201)',
      createLink.status === 201 &&
        createLink.json?.commLink?.instrumentoId === instrumentoId &&
        createLink.json?.commLink?.equipoId === null,
      createLink.json
    );
    const linkId: string | undefined = createLink.json?.commLink?.id;
    if (linkId) createdCommLinkIds.push(linkId);

    const dupPortLink = await call('editor', 'POST', COMM_LINKS, { puertoId: portId1, instrumentoId: instrumentoId2 });
    check(
      'EDITOR: puerto ya tiene enlace activo -> 409 comm_link_port_conflict',
      dupPortLink.status === 409 && dupPortLink.json?.error === 'comm_link_port_conflict',
      dupPortLink.json
    );

    const dupInstrumentLink = await call('editor', 'POST', COMM_LINKS, { puertoId: portId2, instrumentoId });
    check(
      'EDITOR: instrumento ya tiene enlace activo -> 409 comm_link_instrument_conflict',
      dupInstrumentLink.status === 409 && dupInstrumentLink.json?.error === 'comm_link_instrument_conflict',
      dupInstrumentLink.json
    );

    const linkOnSecondPort = await call('editor', 'POST', COMM_LINKS, { puertoId: portId2, instrumentoId: instrumentoId2 });
    check('EDITOR crea segundo ENLACE_COM en el otro puerto (201)', linkOnSecondPort.status === 201, linkOnSecondPort.json);
    const linkId2: string | undefined = linkOnSecondPort.json?.commLink?.id;
    if (linkId2) createdCommLinkIds.push(linkId2);

    const patchOk = await call('editor', 'PATCH', `${COMM_LINKS}/${linkId}`, { tagMedio: 'Fibra-01-actualizada' });
    check('EDITOR actualiza tagMedio (200)', patchOk.status === 200 && patchOk.json?.commLink?.tagMedio === 'Fibra-01-actualizada', patchOk.json);

    const editorDeleteLink = await call('editor', 'DELETE', `${COMM_LINKS}/${linkId}`);
    check('EDITOR no puede desactivar enlace (403)', editorDeleteLink.status === 403, editorDeleteLink.json);

    // ===================== VIEWER (lectura) =====================
    const viewerGetOne = await call('viewer', 'GET', `${COMM_LINKS}/${linkId}`);
    check('VIEWER puede leer enlace individual (200)', viewerGetOne.status === 200, viewerGetOne.json);

    // ===================== ADMIN =====================
    const adminDeleteLink1 = await call('admin', 'DELETE', `${COMM_LINKS}/${linkId}`);
    check('ADMIN desactiva enlace 1 (200)', adminDeleteLink1.status === 200, adminDeleteLink1.json);

    const adminDeleteLink2 = await call('admin', 'DELETE', `${COMM_LINKS}/${linkId2}`);
    check('ADMIN desactiva enlace 2 (200)', adminDeleteLink2.status === 200, adminDeleteLink2.json);

    // El puerto vuelve a estar libre tras desactivar su enlace.
    const relink = await call('editor', 'POST', COMM_LINKS, { puertoId: portId1, instrumentoId });
    check('Puerto liberado admite un nuevo enlace tras desactivar el anterior (201)', relink.status === 201, relink.json);
    const relinkId: string | undefined = relink.json?.commLink?.id;
    if (relinkId) createdCommLinkIds.push(relinkId);

    const adminDeletePort1 = await call('admin', 'DELETE', `${PORTS}/${portId1}`);
    check('ADMIN desactiva puerto 1 (requiere desactivar su enlace primero) (200)', adminDeletePort1.status === 200, adminDeletePort1.json);

    const adminDeleteRelink = await call('admin', 'DELETE', `${COMM_LINKS}/${relinkId}`);
    check('ADMIN desactiva el enlace reactivado, limpieza final (200)', adminDeleteRelink.status === 200, adminDeleteRelink.json);

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/switches');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    if (projectId) {
      for (const id of createdCommLinkIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/comm-links/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar comm-link ${id} (status ${r?.status})`);
      }
      for (const id of createdPortIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/ports/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar port ${id} (status ${r?.status})`);
      }
      for (const id of createdSwitchIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/switches/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar switch ${id} (status ${r?.status})`);
      }
      for (const id of createdInstrumentIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/instruments/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar instrumento ${id} (status ${r?.status})`);
      }
      for (const id of createdGabineteIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/gabinetes/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar gabinete ${id} (status ${r?.status})`);
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
