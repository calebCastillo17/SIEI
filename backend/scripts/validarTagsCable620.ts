/*
 * Valida los TAG_CABLE ya cargados contra la regla de tageado confirmada
 * por el usuario: `{tag del destino sin guiones}-{T|X}{correlativo}` —
 * T = señal discreta (DI/DO), X = analógica/resistencia (AI/AO/RTD) por
 * ahora (COM queda sin letra definida, no se valida como X).
 *
 * "Destino" para el tageado — confirmado empíricamente contra los tags
 * reales ya cargados, prioridad de mayor a menor:
 *   1. INSTRUMENTO — resuelto hasta su PADRE (instrumento_asociado_id),
 *      nunca el hijo directo (ej. cable a 620-HYO-5084/620-HS-5084/etc.
 *      se tagea "620HV5084-T01", el tag del PADRE 620-HV-5084 — mismo
 *      criterio que tag_senal, que también usa siempre el padre).
 *   2. EQUIPO (si no hay instrumento en ningún extremo del cable).
 *   3. CAJA (si ningún extremo es instrumento ni equipo — cable RIO->caja).
 *   Un GABINETE o MODULO nunca es el "destino" para efectos de tageado.
 *   Cuando ambos extremos empatan en prioridad (ej. equipo<->equipo, caso
 *   panel eléctrico: dueño<->panel), se prefiere el DESTINO del tramo
 *   (punto_destino) sobre el ORIGEN — confirmado con datos reales
 *   (620-PPS-5005 (origen) -> 620-AFM-5005 (destino) se tagea con AFM,
 *   no con PPS).
 *
 * Solo LEE — no corrige nada. Reporta cada cable con su tag real, el tag
 * esperado según la regla, y si coinciden o no.
 *
 * Uso: npx tsx scripts/validarTagsCable620.ts --project 50050
 */

import { getDbPool } from '../src/db/sql.js';
import sql from 'mssql';

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--project');
  const projectId = idx >= 0 ? args[idx + 1] : undefined;
  if (!projectId) {
    console.error('Falta --project <projectId>.');
    process.exit(1);
  }
  return { projectId };
}

async function main() {
  const { projectId } = parseArgs();
  const pool = await getDbPool();

  // Todos los instrumentos del proyecto, para resolver hijo -> padre.
  const instrumentos = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT id, tag_instrumento, instrumento_asociado_id FROM nucleo.instrumento WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
  `);
  const instrumentoPorId = new Map<number, { tag: string; padreId: number | null }>();
  for (const row of instrumentos.recordset) {
    instrumentoPorId.set(row.id, { tag: row.tag_instrumento, padreId: row.instrumento_asociado_id });
  }
  function tagPadre(instrumentoId: number): string {
    let actual = instrumentoPorId.get(instrumentoId);
    if (!actual) return String(instrumentoId);
    const visitados = new Set<number>([instrumentoId]);
    let id = instrumentoId;
    while (actual?.padreId && !visitados.has(actual.padreId)) {
      id = actual.padreId;
      visitados.add(id);
      actual = instrumentoPorId.get(id);
    }
    return actual?.tag ?? String(instrumentoId);
  }

  // Cada tramo (po,pd) que usa el cable, con clase/tipo_io de la señal.
  const result = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT
      cab.id AS cable_id, cab.tag_cable,
      po.caja_id AS po_caja, po.gabinete_id AS po_gabinete, po.equipo_id AS po_equipo, po.instrumento_id AS po_instrumento,
      pd.caja_id AS pd_caja, pd.gabinete_id AS pd_gabinete, pd.equipo_id AS pd_equipo, pd.instrumento_id AS pd_instrumento,
      cj_o.tag_caja AS po_caja_tag, eq_o.tag_equipo AS po_equipo_tag,
      cj_d.tag_caja AS pd_caja_tag, eq_d.tag_equipo AS pd_equipo_tag,
      tio.codigo AS tipo_io_codigo, cs.codigo AS clase_senal_codigo
    FROM nucleo.cable cab
    JOIN nucleo.conductor cond ON cond.cable_id = cab.id AND cond.activo = 1
    JOIN nucleo.tramo_conductor td ON td.conductor_id = cond.id AND td.activo = 1
    JOIN nucleo.tramo_conexion tc ON tc.id = td.tramo_conexion_id AND tc.activo = 1
    JOIN nucleo.punto_conexion po ON po.id = tc.punto_origen_id
    JOIN nucleo.punto_conexion pd ON pd.id = tc.punto_destino_id
    LEFT JOIN nucleo.caja cj_o ON cj_o.id = po.caja_id
    LEFT JOIN nucleo.equipo eq_o ON eq_o.id = po.equipo_id
    LEFT JOIN nucleo.caja cj_d ON cj_d.id = pd.caja_id
    LEFT JOIN nucleo.equipo eq_d ON eq_d.id = pd.equipo_id
    JOIN nucleo.ruta_conexion rc ON rc.id = tc.ruta_conexion_id
    JOIN nucleo.senal s ON s.id = rc.senal_id
    JOIN cat.cat_clase_senal cs ON cs.id = s.clase_senal_id
    LEFT JOIN cat.cat_tipo_io tio ON tio.id = s.tipo_io_id
    WHERE cab.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND cab.activo = 1
    ORDER BY cab.tag_cable;
  `);

  interface Candidato { prioridad: number; tag: string }
  function candidato(row: any, lado: 'po' | 'pd'): Candidato | null {
    if (row[`${lado}_instrumento`]) return { prioridad: 1, tag: tagPadre(row[`${lado}_instrumento`]) };
    if (row[`${lado}_equipo`]) return { prioridad: 2, tag: row[`${lado}_equipo_tag`] };
    if (row[`${lado}_caja`]) return { prioridad: 3, tag: row[`${lado}_caja_tag`] };
    return null; // gabinete o módulo — nunca es "destino" de tageado
  }

  interface CableInfo { tagCable: string; destinos: Set<string>; tiposIo: Set<string>; clases: Set<string> }
  const cables = new Map<string, CableInfo>();

  for (const row of result.recordset) {
    const id = String(row.cable_id);
    if (!cables.has(id)) cables.set(id, { tagCable: row.tag_cable, destinos: new Set(), tiposIo: new Set(), clases: new Set() });
    const info = cables.get(id)!;

    const cPo = candidato(row, 'po');
    const cPd = candidato(row, 'pd');
    let elegido: Candidato | null;
    if (cPo && cPd) {
      // Empate de prioridad -> gana el DESTINO (pd); si no hay empate,
      // gana el de MENOR número de prioridad (instrumento > equipo > caja).
      elegido = cPo.prioridad === cPd.prioridad ? cPd : (cPo.prioridad < cPd.prioridad ? cPo : cPd);
    } else {
      elegido = cPo ?? cPd;
    }
    if (elegido) info.destinos.add(elegido.tag);

    if (row.tipo_io_codigo) info.tiposIo.add(row.tipo_io_codigo);
    if (row.clase_senal_codigo) info.clases.add(row.clase_senal_codigo);
  }

  let ok = 0;
  let sinDestinoClaro = 0;
  let multipleDestinos = 0;
  let letraInesperada = 0;
  let prefijoNoCoincide = 0;
  let formatoInesperado = 0;
  let comSinLetra = 0;

  const FORMATO = /^([A-Z0-9]+)-([TX])(\d{2,})$/;

  for (const info of cables.values()) {
    if (info.destinos.size === 0) {
      console.log(`[SIN DESTINO CLARO] ${info.tagCable}: todos sus extremos son GABINETE/MODULO.`);
      sinDestinoClaro++;
      continue;
    }
    if (info.destinos.size > 1) {
      console.log(`[MULTIPLE DESTINOS REALES] ${info.tagCable}: resuelve a más de un destino distinto (${[...info.destinos].join(', ')}) — esto sí es raro, revisar a mano.`);
      multipleDestinos++;
      continue;
    }

    const destino = [...info.destinos][0];
    const match = info.tagCable.match(FORMATO);
    if (!match) {
      console.log(`[FORMATO INESPERADO] ${info.tagCable}: no matchea "{DESTINO}-{T|X}{NN}".`);
      formatoInesperado++;
      continue;
    }
    const [, prefijo, letra] = match;

    if (prefijo.toUpperCase() !== destino.replace(/-/g, '').toUpperCase()) {
      console.log(`[PREFIJO NO COINCIDE] ${info.tagCable}: prefijo "${prefijo}" — destino real "${destino}" (sin guiones: "${destino.replace(/-/g, '')}").`);
      prefijoNoCoincide++;
      continue;
    }

    const soloCom = info.clases.size > 0 && [...info.clases].every((c) => c === 'COM');
    if (soloCom) {
      console.log(`[COM SIN LETRA DEFINIDA] ${info.tagCable}: transporta señal(es) COM, letra usada "${letra}" — regla para COM aún no definida, no se valida como error.`);
      comSinLetra++;
      continue;
    }

    const esDiscreta = [...info.tiposIo].some((t) => t === 'DI' || t === 'DO');
    const esAnalogicaOResistencia = [...info.tiposIo].some((t) => t === 'AI' || t === 'AO' || t === 'RTD');
    const letraEsperada = esDiscreta ? 'T' : esAnalogicaOResistencia ? 'X' : null;

    if (letraEsperada === null) {
      console.log(`[TIPO_IO DESCONOCIDO] ${info.tagCable}: tipos vistos: ${[...info.tiposIo].join(',') || 'ninguno'}.`);
      continue;
    }
    if (letra !== letraEsperada) {
      console.log(`[LETRA INESPERADA] ${info.tagCable}: usa "${letra}" pero por tipo (${[...info.tiposIo].join(',')}) esperaría "${letraEsperada}".`);
      letraInesperada++;
      continue;
    }

    ok++;
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Cables totales:            ${cables.size}`);
  console.log(`OK (coinciden con la regla): ${ok}`);
  console.log(`Sin destino claro:         ${sinDestinoClaro}`);
  console.log(`Múltiples destinos reales (raro, revisar): ${multipleDestinos}`);
  console.log(`Formato inesperado:        ${formatoInesperado}`);
  console.log(`Prefijo no coincide:       ${prefijoNoCoincide}`);
  console.log(`Letra inesperada:          ${letraInesperada}`);
  console.log(`COM sin letra definida (informativo): ${comSinLetra}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
