import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import sql from 'mssql';

import { authenticate } from '../middleware/authenticate.js';
import { requireProjectPermission } from '../middleware/requireProjectPermission.js';
import { getDbPool } from '../db/sql.js';
import { compararCodigoNatural } from '../lib/naturalSort.js';

/*
 * Vistas de solo lectura para la sección CONTROL del frontend
 * (ver CLAUDE.md, "Interfaz CONTROL"). NO son un módulo de datos nuevo —
 * son lecturas enriquecidas (JOIN) sobre las tablas normalizadas ya
 * existentes (nucleo.senal/instrumento/equipo/canal/modulo/slot/rack/
 * gabinete/caja/ruta_conexion), pensadas para no obligar al frontend a
 * hacer N+1 llamadas por señal para resolver dueño + IO + estado de
 * conexionado. No agrega columnas ni tablas — solo consultas.
 *
 * "Estado de conexionado" es deliberadamente de 2 niveles, no más:
 *   IO_PENDIENTE   -> la señal no tiene canal_id asignado.
 *   RUTA_PENDIENTE -> tiene canal, pero ninguna ruta_conexion activa.
 *   RUTA_CARGADA   -> tiene canal y al menos una ruta_conexion activa.
 * Nunca se reporta un cuarto estado de "terminaciones completas": esa
 * capa queda deliberadamente fuera de esta fase (ver docs/
 * DIAGNOSTICO_SENALES_GABINETES.md sección 43 y la instrucción de la
 * fase "IMPLEMENTACIÓN REAL — CONTROL 620").
 */
export const controlOverviewRouter = Router({ mergeParams: true });

controlOverviewRouter.use(authenticate);

function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/*
 * BORNERA (columna del Excel maestro del usuario, hoja SENALES) — el
 * borne REAL del TB propio del módulo, dentro del gabinete, con prefijo
 * "F" (fusible) — un borne físico distinto de los pines de fábrica del
 * conector del módulo (esos son "hilos"/T_MODULO, ya modelados vía
 * cat_modulo_io_terminal). Confirmado con datos reales del Excel: la
 * numeración es secuencial por MÓDULO completo (nunca se reinicia por
 * canal) y la cantidad de bornes por canal depende del tipo: 2 para
 * DI/DO (coincide 1 a 1 con los 2 pines de fábrica), 4 para AI/AO/RTD
 * (2 más que los pines de fábrica — alimentación del lazo, confirmado
 * por el usuario, aunque no se modela para qué es cada uno).
 *
 * Pedido explícito del usuario: por ahora esto es una REGLA fija, no un
 * dato real materializado en la base (ese nivel de detalle — configurar
 * la cantidad de bornes por tipo de módulo desde una pantalla — queda
 * para después). Se calcula acá, nunca se guarda.
 */
const BORNERAS_POR_CANAL_SEGUN_TIPO_IO: Record<string, number> = {
  DI: 2,
  DO: 2,
  AI: 4,
  AO: 4,
  RTD: 4
};

function calcularBornera(tipoIoCodigo: string | null, numeroCanal: number): Array<{ numero: string }> {
  const porCanal = tipoIoCodigo ? (BORNERAS_POR_CANAL_SEGUN_TIPO_IO[tipoIoCodigo] ?? 2) : 2;
  const inicio = numeroCanal * porCanal + 1;
  // Solo la PRIMERA mitad de los bornes de cada canal lleva el prefijo
  // "F" (fusible) — confirmado con datos reales: DI/DO es "F1-2" (uno
  // con F, el otro no) y AI/AO/RTD es "F1-F2-3-4" (los dos primeros con
  // F, los dos últimos sin) — nunca TODOS con F, corrección explícita
  // del usuario sobre la primera versión de esta regla.
  const conFusible = Math.floor(porCanal / 2);
  return Array.from({ length: porCanal }, (_, i) => ({
    numero: i < conFusible ? `F${inicio + i}` : `${inicio + i}`
  }));
}

/**
 * Cuántos bornes necesita una señal en el TB de la CAJA — regla real,
 * decodificada directamente de la fórmula BORNE_JB del Excel maestro
 * (columna Z de la hoja SENALES, un LET/SEQUENCE), NO inventada:
 *
 *   N = SI CONEX_TIPO="LP" (loop-powered)         -> 2
 *       SI NO, SI TIPO_INSTRUMENTO∈{"HY","HYO"}    -> 5
 *       SI NO, SI TIPO_INSTRUMENTO="HYC"           -> 4
 *       SI NO, SI TIPO_IO∈{"AI","AO"}              -> 2
 *       SI NO, SI TIPO_IO∈{"DI","DO"}              -> 3
 *       SI NO                                       -> null (no definido)
 *
 * OJO: esta regla es DISTINTA de BORNERAS_POR_CANAL_SEGUN_TIPO_IO (la
 * bornera del GABINETE, calcularBornera arriba) — son dos TB físicos
 * distintos con reglas propias confirmadas por separado, no la misma
 * regla aplicada dos veces. Verificado con el usuario tras encontrar que
 * la primera versión de esto (reutilizar la regla del gabinete) daba 2/4
 * cuando el Excel real pedía 3 para varias señales DI/DO.
 *
 * TIPO_INSTRUMENTO/CONEX_TIPO son NULL para una señal de EQUIPO (nucleo.
 * equipo no tiene esas columnas) — ahí la regla cae directo a TIPO_IO
 * (DI/DO=3, AI/AO=2), que sí aplica a ambos tipos de dueño.
 *
 * Devuelve null cuando la propia fórmula del Excel tampoco define un N
 * (tipo de señal no cubierto, ej. RTD) — en ese caso no se completa nada,
 * nunca se inventa una cantidad.
 */
function bornesCajaNecesarios(
  tipoIoCodigo: string | null,
  tipoInstrumento: string | null,
  esLoopPowered: boolean | null
): number | null {
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
 * Completa los bornes REALES de una caja (los que ya tienen terminación
 * cargada) hasta la cantidad que `bornesCajaNecesarios` dice que esa
 * señal necesita — pedido explícito del usuario: "los bornes de las
 * cajas ponlos todos los que necesita, así sean más de los que se
 * cablean con las señales" (confirmado con datos reales: decenas de
 * señales tienen hoy menos bornes reales cargados en su caja de los que
 * su tipo necesita).
 *
 * Los que faltan se numeran CONTINUANDO la secuencia de los reales de esta
 * MISMA señal (máximo real + 1, + 2, ...) y quedan marcados
 * `estimado: true` — pedido explícito del usuario: "no le pongas
 * pendiente, solo ponlos pero iguales que los otros enumerados pero así
 * como medio transparentes" — el número mostrado NO es necesariamente el
 * mismo que el Excel real asignaría (esa es una secuencia corrida por
 * caja+TB completo, no solo por señal, y ese archivo no tiene los
 * resultados cacheados — ver comentario de bornesCajaNecesarios), es una
 * numeración de continuidad razonable; `estimado` es lo que le dice a la
 * UI que lo pinte semitransparente en vez de sólido. Si la señal no tiene
 * ningún borne real todavía, arranca en 1.
 *
 * Solo aplica cuando hay una CAJA real de por medio (`tieneCaja`, resuelto
 * por `cajaTag` — NUNCA por `bloqueCodigo`): `bloqueCodigo` solo se
 * resuelve vía una terminación YA cargada, así que una señal con 0 bornes
 * reales nunca tiene `bloqueCodigo` — gatear por ahí dejaba sin completar
 * justo a las señales que más lo necesitaban (bug real reportado por el
 * usuario: "pareciera que solo listás las que están conectadas"). Un
 * panel eléctrico no tiene TB en absoluto (por diseño) y no se le agregan
 * bornes estimados — por eso el gate es `cajaTag`, no "hay algún nodo de
 * conexión".
 */
function padBornesCaja<T extends { numero: string | null; campoOcupado: boolean; rioOcupado: boolean }>(
  bornesReales: T[],
  necesarios: number | null,
  tieneCaja: boolean
): Array<T | { numero: string; campoOcupado: boolean; rioOcupado: boolean; estimado: true }> {
  if (!tieneCaja || necesarios === null) return bornesReales;
  const faltan = Math.max(0, necesarios - bornesReales.length);
  if (faltan <= 0) return bornesReales;
  const numerosReales = bornesReales.map((b) => Number(b.numero)).filter((n) => Number.isFinite(n));
  const siguiente = numerosReales.length > 0 ? Math.max(...numerosReales) + 1 : 1;
  return [
    ...bornesReales,
    ...Array.from({ length: faltan }, (_, i) => ({
      numero: String(siguiente + i),
      campoOcupado: false,
      rioOcupado: false,
      estimado: true as const
    }))
  ];
}

const CONTROL_SIGNAL_SELECT = `
  s.id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.descripcion,
  s.canal_id, s.dueno_ausente, s.sin_match_pnid, s.servicio AS senal_servicio,

  i.id AS instrumento_id, i.tag_instrumento, i.descripcion AS instrumento_descripcion,
  i.tipo_instrumento, i.servicio, i.sistema AS instrumento_sistema, i.ubicacion, i.nodo AS instrumento_nodo,
  i.pnpid, i.plano_pnid, i.tecnologia, i.funcionamiento, i.cuerpo_instrumento,
  i.linea_pnid, i.equipo_asociado_tag,

  iag.id AS agrupador_id, iag.tag_instrumento AS agrupador_tag,

  e.id AS equipo_id, e.tag_equipo, e.descripcion AS equipo_descripcion,
  e.sistema AS equipo_sistema, e.nodo AS equipo_nodo, e.panel AS equipo_panel,

  tio.codigo AS tipo_io_codigo,

  c.numero_canal,
  m.id AS modulo_id, cmi.fabricante, cmi.modelo,
  sl.numero_slot, r.numero_rack,
  g.id AS gabinete_id, g.tag_gabinete, tg.codigo AS tipo_gabinete_codigo,

  (
    SELECT TOP 1 cj.tag_caja
    FROM nucleo.ruta_conexion rc
    JOIN nucleo.tramo_conexion tc ON tc.ruta_conexion_id = rc.id AND tc.activo = 1
    JOIN nucleo.punto_conexion po ON po.id = tc.punto_origen_id
    JOIN nucleo.punto_conexion pd ON pd.id = tc.punto_destino_id
    LEFT JOIN nucleo.caja cj ON cj.id = COALESCE(po.caja_id, pd.caja_id)
    WHERE rc.senal_id = s.id AND rc.activo = 1
      AND (po.caja_id IS NOT NULL OR pd.caja_id IS NOT NULL)
  ) AS caja_tag,

  (
    SELECT COUNT(*) FROM nucleo.ruta_conexion rc
    WHERE rc.senal_id = s.id AND rc.activo = 1
  ) AS n_rutas,

  (
    SELECT TOP 1 rc.id FROM nucleo.ruta_conexion rc
    WHERE rc.senal_id = s.id AND rc.activo = 1
    ORDER BY rc.id
  ) AS ruta_id
`;

const CONTROL_SIGNAL_FROM = `
  FROM nucleo.senal s
  JOIN cat.cat_clase_senal cs ON cs.id = s.clase_senal_id AND cs.codigo = 'CONTROL'
  LEFT JOIN nucleo.instrumento i ON i.id = s.instrumento_id
  LEFT JOIN nucleo.instrumento iag ON iag.id = s.instrumento_agrupador_id
  LEFT JOIN nucleo.equipo e ON e.id = s.equipo_id
  LEFT JOIN cat.cat_tipo_io tio ON tio.id = s.tipo_io_id
  LEFT JOIN nucleo.canal c ON c.id = s.canal_id
  LEFT JOIN nucleo.modulo m ON m.id = c.modulo_id
  LEFT JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
  LEFT JOIN nucleo.slot sl ON sl.id = m.slot_id
  LEFT JOIN nucleo.rack r ON r.id = sl.rack_id
  LEFT JOIN nucleo.gabinete g ON g.id = r.gabinete_id
  LEFT JOIN cat.cat_tipo_gabinete tg ON tg.id = g.tipo_gabinete_id
`;

function estadoConexionado(row: Record<string, any>): 'IO_PENDIENTE' | 'RUTA_PENDIENTE' | 'RUTA_CARGADA' {
  if (row.canal_id === null) return 'IO_PENDIENTE';
  if (Number(row.n_rutas) === 0) return 'RUTA_PENDIENTE';
  return 'RUTA_CARGADA';
}

function serializeControlSignal(row: Record<string, any>) {
  const nullableId = (v: unknown) => (v === null || v === undefined ? null : String(v));

  return {
    id: String(row.id),
    codigoSenal: row.codigo_senal,
    tagSenal: row.tag_senal,
    nombreCorto: row.nombre_corto,
    descripcion: row.descripcion,
    tipoIoCodigo: row.tipo_io_codigo,

    // Servicio DE LA SEÑAL (migración 028) — más granular que
    // dueno.servicio (el servicio general del instrumento, si lo hay);
    // pensado sobre todo para señales de equipo, que no tienen su propio
    // servicio. La UI prefiere este valor y cae a dueno.servicio si está
    // vacío.
    servicio: row.senal_servicio,

    dueno: row.instrumento_id
      ? {
          tipo: 'instrumento' as const,
          id: String(row.instrumento_id),
          tag: row.tag_instrumento,
          descripcion: row.instrumento_descripcion,
          tipoInstrumento: row.tipo_instrumento,
          servicio: row.servicio,
          sistema: row.instrumento_sistema,
          ubicacion: row.ubicacion,
          nodo: row.instrumento_nodo,
          pnpid: row.pnpid,
          planoPnid: row.plano_pnid,
          tecnologia: row.tecnologia,
          funcionamiento: row.funcionamiento,
          cuerpoInstrumento: row.cuerpo_instrumento,
          linea: row.linea_pnid,
          equipoAsociadoTag: row.equipo_asociado_tag
        }
      : row.equipo_id
        ? {
            tipo: 'equipo' as const,
            id: String(row.equipo_id),
            tag: row.tag_equipo,
            descripcion: row.equipo_descripcion,
            sistema: row.equipo_sistema,
            nodo: row.equipo_nodo,
            panel: row.equipo_panel
          }
        : null,

    agrupador: row.agrupador_id
      ? { id: String(row.agrupador_id), tag: row.agrupador_tag }
      : null,

    io: row.canal_id
      ? {
          canalId: String(row.canal_id),
          numeroCanal: row.numero_canal,
          moduloId: nullableId(row.modulo_id),
          fabricante: row.fabricante,
          modelo: row.modelo,
          numeroSlot: row.numero_slot,
          numeroRack: row.numero_rack,
          gabineteId: nullableId(row.gabinete_id),
          tagGabinete: row.tag_gabinete,
          tipoGabineteCodigo: row.tipo_gabinete_codigo
        }
      : null,

    cajaTag: row.caja_tag,
    rutaId: nullableId(row.ruta_id),
    estadoConexionado: estadoConexionado(row),
    duenoAusente: Boolean(row.dueno_ausente), sinMatchPnid: Boolean(row.sin_match_pnid)
  };
}


/*
 * GET /api/projects/:projectId/control/signals
 *
 * Lista completa de señales CONTROL con dueño/IO/conexionado ya
 * resueltos, para la tabla principal de la sección CONTROL. Filtros
 * opcionales por querystring: q (texto libre sobre tag/codigo/nombre/tag
 * de dueño), gabineteId, tipoIoCodigo, estado.
 */
controlOverviewRouter.get(
  '/signals',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${CONTROL_SIGNAL_SELECT}
          ${CONTROL_SIGNAL_FROM}
          WHERE s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND s.activo = 1
          ORDER BY g.tag_gabinete, r.numero_rack, sl.numero_slot, c.numero_canal, s.tag_senal;
        `);

      let signals = result.recordset.map(serializeControlSignal);

      const q = normalizeParam(req.query.q as string | string[] | undefined)?.trim().toLowerCase();
      if (q) {
        signals = signals.filter((s) =>
          [s.tagSenal, s.codigoSenal, s.nombreCorto, s.dueno?.tag, s.agrupador?.tag]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        );
      }
      const gabineteId = normalizeParam(req.query.gabineteId as string | string[] | undefined);
      if (gabineteId) signals = signals.filter((s) => s.io?.gabineteId === gabineteId);

      const tipoIo = normalizeParam(req.query.tipoIoCodigo as string | string[] | undefined);
      if (tipoIo) signals = signals.filter((s) => s.tipoIoCodigo === tipoIo);

      const numeroRack = normalizeParam(req.query.numeroRack as string | string[] | undefined);
      if (numeroRack) signals = signals.filter((s) => String(s.io?.numeroRack) === numeroRack);

      const numeroSlot = normalizeParam(req.query.numeroSlot as string | string[] | undefined);
      if (numeroSlot) signals = signals.filter((s) => String(s.io?.numeroSlot) === numeroSlot);

      const duenoTipo = normalizeParam(req.query.duenoTipo as string | string[] | undefined);
      if (duenoTipo) signals = signals.filter((s) => s.dueno?.tipo === duenoTipo);

      const estado = normalizeParam(req.query.estado as string | string[] | undefined);
      if (estado) signals = signals.filter((s) => s.estadoConexionado === estado);

      res.status(200).json({ projectId, signals });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/control/groups
 *
 * Agrupación funcional de señales — no un concepto nuevo de datos, es una
 * re-agrupación de las mismas señales de GET .../control/signals: la
 * clave de grupo es el instrumento agrupador cuando existe (p. ej. las 5
 * señales de 620-HV-5084), y si no existe, el propio dueño (instrumento o
 * equipo) — así las 6 señales de un mismo equipo como 620-PPS-5005, que
 * no tienen agrupador formal pero comparten dueño, también aparecen
 * juntas. Pensada para "cómo se agrupan las señales", no para reemplazar
 * la tabla plana de .../control/signals.
 */
controlOverviewRouter.get(
  '/groups',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${CONTROL_SIGNAL_SELECT}
          ${CONTROL_SIGNAL_FROM}
          WHERE s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND s.activo = 1
          ORDER BY s.tag_senal;
        `);

      const signals = result.recordset.map(serializeControlSignal);

      type Grupo = {
        clave: string;
        tipo: 'agrupador' | 'individual';
        gabinetes: Set<string>;
        miembros: typeof signals;
      };
      const grupos = new Map<string, Grupo>();

      for (const s of signals) {
        const clave = s.agrupador?.tag ?? s.dueno?.tag ?? `(sin dueño) ${s.codigoSenal ?? s.id}`;
        if (!grupos.has(clave)) {
          grupos.set(clave, { clave, tipo: s.agrupador ? 'agrupador' : 'individual', gabinetes: new Set(), miembros: [] });
        }
        const g = grupos.get(clave)!;
        g.miembros.push(s);
        if (s.io?.tagGabinete) g.gabinetes.add(s.io.tagGabinete);
      }

      const q = normalizeParam(req.query.q as string | string[] | undefined)?.trim().toLowerCase();

      let lista = [...grupos.values()]
        .map((g) => ({
          clave: g.clave,
          tipo: g.tipo,
          gabinetes: [...g.gabinetes],
          nMiembros: g.miembros.length,
          miembros: g.miembros
        }))
        .sort((a, b) => a.clave.localeCompare(b.clave));

      if (q) {
        lista = lista.filter(
          (g) => g.clave.toLowerCase().includes(q) || g.miembros.some((m) => (m.tagSenal ?? '').toLowerCase().includes(q))
        );
      }

      res.status(200).json({ projectId, grupos: lista });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/control/signals/:signalId
 *
 * Mismo shape que el item de la lista — usado por la vista de detalle
 * de señal CONTROL (dueño resuelto + IO resuelto + estado de
 * conexionado). El detalle fino del conexionado (tramos/conductores/
 * terminaciones) se obtiene aparte con GET .../routes/:rutaId/conexionado
 * (ya existente desde 015), usando el rutaId que este endpoint expone.
 */
controlOverviewRouter.get(
  '/signals/:signalId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const signalId = normalizeParam(req.params.signalId);
      if (!signalId || !/^\d+$/.test(signalId)) {
        res.status(400).json({ error: 'invalid_signal_id', message: 'signalId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('signal_id', sql.NVarChar(30), signalId)
        .query(`
          SELECT ${CONTROL_SIGNAL_SELECT}
          ${CONTROL_SIGNAL_FROM}
          WHERE s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND s.activo = 1
            AND s.id = TRY_CONVERT(BIGINT, @signal_id);
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'signal_not_found', message: 'Signal does not exist in this project or is inactive.' });
        return;
      }

      const signal = serializeControlSignal(row);

      // Cadena de nodos física de la ruta (para la visualización de
      // conexionado por etapas) — GET .../routes/:id/conexionado (015) da
      // el árbol tramo->conductor->terminación pero no la identidad de
      // cada nodo, así que se resuelve aparte aquí, una sola vez, con los
      // mismos punto_conexion ya usados por la ruta.
      let rutaNodos: Array<{ tipo: string; tag: string; extra?: string }> = [];
      if (signal.rutaId) {
        const tramosResult = await pool
          .request()
          .input('ruta_id', sql.NVarChar(30), signal.rutaId)
          .query(`
            SELECT tc.numero_orden,
              po.instrumento_id AS o_inst_id, oi.tag_instrumento AS o_inst_tag,
              po.equipo_id AS o_eq_id, oe.tag_equipo AS o_eq_tag,
              po.caja_id AS o_caja_id, ocj.tag_caja AS o_caja_tag,
              po.gabinete_id AS o_gab_id, ogb.tag_gabinete AS o_gab_tag,
              po.modulo_id AS o_mod_id, ocmi.modelo AS o_mod_modelo, osl.numero_slot AS o_mod_slot,
              pd.instrumento_id AS d_inst_id, di.tag_instrumento AS d_inst_tag,
              pd.equipo_id AS d_eq_id, de_.tag_equipo AS d_eq_tag,
              pd.caja_id AS d_caja_id, dcj.tag_caja AS d_caja_tag,
              pd.gabinete_id AS d_gab_id, dgb.tag_gabinete AS d_gab_tag,
              pd.modulo_id AS d_mod_id, dcmi.modelo AS d_mod_modelo, dsl.numero_slot AS d_mod_slot
            FROM nucleo.tramo_conexion tc
            JOIN nucleo.punto_conexion po ON po.id = tc.punto_origen_id
            JOIN nucleo.punto_conexion pd ON pd.id = tc.punto_destino_id
            LEFT JOIN nucleo.instrumento oi ON oi.id = po.instrumento_id
            LEFT JOIN nucleo.equipo oe ON oe.id = po.equipo_id
            LEFT JOIN nucleo.caja ocj ON ocj.id = po.caja_id
            LEFT JOIN nucleo.gabinete ogb ON ogb.id = po.gabinete_id
            LEFT JOIN nucleo.modulo om ON om.id = po.modulo_id
            LEFT JOIN cat.cat_modulo_io ocmi ON ocmi.id = om.catalogo_modulo_id
            LEFT JOIN nucleo.slot osl ON osl.id = om.slot_id
            LEFT JOIN nucleo.instrumento di ON di.id = pd.instrumento_id
            LEFT JOIN nucleo.equipo de_ ON de_.id = pd.equipo_id
            LEFT JOIN nucleo.caja dcj ON dcj.id = pd.caja_id
            LEFT JOIN nucleo.gabinete dgb ON dgb.id = pd.gabinete_id
            LEFT JOIN nucleo.modulo dm ON dm.id = pd.modulo_id
            LEFT JOIN cat.cat_modulo_io dcmi ON dcmi.id = dm.catalogo_modulo_id
            LEFT JOIN nucleo.slot dsl ON dsl.id = dm.slot_id
            WHERE tc.ruta_conexion_id = TRY_CONVERT(BIGINT, @ruta_id) AND tc.activo = 1
            ORDER BY tc.numero_orden;
          `);

        const nodeFrom = (r: Record<string, any>, side: 'o' | 'd') => {
          if (r[`${side}_inst_id`]) return { tipo: 'instrumento', tag: r[`${side}_inst_tag`] };
          if (r[`${side}_eq_id`]) return { tipo: 'equipo', tag: r[`${side}_eq_tag`] };
          if (r[`${side}_caja_id`]) return { tipo: 'caja', tag: r[`${side}_caja_tag`] };
          if (r[`${side}_gab_id`]) return { tipo: 'gabinete', tag: r[`${side}_gab_tag`] };
          if (r[`${side}_mod_id`]) return { tipo: 'modulo', tag: r[`${side}_mod_modelo`], extra: `SLOT-${String(r[`${side}_mod_slot`]).padStart(2, '0')}` };
          return { tipo: 'desconocido', tag: '—' };
        };

        const rows = tramosResult.recordset;
        if (rows.length > 0) {
          rutaNodos = [nodeFrom(rows[0], 'o')];
          for (const r of rows) rutaNodos.push(nodeFrom(r, 'd'));
        }
      }

      res.status(200).json({ signal: { ...signal, rutaNodos } });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/control/hardware
 *
 * Árbol GABINETE -> RACK -> SLOT -> MODULO -> CANAL para la vista de
 * hardware, con la señal CONTROL de cada canal si existe (RESERVA en
 * caso contrario — un canal libre nunca se representa como una fila de
 * nucleo.senal, siempre se deriva de "canal existente sin señal activa",
 * ver CLAUDE.md).
 */
controlOverviewRouter.get(
  '/hardware',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT
            g.id AS gabinete_id, g.tag_gabinete, tg.codigo AS tipo_gabinete_codigo,
            r.id AS rack_id, r.numero_rack,
            sl.id AS slot_id, sl.numero_slot,
            m.id AS modulo_id, cmi.fabricante, cmi.modelo, tio.codigo AS tipo_io_codigo,
            c.id AS canal_id, c.numero_canal,
            s.id AS senal_id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.dueno_ausente, s.sin_match_pnid,

            i.tag_instrumento AS dueno_tag, e.tag_equipo AS dueno_equipo_tag,
            iag.tag_instrumento AS agrupador_tag,

            (
              SELECT TOP 1 cj.tag_caja
              FROM nucleo.ruta_conexion rc
              JOIN nucleo.tramo_conexion tc ON tc.ruta_conexion_id = rc.id AND tc.activo = 1
              JOIN nucleo.punto_conexion po ON po.id = tc.punto_origen_id
              JOIN nucleo.punto_conexion pd ON pd.id = tc.punto_destino_id
              LEFT JOIN nucleo.caja cj ON cj.id = COALESCE(po.caja_id, pd.caja_id)
              WHERE rc.senal_id = s.id AND rc.activo = 1
                AND (po.caja_id IS NOT NULL OR pd.caja_id IS NOT NULL)
            ) AS caja_tag,
            (
              -- Cable real del tramo de campo (instrumento -> caja,
              -- numero_orden = 1) — el único tramo con conductor/
              -- terminación real cargados hoy (migración 015, ver "ARRANCA
              -- POR AHÍ" en el historial de esta sesión); los tramos
              -- caja -> gabinete -> módulo todavía no tienen cable propio
              -- documentado. TOP 1 porque puede haber 2 conductores
              -- (discreta) del MISMO cable — alcanza con su tag.
              SELECT TOP 1 cab.tag_cable
              FROM nucleo.ruta_conexion rc2
              JOIN nucleo.tramo_conexion tc2 ON tc2.ruta_conexion_id = rc2.id AND tc2.activo = 1 AND tc2.numero_orden = 1
              JOIN nucleo.tramo_conductor tcd2 ON tcd2.tramo_conexion_id = tc2.id AND tcd2.activo = 1
              JOIN nucleo.conductor cond2 ON cond2.id = tcd2.conductor_id
              JOIN nucleo.cable cab ON cab.id = cond2.cable_id
              WHERE rc2.senal_id = s.id AND rc2.activo = 1
            ) AS cable_tag_campo,
            (
              SELECT COUNT(*) FROM nucleo.ruta_conexion rc
              WHERE rc.senal_id = s.id AND rc.activo = 1
            ) AS n_rutas

          FROM nucleo.gabinete g
          JOIN cat.cat_tipo_gabinete tg ON tg.id = g.tipo_gabinete_id
          LEFT JOIN nucleo.rack r ON r.gabinete_id = g.id AND r.activo = 1
          LEFT JOIN nucleo.slot sl ON sl.rack_id = r.id AND sl.activo = 1
          LEFT JOIN nucleo.modulo m ON m.slot_id = sl.id AND m.activo = 1
          LEFT JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
          LEFT JOIN cat.cat_tipo_io tio ON tio.id = cmi.tipo_io_id
          LEFT JOIN nucleo.canal c ON c.modulo_id = m.id AND c.activo = 1
          LEFT JOIN nucleo.senal s ON s.canal_id = c.id AND s.activo = 1
          LEFT JOIN nucleo.instrumento i ON i.id = s.instrumento_id
          LEFT JOIN nucleo.equipo e ON e.id = s.equipo_id
          LEFT JOIN nucleo.instrumento iag ON iag.id = s.instrumento_agrupador_id
          WHERE g.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND g.activo = 1
          ORDER BY g.tag_gabinete, r.numero_rack, sl.numero_slot, c.numero_canal;
        `);

      type GabineteNode = {
        id: string; tagGabinete: string; tipoGabineteCodigo: string;
        racks: Map<string, { id: string; numeroRack: number; slots: Map<string, any> }>;
      };
      const gabinetes = new Map<string, GabineteNode>();

      for (const row of result.recordset) {
        const gId = String(row.gabinete_id);
        if (!gabinetes.has(gId)) {
          gabinetes.set(gId, { id: gId, tagGabinete: row.tag_gabinete, tipoGabineteCodigo: row.tipo_gabinete_codigo, racks: new Map() });
        }
        const gab = gabinetes.get(gId)!;
        if (row.rack_id === null) continue;
        const rId = String(row.rack_id);
        if (!gab.racks.has(rId)) gab.racks.set(rId, { id: rId, numeroRack: row.numero_rack, slots: new Map() });
        const rack = gab.racks.get(rId)!;
        if (row.slot_id === null) continue;
        const slId = String(row.slot_id);
        if (!rack.slots.has(slId)) {
          rack.slots.set(slId, {
            id: slId, numeroSlot: row.numero_slot,
            modulo: row.modulo_id
              ? { id: String(row.modulo_id), fabricante: row.fabricante, modelo: row.modelo, tipoIoCodigo: row.tipo_io_codigo, canales: [] as any[] }
              : null
          });
        }
        const slot = rack.slots.get(slId)!;
        if (row.canal_id !== null && slot.modulo) {
          const duenoTag = row.dueno_tag ?? row.dueno_equipo_tag ?? null;
          const duenoTipo = row.dueno_tag ? 'instrumento' : row.dueno_equipo_tag ? 'equipo' : null;
          slot.modulo.canales.push({
            id: String(row.canal_id),
            numeroCanal: row.numero_canal,
            senal: row.senal_id
              ? {
                  id: String(row.senal_id), codigoSenal: row.codigo_senal, tagSenal: row.tag_senal, nombreCorto: row.nombre_corto,
                  duenoTag, duenoTipo, agrupadorTag: row.agrupador_tag ?? null, cajaTag: row.caja_tag ?? null,
                  cableTagCampo: row.cable_tag_campo ?? null,
                  duenoAusente: Boolean(row.dueno_ausente), sinMatchPnid: Boolean(row.sin_match_pnid),
                  estadoConexionado: row.canal_id === null ? 'IO_PENDIENTE' : Number(row.n_rutas) === 0 ? 'RUTA_PENDIENTE' : 'RUTA_CARGADA'
                }
              : null,
            estado: row.senal_id ? 'OCUPADO' : 'RESERVA'
          });
        }
      }

      const tree = [...gabinetes.values()].map((g) => ({
        id: g.id,
        tagGabinete: g.tagGabinete,
        tipoGabineteCodigo: g.tipoGabineteCodigo,
        racks: [...g.racks.values()]
          .sort((a, b) => a.numeroRack - b.numeroRack)
          .map((r) => ({
            id: r.id,
            numeroRack: r.numeroRack,
            slots: [...r.slots.values()]
              .sort((a: any, b: any) => a.numeroSlot - b.numeroSlot)
              .map((sl: any) => ({
                ...sl,
                modulo: sl.modulo
                  ? { ...sl.modulo, canales: sl.modulo.canales.sort((a: any, b: any) => a.numeroCanal - b.numeroCanal) }
                  : null
              }))
          }))
      }));

      res.status(200).json({ projectId, gabinetes: tree });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/control/planos
 *
 * Tabla que relaciona el hardware de CONTROL (gabinetes y cajas) con los
 * planos ya cargados (nucleo.gabinete_plano / nucleo.caja_plano, migración
 * 014) — no es un dato nuevo, es una lectura conjunta pensada para
 * responder "qué planos cubren mi conexionado". Cada fila es una
 * asociación real; un gabinete/caja con varios planos aparece varias
 * veces (una por plano), y un plano sin ninguna asociación activa
 * (todavía) no aparece aquí — para eso sigue estando la lista general en
 * .../planos.
 */
controlOverviewRouter.get(
  '/planos',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT
            'gabinete' AS entidad_tipo, g.id AS entidad_id, g.tag_gabinete AS entidad_tag,
            p.id AS plano_id, p.codigo_plano, p.descripcion, tp.codigo AS tipo_plano_codigo
          FROM nucleo.gabinete_plano gp
          JOIN nucleo.gabinete g ON g.id = gp.gabinete_id
          JOIN nucleo.plano p ON p.id = gp.plano_id AND p.activo = 1
          JOIN cat.cat_tipo_plano tp ON tp.id = p.tipo_plano_id
          WHERE gp.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND gp.activo = 1

          UNION ALL

          SELECT
            'caja' AS entidad_tipo, c.id AS entidad_id, c.tag_caja AS entidad_tag,
            p.id AS plano_id, p.codigo_plano, p.descripcion, tp.codigo AS tipo_plano_codigo
          FROM nucleo.caja_plano cp
          JOIN nucleo.caja c ON c.id = cp.caja_id
          JOIN nucleo.plano p ON p.id = cp.plano_id AND p.activo = 1
          JOIN cat.cat_tipo_plano tp ON tp.id = p.tipo_plano_id
          WHERE cp.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND cp.activo = 1

          ORDER BY entidad_tipo, entidad_tag, tipo_plano_codigo, codigo_plano;
        `);

      const filas = result.recordset.map((row) => ({
        entidadTipo: row.entidad_tipo as 'gabinete' | 'caja',
        entidadId: String(row.entidad_id),
        entidadTag: row.entidad_tag as string,
        planoId: String(row.plano_id),
        codigoPlano: row.codigo_plano as string | null,
        descripcion: row.descripcion as string,
        tipoPlanoCodigo: row.tipo_plano_codigo as string
      }));

      res.status(200).json({ projectId, planos: filas });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/control/cajas
 *
 * "PANEL" unificado (pedido explícito del usuario: "ya no lo llamaremos
 * cajas sino panel... dentro de los paneles pueden ir cajas, o estos
 * paneles eléctricos") — una sola lista, cada elemento con `tipo: 'CAJA'
 * | 'EQUIPO'`, en vez de las dos listas separadas (`cajas`/`paneles`) que
 * esta misma ruta devolvía antes. En el Excel del usuario el concepto es
 * uno solo, la propia columna se llama CAJA_EQUIPO — la caja real (con
 * TB/bornes) y el panel eléctrico de un equipo (sin TB, "no tiene TB o no
 * nos interesa, solamente se sabe que llega") son dos variantes del mismo
 * rol dentro de una ruta, no dos entidades separadas para el usuario.
 *
 * CAJA -> BLOQUE_TERMINAL -> TERMINAL -> POSICION_TERMINAL, con la señal
 * real que ocupa cada posición si existe — acá la cadena real es
 * POSICION_TERMINAL <- TERMINACION <- TRAMO_CONDUCTOR <- TRAMO_CONEXION
 * <- RUTA_CONEXION <- SEÑAL (migración 015), no un simple canal_id como
 * en un módulo. EQUIPO (panel eléctrico) no tiene ese detalle de bornes
 * — ver el comentario más abajo, antes de armar `panelesEquipo`.
 *
 * A diferencia del comentario de cabecera de este archivo ("nunca se
 * reporta una capa de terminaciones completas"), esa decisión aplicaba al
 * estado de UNA SEÑAL (2 niveles, sin cambios ahí) — acá el eje es el
 * PANEL, no la señal, y para una caja la ocupación de una posición SÍ
 * importa y ya existe con datos reales (ver "Terminaciones (migración
 * 015)" / "ARRANCA POR AHÍ" en el historial de esta sesión). No es una
 * contradicción, es una vista distinta con una pregunta distinta.
 *
 * Una posición admite a lo sumo una TERMINACION activa
 * (UX_terminacion_posicion_ocupacion) — el LEFT JOIN de acá abajo es 1:1,
 * nunca multiplica filas por posición.
 *
 * Cada panel (de cualquier tipo) trae, además del detalle propio de su
 * tipo, un resumen común pensado para listar/filtrar sin entrar al
 * detalle: `cantidadSenales`, `cantidadCables` (tags de cable distintos
 * entre sus señales) y `gabinetesTags` (gabinetes reales hacia los que
 * continúa cada señal, resueltos por su propio canal_id — no por el
 * tramo que pasa por este panel).
 */
controlOverviewRouter.get(
  '/cajas',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT
            c.id AS caja_id, c.tag_caja,
            bt.id AS bloque_id, bt.codigo AS bloque_codigo,
            bt.plano_id AS bloque_plano_id, pl.codigo_plano AS bloque_plano_codigo,
            t.id AS terminal_id, t.numero AS terminal_numero,
            pt.id AS posicion_id, pt.codigo AS posicion_codigo,

            cond.codigo AS conductor_codigo, cab.tag_cable,

            s.id AS senal_id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.dueno_ausente, s.sin_match_pnid,
            i.tag_instrumento AS dueno_tag, e.tag_equipo AS dueno_equipo_tag,

            -- Gabinete/RIO al que en realidad va esta señal, resuelto vía
            -- su propio canal_id (independiente del tramo que pasa por
            -- ESTA caja) — la caja es un nodo intermedio de la ruta física
            -- real (instrumento -> caja -> gabinete -> módulo), esto
            -- responde "hacia qué gabinete continúa" (pedido explícito
            -- del usuario al ver el cable/conductor en esta vista).
            g2.tag_gabinete AS destino_gabinete_tag

          FROM nucleo.caja c
          LEFT JOIN nucleo.bloque_terminal bt ON bt.caja_id = c.id AND bt.activo = 1
          LEFT JOIN nucleo.plano pl ON pl.id = bt.plano_id
          LEFT JOIN nucleo.terminal t ON t.bloque_terminal_id = bt.id AND t.activo = 1
          LEFT JOIN nucleo.posicion_terminal pt ON pt.terminal_id = t.id AND pt.activo = 1
          LEFT JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
          LEFT JOIN nucleo.tramo_conductor tcd ON tcd.id = te.tramo_conductor_id AND tcd.activo = 1
          LEFT JOIN nucleo.conductor cond ON cond.id = tcd.conductor_id
          LEFT JOIN nucleo.cable cab ON cab.id = cond.cable_id
          LEFT JOIN nucleo.tramo_conexion tc ON tc.id = tcd.tramo_conexion_id
          LEFT JOIN nucleo.ruta_conexion rc ON rc.id = tc.ruta_conexion_id AND rc.activo = 1
          LEFT JOIN nucleo.senal s ON s.id = rc.senal_id AND s.activo = 1
          LEFT JOIN nucleo.instrumento i ON i.id = s.instrumento_id
          LEFT JOIN nucleo.equipo e ON e.id = s.equipo_id
          LEFT JOIN nucleo.canal c2 ON c2.id = s.canal_id AND c2.activo = 1
          LEFT JOIN nucleo.modulo m2 ON m2.id = c2.modulo_id AND m2.activo = 1
          LEFT JOIN nucleo.slot sl2 ON sl2.id = m2.slot_id
          LEFT JOIN nucleo.rack rk2 ON rk2.id = sl2.rack_id
          LEFT JOIN nucleo.gabinete g2 ON g2.id = rk2.gabinete_id
          WHERE c.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND c.activo = 1
          ORDER BY c.tag_caja, bt.codigo, pt.codigo;
        `);

      type CajaNode = {
        id: string; tagCaja: string;
        bloques: Map<string, { id: string; codigo: string; planoId: string | null; planoCodigoPlano: string | null; terminales: Map<string, any> }>;
        senales: any[];
      };
      const cajas = new Map<string, CajaNode>();
      // Una señal puede ocupar más de una POSICION_TERMINAL en la misma
      // caja (varios hilos de una misma señal, ej. alimentación + señal
      // en bornes distintos del mismo TB — mismo motivo documentado más
      // abajo para `panelesEquipo`) — se agrega al resumen plano una sola
      // vez por caja, aunque ocupe varias posiciones.
      const cajaSenalYaListada = new Set<string>();

      for (const row of result.recordset) {
        const cId = String(row.caja_id);
        if (!cajas.has(cId)) {
          cajas.set(cId, { id: cId, tagCaja: row.tag_caja, bloques: new Map(), senales: [] });
        }
        const caja = cajas.get(cId)!;
        if (row.bloque_id === null) continue;
        const bId = String(row.bloque_id);
        if (!caja.bloques.has(bId)) {
          caja.bloques.set(bId, {
            id: bId, codigo: row.bloque_codigo,
            planoId: row.bloque_plano_id === null ? null : String(row.bloque_plano_id),
            planoCodigoPlano: row.bloque_plano_codigo,
            terminales: new Map()
          });
        }
        const bloque = caja.bloques.get(bId)!;
        if (row.terminal_id === null) continue;
        const tId = String(row.terminal_id);
        if (!bloque.terminales.has(tId)) {
          bloque.terminales.set(tId, { id: tId, numero: row.terminal_numero, posiciones: [] as any[] });
        }
        const terminal = bloque.terminales.get(tId)!;
        if (row.posicion_id === null) continue;

        const duenoTag = row.dueno_tag ?? row.dueno_equipo_tag ?? null;
        const duenoTipo = row.dueno_tag ? 'instrumento' : row.dueno_equipo_tag ? 'equipo' : null;

        const senalEntry = row.senal_id
          ? {
              id: String(row.senal_id), codigoSenal: row.codigo_senal, tagSenal: row.tag_senal, nombreCorto: row.nombre_corto,
              duenoTag, duenoTipo, duenoAusente: Boolean(row.dueno_ausente), sinMatchPnid: Boolean(row.sin_match_pnid),
              conductorCodigo: row.conductor_codigo, tagCable: row.tag_cable,
              destinoGabineteTag: row.destino_gabinete_tag ?? null
            }
          : null;

        terminal.posiciones.push({
          id: String(row.posicion_id),
          codigo: row.posicion_codigo,
          senal: senalEntry,
          estado: senalEntry ? 'OCUPADO' : 'RESERVA'
        });

        if (senalEntry) {
          const senalKey = `${cId}:${senalEntry.id}`;
          if (!cajaSenalYaListada.has(senalKey)) {
            cajaSenalYaListada.add(senalKey);
            caja.senales.push(senalEntry);
          }
        }
      }

      const panelesCaja = [...cajas.values()].map((c) => {
        const cablesSet = new Set<string>();
        const gabinetesSet = new Set<string>();
        for (const s of c.senales) {
          if (s.tagCable) cablesSet.add(s.tagCable);
          if (s.destinoGabineteTag) gabinetesSet.add(s.destinoGabineteTag);
        }
        return {
          id: c.id,
          tipo: 'CAJA' as const,
          tag: c.tagCaja,
          cantidadSenales: c.senales.length,
          cantidadCables: cablesSet.size,
          gabinetesTags: [...gabinetesSet].sort(),
          senales: c.senales,
          bloques: [...c.bloques.values()]
            .sort((a, b) => compararCodigoNatural(a.codigo, b.codigo))
            .map((b) => ({
              id: b.id,
              codigo: b.codigo,
              planoId: b.planoId,
              planoCodigoPlano: b.planoCodigoPlano,
              terminales: [...b.terminales.values()].sort((a: any, bb: any) => compararCodigoNatural(a.numero, bb.numero))
            }))
        };
      });

      // --- Paneles eléctricos ---
      // Pedido explícito del usuario: no todo lo que sigue después del
      // RIO/gabinete es una caja real — a veces el cable de campo llega
      // directo al panel PROPIO de un equipo (ej. "620-AFM-5005", el
      // armario de un variador). A diferencia de una caja, un panel
      // eléctrico NO necesita bornes/TB modelados ("no tiene TB o no nos
      // interesa, solamente se sabe que llega") — por eso esto NO pasa
      // por bloque_terminal en absoluto (aunque la migración 026 ya le
      // daría esa capacidad si alguna vez hiciera falta). Un panel es
      // cualquier EQUIPO que aparece como nodo del tramo 1 de una ruta
      // real — el mismo rol que cumple una caja, sin el detalle de
      // bornes. Puede estar en dos posiciones distintas, confirmado con
      // datos reales del proyecto 620:
      //   - Como DESTINO (ej. un futuro AFM-5005 recibiendo el cable de
      //     un PPS-5005 dueño distinto) — el rol exacto de una caja.
      //   - Como ORIGEN (ej. 620-TSA-5001/620-UPS-5010, que SON su
      //     propio panel — el dueño de la señal y el panel son el mismo
      //     equipo, ruta de solo 2 tramos, sin nodo de caja separado).
      // Se lista acá, junto a las cajas (pedido explícito: "esos los
      // vamos listando también en la parte de cajas"), identificado como
      // "panel eléctrico", nunca como caja.
      const panelesResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT
            eqp.id AS panel_id, eqp.tag_equipo AS panel_tag,
            s.id AS senal_id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.dueno_ausente, s.sin_match_pnid,
            i.tag_instrumento AS dueno_tag, e.tag_equipo AS dueno_equipo_tag,
            cab.tag_cable,
            g2.tag_gabinete AS destino_gabinete_tag
          FROM nucleo.senal s
          JOIN nucleo.ruta_conexion rc ON rc.senal_id = s.id AND rc.activo = 1
          JOIN nucleo.tramo_conexion tc1 ON tc1.ruta_conexion_id = rc.id AND tc1.activo = 1 AND tc1.numero_orden = 1
          JOIN nucleo.punto_conexion pd1 ON pd1.id = tc1.punto_destino_id
          JOIN nucleo.punto_conexion po1 ON po1.id = tc1.punto_origen_id
          JOIN nucleo.equipo eqp ON eqp.id = COALESCE(pd1.equipo_id, po1.equipo_id)
          LEFT JOIN nucleo.instrumento i ON i.id = s.instrumento_id
          LEFT JOIN nucleo.equipo e ON e.id = s.equipo_id
          LEFT JOIN nucleo.tramo_conductor td1 ON td1.tramo_conexion_id = tc1.id AND td1.activo = 1
          LEFT JOIN nucleo.conductor cond ON cond.id = td1.conductor_id
          LEFT JOIN nucleo.cable cab ON cab.id = cond.cable_id
          LEFT JOIN nucleo.canal c2 ON c2.id = s.canal_id AND c2.activo = 1
          LEFT JOIN nucleo.modulo m2 ON m2.id = c2.modulo_id AND m2.activo = 1
          LEFT JOIN nucleo.slot sl2 ON sl2.id = m2.slot_id
          LEFT JOIN nucleo.rack rk2 ON rk2.id = sl2.rack_id
          LEFT JOIN nucleo.gabinete g2 ON g2.id = rk2.gabinete_id
          WHERE s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND s.activo = 1
          ORDER BY eqp.tag_equipo, s.tag_senal;
        `);

      type PanelEquipoNode = { id: string; tagEquipo: string; senales: any[] };
      const panelesEquipo = new Map<string, PanelEquipoNode>();
      // Una señal puede tener más de un conductor en el tramo 1 (ej. 2
      // hilos por señal discreta) — el LEFT JOIN de arriba multiplica
      // filas por conductor, así que cada señal se agrega una sola vez
      // por panel (el cable ya es el mismo para todos sus conductores).
      const senalYaListada = new Set<string>();
      for (const row of panelesResult.recordset) {
        const pId = String(row.panel_id);
        if (!panelesEquipo.has(pId)) panelesEquipo.set(pId, { id: pId, tagEquipo: row.panel_tag, senales: [] });
        const senalKey = `${pId}:${row.senal_id}`;
        if (senalYaListada.has(senalKey)) continue;
        senalYaListada.add(senalKey);
        const duenoTag = row.dueno_tag ?? row.dueno_equipo_tag ?? null;
        const duenoTipo = row.dueno_tag ? 'instrumento' : row.dueno_equipo_tag ? 'equipo' : null;
        panelesEquipo.get(pId)!.senales.push({
          id: String(row.senal_id), codigoSenal: row.codigo_senal, tagSenal: row.tag_senal, nombreCorto: row.nombre_corto,
          duenoTag, duenoTipo, duenoAusente: Boolean(row.dueno_ausente), sinMatchPnid: Boolean(row.sin_match_pnid),
          tagCable: row.tag_cable ?? null,
          destinoGabineteTag: row.destino_gabinete_tag ?? null
        });
      }

      const panelesEquipoSerializados = [...panelesEquipo.values()].map((p) => {
        const cablesSet = new Set<string>();
        const gabinetesSet = new Set<string>();
        for (const s of p.senales) {
          if (s.tagCable) cablesSet.add(s.tagCable);
          if (s.destinoGabineteTag) gabinetesSet.add(s.destinoGabineteTag);
        }
        return {
          id: p.id,
          tipo: 'EQUIPO' as const,
          tag: p.tagEquipo,
          cantidadSenales: p.senales.length,
          cantidadCables: cablesSet.size,
          gabinetesTags: [...gabinetesSet].sort(),
          senales: p.senales,
          bloques: null
        };
      });

      const paneles = [...panelesCaja, ...panelesEquipoSerializados]
        .sort((a, b) => compararCodigoNatural(a.tag, b.tag));

      res.status(200).json({ projectId, paneles });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/control/ruteo
 *
 * El árbol completo de ruteo de UN proyecto en una sola llamada — pedido
 * explícito del usuario, calcado del esquema de su Excel maestro (hoja
 * SENALES, columnas A:AK, celdas combinadas por RIO/rack/módulo): GABINETE
 * -> RACK -> MÓDULO (con su propio surge y TB) -> CANAL (ocupado o en
 * RESERVA) -> cable RIO->caja -> CAJA (su TB, sus bornes) -> cable
 * caja->instrumento/equipo -> INSTRUMENTO o EQUIPO. No es un dato nuevo:
 * fusiona /hardware (gabinete->canal) con /cajas (bornes) y la cadena de
 * conexionado (migración 015) ya usada en RouteDetailPage, en las
 * llamadas mínimas necesarias en vez de una por señal.
 *
 * "Reserva" de un cable (pedido explícito del usuario, columna R_CABLE de
 * su Excel) es SIEMPRE calculada acá — capacidad_conductores menos
 * conductores activos de ESE cable — nunca un dato importado: el Excel
 * la traía como número fijo, pero es 100% derivable de lo que ya hay.
 *
 * Canales en RESERVA (sin señal) sí aparecen — pedido explícito del
 * usuario ("los canales/hilos en RESERVA también van en el árbol") — a
 * diferencia de /cajas, que ya los mostraba, esto lo iguala en /hardware
 * también para esta vista unificada.
 */
controlOverviewRouter.get(
  '/ruteo',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();

      // 1) Árbol gabinete -> rack -> módulo (+ surge + su propio TB) -> canal -> señal.
      const hwResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT
            g.id AS gabinete_id, g.tag_gabinete, tg.codigo AS tipo_gabinete_codigo,
            r.id AS rack_id, r.numero_rack,
            sl.id AS slot_id, sl.numero_slot,
            m.id AS modulo_id, m.tag AS modulo_tag, m.surge_protector_tag,
            cmi.fabricante, cmi.modelo, tio.codigo AS tipo_io_codigo,
            btm.codigo AS modulo_bloque_codigo,
            c.id AS canal_id, c.numero_canal,
            s.id AS senal_id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.dueno_ausente, s.sin_match_pnid,
            s.servicio AS senal_servicio,
            -- DESTINO de la hoja SENALES del Excel ("la descripción corta
            -- de la señal") — vive en nucleo.senal.descripcion, la columna
            -- de descripción libre que ya existía pero estaba sin usar
            -- para este proyecto (0/269 señales CONTROL la tenían antes
            -- de importar DESTINO). Distinto de SERVICIO (más largo, con
            -- el contexto del equipo/instrumento) y de nombre_corto (solo
            -- el sufijo del tag, ej. "RDY").
            s.descripcion AS senal_destino,
            -- Nodo del INSTRUMENTO dueño únicamente (pedido explícito del
            -- usuario) — para esta columna el nodo no se muestra del lado
            -- equipo, aunque exista (información propia del instrumento
            -- en esta vista). i.servicio es el servicio GENERAL del
            -- instrumento (menos granular que senal.servicio, migración
            -- 028 — ver ese comentario) — se usa solo como respaldo
            -- cuando la señal no tiene su propio servicio.
            i.tag_instrumento AS dueno_tag, i.nodo AS dueno_nodo, i.servicio AS dueno_servicio, e.tag_equipo AS dueno_equipo_tag,
            -- Para bornesCajaNecesarios() más abajo — la cantidad real de
            -- bornes que la señal necesita en la caja (fórmula BORNE_JB
            -- del Excel, decodificada del propio archivo real).
            i.tipo_instrumento AS dueno_tipo_instrumento, s.es_loop_powered,
            (
              SELECT COUNT(*) FROM nucleo.ruta_conexion rc
              WHERE rc.senal_id = s.id AND rc.activo = 1
            ) AS n_rutas
          FROM nucleo.gabinete g
          JOIN cat.cat_tipo_gabinete tg ON tg.id = g.tipo_gabinete_id
          LEFT JOIN nucleo.rack r ON r.gabinete_id = g.id AND r.activo = 1
          LEFT JOIN nucleo.slot sl ON sl.rack_id = r.id AND sl.activo = 1
          LEFT JOIN nucleo.modulo m ON m.slot_id = sl.id AND m.activo = 1
          LEFT JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
          LEFT JOIN cat.cat_tipo_io tio ON tio.id = cmi.tipo_io_id
          LEFT JOIN nucleo.bloque_terminal btm ON btm.modulo_id = m.id AND btm.activo = 1
          LEFT JOIN nucleo.canal c ON c.modulo_id = m.id AND c.activo = 1
          LEFT JOIN nucleo.senal s ON s.canal_id = c.id AND s.activo = 1
          LEFT JOIN nucleo.instrumento i ON i.id = s.instrumento_id
          LEFT JOIN nucleo.equipo e ON e.id = s.equipo_id
          WHERE g.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND g.activo = 1
          ORDER BY g.tag_gabinete, r.numero_rack, sl.numero_slot, c.numero_canal;
        `);

      // 2) Hilos propios del módulo (terminales de fábrica), por canal — los
      //    mismos que ya se ven en "Ver canales"/RouteDetailPage.
      const hilosResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT bt.modulo_id, cmit.numero_canal, t.numero, cmit.orden_terminal
          FROM nucleo.terminal t
          JOIN nucleo.bloque_terminal bt ON bt.id = t.bloque_terminal_id AND bt.modulo_id IS NOT NULL
          JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = t.catalogo_modulo_io_terminal_id
          WHERE bt.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND t.activo = 1
          ORDER BY bt.modulo_id, cmit.numero_canal, cmit.orden_terminal;
        `);
      const hilosPorModuloCanal = new Map<string, Array<{ numero: string }>>();
      for (const row of hilosResult.recordset) {
        const key = `${row.modulo_id}:${row.numero_canal}`;
        if (!hilosPorModuloCanal.has(key)) hilosPorModuloCanal.set(key, []);
        hilosPorModuloCanal.get(key)!.push({ numero: row.numero });
      }

      // 3) Por señal con conexionado real: cable de campo (tramo 1), su
      //    borne en la caja (o el propio equipo si el destino no es una
      //    caja), y el cable del RIO que llega al MISMO borne (tramo 2,
      //    la otra posición) — un row por borne/hilo, se agrupa abajo.
      const conexResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT
            s.id AS senal_id,
            cabCampo.tag_cable AS cable_campo_tag, cabCampo.tipo_cable AS cable_campo_tipo,
            cabCampo.capacidad_conductores AS cable_campo_capacidad,
            (
              SELECT COUNT(*) FROM nucleo.conductor cc
              JOIN nucleo.tramo_conductor tcc ON tcc.conductor_id = cc.id AND tcc.activo = 1
              WHERE cc.cable_id = cabCampo.id AND cc.activo = 1
            ) AS cable_campo_en_uso,
            COALESCE(cj.tag_caja, cjDirecto.tag_caja) AS tag_caja,
            COALESCE(eqPanelBloque.tag_equipo, eqPanelDirecto.tag_equipo, eqPanelOrigen.tag_equipo) AS equipo_panel_tag,
            bt.codigo AS bloque_codigo,
            t.id AS terminal_id, t.numero AS terminal_numero,
            ptCampo.codigo AS posicion_campo_codigo,
            cabRio.tag_cable AS cable_rio_tag, cabRio.tipo_cable AS cable_rio_tipo,
            cabRio.capacidad_conductores AS cable_rio_capacidad,
            (
              SELECT COUNT(*) FROM nucleo.conductor cr
              JOIN nucleo.tramo_conductor tcr ON tcr.conductor_id = cr.id AND tcr.activo = 1
              WHERE cr.cable_id = cabRio.id AND cr.activo = 1
            ) AS cable_rio_en_uso,
            ptRio.codigo AS posicion_rio_codigo
          FROM nucleo.senal s
          JOIN nucleo.ruta_conexion rc ON rc.senal_id = s.id AND rc.activo = 1
          JOIN nucleo.tramo_conexion tc1 ON tc1.ruta_conexion_id = rc.id AND tc1.activo = 1 AND tc1.numero_orden = 1
          -- LEFT (no INNER) desde acá para abajo: "0 conductores todavía"
          -- es un estado válido (una ruta puede existir como esqueleto —
          -- punto_conexion/tramo_conexion reales — sin que nadie haya
          -- cargado el cable/conductor aún, confirmado con datos reales:
          -- 26 rutas de equipo en este proyecto están así). Sin estos
          -- LEFT, esas señales no mostraban ni siquiera la caja/el panel,
          -- que sí se puede resolver directo desde punto_conexion sin
          -- necesitar ningún conductor.
          LEFT JOIN nucleo.tramo_conductor td1 ON td1.tramo_conexion_id = tc1.id AND td1.activo = 1
          LEFT JOIN nucleo.conductor condCampo ON condCampo.id = td1.conductor_id
          LEFT JOIN nucleo.cable cabCampo ON cabCampo.id = condCampo.cable_id
          LEFT JOIN nucleo.terminacion termCampo ON termCampo.tramo_conductor_id = td1.id AND termCampo.activo = 1 AND termCampo.extremo = 'DESTINO'
          LEFT JOIN nucleo.posicion_terminal ptCampo ON ptCampo.id = termCampo.posicion_terminal_id
          LEFT JOIN nucleo.terminal t ON t.id = ptCampo.terminal_id
          LEFT JOIN nucleo.bloque_terminal bt ON bt.id = t.bloque_terminal_id
          LEFT JOIN nucleo.caja cj ON cj.id = bt.caja_id
          -- El panel propio de un EQUIPO (migración 026, ej. "620-AFM-5005",
          -- el armario de un variador) ocupa exactamente la misma posición
          -- que una caja — el DESTINO del tramo 1 — cuando el cable de
          -- campo llega directo a su TB sin pasar por una caja real.
          LEFT JOIN nucleo.equipo eqPanelBloque ON eqPanelBloque.id = bt.equipo_id
          -- Respaldo sin pasar por el conductor/terminación — directo
          -- desde el propio punto_destino del tramo, para que la caja o
          -- el panel se vean aunque todavía no haya ni un conductor
          -- cargado (confirmado con datos reales: 26 rutas de equipo en
          -- este proyecto están así, ver comentario más arriba).
          LEFT JOIN nucleo.punto_conexion pd1 ON pd1.id = tc1.punto_destino_id
          LEFT JOIN nucleo.caja cjDirecto ON cjDirecto.id = pd1.caja_id
          LEFT JOIN nucleo.equipo eqPanelDirecto ON eqPanelDirecto.id = pd1.equipo_id
          -- Antes de la migración 026 (bloque_terminal no admitía equipo
          -- como dueño), la única forma de que un panel de equipo
          -- apareciera en una ruta ya construida era como ORIGEN del
          -- tramo 1 (el mismo rol que un instrumento) — confirmado con
          -- datos reales (620-TSA-5001: tramo 1 = equipo -> gabinete
          -- directo, sin caja ni panel intermedio). Se mantiene como
          -- último respaldo para no perder esas rutas ya existentes.
          LEFT JOIN nucleo.punto_conexion po1 ON po1.id = tc1.punto_origen_id
          LEFT JOIN nucleo.equipo eqPanelOrigen ON eqPanelOrigen.id = po1.equipo_id
          -- Cable del RIO: se pivota desde la posición HERMANA del MISMO
          -- borne (nunca desde el tramo primero) — un terminal admite a lo
          -- sumo 2 posiciones activas (campo y RIO), así que "la otra
          -- posición de este mismo terminal" identifica una sola fila sin
          -- necesidad de filtrar por tramo/orden: por construcción (ver
          -- fixCableRioCajaVsCampo620.ts) la única terminación que puede
          -- ocupar esa posición hermana es la del cable RIO->caja.
          LEFT JOIN nucleo.posicion_terminal ptRio ON ptRio.terminal_id = t.id AND ptRio.id != ptCampo.id AND ptRio.activo = 1
          LEFT JOIN nucleo.terminacion termRio ON termRio.posicion_terminal_id = ptRio.id AND termRio.activo = 1 AND termRio.extremo = 'ORIGEN'
          LEFT JOIN nucleo.tramo_conductor td2 ON td2.id = termRio.tramo_conductor_id AND td2.activo = 1
          LEFT JOIN nucleo.conductor condRio ON condRio.id = td2.conductor_id
          LEFT JOIN nucleo.cable cabRio ON cabRio.id = condRio.cable_id
          WHERE s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND s.activo = 1
          ORDER BY s.id, t.numero;
        `);

      interface CableInfo { tag: string; tipoCable: string | null; capacidad: number | null; enUso: number; reserva: number | null }
      const buildCable = (tag: unknown, tipo: unknown, capacidad: unknown, enUso: unknown): CableInfo | null => {
        if (!tag) return null;
        const cap = capacidad === null ? null : Number(capacidad);
        const uso = Number(enUso ?? 0);
        return { tag: tag as string, tipoCable: (tipo as string) ?? null, capacidad: cap, enUso: uso, reserva: cap === null ? null : cap - uso };
      };

      // `pendiente: true` = borne todavía sin terminación real cargada,
      // ver `padBornesCaja` más abajo — no tiene número real asignado
      // (nunca se inventa uno), solo indica que el TB necesita más
      // bornes de los que ya están cableados.
      // `estimado: true` = borne agregado por padBornesCaja (numeración de
      // continuidad, no la secuencia real del Excel) — ver ese comentario.
      interface BorneRuteo { numero: string; campoOcupado: boolean; rioOcupado: boolean; estimado?: boolean }
      interface ConexRuteo {
        cableCampo: CableInfo | null; cajaTag: string | null; equipoPanelTag: string | null;
        bloqueCodigo: string | null; bornes: BorneRuteo[]; cableRio: CableInfo | null;
      }
      const conexPorSenal = new Map<string, ConexRuteo>();
      for (const row of conexResult.recordset) {
        const senalId = String(row.senal_id);
        let entry = conexPorSenal.get(senalId);
        if (!entry) {
          entry = {
            cableCampo: buildCable(row.cable_campo_tag, row.cable_campo_tipo, row.cable_campo_capacidad, row.cable_campo_en_uso),
            cajaTag: row.tag_caja ?? null,
            equipoPanelTag: row.equipo_panel_tag ?? null,
            bloqueCodigo: row.bloque_codigo ?? null,
            bornes: [],
            cableRio: null
          };
          conexPorSenal.set(senalId, entry);
        }
        if (row.terminal_id !== null) {
          entry.bornes.push({
            numero: row.terminal_numero,
            campoOcupado: row.posicion_campo_codigo !== null,
            rioOcupado: row.posicion_rio_codigo !== null
          });
        }
        if (!entry.cableRio && row.cable_rio_tag) {
          entry.cableRio = buildCable(row.cable_rio_tag, row.cable_rio_tipo, row.cable_rio_capacidad, row.cable_rio_en_uso);
        }
      }

      // --- Ensamblado del árbol ---
      type ModuloNode = {
        id: string; tag: string | null; fabricante: string | null; modelo: string | null;
        surgeProtectorTag: string | null; bloqueTerminalCodigo: string | null; tipoIoCodigo: string | null;
        canales: any[];
      };
      type GabineteNode = {
        id: string; tagGabinete: string; tipoGabineteCodigo: string;
        racks: Map<string, { id: string; numeroRack: number; slots: Map<string, { id: string; numeroSlot: number; modulo: ModuloNode | null }> }>;
      };
      const gabinetes = new Map<string, GabineteNode>();

      for (const row of hwResult.recordset) {
        const gId = String(row.gabinete_id);
        if (!gabinetes.has(gId)) {
          gabinetes.set(gId, { id: gId, tagGabinete: row.tag_gabinete, tipoGabineteCodigo: row.tipo_gabinete_codigo, racks: new Map() });
        }
        const gab = gabinetes.get(gId)!;
        if (row.rack_id === null) continue;
        const rId = String(row.rack_id);
        if (!gab.racks.has(rId)) gab.racks.set(rId, { id: rId, numeroRack: row.numero_rack, slots: new Map() });
        const rack = gab.racks.get(rId)!;
        if (row.slot_id === null) continue;
        const slId = String(row.slot_id);
        if (!rack.slots.has(slId)) {
          rack.slots.set(slId, {
            id: slId,
            numeroSlot: row.numero_slot,
            modulo: row.modulo_id
              ? {
                  id: String(row.modulo_id), tag: row.modulo_tag, fabricante: row.fabricante, modelo: row.modelo,
                  surgeProtectorTag: row.surge_protector_tag, bloqueTerminalCodigo: row.modulo_bloque_codigo,
                  tipoIoCodigo: row.tipo_io_codigo, canales: []
                }
              : null
          });
        }
        const slot = rack.slots.get(slId)!;
        if (row.canal_id !== null && slot.modulo) {
          const duenoTag = row.dueno_tag ?? row.dueno_equipo_tag ?? null;
          const duenoTipo = row.dueno_tag ? 'instrumento' : row.dueno_equipo_tag ? 'equipo' : null;
          const hilos = hilosPorModuloCanal.get(`${row.modulo_id}:${row.numero_canal}`) ?? [];
          const conex = row.senal_id ? conexPorSenal.get(String(row.senal_id)) ?? null : null;

          // Cuando el equipo aparece como ORIGEN del tramo sin que exista
          // ningún bloque_terminal real más adelante (bloqueCodigo null —
          // caso "sin panel intermedio", ej. 620-TSA-5001, ruta de solo 2
          // tramos), lo que se resolvió como "cable de tramo 1" es en
          // realidad el único cable de todo el recorrido (RIO -> equipo)
          // — se muestra como "cable RIO", no como "cable campo", que es
          // como lo pidió el usuario. Cuando SÍ hay un bloque_terminal
          // real (migración 026, panel propio del equipo con su propio
          // TB) se trata exactamente igual que una caja — cable campo,
          // bornes y cable RIO se resuelven todos normalmente más abajo,
          // sin relabeling.
          const esDestinoEquipoSinPanel = Boolean(conex && !conex.bloqueCodigo && conex.equipoPanelTag);
          const cableRio = esDestinoEquipoSinPanel ? (conex?.cableCampo ?? null) : (conex?.cableRio ?? null);
          const cableCampo = esDestinoEquipoSinPanel ? null : (conex?.cableCampo ?? null);

          slot.modulo.canales.push({
            id: String(row.canal_id),
            numeroCanal: row.numero_canal,
            hilos,
            bornera: calcularBornera(row.tipo_io_codigo, row.numero_canal),
            estado: row.senal_id ? 'OCUPADO' : 'RESERVA',
            senal: row.senal_id
              ? {
                  id: String(row.senal_id), codigoSenal: row.codigo_senal, tagSenal: row.tag_senal, nombreCorto: row.nombre_corto,
                  destino: row.senal_destino ?? null,
                  duenoTag, duenoTipo, duenoNodo: row.dueno_nodo ?? null,
                  // Preferí siempre el servicio de la SEÑAL (más granular,
                  // migración 028 — el único que existe del lado equipo);
                  // cae al servicio general del instrumento dueño solo si
                  // la señal no tiene el suyo propio.
                  duenoServicio: row.senal_servicio ?? row.dueno_servicio ?? null,
                  duenoAusente: Boolean(row.dueno_ausente), sinMatchPnid: Boolean(row.sin_match_pnid),
                  estadoConexionado: Number(row.n_rutas) === 0 ? 'RUTA_PENDIENTE' : 'RUTA_CARGADA',
                  cableRio,
                  cajaTag: conex?.cajaTag ?? null,
                  equipoPanelTag: conex?.equipoPanelTag ?? null,
                  bloqueCajaCodigo: conex?.bloqueCodigo ?? null,
                  // Gate por cajaTag, NO por bloqueCodigo: bloqueCodigo
                  // (bt.codigo) solo se resuelve vía una terminación REAL
                  // ya cargada (ver JOIN de arriba) — una señal con 0
                  // bornes reales todavía nunca tiene bloqueCodigo, así
                  // que ese gate dejaba SIN "pendiente" justo a las
                  // señales que más lo necesitaban (bug real reportado
                  // por el usuario: "pareciera que solo listas las que
                  // están conectadas"). cajaTag sí se resuelve directo
                  // desde punto_conexion (fallback cjDirecto), sin
                  // depender de ninguna terminación.
                  bornes: padBornesCaja(
                    conex?.bornes ?? [],
                    bornesCajaNecesarios(row.tipo_io_codigo, row.dueno_tipo_instrumento, row.es_loop_powered),
                    Boolean(conex?.cajaTag)
                  ),
                  cableCampo
                }
              : null
          });
        }
      }

      const tree = [...gabinetes.values()].map((g) => ({
        id: g.id,
        tagGabinete: g.tagGabinete,
        tipoGabineteCodigo: g.tipoGabineteCodigo,
        racks: [...g.racks.values()]
          .sort((a, b) => a.numeroRack - b.numeroRack)
          .map((r) => ({
            id: r.id,
            numeroRack: r.numeroRack,
            slots: [...r.slots.values()]
              .sort((a, b) => a.numeroSlot - b.numeroSlot)
              .map((sl) => ({
                ...sl,
                modulo: sl.modulo ? { ...sl.modulo, canales: sl.modulo.canales.sort((a: any, b: any) => a.numeroCanal - b.numeroCanal) } : null
              }))
          }))
      }));

      res.status(200).json({ projectId, gabinetes: tree });

    } catch (error) {
      next(error);
    }
  }
);
