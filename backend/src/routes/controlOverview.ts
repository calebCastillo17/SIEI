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

const CONTROL_SIGNAL_SELECT = `
  s.id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.descripcion,
  s.canal_id, s.dueno_ausente,

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
    duenoAusente: Boolean(row.dueno_ausente)
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
            s.id AS senal_id, s.codigo_senal, s.tag_senal, s.nombre_corto, s.dueno_ausente,

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
                  duenoAusente: Boolean(row.dueno_ausente),
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
