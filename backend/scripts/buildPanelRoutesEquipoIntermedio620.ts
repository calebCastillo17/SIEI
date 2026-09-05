/*
 * Construye las rutas DUEÑO(equipo) -> PANEL(equipo, distinto del dueño) ->
 * GABINETE -> MODULO para los grupos "panel eléctrico" del proyecto 620 que
 * quedaron bloqueados hasta la migración 027 (TR_tramo_conexion_validar_
 * secuencia ahora acepta EQUIPO como nodo intermedio — ver esa migración y
 * el hallazgo completo de 15 grupos, documentado en el mensaje del usuario
 * "PERO HAY MAS...").
 *
 * De los 15 grupos encontrados en la hoja SENALES del master:
 *   - 620-PPS-5005 -> 620-AFM-5005 (6 señales) YA fue construido en esta
 *     misma sesión con el workaround de 2 tramos (dueño->gabinete directo,
 *     sin el panel como nodo) — deliberadamente NO se reconstruye acá, es
 *     una decisión aparte pendiente de confirmar con el usuario.
 *   - 620-PPC-5009 -> 620-AFL-5001, 620-PPC-5010 -> 620-AFL-5002,
 *     620-PPC-XXX3 -> 620-AFL-XXX3 (18 señales) siguen BLOQUEADOS: el
 *     equipo dueño no existe en nucleo.equipo para este proyecto — fuera
 *     de alcance, requiere un import de equipos aparte.
 *   - Los 11 grupos restantes (30 señales) SÍ se construyen acá, todos con
 *     dueño y panel ya existentes en la base:
 *       620-PPS-5006      -> 620-AFM-5006   (6)
 *       420-SGL-605-CB1   -> 420-SGL-605    (2)
 *       420-SGL-605-CB2   -> 420-SGL-605    (2)
 *       420-SGL-605-CB5   -> 420-SGL-605    (2)
 *       420-MCL-605-P1    -> 420-MCL-5008   (2)
 *       420-MCL-605-P2    -> 420-MCL-5008   (2)
 *       420-SGL-5002-P1   -> 420-SGL-5002   (2)
 *       420-SGL-5002-P2   -> 420-SGL-5002   (2)
 *       420-SGL-5002-C1   -> 420-SGL-5002   (2)
 *       420-SGL-5002-C2   -> 420-SGL-5002   (2)
 *       620-AGA-5001A     -> 620-MCL-5008   (6)
 *
 * Cada señal ya tenía su IO asignado (canal_id -> modulo -> slot -> rack ->
 * gabinete) desde antes de esta sesión — el propio canal_id de la señal
 * resuelve GABINETE/MODULO reales, no hace falta inventarlos. El cable
 * hacia cada panel (ej. 620AFM5006-T01) también ya existía, con 0
 * conductores — igual que el caso PPS-5005 ya resuelto.
 *
 * Para cada señal:
 *   1. Asegura (crea si falta, reutiliza si ya existe) el connection-point
 *      del equipo DUEÑO y del equipo PANEL — un punto por equipo, compartido
 *      entre todas las señales de su grupo (varias señales de un mismo
 *      dueño/panel reutilizan el mismo punto, igual que caja/gabinete).
 *   2. Asegura el connection-point del GABINETE y del MODULO reales de la
 *      señal (resueltos vía canal_id -> modulo -> slot -> rack -> gabinete).
 *   3. POST /routes con 3 tramos (par_conductor_id NULL en los 3, modelo
 *      nuevo de 015): DUEÑO->PANEL, PANEL->GABINETE, GABINETE->MODULO.
 *   4. Crea 2 conductores nuevos en el cable del panel (códigos
 *      2*N_PAR_CABLE-1 / 2*N_PAR_CABLE, misma fórmula ya usada en
 *      fixCablePanelesElectricos620.ts) y los asocia al tramo 1 (el único
 *      tramo con "cable real de campo") vía POST /tramo-conductores.
 *
 * Uso:
 *   npx tsx scripts/buildPanelRoutesEquipoIntermedio620.ts --project 50050 --dry-run
 *   npx tsx scripts/buildPanelRoutesEquipoIntermedio620.ts --project 50050 --apply
 *   [--api http://localhost:3000] [--user admin@siei.local]
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

/** Un grupo = un equipo dueño con N señales, todas hacia el mismo panel. */
interface Grupo {
  duenoTag: string;
  panelTag: string;
  tagCable: string;
  senales: { tagSenal: string; nParCable: number }[];
}

const GRUPOS: Grupo[] = [
  {
    duenoTag: '620-PPS-5006', panelTag: '620-AFM-5006', tagCable: '620AFM5006-T01',
    senales: [
      { tagSenal: '620-PPS-5006_RDY', nParCable: 1 },
      { tagSenal: '620-PPS-5006_REM', nParCable: 2 },
      { tagSenal: '620-PPS-5006_ESP', nParCable: 3 },
      { tagSenal: '620-PPS-5006_RUN', nParCable: 4 },
      { tagSenal: '620-PPS-5006_FAL', nParCable: 5 },
      { tagSenal: '620-PPS-5006_ST', nParCable: 6 }
    ]
  },
  {
    duenoTag: '420-SGL-605-CB1', panelTag: '420-SGL-605', tagCable: '420SGL605-T01',
    senales: [
      { tagSenal: '420-SGL-605-CB1_HYO', nParCable: 1 },
      { tagSenal: '420-SGL-605-CB1_HYC', nParCable: 2 }
    ]
  },
  {
    duenoTag: '420-SGL-605-CB2', panelTag: '420-SGL-605', tagCable: '420SGL605-T01',
    senales: [
      { tagSenal: '420-SGL-605-CB2_HYO', nParCable: 3 },
      { tagSenal: '420-SGL-605-CB2_HYC', nParCable: 4 }
    ]
  },
  {
    duenoTag: '420-SGL-605-CB5', panelTag: '420-SGL-605', tagCable: '420SGL605-T01',
    senales: [
      { tagSenal: '420-SGL-605-CB5_HYO', nParCable: 5 },
      { tagSenal: '420-SGL-605-CB5_HYC', nParCable: 6 }
    ]
  },
  {
    duenoTag: '420-MCL-605-P1', panelTag: '420-MCL-5008', tagCable: '420MCL5008-T01',
    senales: [
      { tagSenal: '420-MCL-605-P1_HYO', nParCable: 1 },
      { tagSenal: '420-MCL-605-P1_HYC', nParCable: 2 }
    ]
  },
  {
    duenoTag: '420-MCL-605-P2', panelTag: '420-MCL-5008', tagCable: '420MCL5008-T01',
    senales: [
      { tagSenal: '420-MCL-605-P2_HYO', nParCable: 3 },
      { tagSenal: '420-MCL-605-P2_HYC', nParCable: 4 }
    ]
  },
  {
    duenoTag: '420-SGL-5002-P1', panelTag: '420-SGL-5002', tagCable: '420SGL5002-T01',
    senales: [
      { tagSenal: '420-SGL-5002-P1_HYO', nParCable: 1 },
      { tagSenal: '420-SGL-5002-P1_HYC', nParCable: 2 }
    ]
  },
  {
    duenoTag: '420-SGL-5002-P2', panelTag: '420-SGL-5002', tagCable: '420SGL5002-T01',
    senales: [
      { tagSenal: '420-SGL-5002-P2_HYO', nParCable: 3 },
      { tagSenal: '420-SGL-5002-P2_HYC', nParCable: 4 }
    ]
  },
  {
    duenoTag: '420-SGL-5002-C1', panelTag: '420-SGL-5002', tagCable: '420SGL5002-T01',
    senales: [
      { tagSenal: '420-SGL-5002-C1_HYO', nParCable: 5 },
      { tagSenal: '420-SGL-5002-C1_HYC', nParCable: 6 }
    ]
  },
  {
    duenoTag: '420-SGL-5002-C2', panelTag: '420-SGL-5002', tagCable: '420SGL5002-T01',
    senales: [
      { tagSenal: '420-SGL-5002-C2_HYO', nParCable: 7 },
      { tagSenal: '420-SGL-5002-C2_HYC', nParCable: 8 }
    ]
  },
  {
    // Anomalía real de datos (documentada, no corregida en el Excel): la
    // columna CAJA_EQUIPO de las 6 filas de 620-AGA-5001A dice literalmente
    // "620-MCL-5008" (prefijo del propio dueño, 620), pero el panel físico
    // real solo existe en nucleo.equipo como "420-MCL-5008" — el mismo
    // panel ya usado por 420-MCL-605-P1/P2. Se usa el tag REAL de la base
    // (420-MCL-5008), no el que aparece en el Excel, porque es el mismo
    // panel físico, no uno nuevo — mismo criterio que otras anomalías ya
    // documentadas en el proyecto (ver 014_planos.sql, duplicado
    // 620-J-20039).
    duenoTag: '620-AGA-5001A', panelTag: '420-MCL-5008', tagCable: '620MCL5008-T01',
    senales: [
      { tagSenal: '620-AGA-5001A_RDY', nParCable: 1 },
      { tagSenal: '620-AGA-5001A_REM', nParCable: 2 },
      { tagSenal: '620-AGA-5001A_ESP', nParCable: 3 },
      { tagSenal: '620-AGA-5001A_RUN', nParCable: 4 },
      { tagSenal: '620-AGA-5001A_FAL', nParCable: 5 },
      { tagSenal: '620-AGA-5001A_ST', nParCable: 6 }
    ]
  }
];

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  const { equipment } = await apiFetch<{ equipment: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/equipment`);
  const equipoByTag = new Map(equipment.map((e) => [e.tagEquipo as string, e]));

  const { signals } = await apiFetch<{ signals: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/control/signals`);
  const signalByTag = new Map(signals.filter((s) => s.tagSenal).map((s) => [s.tagSenal as string, s]));

  const { cables } = await apiFetch<{ cables: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/cables`);
  const cableByTag = new Map(cables.map((c) => [c.tagCable as string, c]));

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

  async function ensurePointForModulo(moduloId: string): Promise<string> {
    const existing = pointByModuloId.get(moduloId);
    if (existing) return existing.id;
    if (isDryRun) return `(nuevo-para-modulo-${moduloId})`;
    const { connectionPoint } = await apiFetch<{ connectionPoint: { id: string } }>(
      apiBase, devUserEmail, `/api/projects/${projectId}/connection-points`,
      { method: 'POST', body: { moduloId, descripcion: 'Módulo destino (panel eléctrico, migración 027)' } }
    );
    pointByModuloId.set(moduloId, { id: connectionPoint.id, moduloId });
    return connectionPoint.id;
  }

  async function ensurePointForGabinete(gabineteId: string): Promise<string> {
    const existing = pointByGabineteId.get(gabineteId);
    if (existing) return existing.id;
    if (isDryRun) return `(nuevo-para-gabinete-${gabineteId})`;
    const { connectionPoint } = await apiFetch<{ connectionPoint: { id: string } }>(
      apiBase, devUserEmail, `/api/projects/${projectId}/connection-points`,
      { method: 'POST', body: { gabineteId, descripcion: 'Gabinete (panel eléctrico, migración 027)' } }
    );
    pointByGabineteId.set(gabineteId, { id: connectionPoint.id, gabineteId });
    return connectionPoint.id;
  }

  let rutasCreadas = 0;
  let yaCorrectas = 0;
  let sinSenal = 0;
  let sinModulo = 0;
  let sinCable = 0;
  let errores = 0;
  let conductoresCreados = 0;

  for (const grupo of GRUPOS) {
    const dueno = equipoByTag.get(grupo.duenoTag);
    const panel = equipoByTag.get(grupo.panelTag);
    const cable = cableByTag.get(grupo.tagCable);

    if (!dueno) { console.warn(`[WARN] equipo dueño ${grupo.duenoTag} no existe — grupo saltado.`); errores++; continue; }
    if (!panel) { console.warn(`[WARN] equipo panel ${grupo.panelTag} no existe — grupo saltado.`); errores++; continue; }
    if (!cable) { console.warn(`[WARN] cable ${grupo.tagCable} no existe — grupo saltado.`); sinCable++; continue; }

    for (const { tagSenal, nParCable } of grupo.senales) {
      const signal = signalByTag.get(tagSenal);
      if (!signal) { console.warn(`  [WARN] ${tagSenal}: señal no encontrada.`); sinSenal++; continue; }

      if (signal.rutaId) {
        console.log(`  ${tagSenal}: ya tiene ruta activa (${signal.rutaId}) — se salta (idempotente).`);
        yaCorrectas++;
        continue;
      }

      const moduloId: string | null = signal.io?.moduloId ?? null;
      const gabineteId: string | null = signal.io?.gabineteId ?? null;
      if (!moduloId || !gabineteId) {
        console.warn(`  [WARN] ${tagSenal}: sin módulo/gabinete de IO asignado (moduloId=${moduloId}, gabineteId=${gabineteId}) — se salta.`);
        sinModulo++;
        continue;
      }

      console.log(`${tagSenal}: ${grupo.duenoTag} -> ${grupo.panelTag} -> gabinete ${gabineteId} -> modulo ${moduloId} (cable ${grupo.tagCable}, par ${nParCable})`);

      if (isDryRun) { rutasCreadas++; continue; }

      const pDueno = await ensurePointForEquipo(dueno.id, grupo.duenoTag);
      const pPanel = await ensurePointForEquipo(panel.id, grupo.panelTag);
      const pGabinete = await ensurePointForGabinete(gabineteId);
      const pModulo = await ensurePointForModulo(moduloId);

      const { route } = await apiFetch<{ route: { id: string; segments: Array<{ id: string; numeroOrden: number }> } }>(
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

      const tramo1 = route.segments.find((s) => s.numeroOrden === 1)!;
      const codigo1 = String(2 * nParCable - 1);
      const codigo2 = String(2 * nParCable);
      for (const codigo of [codigo1, codigo2]) {
        const { conductor } = await apiFetch<{ conductor: { id: string } }>(
          apiBase, devUserEmail, `/api/projects/${projectId}/conductors`,
          { method: 'POST', body: { cableId: cable.id, codigo } }
        );
        await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/tramo-conductores`, {
          method: 'POST',
          body: { tramoConexionId: tramo1.id, conductorId: conductor.id }
        });
        conductoresCreados++;
      }

      rutasCreadas++;
    }
  }

  console.log(`\n=== Resumen (${mode}) ===`);
  console.log(`Rutas creadas/planeadas:  ${rutasCreadas}`);
  console.log(`Ya tenían ruta:           ${yaCorrectas}`);
  console.log(`Sin señal encontrada:     ${sinSenal}`);
  console.log(`Sin módulo/gabinete IO:   ${sinModulo}`);
  console.log(`Sin cable en la base:     ${sinCable}`);
  console.log(`Grupos con error:         ${errores}`);
  console.log(`Conductores creados:      ${conductoresCreados}`);
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
