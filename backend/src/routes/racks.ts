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
 * nucleo.rack — depende de RIO. Sin TAG: se identifica por numero_rack,
 * único dentro de su RIO entre filas activas (UX_rack_rio_numero). Sin
 * CHECK ni triggers propios.
 */
export const racksRouter = Router({ mergeParams: true });

racksRouter.use(authenticate);


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

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    rioId: String(row.rio_id),
    numeroRack: row.numero_rack,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMN_NAMES = [
  'id', 'proyecto_id', 'rio_id', 'numero_rack', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
];
const COLUMNS = COLUMN_NAMES.join(', ');
const OUTPUT_INSERTED_COLUMNS = COLUMN_NAMES.map((c) => `INSERTED.${c}`).join(', ');


/*
 * GET /api/projects/:projectId/racks?rioId=
 */
racksRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const rioIdFilter = normalizeParam(req.query.rioId as string | string[] | undefined);

      if (rioIdFilter !== undefined && !isPositiveIntString(rioIdFilter)) {
        res.status(400).json({ error: 'invalid_rio_id', message: 'rioId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (rioIdFilter) request.input('rio_id', sql.NVarChar(30), rioIdFilter);

      const result = await request.query(`
        SELECT ${COLUMNS}
        FROM nucleo.rack
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${rioIdFilter ? 'AND rio_id = TRY_CONVERT(BIGINT, @rio_id)' : ''}
        ORDER BY rio_id, numero_rack;
      `);

      res.status(200).json({ projectId, racks: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/racks/:rackId
 */
racksRouter.get(
  '/:rackId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const rackId = normalizeParam(req.params.rackId);

      if (!isPositiveIntString(rackId)) {
        res.status(400).json({ error: 'invalid_rack_id', message: 'rackId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rack_id', sql.NVarChar(30), rackId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.rack
          WHERE id = TRY_CONVERT(BIGINT, @rack_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'rack_not_found', message: 'Rack does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ rack: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/racks
 */
racksRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { rioId, numeroRack } = req.body ?? {};

      if (!isPositiveIntString(rioId)) {
        res.status(400).json({ error: 'validation_error', message: 'rioId is required and must be a numeric id.' });
        return;
      }

      if (
        typeof numeroRack !== 'number' ||
        !Number.isInteger(numeroRack) ||
        numeroRack < 0 ||
        numeroRack > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroRack must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('rio_id', sql.NVarChar(30), rioId)
        .input('numero_rack', sql.SmallInt, numeroRack)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.rack
            WHERE rio_id = TRY_CONVERT(BIGINT, @rio_id)
              AND numero_rack = @numero_rack AND activo = 1
          )
          BEGIN
            THROW 54401, 'Ya existe un rack activo con ese número en ese RIO.', 1;
          END;

          INSERT INTO nucleo.rack (proyecto_id, rio_id, numero_rack, activo, created_at, created_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @rio_id), @numero_rack, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/racks/${String(row.id)}`)
        .json({ rack: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54401 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'rack_number_conflict', message: 'An active rack with this number already exists in that RIO.' });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'rioId does not exist, is inactive, or does not belong to this project.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/racks/:rackId
 *
 * Solo permite renumerar (numeroRack). Mover un rack a otro RIO no está
 * soportado aquí — reasignar rio_id implicaría revalidar toda la cadena
 * física por debajo (slot/modulo/canal); si hace falta, se agrega aparte.
 */
racksRouter.patch(
  '/:rackId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const rackId = normalizeParam(req.params.rackId);

      if (!isPositiveIntString(rackId)) {
        res.status(400).json({ error: 'invalid_rack_id', message: 'rackId must be a positive integer.' });
        return;
      }

      const { numeroRack } = req.body ?? {};

      if (
        typeof numeroRack !== 'number' ||
        !Number.isInteger(numeroRack) ||
        numeroRack < 0 ||
        numeroRack > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroRack must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rack_id', sql.NVarChar(30), rackId)
        .input('numero_rack', sql.SmallInt, numeroRack)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @rio_id BIGINT;
          SELECT @rio_id = rio_id FROM nucleo.rack
          WHERE id = TRY_CONVERT(BIGINT, @rack_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          IF @rio_id IS NULL
          BEGIN
            THROW 54402, 'El rack no existe en este proyecto o está inactivo.', 1;
          END;

          IF EXISTS (
            SELECT 1 FROM nucleo.rack
            WHERE rio_id = @rio_id AND numero_rack = @numero_rack AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @rack_id)
          )
          BEGIN
            THROW 54401, 'Ya existe un rack activo con ese número en ese RIO.', 1;
          END;

          UPDATE nucleo.rack
          SET numero_rack = @numero_rack,
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          WHERE id = TRY_CONVERT(BIGINT, @rack_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      res.status(200).json({ rack: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54401 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'rack_number_conflict', message: 'An active rack with this number already exists in that RIO.' });
        return;
      }
      if (number === 54402) {
        res.status(404).json({ error: 'rack_not_found', message: 'Rack does not exist in this project or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/racks/:rackId
 */
racksRouter.delete(
  '/:rackId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const rackId = normalizeParam(req.params.rackId);

      if (!isPositiveIntString(rackId)) {
        res.status(400).json({ error: 'invalid_rack_id', message: 'rackId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rack_id', sql.NVarChar(30), rackId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.rack
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          WHERE id = TRY_CONVERT(BIGINT, @rack_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'rack_not_found', message: 'Rack does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ rack: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);
