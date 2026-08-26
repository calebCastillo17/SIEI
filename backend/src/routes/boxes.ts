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
 * nucleo.caja — nodo intermedio de una ruta de conexionado
 * (INSTRUMENTO/EQUIPO -> 0..N CAJAS -> RIO/MODULO). Sin CHECK ni triggers
 * propios, solo el índice único filtrado de TAG por proyecto activo. Mismo
 * patrón que rios.ts/equipment.ts.
 */
export const boxesRouter = Router({ mergeParams: true });

boxesRouter.use(authenticate);


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

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tagCaja: row.tag_caja,
    descripcion: row.descripcion,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'proyecto_id', 'tag_caja', 'descripcion', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/projects/:projectId/boxes
 */
boxesRouter.get(
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
          SELECT ${COLUMNS}
          FROM nucleo.caja
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY tag_caja;
        `);

      res.status(200).json({ projectId, boxes: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/boxes/:boxId
 */
boxesRouter.get(
  '/:boxId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const boxId = normalizeParam(req.params.boxId);

      if (!boxId || !/^\d+$/.test(boxId)) {
        res.status(400).json({ error: 'invalid_box_id', message: 'boxId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('caja_id', sql.NVarChar(30), boxId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.caja
          WHERE id = TRY_CONVERT(BIGINT, @caja_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'box_not_found', message: 'Box does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ box: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/boxes
 */
boxesRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const { tagCaja, descripcion = null } = req.body ?? {};

      if (typeof tagCaja !== 'string' || tagCaja.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'tagCaja is required.' });
        return;
      }

      const tag = tagCaja.trim();

      if (tag.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'tagCaja cannot exceed 50 characters.' });
        return;
      }

      if (descripcion !== null && descripcion !== undefined && typeof descripcion !== 'string') {
        res.status(400).json({ error: 'validation_error', message: 'descripcion must be a string or null.' });
        return;
      }
      if (typeof descripcion === 'string' && descripcion.length > 300) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion cannot exceed 300 characters.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('tag_caja', sql.NVarChar(50), tag)
        .input('descripcion', sql.NVarChar(300), descripcion)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.caja
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_caja = @tag_caja AND activo = 1
          )
          BEGIN
            THROW 55001, 'Ya existe una caja activa con ese TAG en el proyecto.', 1;
          END;

          INSERT INTO nucleo.caja (proyecto_id, tag_caja, descripcion, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_caja, INSERTED.descripcion,
                 INSERTED.activo, INSERTED.created_at, INSERTED.created_by
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), @tag_caja, @descripcion, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/boxes/${String(row.id)}`)
        .json({ box: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 55001 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'box_tag_conflict', message: 'An active box with this TAG already exists in the project.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/boxes/:boxId
 */
boxesRouter.patch(
  '/:boxId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const boxId = normalizeParam(req.params.boxId);

      if (!boxId || !/^\d+$/.test(boxId)) {
        res.status(400).json({ error: 'invalid_box_id', message: 'boxId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        tagCaja: { column: 'tag_caja', sqlType: sql.NVarChar(50), max: 50 },
        descripcion: { column: 'descripcion', sqlType: sql.NVarChar(300), max: 300 }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if ('tagCaja' in body) {
        if (typeof body.tagCaja !== 'string' || body.tagCaja.trim().length === 0) {
          res.status(400).json({ error: 'validation_error', message: 'tagCaja cannot be empty.' });
          return;
        }
        body.tagCaja = body.tagCaja.trim();
      }

      for (const key of keys) {
        const value = body[key];
        const config = allowedFields[key];

        if (value !== null && typeof value !== 'string') {
          res.status(400).json({ error: 'validation_error', message: `${key} must be a string or null.` });
          return;
        }
        if (typeof value === 'string' && value.length > config.max) {
          res.status(400).json({ error: 'validation_error', message: `${key} cannot exceed ${config.max} characters.` });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('caja_id', sql.NVarChar(30), boxId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, config.sqlType, body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      if ('tagCaja' in body) {
        request.input('nuevo_tag', sql.NVarChar(50), body.tagCaja);
      }

      const tagCheck = 'tagCaja' in body
        ? `
          IF EXISTS (
            SELECT 1 FROM nucleo.caja
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_caja = @nuevo_tag AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @caja_id)
          )
          BEGIN
            THROW 55001, 'Ya existe una caja activa con ese TAG en el proyecto.', 1;
          END;
        `
        : '';

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.caja
          WHERE id = TRY_CONVERT(BIGINT, @caja_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 55002, 'La caja no existe en este proyecto o está inactiva.', 1;
        END;

        ${tagCheck}

        UPDATE nucleo.caja
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT
          INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_caja, INSERTED.descripcion,
          INSERTED.activo, INSERTED.created_at, INSERTED.updated_at,
          INSERTED.created_by, INSERTED.updated_by
        WHERE id = TRY_CONVERT(BIGINT, @caja_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      res.status(200).json({ box: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 55001 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'box_tag_conflict', message: 'An active box with this TAG already exists in the project.' });
        return;
      }
      if (number === 55002) {
        res.status(404).json({ error: 'box_not_found', message: 'Box does not exist in this project or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/boxes/:boxId
 *
 * nucleo.caja no tiene triggers que bloqueen la desactivación por uso —
 * a diferencia de punto_conexion (que sí referencia caja_id), la propia
 * caja no valida si algún punto_conexion suyo está en uso. Si hace falta
 * ese bloqueo, es una regla a confirmar, no a inventar aquí.
 */
boxesRouter.delete(
  '/:boxId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const boxId = normalizeParam(req.params.boxId);

      if (!boxId || !/^\d+$/.test(boxId)) {
        res.status(400).json({ error: 'invalid_box_id', message: 'boxId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('caja_id', sql.NVarChar(30), boxId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.caja
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_caja, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @caja_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'box_not_found', message: 'Box does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        box: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagCaja: row.tag_caja,
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);
