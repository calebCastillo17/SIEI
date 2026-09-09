/*
 * Creación de las señales CONTROL del proyecto 420 directo con su dueño
 * REAL — a diferencia de 620 (donde las 175 señales ya existían colgadas
 * de un micro-instrumento y hubo que migrarlas después), acá las señales
 * TODAVÍA NO EXISTEN: se crean de una sola vez con el dueño correcto,
 * usando exactamente los mismos datos que el motor de reimportación de
 * señales (compare.ts/pnidImports.ts) ya usa para sincronizar — decisión
 * explícita del usuario tras validar el caso real 420-TE-5048/S420-TI-5048:
 * "por eso que el master 420 esta desactualizado en eso, tu actualizarias
 * eso supongo" / "si seguimos".
 *
 * Fuente: los resultados ES_SENAL de un import P&ID ya APLICADO (nunca la
 * fila cruda directamente — usa el mismo snapshot persistido que ya
 * pasó por compare.ts, mismo criterio de esta sesión de no reimplementar
 * lógica de comparación en un script aparte). Cada resultado ES_SENAL ya
 * trae:
 *   - pnpid                              -> codigoSenal (vínculo persistente
 *                                            para el motor de reimportación)
 *   - datosPropuestos.instrumentoAsociadoTag -> dueño real (instrumentoId)
 *   - datosPropuestos.tipoInstrumento (Type) -> junto al dueño, deriva
 *                                            tagSenal = "{dueño}_{Type}"
 *   - datosPropuestos.servicio           -> servicio
 *   - datosPropuestos.tipoSenalPnid      -> tipoIoId, SOLO cuando es
 *                                            inequívoco (4 a 20 mA + HART
 *                                            -> AI, RESISTENCIA -> RTD),
 *                                            mismo criterio que
 *                                            TIPO_SENAL_A_TIPO_IO en
 *                                            compare.ts — nunca se
 *                                            adivina DI/DO.
 *
 * tagPnid (migración 048) NO se manda acá — no es un campo aceptado por
 * POST /signals (gestionado exclusivamente por el motor de reimportación).
 * Se backfillea aparte con una sola UPDATE directa a la base, igual
 * criterio que el backfill ya hecho para las 175 señales de 620 (evita un
 * "cambio" falso la primera vez que se reimporte este mismo reporte).
 *
 * Uso:
 *   npx tsx scripts/crearSenalesControl420DesdeReporte.ts --project <projectId> --import <importId> --dry-run
 *   npx tsx scripts/crearSenalesControl420DesdeReporte.ts --project <projectId> --import <importId> --apply
 *   [--api http://localhost:3000] [--user admin@siei.local]
 *
 * Idempotente: busca primero por codigoSenal (PnPID) antes de crear — una
 * segunda ejecución (o correr contra un import posterior con las mismas
 * señales) produce SKIP, nunca duplicados.
 */

interface Args {
  projectId: string;
  importId: string;
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
  const importId = get('--import');
  if (!projectId || !importId) {
    console.error('Faltan --project <projectId> --import <importId>.');
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
    importId,
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

// Mismo criterio que TIPO_SENAL_A_TIPO_IO en compare.ts — solo los casos
// inequívocos, nunca DI/DO adivinado.
const TIPO_SENAL_A_TIPO_IO: Record<string, string> = {
  '4 a 20 ma + hart': 'AI',
  resistencia: 'RTD'
};

async function main() {
  const { projectId, importId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== crearSenalesControl420DesdeReporte.ts (${mode.toUpperCase()}) ===`);
  console.log(`API: ${apiBase}  |  Usuario dev: ${devUserEmail}  |  Import: ${importId}`);

  const importResp = await apiFetch<{ resultados: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/pnid-imports/${importId}`);
  if (importResp.status !== 200) {
    console.error('No se pudo leer el import:', importResp.json);
    process.exit(1);
  }
  const esSenalRows = importResp.json.resultados.filter((r) => r.resultado === 'ES_SENAL');
  console.log(`\n${esSenalRows.length} filas ES_SENAL en el import ${importId}.`);

  const instrumentsResp = await apiFetch<{ instruments: Array<{ id: string; tagInstrumento: string }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/instruments`
  );
  const instrumentIdByTag = new Map<string, string>();
  for (const i of instrumentsResp.json.instruments ?? []) instrumentIdByTag.set(i.tagInstrumento, i.id);

  const claseSenalResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/signal-classes');
  const claseControlId = (claseSenalResp.json.items ?? []).find((c) => c.codigo === 'CONTROL')?.id;
  if (!claseControlId) { console.error('No existe cat_clase_senal CONTROL.'); process.exit(1); }

  const ioTypeResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/io-types');
  const ioTypeIdByCode = new Map<string, string>();
  for (const t of ioTypeResp.json.items ?? []) ioTypeIdByCode.set(t.codigo, t.id);

  const existingSignalsResp = await apiFetch<{ signals: Array<{ id: string; codigoSenal: string | null }> }>(
    apiBase, devUserEmail, `/api/projects/${projectId}/signals`
  );
  const signalIdByCodigoSenal = new Map<string, string>();
  for (const s of existingSignalsResp.json.signals ?? []) if (s.codigoSenal) signalIdByCodigoSenal.set(s.codigoSenal, s.id);

  let ok = 0, skip = 0, error = 0;
  const errores: Array<{ tag: string; message: string }> = [];
  const creadas: Array<{ pnpid: string; senalId: string }> = [];

  for (const r of esSenalRows) {
    const tagCrudo = r.tagInstrumento ?? `PnPID ${r.pnpid}`;

    if (signalIdByCodigoSenal.has(r.pnpid)) {
      skip++;
      console.log(`  = SKIP ${tagCrudo} (ya existe una señal con codigoSenal=${r.pnpid})`);
      continue;
    }

    const asociadoTag = r.datosPropuestos?.instrumentoAsociadoTag;
    const duenoId = asociadoTag ? instrumentIdByTag.get(asociadoTag) : undefined;
    if (!asociadoTag || !duenoId) {
      error++;
      errores.push({ tag: tagCrudo, message: `Instrumento Asociado "${asociadoTag ?? 'vacío'}" no resuelve a un instrumento activo.` });
      console.log(`  ! ERROR ${tagCrudo}: Instrumento Asociado "${asociadoTag ?? 'vacío'}" no resuelve.`);
      continue;
    }

    const tipo = r.datosPropuestos?.tipoInstrumento;
    const tagSenal = tipo ? `${asociadoTag}_${tipo}` : null;

    const tipoSenalPnid: string | null = r.datosPropuestos?.tipoSenalPnid ?? null;
    const tipoIoCodigo = tipoSenalPnid ? TIPO_SENAL_A_TIPO_IO[tipoSenalPnid.trim().toLowerCase()] : undefined;
    const tipoIoId = tipoIoCodigo ? ioTypeIdByCode.get(tipoIoCodigo) : undefined;

    const body: Record<string, unknown> = {
      instrumentoId: duenoId,
      claseSenalId: claseControlId,
      codigoSenal: r.pnpid
    };
    if (tagSenal) body.tagSenal = tagSenal;
    if (r.datosPropuestos?.servicio) body.servicio = r.datosPropuestos.servicio;
    if (tipoIoId) body.tipoIoId = tipoIoId;

    if (isDryRun) {
      ok++;
      console.log(`  + ${tagCrudo} -> dueño=${asociadoTag} | tagSenal=${tagSenal ?? '(sin Type)'} | tipoIo=${tipoIoCodigo ?? '—'} | PnPID=${r.pnpid}`);
      continue;
    }

    const created = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals`, { method: 'POST', body });
    if (created.status === 201) {
      ok++;
      signalIdByCodigoSenal.set(r.pnpid, created.json.signal.id);
      creadas.push({ pnpid: r.pnpid, senalId: created.json.signal.id });
      console.log(`  + ${tagCrudo} -> dueño=${asociadoTag} | tagSenal=${tagSenal ?? '(sin Type)'} | señal id=${created.json.signal.id}`);
    } else {
      error++;
      errores.push({ tag: tagCrudo, message: JSON.stringify(created.json) });
      console.log(`  ! ERROR ${tagCrudo}: ${JSON.stringify(created.json)}`);
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Modo: ${mode}`);
  console.log(`OK=${ok}  SKIP=${skip}  ERROR=${error}`);
  if (errores.length > 0) {
    console.log('\nErrores:');
    errores.forEach((e) => console.log(`  [${e.tag}] ${e.message}`));
  }
  if (!isDryRun && creadas.length > 0) {
    console.log(`\n${creadas.length} señales creadas — tagPnid se backfillea aparte contra la base (ver siguiente paso).`);
  }

  process.exit(error > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
