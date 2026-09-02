/*
 * Pruebas de API para las vistas de solo lectura de la sección CONTROL
 * (backend/src/routes/controlOverview.ts): GET .../control/signals,
 * GET .../control/signals/:id, GET .../control/hardware.
 *
 * Autocontenida sobre el proyecto fixture TEST-001: crea su propio
 * catálogo de módulo, gabinete/rack/slot/módulo, instrumento, equipo,
 * señales CONTROL y una ruta, todo con TAGs únicos por corrida, y limpia
 * todo en `finally`.
 *
 * Uso: npm run test:control-overview   (ver backend/package.json)
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

async function call(user: UserKey, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': USERS[user] },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body */ }
  return { status: res.status, json };
}

function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) { pass++; console.log(`PASS: ${label}`); }
  else { fail++; failures.push(label); console.log(`FAIL: ${label}` + (extra ? ` -- ${JSON.stringify(extra)}` : '')); }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health/db`);
      if (res.ok) { const json = await res.json(); if (json?.connection === true) return true; }
    } catch { /* aún no acepta conexiones */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main(): Promise<void> {
  let serverProcess: ChildProcess | null = null;
  const alreadyRunning = await waitForHealth(500);

  if (!alreadyRunning) {
    console.log(`Ningún backend respondiendo en ${BASE}; levantando uno para la prueba...`);
    serverProcess = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'pipe',
      detached: true
    });
    serverProcess.stdout?.on('data', () => {});
    serverProcess.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    const ready = await waitForHealth(20_000);
    if (!ready) { console.error('El backend no respondió a tiempo.'); serverProcess.kill(); process.exit(1); }
  }

  const created = {
    moduleTypeId: undefined as string | undefined,
    gabineteId: undefined as string | undefined,
    rackId: undefined as string | undefined,
    slotId: undefined as string | undefined,
    moduleId: undefined as string | undefined,
    instrumentoId: undefined as string | undefined,
    equipoId: undefined as string | undefined,
    signalInstId: undefined as string | undefined,
    signalEqId: undefined as string | undefined,
    puntoOrigenId: undefined as string | undefined,
    puntoDestinoId: undefined as string | undefined,
    routeId: undefined as string | undefined
  };

  try {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const projectsList = await call('admin', 'GET', '/api/projects');
    const project = projectsList.json?.projects?.find((p: any) => p.code === 'TEST-001');
    check('Proyecto fixture TEST-001 existe y es accesible', projectsList.status === 200 && Boolean(project), projectsList.json);
    if (!project) throw new Error('No se encontró TEST-001.');
    const projectId = project.id as string;

    const P = (path: string) => `/api/projects/${projectId}${path}`;

    // --- Catálogo de módulo (global) ---
    const tiposIo = await call('viewer', 'GET', '/api/catalogs/io-types');
    const diId = tiposIo.json.items.find((t: any) => t.codigo === 'DI').id;

    const moduleType = await call('admin', 'POST', '/api/catalogs/module-types', {
      fabricante: `TEST-CTRL-${runId}`, modelo: `MOD-${runId}`, tipoIoId: diId, canalesMax: 4
    });
    check('POST module-types crea el modelo de prueba', moduleType.status === 201, moduleType.json);
    created.moduleTypeId = moduleType.json?.moduleType?.id;

    // --- Hardware: gabinete -> rack -> slot -> módulo (canal auto-generado) ---
    const tiposGabinete = await call('viewer', 'GET', '/api/catalogs/tipos-gabinete');
    const tipoControlId = tiposGabinete.json.items.find((t: any) => t.codigo === 'CONTROL').id;

    const gabinete = await call('editor', 'POST', P('/gabinetes'), { tagGabinete: `TEST-CTRL-GAB-${runId}`, tipoGabineteId: tipoControlId });
    check('POST gabinetes crea el gabinete de prueba', gabinete.status === 201, gabinete.json);
    created.gabineteId = gabinete.json?.gabinete?.id;

    const rack = await call('editor', 'POST', P('/racks'), { gabineteId: created.gabineteId, numeroRack: 1 });
    check('POST racks crea el rack de prueba', rack.status === 201, rack.json);
    created.rackId = rack.json?.rack?.id;

    const slot = await call('editor', 'POST', P('/slots'), { rackId: created.rackId, numeroSlot: 1 });
    check('POST slots crea el slot de prueba', slot.status === 201, slot.json);
    created.slotId = slot.json?.slot?.id;

    const modulo = await call('editor', 'POST', P('/modules'), { slotId: created.slotId, catalogoModuloId: created.moduleTypeId });
    check('POST modules crea el módulo de prueba (dispara generación de canal)', modulo.status === 201, modulo.json);
    created.moduleId = modulo.json?.module?.id;

    const canales = await call('viewer', 'GET', P(`/channels?moduloId=${created.moduleId}`));
    check('El módulo generó automáticamente sus 4 canales', canales.status === 200 && canales.json.channels.length === 4, canales.json);
    const canal0Id = canales.json.channels.find((c: any) => c.numeroCanal === 0)?.id;
    const canal1Id = canales.json.channels.find((c: any) => c.numeroCanal === 1)?.id;

    // --- Dueños: instrumento y equipo ---
    const instrumento = await call('editor', 'POST', P('/instruments'), { tagInstrumento: `TEST-CTRL-INST-${runId}`, descripcion: 'Instrumento de prueba CONTROL' });
    check('POST instruments crea el instrumento de prueba', instrumento.status === 201, instrumento.json);
    created.instrumentoId = instrumento.json?.instrument?.id;

    const equipo = await call('editor', 'POST', P('/equipment'), { tagEquipo: `TEST-CTRL-EQ-${runId}` });
    check('POST equipment crea el equipo de prueba', equipo.status === 201, equipo.json);
    created.equipoId = equipo.json?.equipment?.id;

    // --- Señales CONTROL: una de instrumento (canal0, con ruta) y una de equipo (canal1, sin ruta) ---
    const clases = await call('viewer', 'GET', '/api/catalogs/signal-classes');
    const claseControlId = clases.json.items.find((c: any) => c.codigo === 'CONTROL').id;

    const senalInst = await call('editor', 'POST', P('/signals'), {
      instrumentoId: created.instrumentoId, claseSenalId: claseControlId, tipoIoId: diId,
      canalId: canal0Id, tagSenal: `TEST-CTRL-${runId}_PI`, nombreCorto: 'PI', codigoSenal: `SIG-${runId.slice(-10)}-1`
    });
    check('POST signals crea la señal de instrumento (con canal)', senalInst.status === 201, senalInst.json);
    created.signalInstId = senalInst.json?.signal?.id;

    const senalEq = await call('editor', 'POST', P('/signals'), {
      equipoId: created.equipoId, claseSenalId: claseControlId, tipoIoId: diId,
      canalId: canal1Id, tagSenal: `TEST-CTRL-${runId}_RDY`, nombreCorto: 'RDY', codigoSenal: `SIG-${runId.slice(-10)}-2`
    });
    check('POST signals crea la señal de equipo (con canal, sin ruta)', senalEq.status === 201, senalEq.json);
    created.signalEqId = senalEq.json?.signal?.id;

    // --- Ruta lógica solo para la señal de instrumento: instrumento -> gabinete -> modulo ---
    const puntoOrigen = await call('editor', 'POST', P('/connection-points'), { instrumentoId: created.instrumentoId });
    created.puntoOrigenId = puntoOrigen.json?.connectionPoint?.id;
    const puntoGabinete = await call('editor', 'POST', P('/connection-points'), { gabineteId: created.gabineteId });
    const puntoModulo = await call('editor', 'POST', P('/connection-points'), { moduloId: created.moduleId });
    created.puntoDestinoId = puntoModulo.json?.connectionPoint?.id;

    const ruta = await call('editor', 'POST', P('/routes'), {
      senalId: created.signalInstId,
      segments: [
        { puntoOrigenId: created.puntoOrigenId, puntoDestinoId: puntoGabinete.json.connectionPoint.id, parConductorId: null },
        { puntoOrigenId: puntoGabinete.json.connectionPoint.id, puntoDestinoId: created.puntoDestinoId, parConductorId: null }
      ]
    });
    check('POST routes crea la ruta instrumento->gabinete->modulo', ruta.status === 201, ruta.json);
    created.routeId = ruta.json?.route?.id;

    // ===================== GET control/hardware =====================

    const hardware = await call('viewer', 'GET', P('/control/hardware'));
    check('GET control/hardware responde 200', hardware.status === 200, hardware.json);
    const gab = hardware.json?.gabinetes?.find((g: any) => g.id === created.gabineteId);
    check('El gabinete de prueba aparece en el árbol de hardware', Boolean(gab), hardware.json);
    const rackNode = gab?.racks?.find((r: any) => r.id === created.rackId);
    const slotNode = rackNode?.slots?.find((s: any) => s.id === created.slotId);
    check('El módulo de prueba tiene 4 canales en el árbol', slotNode?.modulo?.canales?.length === 4, slotNode);
    const ch0 = slotNode?.modulo?.canales?.find((c: any) => c.numeroCanal === 0);
    const ch1 = slotNode?.modulo?.canales?.find((c: any) => c.numeroCanal === 1);
    const ch2 = slotNode?.modulo?.canales?.find((c: any) => c.numeroCanal === 2);
    check('Canal 0 aparece OCUPADO por la señal de instrumento', ch0?.estado === 'OCUPADO' && ch0?.senal?.id === created.signalInstId, ch0);
    check('Canal 1 aparece OCUPADO por la señal de equipo', ch1?.estado === 'OCUPADO' && ch1?.senal?.id === created.signalEqId, ch1);
    check('Canal 2 (sin señal) aparece como RESERVA', ch2?.estado === 'RESERVA' && ch2?.senal === null, ch2);

    // ===================== GET control/signals (lista + filtros) =====================

    const listAll = await call('viewer', 'GET', P(`/control/signals?q=TEST-CTRL-${runId}`));
    check('GET control/signals con filtro q trae exactamente las 2 señales de prueba', listAll.status === 200 && listAll.json.signals.length === 2, listAll.json);

    const sInst = listAll.json.signals.find((s: any) => s.id === created.signalInstId);
    check('La señal de instrumento resuelve dueño=instrumento con tag correcto', sInst?.dueno?.tipo === 'instrumento' && sInst?.dueno?.tag === `TEST-CTRL-INST-${runId}`, sInst);
    check('La señal de instrumento resuelve IO (gabinete/rack/slot/módulo/canal)', sInst?.io?.tagGabinete === `TEST-CTRL-GAB-${runId}` && sInst?.io?.numeroCanal === 0, sInst);
    check('La señal de instrumento queda RUTA_CARGADA', sInst?.estadoConexionado === 'RUTA_CARGADA', sInst);

    const sEq = listAll.json.signals.find((s: any) => s.id === created.signalEqId);
    check('La señal de equipo resuelve dueño=equipo con tag correcto', sEq?.dueno?.tipo === 'equipo' && sEq?.dueno?.tag === `TEST-CTRL-EQ-${runId}`, sEq);
    check('La señal de equipo (con canal, sin ruta) queda RUTA_PENDIENTE', sEq?.estadoConexionado === 'RUTA_PENDIENTE', sEq);

    const filterByGabinete = await call('viewer', 'GET', P(`/control/signals?gabineteId=${created.gabineteId}`));
    check('Filtro gabineteId trae ambas señales de ese gabinete', filterByGabinete.json.signals.length >= 2, filterByGabinete.json);

    const filterByEstado = await call('viewer', 'GET', P(`/control/signals?q=TEST-CTRL-${runId}&estado=RUTA_CARGADA`));
    check('Filtro estado=RUTA_CARGADA excluye la señal de equipo', filterByEstado.json.signals.length === 1 && filterByEstado.json.signals[0].id === created.signalInstId, filterByEstado.json);

    const filterByDuenoTipo = await call('viewer', 'GET', P(`/control/signals?q=TEST-CTRL-${runId}&duenoTipo=equipo`));
    check('Filtro duenoTipo=equipo excluye la señal de instrumento', filterByDuenoTipo.json.signals.length === 1 && filterByDuenoTipo.json.signals[0].id === created.signalEqId, filterByDuenoTipo.json);

    // ===================== GET control/signals/:id (detalle + rutaNodos) =====================

    const detailInst = await call('viewer', 'GET', P(`/control/signals/${created.signalInstId}`));
    check('GET control/signals/:id responde 200 para la señal de instrumento', detailInst.status === 200, detailInst.json);
    const nodos = detailInst.json?.signal?.rutaNodos ?? [];
    check(
      'rutaNodos resuelve la cadena instrumento -> gabinete -> modulo',
      nodos.length === 3 &&
        nodos[0].tipo === 'instrumento' && nodos[0].tag === `TEST-CTRL-INST-${runId}` &&
        nodos[1].tipo === 'gabinete' && nodos[1].tag === `TEST-CTRL-GAB-${runId}` &&
        nodos[2].tipo === 'modulo',
      nodos
    );

    const detailEq = await call('viewer', 'GET', P(`/control/signals/${created.signalEqId}`));
    check('rutaNodos queda vacío para la señal sin ruta (no se inventa nada)', (detailEq.json?.signal?.rutaNodos ?? []).length === 0, detailEq.json);

    const detailMissing = await call('viewer', 'GET', P('/control/signals/999999999'));
    check('GET control/signals/:id inexistente responde 404', detailMissing.status === 404, detailMissing.json);

  } catch (error) {
    console.error('Error inesperado durante la prueba:', error);
    fail++;
  } finally {
    // Limpieza en orden inverso de dependencia (desactivación lógica).
    const projectId = (await call('admin', 'GET', '/api/projects')).json?.projects?.find((p: any) => p.code === 'TEST-001')?.id;
    if (projectId) {
      const P = (path: string) => `/api/projects/${projectId}${path}`;
      if (created.signalInstId) await call('admin', 'DELETE', P(`/signals/${created.signalInstId}`));
      if (created.signalEqId) await call('admin', 'DELETE', P(`/signals/${created.signalEqId}`));
      if (created.moduleId) await call('admin', 'DELETE', P(`/modules/${created.moduleId}`));
      if (created.slotId) await call('admin', 'DELETE', P(`/slots/${created.slotId}`));
      if (created.rackId) await call('admin', 'DELETE', P(`/racks/${created.rackId}`));
      if (created.gabineteId) await call('admin', 'DELETE', P(`/gabinetes/${created.gabineteId}`));
      if (created.instrumentoId) await call('admin', 'DELETE', P(`/instruments/${created.instrumentoId}`));
      if (created.equipoId) await call('admin', 'DELETE', P(`/equipment/${created.equipoId}`));
    }

    if (serverProcess) {
      serverProcess.kill();
    }

    console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===`);
    if (failures.length > 0) {
      console.log('Fallas:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();
