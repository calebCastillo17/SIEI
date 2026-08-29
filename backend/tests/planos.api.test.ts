/*
 * Pruebas de API para el módulo de Planos (nucleo.plano,
 * cat.cat_tipo_plano, nucleo.gabinete_plano, nucleo.caja_plano —
 * migración 014).
 *
 * Autocontenida: crea sus propios gabinetes/cajas/proyecto temporal con
 * TAGs únicos por corrida, limpia todo en `finally`.
 *
 * Requiere que la base ya tenga el proyecto TEST-001 y los usuarios DEV
 * (migraciones 001-003 + database/dev/001_dev_auth_seed.sql aplicados).
 *
 * Uso: npm run test:planos   (ver backend/package.json)
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
  let projectId2: string | undefined;

  const createdPlanoIds: string[] = [];
  const createdGabineteIds: string[] = [];
  const createdCajaIds: string[] = [];

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

    const PLANOS = `/api/projects/${projectId}/planos`;
    const GABINETES = `/api/projects/${projectId}/gabinetes`;
    const CAJAS = `/api/projects/${projectId}/boxes`;
    const TIPOS_PLANO = '/api/catalogs/tipos-plano';

    // ===================== Catálogo global: cat_tipo_plano =====================

    const tiposPlano = await call('viewer', 'GET', TIPOS_PLANO);
    const tipoCodes = (tiposPlano.json?.items ?? []).map((i: any) => i.codigo).sort();
    check(
      'GET tipos-plano trae exactamente los 4 tipos aprobados',
      tiposPlano.status === 200 &&
        JSON.stringify(tipoCodes) === JSON.stringify(['CONEXIONADO', 'INTERIOR_GABINETE', 'LAYOUT', 'UNIFILAR']),
      tiposPlano.json
    );
    const tipoConexionadoId: string | undefined = (tiposPlano.json?.items ?? []).find((t: any) => t.codigo === 'CONEXIONADO')?.id;
    const tipoLayoutId: string | undefined = (tiposPlano.json?.items ?? []).find((t: any) => t.codigo === 'LAYOUT')?.id;

    // --- Fixtures propios: gabinete y caja para asociar ---
    const tiposGabinete = await call('viewer', 'GET', '/api/catalogs/tipos-gabinete');
    const tipoRioId: string | undefined = (tiposGabinete.json?.items ?? []).find((t: any) => t.codigo === 'RIO')?.id;

    const createGabinete = await call('admin', 'POST', GABINETES, { tagGabinete: `GAB-PLANO-${runId}`, tipoGabineteId: tipoRioId });
    check('ADMIN crea gabinete fixture', createGabinete.status === 201, createGabinete.json);
    const gabineteId: string | undefined = createGabinete.json?.gabinete?.id;
    if (gabineteId) createdGabineteIds.push(gabineteId);

    const createGabinete2 = await call('admin', 'POST', GABINETES, { tagGabinete: `GAB-PLANO-2-${runId}`, tipoGabineteId: tipoRioId });
    const gabineteId2: string | undefined = createGabinete2.json?.gabinete?.id;
    if (gabineteId2) createdGabineteIds.push(gabineteId2);

    const createCaja = await call('admin', 'POST', CAJAS, { tagCaja: `CAJA-PLANO-${runId}` });
    check('ADMIN crea caja fixture', createCaja.status === 201, createCaja.json);
    const cajaId: string | undefined = createCaja.json?.box?.id;
    if (cajaId) createdCajaIds.push(cajaId);

    // ===================== VIEWER =====================
    const viewerList = await call('viewer', 'GET', PLANOS);
    check('VIEWER puede listar planos (200)', viewerList.status === 200, viewerList.json);

    const viewerCreate = await call('viewer', 'POST', PLANOS, { descripcion: 'Denegado', tipoPlanoId: tipoConexionadoId });
    check('VIEWER no puede crear plano (403)', viewerCreate.status === 403, viewerCreate.json);

    // ===================== EDITOR: validaciones =====================

    const noDescripcion = await call('editor', 'POST', PLANOS, { tipoPlanoId: tipoConexionadoId });
    check('EDITOR: crear sin descripcion -> 400', noDescripcion.status === 400, noDescripcion.json);

    const noTipo = await call('editor', 'POST', PLANOS, { descripcion: 'Sin tipo' });
    check('EDITOR: crear sin tipoPlanoId -> 400', noTipo.status === 400, noTipo.json);

    const tipoInvalido = await call('editor', 'POST', PLANOS, { descripcion: 'Tipo invalido', tipoPlanoId: '999999' });
    check(
      'EDITOR: tipoPlanoId inexistente -> 400 invalid_reference',
      tipoInvalido.status === 400 && tipoInvalido.json?.error === 'invalid_reference',
      tipoInvalido.json
    );

    // ===================== EDITOR: crear planos =====================

    const codigo = `620-J-${runId}`;
    const createPlanoConCodigo = await call('editor', 'POST', PLANOS, {
      codigoPlano: codigo,
      descripcion: 'Plano de prueba con código',
      tipoPlanoId: tipoConexionadoId
    });
    check(
      'EDITOR crea plano con codigoPlano (201, incluye gabinetes/cajas vacíos)',
      createPlanoConCodigo.status === 201 &&
        createPlanoConCodigo.json?.plano?.codigoPlano === codigo &&
        Array.isArray(createPlanoConCodigo.json?.plano?.gabinetes) &&
        createPlanoConCodigo.json.plano.gabinetes.length === 0 &&
        Array.isArray(createPlanoConCodigo.json?.plano?.cajas) &&
        createPlanoConCodigo.json.plano.cajas.length === 0,
      createPlanoConCodigo.json
    );
    const planoId: string | undefined = createPlanoConCodigo.json?.plano?.id;
    if (planoId) createdPlanoIds.push(planoId);

    const createPlanoSinCodigo = await call('editor', 'POST', PLANOS, {
      descripcion: 'Plano de prueba sin código (LAYOUT)',
      tipoPlanoId: tipoLayoutId
    });
    check(
      'EDITOR crea plano sin codigoPlano (201, codigoPlano null)',
      createPlanoSinCodigo.status === 201 && createPlanoSinCodigo.json?.plano?.codigoPlano === null,
      createPlanoSinCodigo.json
    );
    const planoSinCodigoId: string | undefined = createPlanoSinCodigo.json?.plano?.id;
    if (planoSinCodigoId) createdPlanoIds.push(planoSinCodigoId);

    // Mismo codigoPlano dos veces en el mismo proyecto -> PERMITIDO (sin UNIQUE)
    const createPlanoCodigoDuplicado = await call('editor', 'POST', PLANOS, {
      codigoPlano: codigo,
      descripcion: 'Plano de prueba con código duplicado',
      tipoPlanoId: tipoConexionadoId
    });
    check(
      'EDITOR: codigoPlano duplicado -> PERMITIDO (201, sin UNIQUE)',
      createPlanoCodigoDuplicado.status === 201,
      createPlanoCodigoDuplicado.json
    );
    if (createPlanoCodigoDuplicado.json?.plano?.id) createdPlanoIds.push(createPlanoCodigoDuplicado.json.plano.id);

    // ===================== GET detalle / filtros =====================

    const getDetail = await call('viewer', 'GET', `${PLANOS}/${planoId}`);
    check('VIEWER puede leer detalle de plano (200)', getDetail.status === 200, getDetail.json);

    const filterByTipo = await call('viewer', 'GET', `${PLANOS}?tipoPlanoId=${tipoConexionadoId}`);
    check(
      'GET planos?tipoPlanoId= filtra correctamente',
      filterByTipo.status === 200 && filterByTipo.json?.planos?.every((p: any) => p.tipoPlanoId === tipoConexionadoId),
      filterByTipo.json
    );

    // ===================== Asociaciones gabinete =====================

    const associateGab = await call('editor', 'POST', `${PLANOS}/${planoId}/gabinetes`, { gabineteId });
    check(
      'EDITOR asocia gabinete al plano (201, aparece en detalle)',
      associateGab.status === 201 &&
        associateGab.json?.plano?.gabinetes?.some((g: any) => g.gabineteId === gabineteId),
      associateGab.json
    );

    const associateGabDup = await call('editor', 'POST', `${PLANOS}/${planoId}/gabinetes`, { gabineteId });
    check(
      'EDITOR: re-asociar el mismo gabinete activo -> 409 gabinete_plano_conflict',
      associateGabDup.status === 409 && associateGabDup.json?.error === 'gabinete_plano_conflict',
      associateGabDup.json
    );

    const filterByGabinete = await call('viewer', 'GET', `${PLANOS}?gabineteId=${gabineteId}`);
    check(
      'GET planos?gabineteId= filtra correctamente',
      filterByGabinete.status === 200 && filterByGabinete.json?.planos?.some((p: any) => p.id === planoId),
      filterByGabinete.json
    );

    const disassociateGab = await call('editor', 'DELETE', `${PLANOS}/${planoId}/gabinetes/${gabineteId}`);
    check(
      'EDITOR desasocia el gabinete (200, ya no aparece)',
      disassociateGab.status === 200 &&
        !disassociateGab.json?.plano?.gabinetes?.some((g: any) => g.gabineteId === gabineteId),
      disassociateGab.json
    );

    const reassociateGab = await call('editor', 'POST', `${PLANOS}/${planoId}/gabinetes`, { gabineteId });
    check(
      'EDITOR re-asocia el mismo gabinete tras desasociar -> 200 (reactivado, no 201)',
      reassociateGab.status === 200 &&
        reassociateGab.json?.plano?.gabinetes?.some((g: any) => g.gabineteId === gabineteId),
      reassociateGab.json
    );

    // Un plano con varios gabinetes (N:M real)
    const associateGab2 = await call('editor', 'POST', `${PLANOS}/${planoId}/gabinetes`, { gabineteId: gabineteId2 });
    check(
      'EDITOR asocia un SEGUNDO gabinete al mismo plano (201, N:M real)',
      associateGab2.status === 201 && associateGab2.json?.plano?.gabinetes?.length === 2,
      associateGab2.json
    );

    // ===================== Asociaciones caja =====================

    const associateCajaCall = await call('editor', 'POST', `${PLANOS}/${planoId}/cajas`, { cajaId });
    check(
      'EDITOR asocia caja al plano (201, aparece en detalle)',
      associateCajaCall.status === 201 &&
        associateCajaCall.json?.plano?.cajas?.some((c: any) => c.cajaId === cajaId),
      associateCajaCall.json
    );

    const associateCajaDup = await call('editor', 'POST', `${PLANOS}/${planoId}/cajas`, { cajaId });
    check(
      'EDITOR: re-asociar la misma caja activa -> 409 caja_plano_conflict',
      associateCajaDup.status === 409 && associateCajaDup.json?.error === 'caja_plano_conflict',
      associateCajaDup.json
    );

    const filterByCaja = await call('viewer', 'GET', `${PLANOS}?cajaId=${cajaId}`);
    check(
      'GET planos?cajaId= filtra correctamente',
      filterByCaja.status === 200 && filterByCaja.json?.planos?.some((p: any) => p.id === planoId),
      filterByCaja.json
    );

    // ===================== Cross-project =====================

    const createProject2 = await call('admin', 'POST', '/api/projects', {
      clientId: project.clientId,
      code: `PLN-${runId}`,
      name: 'Proyecto temporal para prueba de plano cruzado'
    });
    projectId2 = createProject2.json?.project?.id;

    if (projectId2) {
      const createGabineteOtroProyecto = await call('admin', 'POST', `/api/projects/${projectId2}/gabinetes`, {
        tagGabinete: `GAB-CRUZADO-${runId}`,
        tipoGabineteId: tipoRioId
      });
      const gabineteOtroProyectoId: string | undefined = createGabineteOtroProyecto.json?.gabinete?.id;

      if (gabineteOtroProyectoId) {
        const crossGab = await call('editor', 'POST', `${PLANOS}/${planoId}/gabinetes`, { gabineteId: gabineteOtroProyectoId });
        check(
          'EDITOR: asociar gabinete de otro proyecto -> 400 invalid_reference',
          crossGab.status === 400 && crossGab.json?.error === 'invalid_reference',
          crossGab.json
        );
      }

      const createCajaOtroProyecto = await call('admin', 'POST', `/api/projects/${projectId2}/boxes`, {
        tagCaja: `CAJA-CRUZADA-${runId}`
      });
      const cajaOtroProyectoId: string | undefined = createCajaOtroProyecto.json?.box?.id;

      if (cajaOtroProyectoId) {
        const crossCaja = await call('editor', 'POST', `${PLANOS}/${planoId}/cajas`, { cajaId: cajaOtroProyectoId });
        check(
          'EDITOR: asociar caja de otro proyecto -> 400 invalid_reference',
          crossCaja.status === 400 && crossCaja.json?.error === 'invalid_reference',
          crossCaja.json
        );
      }

      // Limpieza del proyecto temporal (archivar, no borra datos nucleo).
      await call('admin', 'DELETE', `/api/projects/${projectId2}`).catch(() => null);
    }

    // ===================== PATCH =====================

    const patchOk = await call('editor', 'PATCH', `${PLANOS}/${planoId}`, { descripcion: 'Descripción actualizada' });
    check(
      'EDITOR actualiza descripcion (200)',
      patchOk.status === 200 && patchOk.json?.plano?.descripcion === 'Descripción actualizada',
      patchOk.json
    );

    const patchCodigoAnterior = await call('editor', 'PATCH', `${PLANOS}/${planoId}`, { codigoAnterior: '620-J-LEGACY-01' });
    check(
      'EDITOR actualiza codigoAnterior (200)',
      patchCodigoAnterior.status === 200 && patchCodigoAnterior.json?.plano?.codigoAnterior === '620-J-LEGACY-01',
      patchCodigoAnterior.json
    );

    const patchDescripcionVacia = await call('editor', 'PATCH', `${PLANOS}/${planoId}`, { descripcion: '' });
    check('EDITOR: PATCH con descripcion vacía -> 400', patchDescripcionVacia.status === 400, patchDescripcionVacia.json);

    const viewerPatch = await call('viewer', 'PATCH', `${PLANOS}/${planoId}`, { descripcion: 'hack' });
    check('VIEWER no puede editar (403)', viewerPatch.status === 403, viewerPatch.json);

    // ===================== DELETE (soft) =====================

    const editorDelete = await call('editor', 'DELETE', `${PLANOS}/${planoSinCodigoId}`);
    check('EDITOR no puede desactivar (403, requiere permiso deactivate)', editorDelete.status === 403, editorDelete.json);

    const adminDelete = await call('admin', 'DELETE', `${PLANOS}/${planoSinCodigoId}`);
    check(
      'ADMIN desactiva plano (200)',
      adminDelete.status === 200 && adminDelete.json?.plano?.active === false,
      adminDelete.json
    );

    const getDeactivated = await call('admin', 'GET', `${PLANOS}/${planoSinCodigoId}`);
    check('Plano desactivado ya no aparece en GET (404)', getDeactivated.status === 404, getDeactivated.json);

    const noAccess = await call('viewer', 'GET', '/api/projects/999999/planos');
    check('Proyecto sin acceso -> 403/404', [403, 404].includes(noAccess.status), noAccess.json);

  } finally {
    if (projectId) {
      for (const id of createdPlanoIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/planos/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar plano ${id} (status ${r?.status})`);
      }
      for (const id of createdGabineteIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/gabinetes/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar gabinete ${id} (status ${r?.status})`);
      }
      for (const id of createdCajaIds) {
        const r = await call('admin', 'DELETE', `/api/projects/${projectId}/boxes/${id}`).catch(() => null);
        if (!r || ![200, 404].includes(r.status)) console.warn(`No se pudo limpiar caja ${id} (status ${r?.status})`);
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
