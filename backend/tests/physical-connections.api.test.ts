/*
 * Pruebas de API para el conexionado físico: CAJA, CABLE, PAR_CONDUCTOR,
 * PUNTO_CONEXION, y la pieza central — RUTA_CONEXION + TRAMO_CONEXION
 * creados atómicamente en un único INSERT multi-fila.
 *
 * Mismo patrón que el resto de tests de este directorio: autocontenida,
 * IDs/TAGs únicos por corrida, limpieza total en `finally`.
 *
 * Requiere que la base ya tenga el proyecto TEST-001, los usuarios DEV, y
 * el RIO fixture RIO-TEST-001 (de database/tests/001_smoke_modulo.sql).
 *
 * Uso: npm run test:connections   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3104);
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

  const createdRouteIds: string[] = [];
  const createdConnectionPointIds: string[] = [];
  const createdCableIds: string[] = [];
  const createdBoxIds: string[] = [];
  const createdSignalIds: string[] = [];
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

    const BOXES = `/api/projects/${projectId}/boxes`;
    const CABLES = `/api/projects/${projectId}/cables`;
    const PAIRS = `/api/projects/${projectId}/conductor-pairs`;
    const POINTS = `/api/projects/${projectId}/connection-points`;
    const ROUTES = `/api/projects/${projectId}/routes`;
    const INSTRUMENTS = `/api/projects/${projectId}/instruments`;
    const SIGNALS = `/api/projects/${projectId}/signals`;
    const RIOS = `/api/projects/${projectId}/rios`;

    const rioList = await call('admin', 'GET', RIOS);
    const fixtureRio = rioList.json?.rios?.find((r: any) => r.tagRio === 'RIO-TEST-001');
    check('RIO fixture RIO-TEST-001 disponible', Boolean(fixtureRio), rioList.json);
    const rioId: string = fixtureRio?.id;

    // ===================== CAJA =====================
    const viewerCreateBox = await call('viewer', 'POST', BOXES, { tagCaja: `VIEWER-DENIED-${runId}` });
    check('VIEWER no puede crear caja (403)', viewerCreateBox.status === 403, viewerCreateBox.json);

    const boxTag = `JB-${runId}`;
    const createBox = await call('editor', 'POST', BOXES, { tagCaja: boxTag, descripcion: 'Caja de prueba' });
    check('EDITOR crea CAJA (201)', createBox.status === 201, createBox.json);
    const boxId: string = createBox.json?.box?.id;
    if (boxId) createdBoxIds.push(boxId);

    const dupBox = await call('editor', 'POST', BOXES, { tagCaja: boxTag });
    check('EDITOR: TAG de caja duplicado -> 409', dupBox.status === 409 && dupBox.json?.error === 'box_tag_conflict', dupBox.json);

    // ===================== CABLE + PAR_CONDUCTOR =====================
    const cableTag = `CBL-${runId}`;
    const createCable = await call('editor', 'POST', CABLES, { tagCable: cableTag, tipoCable: 'THHN', capacidadConductores: 6 });
    check('EDITOR crea CABLE (201)', createCable.status === 201 && createCable.json?.cable?.capacidadConductores === 6, createCable.json);
    const cableId: string = createCable.json?.cable?.id;
    if (cableId) createdCableIds.push(cableId);

    const pairOutOfRange = await call('editor', 'POST', PAIRS, { cableId, numeroPar: 7 });
    check(
      'EDITOR: numeroPar excede capacidadConductores -> 400',
      pairOutOfRange.status === 400 && pairOutOfRange.json?.error === 'validation_error',
      pairOutOfRange.json
    );

    const createPair1 = await call('editor', 'POST', PAIRS, { cableId, numeroPar: 1 });
    check('EDITOR crea PAR_CONDUCTOR 1 (201)', createPair1.status === 201 && createPair1.json?.conductorPair?.inUse === false, createPair1.json);
    const pairId1: string = createPair1.json?.conductorPair?.id;

    const createPair2 = await call('editor', 'POST', PAIRS, { cableId, numeroPar: 2 });
    const pairId2: string = createPair2.json?.conductorPair?.id;
    check('EDITOR crea PAR_CONDUCTOR 2 (201)', createPair2.status === 201, createPair2.json);

    const dupPair = await call('editor', 'POST', PAIRS, { cableId, numeroPar: 1 });
    check('EDITOR: numeroPar duplicado en el mismo cable -> 409', dupPair.status === 409 && dupPair.json?.error === 'conductor_pair_conflict', dupPair.json);

    // Pares adicionales, libres, dedicados a los casos de error de ruta más
    // abajo: pairId1/pairId2 quedarán ocupados por la ruta exitosa (todavía
    // activa en ese punto), así que reutilizarlos ahí haría que el índice
    // único de par-conductor ganara la carrera antes de llegar a probar la
    // regla que se quiere aislar. Como cada intento de ruta inválida se
    // revierte por completo, estos pares "extra" quedan libres otra vez
    // después de cada fallo y se pueden reutilizar entre sí.
    const createPair3 = await call('editor', 'POST', PAIRS, { cableId, numeroPar: 3 });
    const pairId3: string = createPair3.json?.conductorPair?.id;
    const createPair4 = await call('editor', 'POST', PAIRS, { cableId, numeroPar: 4 });
    const pairId4: string = createPair4.json?.conductorPair?.id;

    // ===================== INSTRUMENTO + SEÑAL =====================
    const instrTag = `CONN-TEST-${runId}`;
    const createInstr = await call('admin', 'POST', INSTRUMENTS, { tagInstrumento: instrTag });
    const instrumentoId: string = createInstr.json?.instrument?.id;
    if (instrumentoId) createdInstrumentIds.push(instrumentoId);
    check('ADMIN crea instrumento fixture', createInstr.status === 201, createInstr.json);

    // Un segundo instrumento, para probar el caso "origen no es el dueño real".
    const instrTagOther = `CONN-TEST-OTHER-${runId}`;
    const createInstrOther = await call('admin', 'POST', INSTRUMENTS, { tagInstrumento: instrTagOther });
    const instrumentoIdOther: string = createInstrOther.json?.instrument?.id;
    if (instrumentoIdOther) createdInstrumentIds.push(instrumentoIdOther);

    const tagSenalControl = `LT-CONN-${runId}`;
    const createSignal = await call('editor', 'POST', SIGNALS, {
      tagSenal: tagSenalControl,
      claseSenalId: '1', // CONTROL
      instrumentoId
    });
    check('EDITOR crea señal CONTROL fixture (201)', createSignal.status === 201, createSignal.json);
    const senalId: string = createSignal.json?.signal?.id;
    if (senalId) createdSignalIds.push(senalId);

    const tagSenalCom = `COM-CONN-${runId}`;
    const createSignalCom = await call('editor', 'POST', SIGNALS, {
      tagSenal: tagSenalCom,
      claseSenalId: '2', // COM
      instrumentoId,
      direccionComId: '1'
    });
    const senalComId: string = createSignalCom.json?.signal?.id;
    if (senalComId) createdSignalIds.push(senalComId);

    // ===================== PUNTO_CONEXION =====================
    const pointNoOwner = await call('editor', 'POST', POINTS, { descripcion: 'sin dueño' });
    check('EDITOR: punto sin dueño -> 400', pointNoOwner.status === 400, pointNoOwner.json);

    const pointBothOwners = await call('editor', 'POST', POINTS, { instrumentoId, cajaId: boxId });
    check('EDITOR: punto con dos dueños -> 400', pointBothOwners.status === 400, pointBothOwners.json);

    const createPointInstr = await call('editor', 'POST', POINTS, { instrumentoId, regleta: 'R1', borne: '1' });
    check('EDITOR crea PUNTO_CONEXION en el instrumento (201)', createPointInstr.status === 201, createPointInstr.json);
    const pointInstrId: string = createPointInstr.json?.connectionPoint?.id;
    if (pointInstrId) createdConnectionPointIds.push(pointInstrId);

    const createPointOtherInstr = await call('editor', 'POST', POINTS, { instrumentoId: instrumentoIdOther });
    const pointOtherInstrId: string = createPointOtherInstr.json?.connectionPoint?.id;
    if (pointOtherInstrId) createdConnectionPointIds.push(pointOtherInstrId);

    const createPointBox = await call('editor', 'POST', POINTS, { cajaId: boxId, regleta: 'R2' });
    check('EDITOR crea PUNTO_CONEXION en la caja (201)', createPointBox.status === 201, createPointBox.json);
    const pointBoxId: string = createPointBox.json?.connectionPoint?.id;
    if (pointBoxId) createdConnectionPointIds.push(pointBoxId);

    const createPointRio = await call('editor', 'POST', POINTS, { rioId, regleta: 'R3' });
    check('EDITOR crea PUNTO_CONEXION en el RIO (201)', createPointRio.status === 201, createPointRio.json);
    const pointRioId: string = createPointRio.json?.connectionPoint?.id;
    if (pointRioId) createdConnectionPointIds.push(pointRioId);

    const filteredPoints = await call('viewer', 'GET', `${POINTS}?cajaId=${boxId}`);
    check('GET connection-points?cajaId= filtra correctamente', filteredPoints.status === 200 && filteredPoints.json?.connectionPoints?.length === 1, filteredPoints.json);

    // ===================== RUTA_CONEXION: caso feliz =====================
    const viewerCreateRoute = await call('viewer', 'POST', ROUTES, {
      senalId,
      segments: [{ parConductorId: pairId1, puntoOrigenId: pointInstrId, puntoDestinoId: pointBoxId }]
    });
    check('VIEWER no puede crear ruta (403)', viewerCreateRoute.status === 403, viewerCreateRoute.json);

    const createRoute = await call('editor', 'POST', ROUTES, {
      senalId,
      segments: [
        { parConductorId: pairId1, puntoOrigenId: pointInstrId, puntoDestinoId: pointBoxId },
        { parConductorId: pairId2, puntoOrigenId: pointBoxId, puntoDestinoId: pointRioId }
      ]
    });
    check(
      'EDITOR crea RUTA de 2 tramos atómicamente (201)',
      createRoute.status === 201 &&
        createRoute.json?.route?.segments?.length === 2 &&
        createRoute.json.route.segments[0].numeroOrden === 1 &&
        createRoute.json.route.segments[1].numeroOrden === 2,
      createRoute.json
    );
    const routeId: string | undefined = createRoute.json?.route?.id;
    if (routeId) createdRouteIds.push(routeId);

    // El par queda marcado en uso.
    const pairAfterRoute = await call('viewer', 'GET', `${PAIRS}/${pairId1}`);
    check('El par conductor usado en la ruta queda marcado inUse=true', pairAfterRoute.json?.conductorPair?.inUse === true, pairAfterRoute.json);

    // Segunda ruta activa para la misma señal -> conflicto.
    const dupRouteForSignal = await call('editor', 'POST', ROUTES, {
      senalId,
      segments: [{ parConductorId: pairId2, puntoOrigenId: pointInstrId, puntoDestinoId: pointRioId }]
    });
    check(
      'EDITOR: la señal ya tiene ruta activa -> 409 route_signal_conflict',
      dupRouteForSignal.status === 409 && dupRouteForSignal.json?.error === 'route_signal_conflict',
      dupRouteForSignal.json
    );

    // ===================== RUTA_CONEXION: casos de error =====================

    // COM no puede tener ruta activa.
    const routeForCom = await call('editor', 'POST', ROUTES, {
      senalId: senalComId,
      segments: [{ parConductorId: pairId2, puntoOrigenId: pointInstrId, puntoDestinoId: pointRioId }]
    });
    check(
      'EDITOR: señal COM no puede tener ruta activa -> 409 route_signal_is_com',
      routeForCom.status === 409 && routeForCom.json?.error === 'route_signal_is_com',
      routeForCom.json
    );

    // Segunda señal CONTROL para probar los casos de error sin chocar con la ruta ya activa.
    const tagSenalControl2 = `LT-CONN-2-${runId}`;
    const createSignal2 = await call('editor', 'POST', SIGNALS, { tagSenal: tagSenalControl2, claseSenalId: '1', instrumentoId });
    const senalId2: string = createSignal2.json?.signal?.id;
    if (senalId2) createdSignalIds.push(senalId2);

    // Origen del primer tramo no es el dueño real de la señal.
    const badOrigin = await call('editor', 'POST', ROUTES, {
      senalId: senalId2,
      segments: [{ parConductorId: pairId3, puntoOrigenId: pointOtherInstrId, puntoDestinoId: pointRioId }]
    });
    check(
      'EDITOR: origen del primer tramo no es el dueño real -> 400 route_origin_mismatch',
      badOrigin.status === 400 && badOrigin.json?.error === 'route_origin_mismatch',
      badOrigin.json
    );

    // Último tramo no termina en RIO/MODULO (termina en la caja).
    const badDestination = await call('editor', 'POST', ROUTES, {
      senalId: senalId2,
      segments: [{ parConductorId: pairId3, puntoOrigenId: pointInstrId, puntoDestinoId: pointBoxId }]
    });
    check(
      'EDITOR: último tramo termina en CAJA, no en RIO/MODULO -> 400 route_destination_invalid',
      badDestination.status === 400 && badDestination.json?.error === 'route_destination_invalid',
      badDestination.json
    );

    // Secuencia rota: el destino del tramo 1 no coincide con el origen del tramo 2.
    const createPointBox2 = await call('editor', 'POST', POINTS, { cajaId: boxId, regleta: 'R2b' });
    const pointBox2Id: string = createPointBox2.json?.connectionPoint?.id;
    if (pointBox2Id) createdConnectionPointIds.push(pointBox2Id);

    const brokenSequence = await call('editor', 'POST', ROUTES, {
      senalId: senalId2,
      segments: [
        { parConductorId: pairId3, puntoOrigenId: pointInstrId, puntoDestinoId: pointBoxId },
        { parConductorId: pairId4, puntoOrigenId: pointBox2Id, puntoDestinoId: pointRioId } // no encadena con pointBoxId
      ]
    });
    check(
      'EDITOR: secuencia rota entre tramos -> 400 route_sequence_broken',
      brokenSequence.status === 400 && brokenSequence.json?.error === 'route_sequence_broken',
      brokenSequence.json
    );
    // El INSERT multi-fila completo se revirtió: no debe haber quedado una
    // ruta huérfana para senalId2 tras el fallo.
    const orphanCheck = await call('viewer', 'GET', `${ROUTES}?senalId=${senalId2}`);
    check(
      'Tras el fallo de secuencia no queda ninguna ruta huérfana para la señal',
      orphanCheck.status === 200 && orphanCheck.json?.routes?.length === 0,
      orphanCheck.json
    );

    // Referencia inválida.
    const badRef = await call('editor', 'POST', ROUTES, {
      senalId: senalId2,
      segments: [{ parConductorId: '999999999', puntoOrigenId: pointInstrId, puntoDestinoId: pointRioId }]
    });
    check('EDITOR: parConductorId inexistente -> 400 invalid_reference', badRef.status === 400 && badRef.json?.error === 'invalid_reference', badRef.json);

    // ===================== DESACTIVAR CADENA =====================
    const editorDeleteRoute = await call('editor', 'DELETE', `${ROUTES}/${routeId}`);
    check('EDITOR no puede desactivar ruta (403)', editorDeleteRoute.status === 403, editorDeleteRoute.json);

    // No se puede desactivar el punto en uso mientras la ruta está activa.
    const blockedPointDeactivate = await call('admin', 'DELETE', `${POINTS}/${pointBoxId}`);
    check(
      'ADMIN: no puede desactivar un punto usado por un tramo activo -> 409',
      blockedPointDeactivate.status === 409 && blockedPointDeactivate.json?.error === 'connection_point_in_use',
      blockedPointDeactivate.json
    );

    // No se puede desactivar el cable mientras uno de sus pares está en uso.
    const blockedCableDeactivate = await call('admin', 'DELETE', `${CABLES}/${cableId}`);
    check(
      'ADMIN: no puede desactivar un cable con un par en uso -> 409',
      blockedCableDeactivate.status === 409 && blockedCableDeactivate.json?.error === 'cable_conductor_pair_in_use',
      blockedCableDeactivate.json
    );

    const adminDeleteRoute = await call('admin', 'DELETE', `${ROUTES}/${routeId}`);
    check('ADMIN desactiva la ruta (200)', adminDeleteRoute.status === 200, adminDeleteRoute.json);

    const routeAfterDelete = await call('admin', 'GET', `${ROUTES}/${routeId}`);
    check('Ruta desactivada ya no aparece en GET (404)', routeAfterDelete.status === 404, routeAfterDelete.json);

    // La cascada de desactivación liberó el par conductor.
    const pairAfterDelete = await call('viewer', 'GET', `${PAIRS}/${pairId1}`);
    check('Tras desactivar la ruta, el par conductor vuelve a estar libre', pairAfterDelete.json?.conductorPair?.inUse === false, pairAfterDelete.json);

    // Y ahora sí se puede desactivar el punto y el cable.
    const pointDeactivateNow = await call('admin', 'DELETE', `${POINTS}/${pointBoxId}`);
    check('ADMIN desactiva el punto ya liberado (200)', pointDeactivateNow.status === 200, pointDeactivateNow.json);

    const cableDeactivateNow = await call('admin', 'DELETE', `${CABLES}/${cableId}`);
    check('ADMIN desactiva el cable ya liberado (200)', cableDeactivateNow.status === 200, cableDeactivateNow.json);
    createdCableIds.length = 0; // ya desactivado, no reintentar en la limpieza

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/routes');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    if (projectId) {
      for (const id of createdRouteIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/routes/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar route ${id} (status ${r?.status})`);
      }
      for (const id of createdConnectionPointIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/connection-points/${id}`).catch(() => null);
        if (!r || ![200, 404, 409].includes(r.status)) console.warn(`No se pudo limpiar connection-point ${id} (status ${r?.status})`);
      }
      for (const id of createdCableIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/cables/${id}`).catch(() => null);
        if (!r || ![200, 404, 409].includes(r.status)) console.warn(`No se pudo limpiar cable ${id} (status ${r?.status})`);
      }
      for (const id of createdBoxIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/boxes/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar box ${id} (status ${r?.status})`);
      }
      for (const id of createdSignalIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/signals/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar señal ${id} (status ${r?.status})`);
      }
      for (const id of createdInstrumentIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/instruments/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar instrumento ${id} (status ${r?.status})`);
      }

      console.warn(
        'nucleo.par_conductor no tiene soft delete (sin columna activo): ' +
        'los pares de prueba creados sobre el cable de este test quedan permanentes ' +
        'hasta que el cable mismo se desactive (se desactivó arriba, pero las filas ' +
        'de par_conductor persisten como historial, igual que documenta el modelo).'
      );
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
