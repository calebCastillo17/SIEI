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
 * nucleo.rio — raíz de la jerarquía física de E/S (RIO -> RACK -> SLOT ->
 * MODULO -> CANAL). Sin CHECK ni triggers propios, solo el índice único
 * filtrado de TAG por proyecto activo. Mismo patrón que equipment.ts.
 */
export const riosRouter = Router({ mergeParams: true });

riosRouter.use(authenticate);


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


/*
 * GET /api/projects/:projectId/rios
 */
riosRouter.get(
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
          SELECT
            id, proyecto_id, tag_rio, descripcion, activo,
            created_at, updated_at, created_by, updated_by
          FROM nucleo.rio
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY tag_rio;
        `);

      res.status(200).json({
        projectId,
        rios: result.recordset.map((row) => ({
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagRio: row.tag_rio,
          descripcion: row.descripcion,
          active: Boolean(row.activo),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          createdBy: row.created_by === null ? null : String(row.created_by),
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }))
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/rios/:rioId
 */
riosRouter.get(
  '/:rioId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const rioId = normalizeParam(req.params.rioId);

      if (!rioId || !/^\d+$/.test(rioId)) {
        res.status(400).json({ error: 'invalid_rio_id', message: 'rioId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rio_id', sql.NVarChar(30), rioId)
        .query(`
          SELECT
            id, proyecto_id, tag_rio, descripcion, activo,
            created_at, updated_at, created_by, updated_by
          FROM nucleo.rio
          WHERE id = TRY_CONVERT(BIGINT, @rio_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'rio_not_found', message: 'RIO does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({
        rio: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagRio: row.tag_rio,
          descripcion: row.descripcion,
          active: Boolean(row.activo),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          createdBy: row.created_by === null ? null : String(row.created_by),
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/rios
 */
riosRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const { tagRio, descripcion = null } = req.body ?? {};

      if (typeof tagRio !== 'string' || tagRio.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'tagRio is required.' });
        return;
      }

      const tag = tagRio.trim();

      if (tag.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'tagRio cannot exceed 50 characters.' });
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
        .input('tag_rio', sql.NVarChar(50), tag)
        .input('descripcion', sql.NVarChar(300), descripcion)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.rio
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_rio = @tag_rio AND activo = 1
          )
          BEGIN
            THROW 54301, 'Ya existe un RIO activo con ese TAG en el proyecto.', 1;
          END;

          INSERT INTO nucleo.rio (proyecto_id, tag_rio, descripcion, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_rio, INSERTED.descripcion,
                 INSERTED.activo, INSERTED.created_at, INSERTED.created_by
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), @tag_rio, @descripcion, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/rios/${String(row.id)}`)
        .json({
          rio: {
            id: String(row.id),
            projectId: String(row.proyecto_id),
            tagRio: row.tag_rio,
            descripcion: row.descripcion,
            active: Boolean(row.activo),
            createdAt: row.created_at,
            createdBy: row.created_by === null ? null : String(row.created_by)
          }
        });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54301 || number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'rio_tag_conflict',
          message: 'An active RIO with this TAG already exists in the project.'
        });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/rios/:rioId
 */
riosRouter.patch(
  '/:rioId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const rioId = normalizeParam(req.params.rioId);

      if (!rioId || !/^\d+$/.test(rioId)) {
        res.status(400).json({ error: 'invalid_rio_id', message: 'rioId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        tagRio: { column: 'tag_rio', sqlType: sql.NVarChar(50), max: 50 },
        descripcion: { column: 'descripcion', sqlType: sql.NVarChar(300), max: 300 }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if ('tagRio' in body) {
        if (typeof body.tagRio !== 'string' || body.tagRio.trim().length === 0) {
          res.status(400).json({ error: 'validation_error', message: 'tagRio cannot be empty.' });
          return;
        }
        body.tagRio = body.tagRio.trim();
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
        .input('rio_id', sql.NVarChar(30), rioId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, config.sqlType, body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      if ('tagRio' in body) {
        request.input('nuevo_tag', sql.NVarChar(50), body.tagRio);
      }

      const tagCheck = 'tagRio' in body
        ? `
          IF EXISTS (
            SELECT 1 FROM nucleo.rio
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_rio = @nuevo_tag AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @rio_id)
          )
          BEGIN
            THROW 54301, 'Ya existe un RIO activo con ese TAG en el proyecto.', 1;
          END;
        `
        : '';

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.rio
          WHERE id = TRY_CONVERT(BIGINT, @rio_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54302, 'El RIO no existe en este proyecto o está inactivo.', 1;
        END;

        ${tagCheck}

        UPDATE nucleo.rio
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT
          INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_rio, INSERTED.descripcion,
          INSERTED.activo, INSERTED.created_at, INSERTED.updated_at,
          INSERTED.created_by, INSERTED.updated_by
        WHERE id = TRY_CONVERT(BIGINT, @rio_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      const row = result.recordset[0];

      res.status(200).json({
        rio: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagRio: row.tag_rio,
          descripcion: row.descripcion,
          active: Boolean(row.activo),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          createdBy: row.created_by === null ? null : String(row.created_by),
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54301 || number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'rio_tag_conflict',
          message: 'An active RIO with this TAG already exists in the project.'
        });
        return;
      }

      if (number === 54302) {
        res.status(404).json({ error: 'rio_not_found', message: 'RIO does not exist in this project or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/rios/:rioId
 *
 * Desactivación lógica. nucleo.rio no tiene triggers propios que bloqueen
 * la desactivación por uso (a diferencia de modulo/canal) — la base no
 * exige liberar racks/slots/módulos primero. El backend no lo reinventa.
 */
riosRouter.delete(
  '/:rioId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const rioId = normalizeParam(req.params.rioId);

      if (!rioId || !/^\d+$/.test(rioId)) {
        res.status(400).json({ error: 'invalid_rio_id', message: 'rioId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rio_id', sql.NVarChar(30), rioId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.rio
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_rio, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @rio_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'rio_not_found', message: 'RIO does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        rio: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagRio: row.tag_rio,
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
