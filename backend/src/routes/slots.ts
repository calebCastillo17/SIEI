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
 * nucleo.slot — depende de RACK. Sin TAG: se identifica por numero_slot,
 * único dentro de su RACK entre filas activas (UX_slot_rack_numero). Sin
 * CHECK ni triggers propios. Mismo patrón que racks.ts.
 */
export const slotsRouter = Router({ mergeParams: true });

slotsRouter.use(authenticate);


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
    rackId: String(row.rack_id),
    numeroSlot: row.numero_slot,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMN_NAMES = [
  'id', 'proyecto_id', 'rack_id', 'numero_slot', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
];
const COLUMNS = COLUMN_NAMES.join(', ');
const OUTPUT_INSERTED_COLUMNS = COLUMN_NAMES.map((c) => `INSERTED.${c}`).join(', ');


/*
 * GET /api/projects/:projectId/slots?rackId=
 */
slotsRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const rackIdFilter = normalizeParam(req.query.rackId as string | string[] | undefined);

      if (rackIdFilter !== undefined && !isPositiveIntString(rackIdFilter)) {
        res.status(400).json({ error: 'invalid_rack_id', message: 'rackId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (rackIdFilter) request.input('rack_id', sql.NVarChar(30), rackIdFilter);

      const result = await request.query(`
        SELECT ${COLUMNS}
        FROM nucleo.slot
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${rackIdFilter ? 'AND rack_id = TRY_CONVERT(BIGINT, @rack_id)' : ''}
        ORDER BY rack_id, numero_slot;
      `);

      res.status(200).json({ projectId, slots: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/slots/:slotId
 */
slotsRouter.get(
  '/:slotId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const slotId = normalizeParam(req.params.slotId);

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'invalid_slot_id', message: 'slotId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.slot
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'slot_not_found', message: 'Slot does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ slot: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/slots
 */
slotsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { rackId, numeroSlot } = req.body ?? {};

      if (!isPositiveIntString(rackId)) {
        res.status(400).json({ error: 'validation_error', message: 'rackId is required and must be a numeric id.' });
        return;
      }

      if (
        typeof numeroSlot !== 'number' ||
        !Number.isInteger(numeroSlot) ||
        numeroSlot < 0 ||
        numeroSlot > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroSlot must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('rack_id', sql.NVarChar(30), rackId)
        .input('numero_slot', sql.SmallInt, numeroSlot)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.slot
            WHERE rack_id = TRY_CONVERT(BIGINT, @rack_id)
              AND numero_slot = @numero_slot AND activo = 1
          )
          BEGIN
            THROW 54501, 'Ya existe un slot activo con ese número en ese rack.', 1;
          END;

          INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at, created_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @rack_id), @numero_slot, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/slots/${String(row.id)}`)
        .json({ slot: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54501 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'slot_number_conflict', message: 'An active slot with this number already exists in that rack.' });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'rackId does not exist, is inactive, or does not belong to this project.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/slots/:slotId
 *
 * Solo permite renumerar (numeroSlot); mover un slot a otro rack no está
 * soportado aquí por la misma razón que en racks.ts.
 */
slotsRouter.patch(
  '/:slotId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const slotId = normalizeParam(req.params.slotId);

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'invalid_slot_id', message: 'slotId must be a positive integer.' });
        return;
      }

      const { numeroSlot } = req.body ?? {};

      if (
        typeof numeroSlot !== 'number' ||
        !Number.isInteger(numeroSlot) ||
        numeroSlot < 0 ||
        numeroSlot > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroSlot must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .input('numero_slot', sql.SmallInt, numeroSlot)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @rack_id BIGINT;
          SELECT @rack_id = rack_id FROM nucleo.slot
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          IF @rack_id IS NULL
          BEGIN
            THROW 54502, 'El slot no existe en este proyecto o está inactivo.', 1;
          END;

          IF EXISTS (
            SELECT 1 FROM nucleo.slot
            WHERE rack_id = @rack_id AND numero_slot = @numero_slot AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @slot_id)
          )
          BEGIN
            THROW 54501, 'Ya existe un slot activo con ese número en ese rack.', 1;
          END;

          UPDATE nucleo.slot
          SET numero_slot = @numero_slot,
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      res.status(200).json({ slot: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54501 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'slot_number_conflict', message: 'An active slot with this number already exists in that rack.' });
        return;
      }
      if (number === 54502) {
        res.status(404).json({ error: 'slot_not_found', message: 'Slot does not exist in this project or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/slots/:slotId
 */
slotsRouter.delete(
  '/:slotId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const slotId = normalizeParam(req.params.slotId);

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'invalid_slot_id', message: 'slotId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.slot
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'slot_not_found', message: 'Slot does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ slot: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);
