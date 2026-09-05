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
import { hacerEspacioParaTagManual } from '../lib/cableTagging.js';

/*
 * nucleo.cable — sin triggers propios en INSERT, pero SÍ un trigger de
 * desactivación (TR_cable_validar_desactivacion, 51021): no se puede
 * desactivar un cable si alguno de sus PAR_CONDUCTOR está en uso por un
 * TRAMO_CONEXION activo.
 */
export const cablesRouter = Router({ mergeParams: true });

cablesRouter.use(authenticate);


function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sqlErrorNumber(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'number' in error &&
    typeof (error as { number?: unknown }).number === 'number'
  ) {
    return (error as { number: number }).number;
  }
  return undefined;
}

function sqlErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tagCable: row.tag_cable,
    tipoCable: row.tipo_cable,
    capacidadConductores: row.capacidad_conductores,
    // Migración 029 — clasificación estructurada de tipo_cable (texto
    // libre históricamente, ej. "1-12p#18 AWG+SH"). tipoConstruccionId
    // es NULL en un cable todavía sin clasificar — nunca se fuerza.
    tipoConstruccionId: row.tipo_construccion_id === null ? null : String(row.tipo_construccion_id),
    cantidadUnidades: row.cantidad_unidades,
    calibre: row.calibre,
    apantallado: row.apantallado === null ? null : Boolean(row.apantallado),
    // Solo en GET (list / :id) — el subquery de conductores_en_uso no
    // corre en POST/PATCH (INSERTED.* no tiene de dónde sacarlo, y un
    // cable recién creado/editado no cambia su ocupación real). undefined
    // en vez de forzar 0, para no mentir "0 en uso" en esas respuestas.
    conductoresEnUso: row.conductores_en_uso === undefined ? undefined : Number(row.conductores_en_uso),
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'proyecto_id', 'tag_cable', 'tipo_cable', 'capacidad_conductores',
  'tipo_construccion_id', 'cantidad_unidades', 'calibre', 'apantallado', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/projects/:projectId/cables
 */
cablesRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${COLUMNS},
            (
              SELECT COUNT(*)
              FROM nucleo.conductor cr
              JOIN nucleo.tramo_conductor tcr ON tcr.conductor_id = cr.id AND tcr.activo = 1
              WHERE cr.cable_id = c.id AND cr.activo = 1
            ) AS conductores_en_uso
          FROM nucleo.cable c
          WHERE c.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND c.activo = 1
          ORDER BY c.tag_cable;
        `);

      res.status(200).json({ projectId, cables: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/cables/:cableId
 */
cablesRouter.get(
  '/:cableId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const cableId = normalizeParam(req.params.cableId);

      if (!cableId || !/^\d+$/.test(cableId)) {
        res.status(400).json({ error: 'invalid_cable_id', message: 'cableId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('cable_id', sql.NVarChar(30), cableId)
        .query(`
          SELECT ${COLUMNS},
            (
              SELECT COUNT(*)
              FROM nucleo.conductor cr
              JOIN nucleo.tramo_conductor tcr ON tcr.conductor_id = cr.id AND tcr.activo = 1
              WHERE cr.cable_id = c.id AND cr.activo = 1
            ) AS conductores_en_uso
          FROM nucleo.cable c
          WHERE c.id = TRY_CONVERT(BIGINT, @cable_id)
            AND c.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND c.activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'cable_not_found', message: 'Cable does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ cable: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/cables
 */
cablesRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const {
        tagCable, tipoCable = null, capacidadConductores,
        tipoConstruccionId = null, cantidadUnidades = null, calibre = null, apantallado = null
      } = req.body ?? {};

      if (typeof tagCable !== 'string' || tagCable.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'tagCable is required.' });
        return;
      }
      const tag = tagCable.trim();
      if (tag.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'tagCable cannot exceed 50 characters.' });
        return;
      }

      if (tipoCable !== null && tipoCable !== undefined && typeof tipoCable !== 'string') {
        res.status(400).json({ error: 'validation_error', message: 'tipoCable must be a string or null.' });
        return;
      }
      if (typeof tipoCable === 'string' && tipoCable.length > 100) {
        res.status(400).json({ error: 'validation_error', message: 'tipoCable cannot exceed 100 characters.' });
        return;
      }

      if (
        typeof capacidadConductores !== 'number' ||
        !Number.isInteger(capacidadConductores) ||
        capacidadConductores <= 0 ||
        capacidadConductores > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'capacidadConductores must be a positive integer.' });
        return;
      }

      if (tipoConstruccionId !== null && !/^\d+$/.test(String(tipoConstruccionId))) {
        res.status(400).json({ error: 'validation_error', message: 'tipoConstruccionId must be a numeric id or null.' });
        return;
      }
      if (cantidadUnidades !== null && (typeof cantidadUnidades !== 'number' || !Number.isInteger(cantidadUnidades) || cantidadUnidades <= 0)) {
        res.status(400).json({ error: 'validation_error', message: 'cantidadUnidades must be a positive integer or null.' });
        return;
      }
      if (calibre !== null && (typeof calibre !== 'string' || calibre.length > 20)) {
        res.status(400).json({ error: 'validation_error', message: 'calibre must be a string (max 20 chars) or null.' });
        return;
      }
      if (apantallado !== null && typeof apantallado !== 'boolean') {
        res.status(400).json({ error: 'validation_error', message: 'apantallado must be a boolean or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('tag_cable', sql.NVarChar(50), tag)
        .input('tipo_cable', sql.NVarChar(100), tipoCable)
        .input('capacidad_conductores', sql.SmallInt, capacidadConductores)
        .input('tipo_construccion_id', sql.NVarChar(30), tipoConstruccionId)
        .input('cantidad_unidades', sql.SmallInt, cantidadUnidades)
        .input('calibre', sql.NVarChar(20), calibre)
        .input('apantallado', sql.Bit, apantallado)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.cable
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_cable = @tag_cable AND activo = 1
          )
          BEGIN
            THROW 55101, 'Ya existe un cable activo con ese TAG en el proyecto.', 1;
          END;

          INSERT INTO nucleo.cable (
            proyecto_id, tag_cable, tipo_cable, capacidad_conductores,
            tipo_construccion_id, cantidad_unidades, calibre, apantallado,
            activo, created_at, created_by
          )
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_cable, INSERTED.tipo_cable,
                 INSERTED.capacidad_conductores, INSERTED.tipo_construccion_id, INSERTED.cantidad_unidades,
                 INSERTED.calibre, INSERTED.apantallado,
                 INSERTED.activo, INSERTED.created_at, INSERTED.created_by,
                 INSERTED.updated_at, INSERTED.updated_by
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), @tag_cable, @tipo_cable, @capacidad_conductores,
            TRY_CONVERT(BIGINT, @tipo_construccion_id), @cantidad_unidades, @calibre, @apantallado,
            1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/cables/${String(row.id)}`)
        .json({ cable: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 55101 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'cable_tag_conflict', message: 'An active cable with this TAG already exists in the project.' });
        return;
      }
      if (number === 547 && sqlErrorMessage(error).includes('FK_cable_tipo_construccion')) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoConstruccionId does not exist in cat.cat_tipo_construccion_cable.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/cables/:cableId
 *
 * capacidadConductores es editable, pero OJO: reducirla NO desactiva ni
 * valida nada sobre los par_conductor existentes (a diferencia de
 * canal/modulo, aquí no hay trigger que lo haga). El backend no inventa esa
 * cascada — solo aplica la validación de sanity (numero_par en rango) al
 * CREAR un par_conductor nuevo (ver conductorPairs.ts), no retroactivamente.
 */
cablesRouter.patch(
  '/:cableId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const cableId = normalizeParam(req.params.cableId);

      if (!cableId || !/^\d+$/.test(cableId)) {
        res.status(400).json({ error: 'invalid_cable_id', message: 'cableId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        tagCable: { column: 'tag_cable', sqlType: sql.NVarChar(50) },
        tipoCable: { column: 'tipo_cable', sqlType: sql.NVarChar(100) },
        capacidadConductores: { column: 'capacidad_conductores', sqlType: sql.SmallInt },
        // Migración 029 — clasificación estructurada del cable.
        tipoConstruccionId: { column: 'tipo_construccion_id', sqlType: sql.NVarChar(30) },
        cantidadUnidades: { column: 'cantidad_unidades', sqlType: sql.SmallInt },
        calibre: { column: 'calibre', sqlType: sql.NVarChar(20) },
        apantallado: { column: 'apantallado', sqlType: sql.Bit }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if ('tagCable' in body) {
        if (typeof body.tagCable !== 'string' || body.tagCable.trim().length === 0) {
          res.status(400).json({ error: 'validation_error', message: 'tagCable cannot be empty.' });
          return;
        }
        body.tagCable = body.tagCable.trim();
        if (body.tagCable.length > 50) {
          res.status(400).json({ error: 'validation_error', message: 'tagCable cannot exceed 50 characters.' });
          return;
        }
      }

      if ('tipoCable' in body && body.tipoCable !== null) {
        if (typeof body.tipoCable !== 'string') {
          res.status(400).json({ error: 'validation_error', message: 'tipoCable must be a string or null.' });
          return;
        }
        if (body.tipoCable.length > 100) {
          res.status(400).json({ error: 'validation_error', message: 'tipoCable cannot exceed 100 characters.' });
          return;
        }
      }

      if ('capacidadConductores' in body) {
        const value = body.capacidadConductores;
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 32767) {
          res.status(400).json({ error: 'validation_error', message: 'capacidadConductores must be a positive integer.' });
          return;
        }
      }

      const pool = await getDbPool();

      // Tageado automático de cables (ver cableTagging.ts), tercera
      // forma pedida explícitamente por el usuario: si edita el tag a
      // mano y elige un número que ya usa un hermano (mismo destino+
      // letra), ese hermano (y los que sigan) se corren para hacerle
      // lugar — ANTES de que el chequeo de duplicado de acá abajo pueda
      // rechazarlo. Best-effort, nunca interrumpe el PATCH principal.
      if ('tagCable' in body) {
        await hacerEspacioParaTagManual(pool, projectId, cableId, body.tagCable, userId);
      }

      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('cable_id', sql.NVarChar(30), cableId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, config.sqlType, body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      if ('tagCable' in body) {
        request.input('nuevo_tag', sql.NVarChar(50), body.tagCable);
      }

      const tagCheck = 'tagCable' in body
        ? `
          IF EXISTS (
            SELECT 1 FROM nucleo.cable
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_cable = @nuevo_tag AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @cable_id)
          )
          BEGIN
            THROW 55101, 'Ya existe un cable activo con ese TAG en el proyecto.', 1;
          END;
        `
        : '';

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.cable
          WHERE id = TRY_CONVERT(BIGINT, @cable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 55102, 'El cable no existe en este proyecto o está inactivo.', 1;
        END;

        ${tagCheck}

        DECLARE @actualizados TABLE (
          id BIGINT, proyecto_id BIGINT, tag_cable NVARCHAR(50), tipo_cable NVARCHAR(100),
          capacidad_conductores SMALLINT,
          tipo_construccion_id BIGINT, cantidad_unidades SMALLINT, calibre NVARCHAR(20), apantallado BIT,
          activo BIT, created_at DATETIME2, updated_at DATETIME2,
          created_by BIGINT, updated_by BIGINT
        );

        UPDATE nucleo.cable
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT
          INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_cable, INSERTED.tipo_cable,
          INSERTED.capacidad_conductores,
          INSERTED.tipo_construccion_id, INSERTED.cantidad_unidades, INSERTED.calibre, INSERTED.apantallado,
          INSERTED.activo, INSERTED.created_at,
          INSERTED.updated_at, INSERTED.created_by, INSERTED.updated_by
        INTO @actualizados
        WHERE id = TRY_CONVERT(BIGINT, @cable_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;

        SELECT * FROM @actualizados;
      `);

      res.status(200).json({ cable: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 55101 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'cable_tag_conflict', message: 'An active cable with this TAG already exists in the project.' });
        return;
      }
      if (number === 55102) {
        res.status(404).json({ error: 'cable_not_found', message: 'Cable does not exist in this project or is inactive.' });
        return;
      }
      if (number === 547 && sqlErrorMessage(error).includes('FK_cable_tipo_construccion')) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoConstruccionId does not exist in cat.cat_tipo_construccion_cable.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/cables/:cableId
 *
 * Bloqueada por TR_cable_validar_desactivacion (51021) si algún
 * par_conductor de este cable está en uso por un tramo activo.
 */
cablesRouter.delete(
  '/:cableId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const cableId = normalizeParam(req.params.cableId);

      if (!cableId || !/^\d+$/.test(cableId)) {
        res.status(400).json({ error: 'invalid_cable_id', message: 'cableId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('cable_id', sql.NVarChar(30), cableId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivados TABLE (
            id BIGINT, proyecto_id BIGINT, tag_cable NVARCHAR(50), activo BIT,
            updated_at DATETIME2, updated_by BIGINT
          );

          UPDATE nucleo.cable
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_cable, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @cable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'cable_not_found', message: 'Cable does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        cable: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagCable: row.tag_cable,
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 51021) {
        res.status(409).json({
          error: 'cable_conductor_pair_in_use',
          message: 'No se puede desactivar un cable con un par conductor en uso por un tramo activo.'
        });
        return;
      }

      next(error);
    }
  }
);
