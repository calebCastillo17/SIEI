/*
 * Pruebas de API para la jerarquía física de E/S: RIO -> RACK -> SLOT ->
 * MODULO -> CANAL, más el catálogo global cat.cat_modulo_io.
 *
 * Mismo patrón que signals.api.test.ts / equipment.api.test.ts: prueba de
 * integración HTTP real, autocontenida (levanta su propio backend si no hay
 * uno corriendo), con TAGs/números únicos por corrida, y limpieza total en
 * un `finally` sin importar si la corrida pasó o falló.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV
 * (migraciones 001-003 + database/dev/001_dev_auth_seed.sql aplicados).
 *
 * Uso: npm run test:hierarchy   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3102);
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

  // IDs a limpiar en orden hijo -> padre.
  const createdModuleTypeIds: string[] = [];
  const createdModuleIds: string[] = [];
  const createdSlotIds: string[] = [];
  const createdRackIds: string[] = [];
  const createdRioIds: string[] = [];

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

    const RIOS = `/api/projects/${projectId}/rios`;
    const RACKS = `/api/projects/${projectId}/racks`;
    const SLOTS = `/api/projects/${projectId}/slots`;
    const MODULES = `/api/projects/${projectId}/modules`;
    const CHANNELS = `/api/projects/${projectId}/channels`;
    const MODULE_TYPES = '/api/catalogs/module-types';

    // ===================== Catálogo global: cat_modulo_io =====================

    const catList = await call('viewer', 'GET', MODULE_TYPES);
    check('Cualquier usuario autenticado puede leer el catálogo (200)', catList.status === 200, catList.json);

    const editorCreateType = await call('editor', 'POST', MODULE_TYPES, {
      fabricante: 'SIEI-TEST',
      modelo: `DO-4CH-${runId}`,
      tipoIoId: '4', // DO
      canalesMax: 4
    });
    check('EDITOR no puede crear tipo de módulo (403, solo es_admin_sistema)', editorCreateType.status === 403, editorCreateType.json);

    const adminCreateType = await call('admin', 'POST', MODULE_TYPES, {
      fabricante: 'SIEI-TEST',
      modelo: `DO-4CH-${runId}`,
      tipoIoId: '4', // DO
      canalesMax: 4
    });
    check(
      'ADMIN (es_admin_sistema) crea tipo de módulo (201)',
      adminCreateType.status === 201 && adminCreateType.json?.moduleType?.canalesMax === 4,
      adminCreateType.json
    );
    const moduleTypeId: string | undefined = adminCreateType.json?.moduleType?.id;
    if (moduleTypeId) createdModuleTypeIds.push(moduleTypeId);

    const dupType = await call('admin', 'POST', MODULE_TYPES, {
      fabricante: 'SIEI-TEST',
      modelo: `DO-4CH-${runId}`,
      tipoIoId: '4',
      canalesMax: 8
    });
    check('Tipo de módulo duplicado (fabricante+modelo) -> 409', dupType.status === 409, dupType.json);

    // ===================== VIEWER =====================
    const viewerListRios = await call('viewer', 'GET', RIOS);
    check('VIEWER puede listar RIOs (200)', viewerListRios.status === 200, viewerListRios.json);

    const viewerCreateRio = await call('viewer', 'POST', RIOS, { tagRio: `VIEWER-DENIED-${runId}` });
    check('VIEWER no puede crear RIO (403)', viewerCreateRio.status === 403, viewerCreateRio.json);

    // ===================== EDITOR: construir la cadena completa =====================

    const rioTag = `RIO-${runId}`;
    const createRio = await call('editor', 'POST', RIOS, { tagRio: rioTag, descripcion: 'RIO de prueba' });
    check('EDITOR crea RIO (201)', createRio.status === 201 && createRio.json?.rio?.tagRio === rioTag, createRio.json);
    const rioId: string | undefined = createRio.json?.rio?.id;
    if (rioId) createdRioIds.push(rioId);

    const dupRio = await call('editor', 'POST', RIOS, { tagRio: rioTag });
    check('EDITOR: TAG de RIO duplicado -> 409', dupRio.status === 409 && dupRio.json?.error === 'rio_tag_conflict', dupRio.json);

    const createRack = await call('editor', 'POST', RACKS, { rioId, numeroRack: 1 });
    check('EDITOR crea RACK 1 en el RIO (201)', createRack.status === 201 && createRack.json?.rack?.numeroRack === 1, createRack.json);
    const rackId: string | undefined = createRack.json?.rack?.id;
    if (rackId) createdRackIds.push(rackId);

    const dupRack = await call('editor', 'POST', RACKS, { rioId, numeroRack: 1 });
    check('EDITOR: número de rack duplicado en el mismo RIO -> 409', dupRack.status === 409 && dupRack.json?.error === 'rack_number_conflict', dupRack.json);

    const rackBadRio = await call('editor', 'POST', RACKS, { rioId: '999999999', numeroRack: 1 });
    check('EDITOR: rioId inexistente -> 400 invalid_reference', rackBadRio.status === 400 && rackBadRio.json?.error === 'invalid_reference', rackBadRio.json);

    const filteredRacks = await call('viewer', 'GET', `${RACKS}?rioId=${rioId}`);
    check(
      'GET racks?rioId= filtra correctamente',
      filteredRacks.status === 200 && filteredRacks.json?.racks?.length === 1,
      filteredRacks.json
    );

    const createSlot = await call('editor', 'POST', SLOTS, { rackId, numeroSlot: 1 });
    check('EDITOR crea SLOT 1 en el rack (201)', createSlot.status === 201, createSlot.json);
    const slotId: string | undefined = createSlot.json?.slot?.id;
    if (slotId) createdSlotIds.push(slotId);

    // Un segundo slot vacío para probar que un módulo respeta 1-por-slot.
    const createSlot2 = await call('editor', 'POST', SLOTS, { rackId, numeroSlot: 2 });
    const slot2Id: string | undefined = createSlot2.json?.slot?.id;
    if (slot2Id) createdSlotIds.push(slot2Id);

    // ===================== MODULO: crea canales solo =====================

    const createModule = await call('editor', 'POST', MODULES, { slotId, catalogoModuloId: moduleTypeId });
    check(
      'EDITOR crea MODULO válido (201)',
      createModule.status === 201 && createModule.json?.module?.canalesMax === 4,
      createModule.json
    );
    const moduleId: string | undefined = createModule.json?.module?.id;
    if (moduleId) createdModuleIds.push(moduleId);

    const dupSlotModule = await call('editor', 'POST', MODULES, { slotId, catalogoModuloId: moduleTypeId });
    check(
      'EDITOR: ese slot ya tiene módulo activo -> 409 module_slot_conflict',
      dupSlotModule.status === 409 && dupSlotModule.json?.error === 'module_slot_conflict',
      dupSlotModule.json
    );

    const moduleBadCatalog = await call('editor', 'POST', MODULES, { slotId: slot2Id, catalogoModuloId: '999999999' });
    check(
      'EDITOR: catalogoModuloId inexistente -> 400 invalid_reference',
      moduleBadCatalog.status === 400 && moduleBadCatalog.json?.error === 'invalid_reference',
      moduleBadCatalog.json
    );

    // TR_modulo_generar_canales debió crear 4 canales activos (CH0..CH3).
    const channelsList = await call('viewer', 'GET', `${CHANNELS}?moduloId=${moduleId}`);
    check(
      'El módulo generó automáticamente 4 canales activos',
      channelsList.status === 200 &&
        channelsList.json?.channels?.length === 4 &&
        channelsList.json.channels.every((c: any) => c.active === true),
      channelsList.json
    );
    const firstChannelId: string | undefined = channelsList.json?.channels?.[0]?.id;

    // Canal: solo lectura — no hay POST/PATCH/DELETE que probar como error de
    // método; se confirma que sí se puede leer el detalle individual.
    if (firstChannelId) {
      const oneChannel = await call('viewer', 'GET', `${CHANNELS}/${firstChannelId}`);
      check('VIEWER puede leer un canal individual (200)', oneChannel.status === 200, oneChannel.json);
    }

    // ===================== Permisos sobre la cadena =====================

    const viewerCreateModule = await call('viewer', 'POST', MODULES, { slotId: slot2Id, catalogoModuloId: moduleTypeId });
    check('VIEWER no puede crear módulo (403)', viewerCreateModule.status === 403, viewerCreateModule.json);

    const editorDeactivateRack = await call('editor', 'DELETE', `${RACKS}/${rackId}`);
    check('EDITOR no puede desactivar rack (403)', editorDeactivateRack.status === 403, editorDeactivateRack.json);

    // ===================== Regla de negocio: no se puede reducir capacidad con canal en uso =====================
    // (No hay endpoint de señales importado aquí para no acoplar los tests;
    // se prueba solo el camino sin señal activa: reasignar a un tipo con
    // menos canales cuando ninguno está en uso sí debe funcionar.)
    const smallerType = await call('admin', 'POST', MODULE_TYPES, {
      fabricante: 'SIEI-TEST',
      modelo: `DO-2CH-${runId}`,
      tipoIoId: '4',
      canalesMax: 2
    });
    const smallerTypeId: string | undefined = smallerType.json?.moduleType?.id;
    if (smallerTypeId) createdModuleTypeIds.push(smallerTypeId);

    const shrinkModule = await call('editor', 'PATCH', `${MODULES}/${moduleId}`, { catalogoModuloId: smallerTypeId });
    check(
      'EDITOR reduce la capacidad del módulo sin canales en uso (200)',
      shrinkModule.status === 200 && shrinkModule.json?.module?.canalesMax === 2,
      shrinkModule.json
    );

    const channelsAfterShrink = await call('viewer', 'GET', `${CHANNELS}?moduloId=${moduleId}`);
    const activeAfterShrink = channelsAfterShrink.json?.channels?.filter((c: any) => c.active).length;
    check(
      'Tras reducir capacidad quedan solo 2 canales activos',
      channelsAfterShrink.status === 200 && activeAfterShrink === 2,
      channelsAfterShrink.json
    );

    // ===================== ADMIN: desactivar la cadena =====================

    const adminDeactivateModule = await call('admin', 'DELETE', `${MODULES}/${moduleId}`);
    check('ADMIN desactiva el módulo (200)', adminDeactivateModule.status === 200, adminDeactivateModule.json);

    const adminDeactivateSlot = await call('admin', 'DELETE', `${SLOTS}/${slotId}`);
    check('ADMIN desactiva el slot (200)', adminDeactivateSlot.status === 200, adminDeactivateSlot.json);

    const adminDeactivateSlot2 = await call('admin', 'DELETE', `${SLOTS}/${slot2Id}`);
    check('ADMIN desactiva el slot vacío (200)', adminDeactivateSlot2.status === 200, adminDeactivateSlot2.json);

    const adminDeactivateRack = await call('admin', 'DELETE', `${RACKS}/${rackId}`);
    check('ADMIN desactiva el rack (200)', adminDeactivateRack.status === 200, adminDeactivateRack.json);

    const adminDeactivateRio = await call('admin', 'DELETE', `${RIOS}/${rioId}`);
    check('ADMIN desactiva el RIO (200)', adminDeactivateRio.status === 200, adminDeactivateRio.json);

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/rios');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    // Limpieza en orden hijo -> padre. Los módulos/slots/racks/rios ya
    // deberían estar desactivados por el flujo normal de la prueba, pero se
    // reintenta cada uno por si la corrida falló a mitad de camino — DELETE
    // sobre algo ya inactivo devuelve 404, que se trata como éxito de
    // limpieza (200/404 ambos son "ya no queda activo").
    if (projectId) {
      const cleanupSteps: Array<{ kind: string; ids: string[]; path: (id: string) => string }> = [
        { kind: 'module', ids: createdModuleIds, path: (id) => `/api/projects/${projectId}/modules/${id}` },
        { kind: 'slot', ids: createdSlotIds, path: (id) => `/api/projects/${projectId}/slots/${id}` },
        { kind: 'rack', ids: createdRackIds, path: (id) => `/api/projects/${projectId}/racks/${id}` },
        { kind: 'rio', ids: createdRioIds, path: (id) => `/api/projects/${projectId}/rios/${id}` }
      ];

      for (const step of cleanupSteps) {
        for (const id of step.ids) {
          const r = await call('admin', 'DELETE', step.path(id)).catch(() => null);
          if (!r || ![200, 404].includes(r.status)) {
            console.warn(`No se pudo limpiar ${step.kind} ${id} (status ${r?.status})`);
          }
        }
      }
    } else {
      console.warn('projectId no resuelto: no se pudo limpiar fixtures de proyecto.');
    }

    // cat.cat_modulo_io no tiene soft delete (sin columna activo) — no se
    // puede "desactivar" un tipo de módulo de prueba. Se documenta como
    // limitación conocida en vez de dejarlo sin mencionar: estas filas de
    // catálogo (fabricante SIEI-TEST) quedan permanentemente en la base,
    // igual que el fixture SIEI TEST / AI-8CH-TEST de tests/001.
    if (createdModuleTypeIds.length > 0) {
      console.warn(
        `cat.cat_modulo_io no admite soft delete: quedan ${createdModuleTypeIds.length} ` +
        `tipo(s) de módulo de prueba (fabricante SIEI-TEST) en el catálogo global. ` +
        'Esto es inherente al esquema, no un residuo evitable por este test.'
      );
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
