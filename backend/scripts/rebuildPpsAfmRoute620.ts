/*
 * Reconstruye las 6 rutas de 620-PPS-5005 para que incluyan su panel real
 * (620-AFM-5005) como nodo EQUIPO intermedio, ahora que la migración 027
 * lo permite — hasta ahora usaban el workaround de 2 tramos (dueño ->
 * gabinete directo, sin el panel como nodo) por ser el primer caso
 * encontrado, antes de que existiera la migración 027. El usuario lo
 * confirmó explícitamente: "620-pps no es una panel... su panel creo que
 * es un AFM" — 620-AFM-5005, no 620-PPS-5005.
 *
 * A diferencia de buildPanelRoutesEquipoIntermedio620.ts (que construye
 * rutas que no existían), acá cada señal YA tiene una ruta activa (con
 * cable/conductor ya cargados) — se DESACTIVA esa ruta vieja (soft-delete,
 * cascada a sus tramos/tramo_conductor/terminación por trigger, el
 * `nucleo.conductor` en sí NO se toca) y se crea la nueva de 3 tramos
 * DUEÑO -> PANEL -> GABINETE -> MODULO, reutilizando los MISMOS
 * conductores ya existentes (mismo cable, mismos códigos) en el nuevo
 * tramo 1 — no se crea cable/conductor nuevo, ya estaban bien cargados.
 *
 * Uso:
 *   npx tsx scripts/rebuildPpsAfmRoute620.ts --project 50050 --dry-run
 *   npx tsx scripts/rebuildPpsAfmRoute620.ts --project 50050 --apply
 */

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
  if (dryRun === apply) {
    console.error('Especificá exactamente uno de --dry-run / --apply.');
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
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${urlPath} -> ${response.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

const DUENO_TAG = '620-PPS-5005';
const PANEL_TAG = '620-AFM-5005';

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  const { equipment } = await apiFetch<{ equipment: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/equipment`);
  const equipoByTag = new Map(equipment.map((e) => [e.tagEquipo as string, e]));
  const dueno = equipoByTag.get(DUENO_TAG);
  const panel = equipoByTag.get(PANEL_TAG);
  if (!dueno) throw new Error(`Equipo dueño ${DUENO_TAG} no existe.`);
  if (!panel) throw new Error(`Equipo panel ${PANEL_TAG} no existe.`);

  const { signals } = await apiFetch<{ signals: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/control/signals`);
  const senalesDelDueno = signals.filter((s) => s.dueno?.tipo === 'equipo' && s.dueno?.tag === DUENO_TAG);

  if (senalesDelDueno.length === 0) {
    console.log(`No se encontraron señales de ${DUENO_TAG}.`);
    return;
  }

  const { connectionPoints: existingPoints } = await apiFetch<{ connectionPoints: any[] }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/connection-points`
  );
  const pointByEquipoId = new Map(existingPoints.filter((p) => p.equipoId).map((p) => [p.equipoId as string, p]));
  const pointByModuloId = new Map(existingPoints.filter((p) => p.moduloId).map((p) => [p.moduloId as string, p]));
  const pointByGabineteId = new Map(existingPoints.filter((p) => p.gabineteId).map((p) => [p.gabineteId as string, p]));

  async function ensurePointForEquipo(equipoId: string, tag: string): Promise<string> {
    const existing = pointByEquipoId.get(equipoId);
    if (existing) return existing.id;
    if (isDryRun) return `(nuevo-para-equipo-${tag})`;
    const { connectionPoint } = await apiFetch<{ connectionPoint: { id: string } }>(
      apiBase, devUserEmail, `/api/projects/${projectId}/connection-points`,
      { method: 'POST', body: { equipoId, descripcion: `Panel eléctrico / equipo dueño ${tag} (migración 027)` } }
    );
    pointByEquipoId.set(equipoId, { id: connectionPoint.id, equipoId });
    return connectionPoint.id;
  }

  let reconstruidas = 0;
  let saltadas = 0;

  for (const signal of senalesDelDueno) {
    const tagSenal = signal.tagSenal ?? signal.codigoSenal;
    if (!signal.rutaId) {
      console.warn(`  [WARN] ${tagSenal}: no tiene ruta activa — se salta (nada que reconstruir).`);
      saltadas++;
      continue;
    }

    const moduloId: string | null = signal.io?.moduloId ?? null;
    const gabineteId: string | null = signal.io?.gabineteId ?? null;
    if (!moduloId || !gabineteId) {
      console.warn(`  [WARN] ${tagSenal}: sin módulo/gabinete IO — se salta.`);
      saltadas++;
      continue;
    }

    // Conductores ya cargados en el tramo 1 de la ruta VIEJA — se
    // reutilizan tal cual en el tramo 1 de la ruta NUEVA.
    const { conexionado } = await apiFetch<{ conexionado: Array<{ numeroOrden: number; conductores: Array<{ conductorId: string }> }> }>(
      apiBase, devUserEmail, `/api/projects/${projectId}/routes/${signal.rutaId}/conexionado`
    );
    const seg1Viejo = conexionado.find((s) => s.numeroOrden === 1);
    const conductorIds = (seg1Viejo?.conductores ?? []).map((c) => c.conductorId);

    console.log(`${tagSenal}: ruta vieja ${signal.rutaId} (2 tramos, dueño->gabinete) -> nueva (3 tramos, dueño->${PANEL_TAG}->gabinete->modulo), conductores a migrar: [${conductorIds.join(', ')}]`);

    if (isDryRun) { reconstruidas++; continue; }

    // 1. Desactivar la ruta vieja (cascada a tramos/tramo_conductor/
    //    terminación por trigger; el conductor en sí no se toca).
    await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/routes/${signal.rutaId}`, { method: 'DELETE' });

    // 2. Puntos de conexión: dueño y gabinete/módulo ya existían (la ruta
    //    vieja los usaba); el único nuevo es el del panel.
    const pDueno = await ensurePointForEquipo(dueno.id, DUENO_TAG);
    const pPanel = await ensurePointForEquipo(panel.id, PANEL_TAG);
    const pGabinete = pointByGabineteId.get(gabineteId)?.id;
    const pModulo = pointByModuloId.get(moduloId)?.id;
    if (!pGabinete || !pModulo) {
      throw new Error(`${tagSenal}: no se encontró connection-point existente para gabinete ${gabineteId} o módulo ${moduloId} (deberían existir de la ruta vieja).`);
    }

    // 3. Ruta nueva de 3 tramos.
    const { route } = await apiFetch<{ route: { segments: Array<{ id: string; numeroOrden: number }> } }>(
      apiBase, devUserEmail, `/api/projects/${projectId}/routes`,
      {
        method: 'POST',
        body: {
          senalId: signal.id,
          segments: [
            { puntoOrigenId: pDueno, puntoDestinoId: pPanel },
            { puntoOrigenId: pPanel, puntoDestinoId: pGabinete },
            { puntoOrigenId: pGabinete, puntoDestinoId: pModulo }
          ]
        }
      }
    );
    const tramo1Nuevo = route.segments.find((s) => s.numeroOrden === 1)!;

    // 4. Migrar los conductores ya existentes al nuevo tramo 1.
    for (const conductorId of conductorIds) {
      await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores`, {
        method: 'POST',
        body: { tramoConexionId: tramo1Nuevo.id, conductorId }
      });
    }

    reconstruidas++;
  }

  console.log(`\n=== Resumen (${mode}) ===`);
  console.log(`Rutas reconstruidas: ${reconstruidas}`);
  console.log(`Saltadas:            ${saltadas}`);
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
