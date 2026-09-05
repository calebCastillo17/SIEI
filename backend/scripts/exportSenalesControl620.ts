/*
 * Genera un .xlsx con una hoja "SENALES_CONTROL" que reproduce, columna
 * por columna, la hoja real del mismo nombre en el master del usuario —
 * pedido explícito: "un excel que me salga igualito a mi tabla
 * SENALES_CONTROL que está en mi excel".
 *
 * Verificación previa (columna por columna contra el archivo real, 75
 * columnas) confirmó qué ya vive en SIEI y qué no — ver conversación.
 * Columnas EXCLUIDAS deliberadamente, con motivo:
 *   - CLASE_ALARMA, COMPLETITUD: 100% vacías en las 489 filas del Excel
 *     real — confirmado, nada que exportar — el usuario confirmó omitir.
 *   - ID_INSTRUMENTO: "no hace falta por ahora" (confirmado).
 *   - OBSERVACION_REVISION: sin equivalente claro en el modelo, no se
 *     adivina.
 *   - CAJA_EQUIPO, BORNERA_BLOQUE_CAJA, Column50/51, MODULO_VISTA_ORDEN:
 *     columnas auxiliares/de cálculo interno del Excel, no datos propios.
 *
 * Resueltas en una segunda pasada de pulido, pedido explícito del usuario:
 *   - PLANO_LAZO: "ponle lo que actualmente tiene" — nucleo.lazo.
 *     codigo_documento, ligado al instrumento DUEÑO directo de la señal
 *     (nunca al padre acá — sin evidencia real que lo confirme, a
 *     diferencia de tag_senal/tag_cable). Este proyecto (620) no tiene
 *     ningún lazo cargado todavía (0 filas) — sale vacío para todas las
 *     señales hasta que se cargue el dato real.
 *   - PLANO_GANCHO / PLANO_GANCHO_DESCRIPCION: "es el plano de la caja o
 *     panel... sácalo de los planos que tenemos de cajas y paneles" —
 *     resuelto vía caja_plano (migración 014) de la caja real a la que
 *     llega la señal. Un panel eléctrico (equipo) no tiene una tabla
 *     equivalente todavía, siempre sale vacío ahí. Una caja puede tener
 *     más de un plano asociado — se toma el primero (menor id), única
 *     aproximación posible "como está en el Excel" (un solo valor).
 *   - TIPO_SENAL: la clasificación amplia que el usuario ya había descrito
 *     (DISCRETA/ANALOGICA/RESISTENCIA/COMUNICADA), derivada de tipo_io —
 *     ver `derivarTipoSenal`. Los "subtipos" (120VAC, 24VAC, 4-20mA) son
 *     un concepto futuro aparte, no modelado todavía.
 *   - OBSERVACIONES (plural, distinta de OBSERVACION): el usuario pidió
 *     dejarla en el archivo pero sin dato ("no pones nada por ahora") —
 *     columna presente, siempre null a propósito.
 *
 * Dos columnas NO se guardan en la base — se CALCULAN al generar, pedido
 * explícito del usuario ("no quiero que guardes campos, solo los
 * generás cuando los necesitamos"):
 *   - ORDEN_INST_CAJA: el correlativo numérico del propio código de TB de
 *     la caja (ej. "TB-01" -> 1) — confirmado por el usuario: "creo que
 *     ya tienes ese orden cuando deduces TB-01, el 1 es ese orden".
 *   - B_NUM_RESERVA: reserva de bornes de la caja+TB, fórmula real
 *     decodificada de la propia fórmula de Excel (ROUNDUP de 20% de los
 *     bornes usados, analógicos y digitales por separado).
 *
 * N° CABLE (del Excel original) NO se incluye: el usuario confirmó que
 * en su archivo era solo un dato intermedio para ARMAR el tag del cable
 * a mano vía fórmula (RIO + destino + correlativo) — en SIEI el
 * TAG_CABLE ya es un valor real guardado directamente en nucleo.cable
 * (nunca se construye con una fórmula), así que ese intermedio no aplica
 * ni hace falta calcularlo.
 *
 * DISPR = surge protector del módulo (confirmado por el usuario: "está
 * relacionado con el TB, tienen el mismo correlativo") — ya vive en
 * modulo.surgeProtectorTag, no hace falta calcular nada nuevo.
 *
 * RESERVA: pedido explícito del usuario — un canal de módulo sin señal
 * asignada ("reserva") debe salir igual en el Excel, no desaparecer, tal
 * como se ve en su archivo real. La consulta de hardware (`hw`) pasó de
 * INNER a LEFT JOIN contra nucleo.senal — todo lo que dependía de que
 * existiera una señal (tag_senal, instrumento, cable, caja, bornes JB,
 * etc.) sale null/vacío automáticamente para estas filas porque también
 * dependen, en cadena, de esa misma señal. Lo que SÍ es de nivel
 * módulo/canal (RIO, planos, CHASIS, SLOT, MODELO, MODULO, MODULO_VISTA,
 * DISPR, TB, CANAL, T_MODULO, BORNERA) sigue poblándose igual porque
 * nunca dependió de `s.*`. DESTINO se fuerza al literal "RESERVA" (misma
 * convención que ya usa el propio Excel de la usuaria) y la fila se
 * pinta de un gris claro fijo, en vez del color por RIO, para que salte
 * a la vista que está vacía.
 *
 * Es un script de SOLO LECTURA (no escribe nada en la base) — por eso,
 * a diferencia de los scripts de carga de datos de esta sesión, consulta
 * la base DIRECTAMENTE (getDbPool) en vez de pasar por la API real: la
 * disciplina "escribir siempre vía API" existe para que las reglas de
 * negocio validen cada mutación, y acá no hay ninguna mutación.
 *
 * Uso:
 *   npx tsx scripts/exportSenalesControl620.ts --project 50050 [--out /ruta/salida.xlsx]
 */

import ExcelJS from 'exceljs';
import path from 'node:path';

import { getDbPool } from '../src/db/sql.js';
import sql from 'mssql';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const projectId = get('--project');
  if (!projectId) {
    console.error('Falta --project <projectId>.');
    process.exit(1);
  }
  return {
    projectId,
    out: get('--out') ?? path.join(process.cwd(), `SENALES_CONTROL_${projectId}.xlsx`)
  };
}

// Misma regla que ControlHardwarePage/controlOverview.ts (Bornera del
// gabinete) — SIN relación con bornesCajaNecesarios (BORNE_JB), son dos
// TB físicos distintos con reglas propias.
const BORNERAS_POR_CANAL_SEGUN_TIPO_IO: Record<string, number> = { DI: 2, DO: 2, AI: 4, AO: 4, RTD: 4 };
function calcularBornera(tipoIoCodigo: string | null, numeroCanal: number): string[] {
  const porCanal = tipoIoCodigo ? (BORNERAS_POR_CANAL_SEGUN_TIPO_IO[tipoIoCodigo] ?? 2) : 2;
  const inicio = numeroCanal * porCanal + 1;
  const conFusible = Math.floor(porCanal / 2);
  return Array.from({ length: porCanal }, (_, i) => (i < conFusible ? `F${inicio + i}` : `${inicio + i}`));
}

// Misma fórmula real decodificada de BORNE_JB (Excel, hoja SENALES) — ver
// controlOverview.ts (bornesCajaNecesarios) para el detalle completo.
function bornesCajaNecesarios(tipoIoCodigo: string | null, tipoInstrumento: string | null, esLoopPowered: boolean | null): number | null {
  if (esLoopPowered) return 2;
  const tipo = tipoInstrumento?.trim().toUpperCase() ?? null;
  if (tipo === 'HY' || tipo === 'HYO') return 5;
  if (tipo === 'HYC') return 4;
  const tio = tipoIoCodigo?.trim().toUpperCase() ?? null;
  if (tio === 'AI' || tio === 'AO') return 2;
  if (tio === 'DI' || tio === 'DO') return 3;
  return null;
}

/**
 * TIPO_SENAL: pedido explícito del usuario — la clasificación amplia que
 * ya venía describiendo (DISCRETA/ANALOGICA/RESISTENCIA/COMUNICADA), NO
 * el código crudo de tipo_io. Los "subtipos" que mencionó (120VAC, 24VAC,
 * 4-20mA...) son un concepto futuro aparte, no se modelan acá todavía.
 * Esta hoja es específicamente SENALES_CONTROL — sus señales siempre
 * tienen tipo_io_id (nunca son de clase COM), así que COMUNICADA nunca
 * sale de esta función en este export puntual, pero se deja resuelta
 * para cuando exista un export de SENALES_COM.
 */
function derivarTipoSenal(tipoIoCodigo: string | null): string | null {
  const t = tipoIoCodigo?.trim().toUpperCase() ?? null;
  if (t === 'DI' || t === 'DO') return 'DISCRETA';
  if (t === 'AI' || t === 'AO') return 'ANALOGICA';
  if (t === 'RTD') return 'RESISTENCIA';
  return null;
}

interface Fila {
  rio: string | null;
  planoInteriorRio: string | null;
  descripcionPlanoInterior: string | null;
  planoRio: string | null;
  descripcionPlanoRio: string | null;
  chasis: number | null;
  slot: number | null;
  modelo: string | null;
  modulo: string | null;
  moduloVista: string | null;
  dispr: string | null;
  tb: string | null;
  canal: number | null;
  tModulo: string;
  bornera: string;
  nParCable: number | null;
  tagCable: string | null;
  rCable: number | null;
  tipoCable: string | null;
  tagCaja: string | null;
  borneJb: string;
  bNumReserva: number | null;
  tbCaja: string | null;
  ordenInstCaja: number | null;
  tagSenal: string | null;
  senal: string | null;
  tagCableInst: string | null;
  tipoCableInst: string | null;
  destino: string | null;
  nodo: string | null;
  tagEquipoInst: string | null;
  tagInstrumento: string | null;
  tagInstrumentoAsociado: string | null;
  planoLazo: string | null;
  tipoInstrumento: string | null;
  servicio: string | null;
  sistema: string | null;
  pnpid: string | null;
  tagWsp: string | null;
  conexTipo: string | null;
  tecnologia: string | null;
  funcionamiento: string | null;
  cuerpoInstrumento: string | null;
  tipoSenal: string | null;
  linea: string | null;
  equipoAsociado: string | null;
  pAndId: string | null;
  ubicacion: string | null;
  planoGancho: string | null;
  planoGanchoDescripcion: string | null;
  idSenal: string | null;
  enclavamiento: string | null;
  alarmaHh: number | null;
  alarmaH: number | null;
  alarmaL: number | null;
  alarmaLl: number | null;
  rangoMin: number | null;
  rangoMax: number | null;
  unidadIngenieria: string | null;
  valorNormal: string | null;
  prioridadAlarma: string | null;
  retardo: string | null;
  observacion: string | null;
  // OBSERVACIONES (plural, columna 57 del Excel real, distinta de
  // OBSERVACION/73 que sí es senal.observacion) — pedido explícito del
  // usuario: "no pones nada por ahora". Columna siempre null, a
  // propósito, hasta que se identifique a qué corresponde.
  observaciones: null;
  estadoRevision: string | null;
}

async function main() {
  const { projectId, out } = parseArgs();
  const pool = await getDbPool();

  // --- 1) Árbol gabinete->rack->módulo->canal->señal + servicio/destino/
  // nodo, calcado de controlOverview.ts (/control/ruteo). ---
  const hw = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT
      g.id AS gabinete_id, g.tag_gabinete,
      r.numero_rack,
      sl.numero_slot,
      m.id AS modulo_id, m.tag AS modulo_tag, m.surge_protector_tag,
      cmi.fabricante, cmi.modelo, tio.codigo AS tipo_io_codigo,
      btm.codigo AS modulo_bloque_codigo,
      c.id AS canal_id, c.numero_canal,
      s.id AS senal_id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.descripcion, s.servicio AS senal_servicio,
      s.instrumento_id, s.equipo_id, s.es_loop_powered,
      i.tag_instrumento, i.nodo AS instrumento_nodo, i.servicio AS instrumento_servicio,
      i.sistema AS instrumento_sistema, i.tipo_instrumento, i.pnpid, i.tag_anterior AS instrumento_tag_anterior,
      i.tecnologia, i.funcionamiento, i.cuerpo_instrumento, i.linea_pnid, i.equipo_asociado_tag,
      i.plano_pnid, i.ubicacion, i.instrumento_asociado_tag,
      e.tag_equipo, e.sistema AS equipo_sistema,
      s.enclavamiento, s.alarma_hh, s.alarma_h, s.alarma_l, s.alarma_ll,
      s.rango_min, s.rango_max, s.unidad_ingenieria, s.valor_normal, s.retardo, s.observacion,
      cpa.codigo AS prioridad_alarma_codigo, cer.codigo AS estado_revision_codigo
    FROM nucleo.gabinete g
    JOIN nucleo.rack r ON r.gabinete_id = g.id AND r.activo = 1
    JOIN nucleo.slot sl ON sl.rack_id = r.id AND sl.activo = 1
    JOIN nucleo.modulo m ON m.slot_id = sl.id AND m.activo = 1
    LEFT JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
    LEFT JOIN cat.cat_tipo_io tio ON tio.id = cmi.tipo_io_id
    LEFT JOIN nucleo.bloque_terminal btm ON btm.modulo_id = m.id AND btm.activo = 1
    JOIN nucleo.canal c ON c.modulo_id = m.id AND c.activo = 1
    LEFT JOIN nucleo.senal s ON s.canal_id = c.id AND s.activo = 1
    LEFT JOIN nucleo.instrumento i ON i.id = s.instrumento_id
    LEFT JOIN nucleo.equipo e ON e.id = s.equipo_id
    LEFT JOIN cat.cat_prioridad_alarma cpa ON cpa.id = s.prioridad_alarma_id
    LEFT JOIN cat.cat_estado_revision cer ON cer.id = s.estado_revision_id
    WHERE g.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND g.activo = 1
    ORDER BY g.tag_gabinete, r.numero_rack, sl.numero_slot, c.numero_canal;
  `);

  // --- 1b) Hilos propios del módulo (terminales de fábrica) por canal —
  // mismo esquema que /control/ruteo. ---
  const hilosResult = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT bt.modulo_id, cmit.numero_canal, t.numero
    FROM nucleo.terminal t
    JOIN nucleo.bloque_terminal bt ON bt.id = t.bloque_terminal_id AND bt.modulo_id IS NOT NULL
    JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = t.catalogo_modulo_io_terminal_id
    WHERE bt.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND t.activo = 1
    ORDER BY bt.modulo_id, cmit.numero_canal, cmit.orden_terminal;
  `);
  const hilosPorModuloCanal = new Map<string, string[]>();
  for (const row of hilosResult.recordset) {
    const key = `${row.modulo_id}:${row.numero_canal}`;
    if (!hilosPorModuloCanal.has(key)) hilosPorModuloCanal.set(key, []);
    hilosPorModuloCanal.get(key)!.push(row.numero);
  }

  // --- 2) Conexionado real por señal: cable RIO, caja/panel, bornes,
  // cable campo — mismo esquema que /control/ruteo. ---
  const conex = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT
      s.id AS senal_id,
      cabCampo.tag_cable AS cable_campo_tag, cabCampo.tipo_cable AS cable_campo_tipo,
      COALESCE(cj.tag_caja, cjDirecto.tag_caja) AS tag_caja,
      COALESCE(cj.id, cjDirecto.id) AS caja_id_resuelta,
      COALESCE(eqPanelBloque.tag_equipo, eqPanelDirecto.tag_equipo, eqPanelOrigen.tag_equipo) AS equipo_panel_tag,
      bt.codigo AS bloque_codigo,
      t.numero AS terminal_numero,
      cabRio.tag_cable AS cable_rio_tag, cabRio.tipo_cable AS cable_rio_tipo,
      cabRio.capacidad_conductores AS cable_rio_capacidad,
      condRio.codigo AS conductor_rio_codigo,
      (SELECT COUNT(*) FROM nucleo.conductor cr JOIN nucleo.tramo_conductor tcr ON tcr.conductor_id = cr.id AND tcr.activo = 1 WHERE cr.cable_id = cabRio.id AND cr.activo = 1) AS cable_rio_en_uso
    FROM nucleo.senal s
    JOIN nucleo.ruta_conexion rc ON rc.senal_id = s.id AND rc.activo = 1
    JOIN nucleo.tramo_conexion tc1 ON tc1.ruta_conexion_id = rc.id AND tc1.activo = 1 AND tc1.numero_orden = 1
    LEFT JOIN nucleo.tramo_conductor td1 ON td1.tramo_conexion_id = tc1.id AND td1.activo = 1
    LEFT JOIN nucleo.conductor condCampo ON condCampo.id = td1.conductor_id
    LEFT JOIN nucleo.cable cabCampo ON cabCampo.id = condCampo.cable_id
    LEFT JOIN nucleo.terminacion termCampo ON termCampo.tramo_conductor_id = td1.id AND termCampo.activo = 1 AND termCampo.extremo = 'DESTINO'
    LEFT JOIN nucleo.posicion_terminal ptCampo ON ptCampo.id = termCampo.posicion_terminal_id
    LEFT JOIN nucleo.terminal t ON t.id = ptCampo.terminal_id
    LEFT JOIN nucleo.bloque_terminal bt ON bt.id = t.bloque_terminal_id
    LEFT JOIN nucleo.caja cj ON cj.id = bt.caja_id
    LEFT JOIN nucleo.equipo eqPanelBloque ON eqPanelBloque.id = bt.equipo_id
    LEFT JOIN nucleo.punto_conexion pd1 ON pd1.id = tc1.punto_destino_id
    LEFT JOIN nucleo.caja cjDirecto ON cjDirecto.id = pd1.caja_id
    LEFT JOIN nucleo.equipo eqPanelDirecto ON eqPanelDirecto.id = pd1.equipo_id
    LEFT JOIN nucleo.punto_conexion po1 ON po1.id = tc1.punto_origen_id
    LEFT JOIN nucleo.equipo eqPanelOrigen ON eqPanelOrigen.id = po1.equipo_id
    LEFT JOIN nucleo.posicion_terminal ptRio ON ptRio.terminal_id = t.id AND ptRio.id != ptCampo.id AND ptRio.activo = 1
    LEFT JOIN nucleo.terminacion termRio ON termRio.posicion_terminal_id = ptRio.id AND termRio.activo = 1 AND termRio.extremo = 'ORIGEN'
    LEFT JOIN nucleo.tramo_conductor td2 ON td2.id = termRio.tramo_conductor_id AND td2.activo = 1
    LEFT JOIN nucleo.conductor condRio ON condRio.id = td2.conductor_id
    LEFT JOIN nucleo.cable cabRio ON cabRio.id = condRio.cable_id
    WHERE s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND s.activo = 1
    ORDER BY s.id, t.numero;
  `);

  interface Borne { numero: string; campoOcupado?: boolean }
  interface ConexInfo {
    cableCampoTag: string | null; cableCampoTipo: string | null;
    cajaTag: string | null; cajaIdResuelta: string | null; equipoPanelTag: string | null; bloqueCodigo: string | null;
    bornes: Borne[];
    cableRioTag: string | null; cableRioTipo: string | null; cableRioCapacidad: number | null; cableRioEnUso: number;
    conductoresRio: number[]; // códigos reales de conductor en el cable RIO — para N_PAR_CABLE (orden de la señal en SU cable)
  }
  const conexPorSenal = new Map<string, ConexInfo>();
  for (const row of conex.recordset) {
    const id = String(row.senal_id);
    let e = conexPorSenal.get(id);
    if (!e) {
      e = {
        cableCampoTag: row.cable_campo_tag ?? null, cableCampoTipo: row.cable_campo_tipo ?? null,
        cajaTag: row.tag_caja ?? null, cajaIdResuelta: row.caja_id_resuelta === null ? null : String(row.caja_id_resuelta),
        equipoPanelTag: row.equipo_panel_tag ?? null, bloqueCodigo: row.bloque_codigo ?? null,
        bornes: [],
        cableRioTag: row.cable_rio_tag ?? null, cableRioTipo: row.cable_rio_tipo ?? null,
        cableRioCapacidad: row.cable_rio_capacidad === null ? null : Number(row.cable_rio_capacidad),
        cableRioEnUso: Number(row.cable_rio_en_uso ?? 0),
        conductoresRio: []
      };
      conexPorSenal.set(id, e);
    }
    if (row.terminal_numero !== null) e.bornes.push({ numero: row.terminal_numero });
    const codigoNum = Number(row.conductor_rio_codigo);
    if (row.conductor_rio_codigo !== null && Number.isFinite(codigoNum)) e.conductoresRio.push(codigoNum);
  }

  // --- 3) Planos por gabinete (RIO), migración 014. ---
  const planos = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT g.id AS gabinete_id, p.codigo_plano, p.descripcion, tp.codigo AS tipo_plano_codigo
    FROM nucleo.gabinete_plano gp
    JOIN nucleo.gabinete g ON g.id = gp.gabinete_id
    JOIN nucleo.plano p ON p.id = gp.plano_id AND p.activo = 1
    JOIN cat.cat_tipo_plano tp ON tp.id = p.tipo_plano_id
    WHERE gp.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND gp.activo = 1;
  `);
  const planoInteriorPorGabinete = new Map<string, { codigo: string | null; descripcion: string | null }>();
  const planoConexionadoPorGabinete = new Map<string, { codigo: string | null; descripcion: string | null }>();
  for (const row of planos.recordset) {
    const gid = String(row.gabinete_id);
    if (row.tipo_plano_codigo === 'CONEXIONADO_INTERNO' && !planoInteriorPorGabinete.has(gid)) {
      planoInteriorPorGabinete.set(gid, { codigo: row.codigo_plano, descripcion: row.descripcion });
    }
    if (row.tipo_plano_codigo === 'CONEXIONADO' && !planoConexionadoPorGabinete.has(gid)) {
      planoConexionadoPorGabinete.set(gid, { codigo: row.codigo_plano, descripcion: row.descripcion });
    }
  }

  // --- 3b) PLANO_GANCHO: pedido explícito del usuario — "es el plano de
  // la caja o panel... sácalo de los planos que tenemos de cajas y
  // paneles". Se resuelve vía caja_plano (migración 014) de la CAJA real
  // a la que llega la señal — nucleo.equipo (panel eléctrico) no tiene
  // una tabla equipo_plano equivalente todavía, así que un panel siempre
  // queda sin PLANO_GANCHO. Una caja puede tener más de un plano
  // asociado (confirmado con datos reales, ej. 620-TBC-5016 tiene 3) —
  // por ahora, "como está en el Excel" (un solo valor), se toma el
  // primero (menor id) — no hay forma de saber cuál es "el" correcto sin
  // más contexto, documentado como aproximación.
  const planosPorCaja = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT cp.caja_id, p.id AS plano_id, p.codigo_plano, p.descripcion
    FROM nucleo.caja_plano cp
    JOIN nucleo.plano p ON p.id = cp.plano_id AND p.activo = 1
    WHERE cp.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND cp.activo = 1
    ORDER BY cp.caja_id, p.id;
  `);
  const planoGanchoPorCaja = new Map<string, { codigo: string | null; descripcion: string | null }>();
  for (const row of planosPorCaja.recordset) {
    const cid = String(row.caja_id);
    if (!planoGanchoPorCaja.has(cid)) planoGanchoPorCaja.set(cid, { codigo: row.codigo_plano, descripcion: row.descripcion });
  }

  // --- 3c) PLANO_LAZO: pedido explícito del usuario — "ponle lo que
  // actualmente tiene". Vive en nucleo.lazo.codigo_documento, ligado al
  // instrumento DUEÑO directo de la señal (nunca al padre — a diferencia
  // de tag_senal/tag_cable, acá no hay evidencia real que confirme usar
  // el padre, así que se resuelve literal por la FK tal cual está
  // modelada). Un instrumento puede tener más de un lazo activo — se
  // toma el primero. En este proyecto (620) hoy no hay ningún lazo
  // cargado (0 filas), así que sale vacío para todas las señales — queda
  // listo para cuando se cargue el dato real.
  const lazos = await pool.request().input('proyecto_id', sql.NVarChar(30), projectId).query(`
    SELECT instrumento_id, codigo_documento FROM nucleo.lazo WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
  `);
  const lazoPorInstrumento = new Map<string, string | null>();
  for (const row of lazos.recordset) {
    const iid = String(row.instrumento_id);
    if (!lazoPorInstrumento.has(iid)) lazoPorInstrumento.set(iid, row.codigo_documento ?? null);
  }

  // --- Ensamblado + campos calculados (nunca guardados, ver cabecera) ---
  const filas: Fila[] = [];
  // Paralelo a `filas` — true para un canal de módulo sin señal asignada
  // ("reserva"). No es una columna del Excel, solo controla el color de
  // la fila más abajo (ver cabecera, nota RESERVA).
  const esReserva: boolean[] = [];

  for (const row of hw.recordset) {
    const gid = String(row.gabinete_id);
    const conexInfo = row.senal_id !== null ? conexPorSenal.get(String(row.senal_id)) : undefined;

    const bornera = calcularBornera(row.tipo_io_codigo, row.numero_canal).join(',');

    const necesarios = bornesCajaNecesarios(row.tipo_io_codigo, row.tipo_instrumento, row.es_loop_powered);
    const bornesReales = conexInfo?.bornes ?? [];
    const numerosReales = bornesReales.map((b) => Number(b.numero)).filter((n) => Number.isFinite(n));
    let borneJbList = bornesReales.map((b) => b.numero);
    if (necesarios !== null && conexInfo?.cajaTag) {
      const faltan = Math.max(0, necesarios - bornesReales.length);
      const siguiente = numerosReales.length > 0 ? Math.max(...numerosReales) + 1 : 1;
      for (let k = 0; k < faltan; k++) borneJbList.push(String(siguiente + k));
    }

    // N_PAR_CABLE se calcula DESPUÉS de este bucle (necesita comparar
    // contra las demás señales del mismo cable RIO) — ver más abajo.

    // ORDEN_INST_CAJA: correlativo numérico del propio código del TB de
    // la caja (ej. "TB-01" -> 1) — confirmado por el usuario.
    const ordenMatch = conexInfo?.bloqueCodigo?.match(/(\d+)\s*$/);
    const ordenInstCaja = ordenMatch ? Number(ordenMatch[1]) : null;

    const duenoTag = row.tag_instrumento ?? row.tag_equipo ?? null;
    const sistema = row.instrumento_sistema ?? row.equipo_sistema ?? null;

    const planoGanchoInfo = conexInfo?.cajaIdResuelta ? planoGanchoPorCaja.get(conexInfo.cajaIdResuelta) ?? null : null;
    const planoLazo = row.instrumento_id ? lazoPorInstrumento.get(String(row.instrumento_id)) ?? null : null;

    filas.push({
      rio: row.tag_gabinete,
      planoInteriorRio: planoInteriorPorGabinete.get(gid)?.codigo ?? null,
      descripcionPlanoInterior: planoInteriorPorGabinete.get(gid)?.descripcion ?? null,
      planoRio: planoConexionadoPorGabinete.get(gid)?.codigo ?? null,
      descripcionPlanoRio: planoConexionadoPorGabinete.get(gid)?.descripcion ?? null,
      chasis: row.numero_rack,
      slot: row.numero_slot,
      modelo: row.modelo,
      modulo: row.modulo_tag,
      moduloVista: row.tipo_io_codigo,
      dispr: row.surge_protector_tag,
      tb: row.modulo_bloque_codigo,
      canal: row.numero_canal,
      tModulo: (hilosPorModuloCanal.get(`${row.modulo_id}:${row.numero_canal}`) ?? []).join(','),
      bornera,
      nParCable: null, // se completa después del bucle, ver más abajo
      tagCable: conexInfo?.cableRioTag ?? null,
      rCable: conexInfo?.cableRioCapacidad !== null && conexInfo?.cableRioCapacidad !== undefined
        ? conexInfo.cableRioCapacidad - (conexInfo?.cableRioEnUso ?? 0) : null,
      tipoCable: conexInfo?.cableRioTipo ?? null,
      tagCaja: conexInfo?.cajaTag ?? conexInfo?.equipoPanelTag ?? null,
      borneJb: borneJbList.join(','),
      bNumReserva: null, // ver nota en cabecera — pendiente si se necesita
      tbCaja: conexInfo?.bloqueCodigo ?? null,
      ordenInstCaja,
      tagSenal: row.tag_senal,
      senal: row.nombre_corto,
      tagCableInst: conexInfo?.cableCampoTag ?? null,
      tipoCableInst: conexInfo?.cableCampoTipo ?? null,
      destino: row.senal_id !== null ? row.descripcion : 'RESERVA',
      nodo: row.instrumento_nodo ?? null,
      tagEquipoInst: row.tag_equipo,
      tagInstrumento: row.tag_instrumento,
      tagInstrumentoAsociado: row.instrumento_asociado_tag,
      planoLazo,
      tipoInstrumento: row.tipo_instrumento,
      servicio: row.senal_servicio ?? row.instrumento_servicio ?? null,
      sistema,
      pnpid: row.pnpid,
      tagWsp: row.instrumento_tag_anterior,
      conexTipo: row.es_loop_powered ? 'LP' : null,
      tecnologia: row.tecnologia,
      funcionamiento: row.funcionamiento,
      cuerpoInstrumento: row.cuerpo_instrumento,
      tipoSenal: derivarTipoSenal(row.tipo_io_codigo),
      linea: row.linea_pnid,
      equipoAsociado: row.equipo_asociado_tag,
      pAndId: row.plano_pnid,
      ubicacion: row.ubicacion,
      planoGancho: planoGanchoInfo?.codigo ?? null,
      planoGanchoDescripcion: planoGanchoInfo?.descripcion ?? null,
      idSenal: row.codigo_senal,
      enclavamiento: row.enclavamiento,
      alarmaHh: row.alarma_hh,
      alarmaH: row.alarma_h,
      alarmaL: row.alarma_l,
      alarmaLl: row.alarma_ll,
      rangoMin: row.rango_min,
      rangoMax: row.rango_max,
      unidadIngenieria: row.unidad_ingenieria,
      valorNormal: row.valor_normal,
      prioridadAlarma: row.prioridad_alarma_codigo,
      retardo: row.retardo,
      observacion: row.observacion,
      observaciones: null,
      estadoRevision: row.estado_revision_codigo
    });
    esReserva.push(row.senal_id === null);
  }

  // --- B_NUM_RESERVA: 20% de reserva de bornes por (caja, TB), fórmula
  // real decodificada de BORNE_JB (Excel) — ROUNDUP separado para
  // analógicas y digitales, ver cabecera. Se calcula por grupo DESPUÉS de
  // tener todas las filas (necesita el total usado por el grupo). ---
  const gruposCajaTb = new Map<string, { analogicas: number; digitales: number; filas: Fila[] }>();
  for (const [i, row] of hw.recordset.entries()) {
    const fila = filas[i];
    if (!fila.tbCaja) continue;
    const key = `${fila.tagCaja}::${fila.tbCaja}`;
    if (!gruposCajaTb.has(key)) gruposCajaTb.set(key, { analogicas: 0, digitales: 0, filas: [] });
    const grupo = gruposCajaTb.get(key)!;
    grupo.filas.push(fila);
    const tio = (row.tipo_io_codigo ?? '').toUpperCase();
    const bornesUsados = fila.borneJb ? fila.borneJb.split(',').filter(Boolean).length : 0;
    if (tio === 'AI' || tio === 'AO') grupo.analogicas += bornesUsados;
    else if (tio === 'DI' || tio === 'DO') grupo.digitales += bornesUsados;
  }
  for (const grupo of gruposCajaTb.values()) {
    const reserva = Math.ceil((grupo.analogicas * 0.2) / 2) + Math.ceil((grupo.digitales * 0.2) / 3);
    for (const fila of grupo.filas) fila.bNumReserva = reserva;
  }

  // --- N_PAR_CABLE: pedido explícito del usuario — NO es el número de
  // conductor/borne en sí, es simplemente el ORDEN de la señal DENTRO DE
  // SU PROPIO cable (1ra, 2da, 3ra...), sin importar si el cable es
  // multiconductor (discretas) o multipar (analógicas) — "a mí me basta
  // con enumerar o tener el orden de la señal en el cable". Se ordena por
  // el código de conductor REAL más bajo que usa cada señal en el cable
  // RIO (nunca el borne de la caja, que es una numeración distinta) —
  // señales sin cable RIO (ej. panel eléctrico sin caja) quedan sin
  // N_PAR_CABLE, no hay nada que enumerar. ---
  const gruposPorCableRio = new Map<string, Array<{ fila: Fila; minConductor: number }>>();
  for (const [i, row] of hw.recordset.entries()) {
    const fila = filas[i];
    const conexInfo = row.senal_id !== null ? conexPorSenal.get(String(row.senal_id)) : undefined;
    if (!conexInfo?.cableRioTag || conexInfo.conductoresRio.length === 0) continue;
    const minConductor = Math.min(...conexInfo.conductoresRio);
    if (!gruposPorCableRio.has(conexInfo.cableRioTag)) gruposPorCableRio.set(conexInfo.cableRioTag, []);
    gruposPorCableRio.get(conexInfo.cableRioTag)!.push({ fila, minConductor });
  }
  for (const grupo of gruposPorCableRio.values()) {
    grupo.sort((a, b) => a.minConductor - b.minConductor);
    grupo.forEach((item, idx) => { item.fila.nParCable = idx + 1; });
  }

  // --- Escribir el .xlsx ---
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIEI';
  workbook.lastModifiedBy = 'SIEI';
  const ws = workbook.addWorksheet('SENALES_CONTROL');

  const columnas: Array<{ header: string; key: keyof Fila; width?: number }> = [
    { header: 'RIO', key: 'rio', width: 16 },
    { header: 'PLANO_INTERIOR_RIO', key: 'planoInteriorRio', width: 16 },
    { header: 'DESCRIPCION_PLANO_INTERIOR', key: 'descripcionPlanoInterior', width: 30 },
    { header: 'PLANO_RIO', key: 'planoRio', width: 16 },
    { header: 'DESCRIPCION_PLANO_RIO', key: 'descripcionPlanoRio', width: 30 },
    { header: 'CHASIS', key: 'chasis', width: 8 },
    { header: 'SLOT', key: 'slot', width: 6 },
    { header: 'MODELO', key: 'modelo', width: 16 },
    { header: 'MODULO', key: 'modulo', width: 12 },
    { header: 'MODULO_VISTA', key: 'moduloVista', width: 12 },
    { header: 'DISPR', key: 'dispr', width: 10 },
    { header: 'TB', key: 'tb', width: 10 },
    { header: 'CANAL', key: 'canal', width: 6 },
    { header: 'T_MODULO', key: 'tModulo', width: 14 },
    { header: 'BORNERA', key: 'bornera', width: 16 },
    { header: 'N_PAR_CABLE', key: 'nParCable', width: 12 },
    { header: 'TAG_CABLE', key: 'tagCable', width: 18 },
    { header: 'R_CABLE', key: 'rCable', width: 10 },
    { header: 'TIPO_CABLE', key: 'tipoCable', width: 18 },
    { header: 'PLANO_GANCHO', key: 'planoGancho', width: 16 },
    { header: 'PLANO_GANCHO_DESCRIPCION', key: 'planoGanchoDescripcion', width: 30 },
    { header: 'TAG_CAJA', key: 'tagCaja', width: 16 },
    { header: 'BORNE_JB', key: 'borneJb', width: 16 },
    { header: 'B_NUM_RESERVA', key: 'bNumReserva', width: 12 },
    { header: 'TB_CAJA', key: 'tbCaja', width: 10 },
    { header: 'ORDEN_INST_CAJA', key: 'ordenInstCaja', width: 14 },
    { header: 'TAG_SENAL', key: 'tagSenal', width: 22 },
    { header: 'SENAL', key: 'senal', width: 10 },
    { header: 'TAG_CABLE_INST', key: 'tagCableInst', width: 18 },
    { header: 'TIPO_CABLE_INST', key: 'tipoCableInst', width: 18 },
    { header: 'DESTINO', key: 'destino', width: 30 },
    { header: 'NODO', key: 'nodo', width: 10 },
    { header: 'TAG_EQUIPO_INST', key: 'tagEquipoInst', width: 16 },
    { header: 'TAG_INSTRUMENTO', key: 'tagInstrumento', width: 16 },
    { header: 'TAG_INSTRUMENTO_ASOCIADO', key: 'tagInstrumentoAsociado', width: 20 },
    { header: 'PLANO_LAZO', key: 'planoLazo', width: 16 },
    { header: 'TIPO_INSTRUMENTO', key: 'tipoInstrumento', width: 12 },
    { header: 'SERVICIO', key: 'servicio', width: 40 },
    { header: 'SISTEMA', key: 'sistema', width: 14 },
    { header: 'PnPID', key: 'pnpid', width: 12 },
    { header: 'TAG_WSP', key: 'tagWsp', width: 14 },
    { header: 'CONEX_TIPO', key: 'conexTipo', width: 10 },
    { header: 'TECNOLOGIA', key: 'tecnologia', width: 16 },
    { header: 'FUNCIONAMIENTO', key: 'funcionamiento', width: 30 },
    { header: 'CUERPO_INSTRUMENTO', key: 'cuerpoInstrumento', width: 20 },
    { header: 'TIPO_SENAL', key: 'tipoSenal', width: 14 },
    { header: 'LÍNEA', key: 'linea', width: 12 },
    { header: 'EQUIPO_ASOCIADO', key: 'equipoAsociado', width: 16 },
    { header: 'P&ID', key: 'pAndId', width: 12 },
    { header: 'UBICACIÓN', key: 'ubicacion', width: 16 },
    { header: 'OBSERVACIONES', key: 'observaciones', width: 20 },
    { header: 'ID_SENAL', key: 'idSenal', width: 16 },
    { header: 'ENCLAVAMIENTO', key: 'enclavamiento', width: 24 },
    { header: 'ALARMA_HH', key: 'alarmaHh', width: 10 },
    { header: 'ALARMA_H', key: 'alarmaH', width: 10 },
    { header: 'ALARMA_L', key: 'alarmaL', width: 10 },
    { header: 'ALARMA_LL', key: 'alarmaLl', width: 10 },
    { header: 'RANGO_MIN', key: 'rangoMin', width: 10 },
    { header: 'RANGO_MAX', key: 'rangoMax', width: 10 },
    { header: 'UNIDAD_INGENIERIA', key: 'unidadIngenieria', width: 12 },
    { header: 'VALOR_NORMAL', key: 'valorNormal', width: 12 },
    { header: 'PRIORIDAD_ALARMA', key: 'prioridadAlarma', width: 12 },
    { header: 'RETARDO', key: 'retardo', width: 10 },
    { header: 'OBSERVACION', key: 'observacion', width: 30 },
    { header: 'ESTADO_REVISION', key: 'estadoRevision', width: 14 }
  ];

  ws.columns = columnas.map((c) => ({ header: c.header, key: c.key as string, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

  // Pedido explícito del usuario: "que las filas de cada RIO salgan con
  // un color diferente respecto a su RIO" — un color de fondo suave por
  // RIO distinto, ciclando la paleta si hay más RIOs que colores. Cada
  // fila es nueva (ws.addRow, nunca duplicateRow), así que asignar el
  // fill directo no arrastra el problema de referencias compartidas ya
  // encontrado en el generador de LDI (ese sí clona filas existentes).
  const PALETA_COLORES_RIO = ['FFFFF2CC', 'FFD9E1F2', 'FFE2EFDA', 'FFFCE4D6', 'FFE4DFEC', 'FFFFE0E0', 'FFDDEBF7', 'FFFFF0E1'];
  const colorPorRio = new Map<string, string>();
  function colorParaRio(rio: string | null): string | null {
    if (!rio) return null;
    if (!colorPorRio.has(rio)) {
      colorPorRio.set(rio, PALETA_COLORES_RIO[colorPorRio.size % PALETA_COLORES_RIO.length]);
    }
    return colorPorRio.get(rio)!;
  }

  // Gris claro fijo para filas de RESERVA (ver cabecera) — pisa el color
  // por RIO a propósito, para que una reserva salte a la vista sea cual
  // sea su RIO.
  const COLOR_RESERVA = 'FFF2F2F2';

  filas.forEach((fila, i) => {
    const excelRow = ws.addRow(fila as unknown as Record<string, unknown>);
    const color = esReserva[i] ? COLOR_RESERVA : colorParaRio(fila.rio);
    if (color) excelRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });

  await workbook.xlsx.writeFile(out);
  console.log(`Listo: ${filas.length} señales escritas en ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
