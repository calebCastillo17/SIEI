/*
 * Segunda mitad del reemplazo de señales CONTROL del proyecto 620 (ver
 * reemplazarSenalesControl620Reporte2.ts, que ya migró tagSenal/servicio/
 * codigoSenal para las 175 señales del mapeo, sin tocar el dueño). El
 * usuario pidió explícitamente completar el trabajo dándole a la señal el
 * dueño real: "PERO LA IDEA ES QUE EL DUEÑO DE LA SEÑAL SEA EL INSTRUMENTO
 * ASOCIADO Y ESE INTRUMENTO ASOCIADO DEBE JALAR TODAS LAS PROPIEDADES DEL
 * INSTRUMENTO." / "aramalo y hazlo porfavor".
 *
 * De las 175 señales del mapeo, 74 ya tienen como dueño exactamente el
 * instrumento real (no requieren ningún cambio acá) y 101 siguen colgadas
 * del micro-instrumento — a esas 101 les aplica todo lo de abajo.
 *
 * POR QUÉ NO ALCANZA CON UN PATCH DIRECTO
 * ----------------------------------------
 * TR_senal_validar_canal_ruta (migración 001) rechaza cambiar
 * instrumento_id de una señal si tiene una ruta activa cuyo primer tramo
 * no se origina en el nuevo dueño. Las 101 señales SÍ tienen ruta activa
 * (verificado con datos reales), así que hay que reconstruir la ruta.
 *
 * EL RIESGO REAL QUE ESTE SCRIPT EVITA (encontrado validando con datos
 * reales antes de escribir una sola línea de escritura)
 * ----------------------------------------------------------------------
 * "No hay PATCH: reconectar una ruta es desactivarla y crear una nueva"
 * (connectionRoutes.ts) — pero desactivar la ruta entera cascada, vía
 * TR_tramo_conexion_desactivar_conductores / TR_tramo_conductor_
 * desactivar_terminaciones (migración 015), hacia sus TRAMO_CONDUCTOR y
 * TERMINACION activos. En datos reales del proyecto 620 los tramos 1 y 2
 * de estas rutas SÍ tienen terminaciones reales documentadas (cable, 2
 * conductores, bloque de bornes, posición A/B) — el tramo 2 (caja ->
 * gabinete) no cambia físicamente en absoluto, solo el tramo 1 cambia de
 * dueño (el origen deja de ser el punto del micro-instrumento). Recrear la
 * ruta "a lo simple" (solo tramos, sin tramo_conductor/terminacion)
 * habría borrado silenciosamente esa documentación real de cableado.
 *
 * Este script en cambio:
 *   1. Lee y guarda el detalle completo (tramos + tramo_conductor +
 *      terminacion) de la ruta ANTES de tocar nada.
 *   2. Crea un punto_conexion nuevo para el instrumento real, clonando los
 *      campos descriptivos (regleta/bornera/borne/lado/circuito/hilo/
 *      descripcion) del punto de origen viejo (tramo 1).
 *   3. Desactiva la ruta vieja (DELETE /routes/:id).
 *   4. Hace el PATCH de instrumentoId de la señal (ya sin ruta activa que
 *      lo bloquee).
 *   5. Crea la ruta nueva con la MISMA estructura: tramo 1 con el punto de
 *      origen nuevo (mismo destino que antes), tramos 2..N idénticos
 *      (mismos origen/destino — no cambiaron físicamente).
 *   6. Re-crea, tramo por tramo, cada tramo_conductor y cada terminación
 *      que existía antes (mismo conductor, misma posición de terminal,
 *      mismo extremo) — el conductor y la posición de terminal en sí no se
 *      tocaron nunca, solo quedaron libres al desactivarse el tramo_
 *      conductor viejo.
 *
 * Uso:
 *   npx tsx scripts/reconstruirRutasSenalesControl620Reporte2.ts --project <projectId> --dry-run
 *   npx tsx scripts/reconstruirRutasSenalesControl620Reporte2.ts --project <projectId> --apply
 *   [--api http://localhost:3000] [--user admin@siei.local]
 *
 * Idempotente por señal: si al leerla su instrumentoId ya es el real, se
 * reporta SKIP sin tocar nada. Cada señal se procesa de forma
 * independiente (un error en una no aborta el resto) — si una falla a
 * mitad de camino después de desactivar su ruta vieja, queda sin ruta
 * activa (estado válido de "ingeniería inconclusa", nunca corrupto) y se
 * reporta en detalle para revisión manual.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface MapeoEntry {
  senalId: string;
  tagSenalActual: string;
  duenoTagActual: string;
  duenoIdActual: string;
  servicio: string | null;
  nuevoInstrumentoTag: string;
  nuevoTagSenal: string;
  tipoSenalNueva: string;
  tipoIoCodigo: 'AI' | 'RTD' | null;
  pnpidNuevo: string;
  nuevoInstrumentoId: string;
}

interface Args {
  projectId: string;
  apiBase: string;
  devUserEmail: string;
  mode: 'dry-run' | 'apply';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  const projectId = get('--project');
  if (!projectId) {
    console.error('Falta --project <projectId>.');
    process.exit(1);
  }

  const dryRun = has('--dry-run');
  const apply = has('--apply');
  if (dryRun && apply) {
    console.error('No usar --dry-run y --apply al mismo tiempo.');
    process.exit(1);
  }
  if (!dryRun && !apply) {
    console.error('Debe indicarse --dry-run o --apply explícitamente.');
    process.exit(1);
  }

  return {
    projectId,
    apiBase: get('--api') ?? 'http://localhost:3000',
    devUserEmail: get('--user') ?? 'admin@siei.local',
    mode: dryRun ? 'dry-run' : 'apply'
  };
}

async function apiFetch<T = any>(
  apiBase: string,
  devUserEmail: string,
  urlPath: string,
  options: { method?: string; body?: unknown } = {}
): Promise<{ status: number; json: T }> {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const json = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, json };
}

interface OldTerminacion {
  extremo: 'ORIGEN' | 'DESTINO';
  posicionTerminalId: string;
}

interface OldTramoConductor {
  conductorId: string;
  terminaciones: OldTerminacion[];
}

interface OldSegment {
  numeroOrden: number;
  puntoOrigenId: string;
  puntoDestinoId: string;
  parConductorId: string | null;
  tramoConductores: OldTramoConductor[];
}

interface RoutePlan {
  senalId: string;
  duenoActualId: string;
  nuevoInstrumentoId: string;
  oldRouteId: string;
  oldSegments: OldSegment[];
  oldOriginPoint: {
    regleta: string | null;
    bornera: string | null;
    borne: string | null;
    lado: string | null;
    circuito: string | null;
    hilo: string | null;
    descripcion: string | null;
  };
}

async function buildPlan(
  apiBase: string,
  devUserEmail: string,
  projectId: string,
  entry: MapeoEntry
): Promise<{ plan?: RoutePlan; skipReason?: string; error?: string }> {
  const senalResp = await apiFetch<{ signal: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${entry.senalId}`);
  if (senalResp.status !== 200) {
    return { error: `No se pudo leer la señal: ${JSON.stringify(senalResp.json)}` };
  }
  const senal = senalResp.json.signal;

  if (senal.instrumentoId === entry.nuevoInstrumentoId) {
    return { skipReason: `dueño ya es el instrumento real (${entry.nuevoInstrumentoTag})` };
  }

  const routesResp = await apiFetch<{ routes: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/routes?senalId=${entry.senalId}`);
  if (routesResp.status !== 200) {
    return { error: `No se pudo listar rutas: ${JSON.stringify(routesResp.json)}` };
  }
  const rutasActivas = routesResp.json.routes ?? [];
  if (rutasActivas.length === 0) {
    return { error: 'La señal no tiene ruta activa pero su dueño tampoco es el real — caso no contemplado, revisar a mano.' };
  }
  if (rutasActivas.length > 1) {
    return { error: `La señal tiene ${rutasActivas.length} rutas activas simultáneas — caso no contemplado, revisar a mano.` };
  }
  const oldRouteId = String(rutasActivas[0].id);

  const routeDetailResp = await apiFetch<{ route: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/routes/${oldRouteId}`);
  if (routeDetailResp.status !== 200) {
    return { error: `No se pudo leer el detalle de la ruta ${oldRouteId}: ${JSON.stringify(routeDetailResp.json)}` };
  }
  const segments: any[] = routeDetailResp.json.route.segments;
  if (!segments || segments.length === 0) {
    return { error: `La ruta ${oldRouteId} no tiene tramos activos — caso no contemplado, revisar a mano.` };
  }

  const oldSegments: OldSegment[] = [];
  for (const seg of segments) {
    const tramoConductoresResp = await apiFetch<{ tramosConductores: any[] }>(
      apiBase,
      devUserEmail,
      `/api/projects/${projectId}/tramo-conductores?tramoConexionId=${seg.id}`
    );
    if (tramoConductoresResp.status !== 200) {
      return { error: `No se pudieron leer los tramo_conductor del tramo ${seg.id}: ${JSON.stringify(tramoConductoresResp.json)}` };
    }

    const tramoConductores: OldTramoConductor[] = [];
    for (const tc of tramoConductoresResp.json.tramosConductores ?? []) {
      const detailResp = await apiFetch<{ tramoConductor: any }>(
        apiBase,
        devUserEmail,
        `/api/projects/${projectId}/tramo-conductores/${tc.id}`
      );
      if (detailResp.status !== 200) {
        return { error: `No se pudo leer el detalle del tramo_conductor ${tc.id}: ${JSON.stringify(detailResp.json)}` };
      }
      const detail = detailResp.json.tramoConductor;
      tramoConductores.push({
        conductorId: detail.conductorId,
        terminaciones: (detail.terminaciones ?? []).map((t: any) => ({
          extremo: t.extremo,
          posicionTerminalId: t.posicionTerminalId
        }))
      });
    }

    oldSegments.push({
      numeroOrden: seg.numeroOrden,
      puntoOrigenId: seg.puntoOrigenId,
      puntoDestinoId: seg.puntoDestinoId,
      parConductorId: seg.parConductorId,
      tramoConductores
    });
  }

  const primerTramo = oldSegments.find((s) => s.numeroOrden === 1);
  if (!primerTramo) {
    return { error: `La ruta ${oldRouteId} no tiene tramo con numeroOrden=1 — caso no contemplado, revisar a mano.` };
  }

  const origenPointResp = await apiFetch<{ connectionPoint: any }>(
    apiBase,
    devUserEmail,
    `/api/projects/${projectId}/connection-points/${primerTramo.puntoOrigenId}`
  );
  if (origenPointResp.status !== 200) {
    return { error: `No se pudo leer el punto de origen ${primerTramo.puntoOrigenId}: ${JSON.stringify(origenPointResp.json)}` };
  }
  const origenPoint = origenPointResp.json.connectionPoint;

  return {
    plan: {
      senalId: entry.senalId,
      duenoActualId: senal.instrumentoId,
      nuevoInstrumentoId: entry.nuevoInstrumentoId,
      oldRouteId,
      oldSegments,
      oldOriginPoint: {
        regleta: origenPoint.regleta,
        bornera: origenPoint.bornera,
        borne: origenPoint.borne,
        lado: origenPoint.lado,
        circuito: origenPoint.circuito,
        hilo: origenPoint.hilo,
        descripcion: origenPoint.descripcion
      }
    }
  };
}

async function executePlan(
  apiBase: string,
  devUserEmail: string,
  projectId: string,
  plan: RoutePlan
): Promise<{ ok: true } | { ok: false; step: string; message: string }> {
  // 1. Punto nuevo para el instrumento real, clonando campos descriptivos.
  const newPointResp = await apiFetch<{ connectionPoint: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/connection-points`, {
    method: 'POST',
    body: { instrumentoId: plan.nuevoInstrumentoId, ...plan.oldOriginPoint }
  });
  if (newPointResp.status !== 201) {
    return { ok: false, step: 'crear_punto_nuevo', message: JSON.stringify(newPointResp.json) };
  }
  const newPointId = newPointResp.json.connectionPoint.id;

  // 2. Desactivar la ruta vieja (cascada tramos -> tramo_conductor -> terminacion).
  const deleteRouteResp = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/routes/${plan.oldRouteId}`, { method: 'DELETE' });
  if (deleteRouteResp.status !== 200) {
    return { ok: false, step: 'desactivar_ruta_vieja', message: JSON.stringify(deleteRouteResp.json) };
  }

  // 3. PATCH del dueño de la señal — ya sin ruta activa que lo bloquee.
  const patchSenalResp = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${plan.senalId}`, {
    method: 'PATCH',
    body: { instrumentoId: plan.nuevoInstrumentoId }
  });
  if (patchSenalResp.status !== 200) {
    return { ok: false, step: 'patch_dueno_senal', message: JSON.stringify(patchSenalResp.json) };
  }

  // 4. Ruta nueva, misma estructura — tramo 1 con el punto nuevo, el resto igual.
  const newSegmentsBody = plan.oldSegments
    .slice()
    .sort((a, b) => a.numeroOrden - b.numeroOrden)
    .map((seg) => ({
      puntoOrigenId: seg.numeroOrden === 1 ? newPointId : seg.puntoOrigenId,
      puntoDestinoId: seg.puntoDestinoId,
      parConductorId: seg.parConductorId
    }));

  const newRouteResp = await apiFetch<{ route: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/routes`, {
    method: 'POST',
    body: { senalId: plan.senalId, segments: newSegmentsBody }
  });
  if (newRouteResp.status !== 201) {
    return { ok: false, step: 'crear_ruta_nueva', message: JSON.stringify(newRouteResp.json) };
  }
  const newSegments: any[] = newRouteResp.json.route.segments;

  // 5. Re-crear, tramo por tramo, cada tramo_conductor + terminacion que existía antes.
  for (const oldSeg of plan.oldSegments) {
    const newSeg = newSegments.find((s) => s.numeroOrden === oldSeg.numeroOrden);
    if (!newSeg) {
      return { ok: false, step: 'restaurar_conductores', message: `No se encontró el tramo nuevo con numeroOrden=${oldSeg.numeroOrden}` };
    }

    for (const oldTc of oldSeg.tramoConductores) {
      const newTcResp = await apiFetch<{ tramoConductor: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores`, {
        method: 'POST',
        body: { tramoConexionId: newSeg.id, conductorId: oldTc.conductorId }
      });
      if (newTcResp.status !== 201) {
        return {
          ok: false,
          step: 'restaurar_conductores',
          message: `tramo ${newSeg.id} (orden ${oldSeg.numeroOrden}) conductor ${oldTc.conductorId}: ${JSON.stringify(newTcResp.json)}`
        };
      }
      const newTcId = newTcResp.json.tramoConductor.id;

      for (const oldTerm of oldTc.terminaciones) {
        const newTermResp = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores/${newTcId}/terminaciones`, {
          method: 'POST',
          body: { extremo: oldTerm.extremo, posicionTerminalId: oldTerm.posicionTerminalId }
        });
        if (newTermResp.status !== 201) {
          return {
            ok: false,
            step: 'restaurar_conductores',
            message: `tramo_conductor ${newTcId} extremo ${oldTerm.extremo} posicion ${oldTerm.posicionTerminalId}: ${JSON.stringify(newTermResp.json)}`
          };
        }
      }
    }
  }

  return { ok: true };
}

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== reconstruirRutasSenalesControl620Reporte2.ts (${mode.toUpperCase()}) ===`);
  console.log(`API: ${apiBase}  |  Usuario dev: ${devUserEmail}`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const mapeoPath = path.resolve(__dirname, 'data/mapeoSenalesControl620Reporte2.json');
  const mapeo: MapeoEntry[] = JSON.parse(await readFile(mapeoPath, 'utf-8'));
  console.log(`\n${mapeo.length} señales en el mapeo.`);

  let ok = 0, skip = 0, error = 0;
  const errores: Array<{ senalId: string; tag: string; message: string }> = [];

  for (const entry of mapeo) {
    const { plan, skipReason, error: planError } = await buildPlan(apiBase, devUserEmail, projectId, entry);

    if (skipReason) {
      skip++;
      console.log(`  = SKIP ${entry.nuevoTagSenal} (${skipReason})`);
      continue;
    }
    if (planError || !plan) {
      error++;
      errores.push({ senalId: entry.senalId, tag: entry.nuevoTagSenal, message: planError ?? 'plan desconocido' });
      console.log(`  ! ERROR (plan) ${entry.nuevoTagSenal}: ${planError}`);
      continue;
    }

    const totalConductores = plan.oldSegments.reduce((acc, s) => acc + s.tramoConductores.length, 0);
    const totalTerminaciones = plan.oldSegments.reduce(
      (acc, s) => acc + s.tramoConductores.reduce((a2, tc) => a2 + tc.terminaciones.length, 0),
      0
    );

    if (isDryRun) {
      console.log(
        `  + ${entry.nuevoTagSenal} | dueño ${plan.duenoActualId} -> ${plan.nuevoInstrumentoId} | ruta ${plan.oldRouteId} (${plan.oldSegments.length} tramos, ${totalConductores} tramo_conductor, ${totalTerminaciones} terminaciones a restaurar)`
      );
      ok++;
      continue;
    }

    const result = await executePlan(apiBase, devUserEmail, projectId, plan);
    if (result.ok) {
      ok++;
      console.log(`  + ${entry.nuevoTagSenal} | dueño ${plan.duenoActualId} -> ${plan.nuevoInstrumentoId} | ruta ${plan.oldRouteId} -> reconstruida (${totalConductores} conductores, ${totalTerminaciones} terminaciones restauradas)`);
    } else {
      error++;
      errores.push({ senalId: entry.senalId, tag: entry.nuevoTagSenal, message: `[${result.step}] ${result.message}` });
      console.log(`  ! ERROR ${entry.nuevoTagSenal} en paso "${result.step}": ${result.message}`);
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Modo: ${mode}`);
  console.log(`OK=${ok}  SKIP=${skip}  ERROR=${error}`);
  if (errores.length > 0) {
    console.log('\nErrores (revisar a mano — una señal que falló después de "desactivar_ruta_vieja" puede haber quedado sin ruta activa):');
    errores.forEach((e) => console.log(`  [señal ${e.senalId} / ${e.tag}] ${e.message}`));
  }

  process.exit(error > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
