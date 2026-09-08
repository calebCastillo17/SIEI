/*
 * Reemplazo de 175 señales CONTROL del proyecto 620 (scope, no una entidad
 * SIEI propia) a partir del reporte actualizado
 * `reference_excel/162281-620-Instrument List - 2.xlsx` — decisión
 * explícita del usuario tras validar campo por campo en conversación:
 *
 * Hasta ahora, cada una de estas 175 señales CONTROL estaba "colgada" de
 * un micro-instrumento creado solo para representarla (ej. `620-ZSC-5082`,
 * dueño único de una señal de posición cerrado). El reporte nuevo trae la
 * misma información asociada directamente al instrumento real
 * (`620-HV-5082`, la válvula) vía su columna "Instrumento Asociado".
 *
 * IMPORTANTE — el dueño (instrumentoId) de la señal NO se toca acá.
 * Se intentó al principio (ver historial de la conversación) y
 * TR_senal_validar_canal_ruta (migración 001) lo rechaza en el 101 de 175
 * casos: una señal con ruta física activa no puede cambiar de dueño si el
 * primer punto de esa ruta no pertenece al nuevo dueño — y hoy no existe
 * ninguna capacidad (ni API ni trigger) para reasignar el dueño de un
 * punto_conexion. Reconstruir esas rutas es un desarrollo aparte, no
 * incluido acá. El micro-instrumento sigue siendo, en la base, el dueño
 * real de la señal — decisión explícita del usuario: "queda como
 * instrumento normal, pero ya no genera una señal en sí".
 *
 * Esta migración NO crea ni borra ninguna fila de nucleo.senal — hace un
 * PATCH sobre la señal YA EXISTENTE (mismo id, misma auditoría/historia):
 *   - tagSenal   -> "{instrumento real}_{Type del reporte}" (ej.
 *                   "620-HV-5082_ZSC") — mismo patrón de nomenclatura que
 *                   ya usaba el proyecto, confirmado por el usuario.
 *   - servicio   -> el que tenía el micro-instrumento viejo (su dato más
 *                   específico, migrado tal cual — las demás propiedades
 *                   del micro-instrumento NO se migran porque son
 *                   idénticas a las del instrumento real, verificado con
 *                   datos reales antes de este script).
 *   - codigoSenal -> el PnPID del reporte nuevo. Es el "link" persistente
 *                   con el reporte, independiente del dueño en la base —
 *                   decisión explícita del usuario: un futuro motor de
 *                   reimportación (próximo paso, no parte de este script)
 *                   podrá encontrar/actualizar esta misma señal por su
 *                   PnPID sin importar de quién sea dueña hoy.
 *   - tipoIoId   -> AI para "4 a 20 mA + HART", RTD para "RESISTENCIA".
 *                   "120 VAC" queda SIN definir a propósito (DI/DO es
 *                   ambiguo por naturaleza — decisión explícita del
 *                   usuario, se completa a mano caso por caso).
 *
 * El mapeo completo (175 filas, ya validado 1:1 sin colisiones) vive en
 * backend/scripts/data/mapeoSenalesControl620Reporte2.json — este script
 * no reimplementa ninguna lógica de matching, solo aplica ese mapeo ya
 * confirmado.
 *
 * Uso:
 *   npx tsx scripts/reemplazarSenalesControl620Reporte2.ts --project <projectId> --dry-run
 *   npx tsx scripts/reemplazarSenalesControl620Reporte2.ts --project <projectId> --apply
 *   [--api http://localhost:3000] [--user admin@siei.local]
 *
 * Idempotente: si una señal ya quedó con el tagSenal/codigoSenal nuevo,
 * se reporta SKIP (no reintenta el PATCH).
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

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`=== reemplazarSenalesControl620Reporte2.ts (${mode.toUpperCase()}) ===`);
  console.log(`API: ${apiBase}  |  Usuario dev: ${devUserEmail}`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const mapeoPath = path.resolve(__dirname, 'data/mapeoSenalesControl620Reporte2.json');
  const mapeo: MapeoEntry[] = JSON.parse(await readFile(mapeoPath, 'utf-8'));
  console.log(`\n${mapeo.length} señales en el mapeo.`);

  // Catálogo de tipos de E/S (para resolver AI/RTD -> id real)
  const ioTypesResp = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/io-types');
  const tipoIoIdByCode = new Map<string, string>();
  for (const t of ioTypesResp.json.items ?? []) tipoIoIdByCode.set(t.codigo, t.id);

  let ok = 0, skip = 0, error = 0;
  const errores: Array<{ senalId: string; message: string }> = [];

  for (const entry of mapeo) {
    // Estado actual de la señal — para decidir SKIP (ya migrada) y para
    // mostrar el "antes" en dry-run.
    const actual = await apiFetch<{ signal: any }>(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${entry.senalId}`);
    if (actual.status !== 200) {
      error++;
      errores.push({ senalId: entry.senalId, message: `No se pudo leer la señal actual: ${JSON.stringify(actual.json)}` });
      continue;
    }
    const senalActual = actual.json.signal;

    // Decisión del usuario tras encontrar TR_senal_validar_canal_ruta
    // (migración 001): el dueño (instrumentoId) de una señal con ruta
    // física activa NO se puede cambiar sin reconstruir esa ruta — eso
    // queda para más adelante. Por ahora el "link" con el reporte nuevo es
    // el propio PnPID, guardado en codigoSenal (mismo campo que ya se usa
    // como referencia legacy) — el dueño en la base se queda en el
    // micro-instrumento, pero la señal ya es identificable/actualizable
    // por su PnPID en cualquier reimport futuro (motor de reimportación:
    // próximo paso, no parte de este script).
    if (senalActual.tagSenal === entry.nuevoTagSenal && senalActual.codigoSenal === entry.pnpidNuevo) {
      skip++;
      console.log(`  = SKIP ${entry.tagSenalActual} (ya migrada a ${entry.nuevoTagSenal})`);
      continue;
    }

    const body: Record<string, unknown> = {
      tagSenal: entry.nuevoTagSenal,
      servicio: entry.servicio,
      codigoSenal: entry.pnpidNuevo
    };
    if (entry.tipoIoCodigo) {
      const tipoIoId = tipoIoIdByCode.get(entry.tipoIoCodigo);
      if (tipoIoId) body.tipoIoId = tipoIoId;
    }

    if (isDryRun) {
      console.log(`  + dueño=${entry.duenoTagActual} (sin cambiar) | ${entry.tagSenalActual} -> ${entry.nuevoTagSenal} | codigoSenal -> PnPID ${entry.pnpidNuevo} [${entry.tipoSenalNueva}]`);
      console.log(`      servicio: "${entry.servicio}"`);
      ok++;
      continue;
    }

    const updated = await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/signals/${entry.senalId}`, {
      method: 'PATCH',
      body
    });
    if (updated.status === 200) {
      ok++;
      console.log(`  + dueño=${entry.duenoTagActual} (sin cambiar) | ${entry.tagSenalActual} -> ${entry.nuevoTagSenal}`);
    } else {
      error++;
      errores.push({ senalId: entry.senalId, message: JSON.stringify(updated.json) });
      console.log(`  ! ERROR ${entry.tagSenalActual}: ${JSON.stringify(updated.json)}`);
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Modo: ${mode}`);
  console.log(`OK=${ok}  SKIP=${skip}  ERROR=${error}`);
  if (errores.length > 0) {
    console.log('\nErrores:');
    errores.forEach((e) => console.log(`  [señal ${e.senalId}] ${e.message}`));
  }

  process.exit(error > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
