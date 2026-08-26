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
 * nucleo.lazo — documento de lazo de un INSTRUMENTO. Un instrumento admite
 * como máximo un lazo activo (UX_lazo_instrumento_id). Sin CHECK ni
 * triggers propios, así que OUTPUT INSERTED.* directo es válido en todos
 * los verbos (a diferencia de senal/modulo/cable/punto_conexion/
 * ruta_conexion). Mismo patrón de CRUD que equipment.ts.
 */
export const loopsRouter = Router({ mergeParams: true });

loopsRouter.use(authenticate);


function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPositiveIntString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
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

function mapLoopSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  if (number === 55401 || message.includes('UX_lazo_instrumento_id')) {
    return { status: 409, body: { error: 'loop_instrument_conflict', message: 'Ese instrumento ya tiene un lazo activo.' } };
  }
  if (number === 55402) {
    return { status: 404, body: { error: 'loop_not_found', message: 'El lazo no existe en este proyecto o está inactivo.' } };
  }
  if (number === 547 && message.includes('FK_lazo_instrumento')) {
    return { status: 400, body: { error: 'invalid_reference', message: 'instrumentoId no existe, está inactivo, o no pertenece a este proyecto.' } };
  }

  return null;
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    instrumentoId: String(row.instrumento_id),
    codigoDocumento: row.codigo_documento,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'proyecto_id', 'instrumento_id', 'codigo_documento', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/projects/:projectId/loops?instrumentoId=
 */
loopsRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const instrumentoIdFilter = normalizeParam(req.query.instrumentoId as string | string[] | undefined);

      if (instrumentoIdFilter !== undefined && !isPositiveIntString(instrumentoIdFilter)) {
        res.status(400).json({ error: 'invalid_instrumento_id', message: 'instrumentoId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (instrumentoIdFilter) request.input('instrumento_id', sql.NVarChar(30), instrumentoIdFilter);

      const result = await request.query(`
        SELECT ${COLUMNS}
        FROM nucleo.lazo
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${instrumentoIdFilter ? 'AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)' : ''}
        ORDER BY id;
      `);

      res.status(200).json({ projectId, loops: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/loops/:loopId
 */
loopsRouter.get(
  '/:loopId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const loopId = normalizeParam(req.params.loopId);

      if (!isPositiveIntString(loopId)) {
        res.status(400).json({ error: 'invalid_loop_id', message: 'loopId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('lazo_id', sql.NVarChar(30), loopId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.lazo
          WHERE id = TRY_CONVERT(BIGINT, @lazo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'loop_not_found', message: 'Loop does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ loop: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/loops
 */
loopsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { instrumentoId, codigoDocumento = null } = req.body ?? {};

      if (!isPositiveIntString(instrumentoId)) {
        res.status(400).json({ error: 'validation_error', message: 'instrumentoId is required and must be a numeric id.' });
        return;
      }

      if (codigoDocumento !== null && codigoDocumento !== undefined && typeof codigoDocumento !== 'string') {
        res.status(400).json({ error: 'validation_error', message: 'codigoDocumento must be a string or null.' });
        return;
      }
      if (typeof codigoDocumento === 'string' && codigoDocumento.length > 100) {
        res.status(400).json({ error: 'validation_error', message: 'codigoDocumento cannot exceed 100 characters.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('instrumento_id', sql.NVarChar(30), instrumentoId)
        .input('codigo_documento', sql.NVarChar(100), codigoDocumento)
        .query(`
          INSERT INTO nucleo.lazo (proyecto_id, instrumento_id, codigo_documento, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.instrumento_id, INSERTED.codigo_documento,
                 INSERTED.activo, INSERTED.created_at, INSERTED.created_by
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @instrumento_id), @codigo_documento, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/loops/${String(row.id)}`)
        .json({ loop: serialize(row) });

    } catch (error) {
      const mapped = mapLoopSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/loops/:loopId
 *
 * Solo codigoDocumento es editable. instrumentoId no: mover un lazo a otro
 * instrumento no es una operación que el modelo documente, y reasignarlo
 * sin más contexto sería inventar una regla no confirmada.
 */
loopsRouter.patch(
  '/:loopId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const loopId = normalizeParam(req.params.loopId);

      if (!isPositiveIntString(loopId)) {
        res.status(400).json({ error: 'invalid_loop_id', message: 'loopId must be a positive integer.' });
        return;
      }

      const body = req.body ?? {};

      if (!('codigoDocumento' in body)) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      const { codigoDocumento } = body;

      if (codigoDocumento !== null && typeof codigoDocumento !== 'string') {
        res.status(400).json({ error: 'validation_error', message: 'codigoDocumento must be a string or null.' });
        return;
      }
      if (typeof codigoDocumento === 'string' && codigoDocumento.length > 100) {
        res.status(400).json({ error: 'validation_error', message: 'codigoDocumento cannot exceed 100 characters.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('lazo_id', sql.NVarChar(30), loopId)
        .input('codigo_documento', sql.NVarChar(100), codigoDocumento)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          IF NOT EXISTS (
            SELECT 1 FROM nucleo.lazo
            WHERE id = TRY_CONVERT(BIGINT, @lazo_id)
              AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND activo = 1
          )
          BEGIN
            THROW 55402, 'El lazo no existe en este proyecto o está inactivo.', 1;
          END;

          UPDATE nucleo.lazo
          SET codigo_documento = @codigo_documento,
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.instrumento_id, INSERTED.codigo_documento,
                 INSERTED.activo, INSERTED.created_at, INSERTED.updated_at,
                 INSERTED.created_by, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @lazo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      res.status(200).json({ loop: serialize(result.recordset[0]) });

    } catch (error) {
      const mapped = mapLoopSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/loops/:loopId
 *
 * nucleo.lazo no tiene triggers que bloqueen la desactivación por uso —
 * no hay ninguna otra tabla que dependa de un lazo activo.
 */
loopsRouter.delete(
  '/:loopId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const loopId = normalizeParam(req.params.loopId);

      if (!isPositiveIntString(loopId)) {
        res.status(400).json({ error: 'invalid_loop_id', message: 'loopId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('lazo_id', sql.NVarChar(30), loopId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.lazo
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.instrumento_id, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @lazo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'loop_not_found', message: 'Loop does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        loop: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          instrumentoId: String(row.instrumento_id),
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
