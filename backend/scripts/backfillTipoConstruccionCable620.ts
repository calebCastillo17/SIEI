/*
 * Clasifica estructuradamente los cables ya cargados (migración 029),
 * parseando su TIPO_CABLE de texto libre (ej. "1-12p#18 AWG+SH") hacia
 * tipo_construccion_id / cantidad_unidades / calibre / apantallado.
 *
 * Formato reconocido: "N-Uxx#CALIBRE[+SH]" donde U es la cantidad de
 * unidades, xx es "c" (conductores), "p" (pares) o "Tr" (tríadas). Los 7
 * valores distintos reales de este proyecto matchean todos este patrón —
 * un cable cuyo tipo_cable no matchee se salta con una advertencia
 * (nunca se adivina).
 *
 * Uso:
 *   npx tsx scripts/backfillTipoConstruccionCable620.ts --project 50050 --dry-run
 *   npx tsx scripts/backfillTipoConstruccionCable620.ts --project 50050 --apply
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

const PATRON_TIPO_CABLE = /^\d+-(\d+)(c|p|Tr)#([^+]+?)(\+SH)?$/i;
const CODIGO_POR_UNIDAD: Record<string, string> = { c: 'CONDUCTORES', p: 'PARES', tr: 'TRIADAS' };

function parsearTipoCable(tipoCable: string): { codigoConstruccion: string; cantidadUnidades: number; calibre: string; apantallado: boolean } | null {
  const m = tipoCable.match(PATRON_TIPO_CABLE);
  if (!m) return null;
  const [, cantidadStr, unidad, calibre, sh] = m;
  const codigoConstruccion = CODIGO_POR_UNIDAD[unidad.toLowerCase()];
  if (!codigoConstruccion) return null;
  return { codigoConstruccion, cantidadUnidades: Number(cantidadStr), calibre: calibre.trim(), apantallado: Boolean(sh) };
}

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';

  const { items } = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(
    apiBase, devUserEmail, `/api/catalogs/tipos-construccion-cable`
  );
  const idPorCodigo = new Map(items.map((c) => [c.codigo, c.id]));

  const { cables } = await apiFetch<{ cables: any[] }>(apiBase, devUserEmail, `/api/projects/${projectId}/cables`);

  let clasificados = 0;
  let yaCorrectos = 0;
  let sinTipoCable = 0;
  let noParseables = 0;

  for (const cable of cables) {
    if (cable.tipoConstruccionId) { yaCorrectos++; continue; } // ya clasificado, no se pisa
    if (!cable.tipoCable) { sinTipoCable++; continue; }

    const parsed = parsearTipoCable(cable.tipoCable);
    if (!parsed) {
      console.warn(`  [WARN] ${cable.tagCable}: tipo_cable "${cable.tipoCable}" no matchea el patrón esperado — se salta.`);
      noParseables++;
      continue;
    }

    const tipoConstruccionId = idPorCodigo.get(parsed.codigoConstruccion);
    if (!tipoConstruccionId) {
      console.warn(`  [WARN] ${cable.tagCable}: código "${parsed.codigoConstruccion}" no existe en el catálogo — se salta.`);
      continue;
    }

    console.log(`${cable.tagCable} ("${cable.tipoCable}") -> construccion=${parsed.codigoConstruccion} cantidad=${parsed.cantidadUnidades} calibre="${parsed.calibre}" apantallado=${parsed.apantallado}`);

    if (isDryRun) { clasificados++; continue; }

    await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/cables/${cable.id}`, {
      method: 'PATCH',
      body: {
        tipoConstruccionId,
        cantidadUnidades: parsed.cantidadUnidades,
        calibre: parsed.calibre,
        apantallado: parsed.apantallado
      }
    });
    clasificados++;
  }

  console.log(`\n=== Resumen (${mode}) ===`);
  console.log(`Cables clasificados:      ${clasificados}`);
  console.log(`Ya estaban clasificados:  ${yaCorrectos}`);
  console.log(`Sin tipo_cable:           ${sinTipoCable}`);
  console.log(`No parseables:            ${noParseables}`);
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
