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
 * nucleo.puerto — depende de SWITCH. Sin TAG: se identifica por
 * numero_puerto, único dentro de su SWITCH entre filas activas
 * (UX_puerto_switch_numero). Sin CHECK ni triggers propios. Mismo patrón
 * que racks.ts/slots.ts.
 */
export const portsRouter = Router({ mergeParams: true });

portsRouter.use(authenticate);


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
    switchId: String(row.switch_id),
    numeroPuerto: row.numero_puerto,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMN_NAMES = [
  'id', 'proyecto_id', 'switch_id', 'numero_puerto', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
];
const COLUMNS = COLUMN_NAMES.join(', ');
const OUTPUT_INSERTED_COLUMNS = COLUMN_NAMES.map((c) => `INSERTED.${c}`).join(', ');


/*
 * GET /api/projects/:projectId/ports?switchId=
 */
portsRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const switchIdFilter = normalizeParam(req.query.switchId as string | string[] | undefined);

      if (switchIdFilter !== undefined && !isPositiveIntString(switchIdFilter)) {
        res.status(400).json({ error: 'invalid_switch_id', message: 'switchId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (switchIdFilter) request.input('switch_id', sql.NVarChar(30), switchIdFilter);

      const result = await request.query(`
        SELECT ${COLUMNS}
        FROM nucleo.puerto
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${switchIdFilter ? 'AND switch_id = TRY_CONVERT(BIGINT, @switch_id)' : ''}
        ORDER BY switch_id, numero_puerto;
      `);

      res.status(200).json({ projectId, ports: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/ports/:portId
 */
portsRouter.get(
  '/:portId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const portId = normalizeParam(req.params.portId);

      if (!isPositiveIntString(portId)) {
        res.status(400).json({ error: 'invalid_port_id', message: 'portId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('puerto_id', sql.NVarChar(30), portId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.puerto
          WHERE id = TRY_CONVERT(BIGINT, @puerto_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'port_not_found', message: 'Port does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ port: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/ports
 */
portsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { switchId, numeroPuerto } = req.body ?? {};

      if (!isPositiveIntString(switchId)) {
        res.status(400).json({ error: 'validation_error', message: 'switchId is required and must be a numeric id.' });
        return;
      }

      if (
        typeof numeroPuerto !== 'number' ||
        !Number.isInteger(numeroPuerto) ||
        numeroPuerto < 0 ||
        numeroPuerto > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroPuerto must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('switch_id', sql.NVarChar(30), switchId)
        .input('numero_puerto', sql.SmallInt, numeroPuerto)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.puerto
            WHERE switch_id = TRY_CONVERT(BIGINT, @switch_id)
              AND numero_puerto = @numero_puerto AND activo = 1
          )
          BEGIN
            THROW 54801, 'Ya existe un puerto activo con ese número en ese switch.', 1;
          END;

          INSERT INTO nucleo.puerto (proyecto_id, switch_id, numero_puerto, activo, created_at, created_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @switch_id), @numero_puerto, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/ports/${String(row.id)}`)
        .json({ port: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54801 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'port_number_conflict', message: 'An active port with this number already exists on that switch.' });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'switchId does not exist, is inactive, or does not belong to this project.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/ports/:portId
 *
 * Solo permite renumerar (numeroPuerto); mover un puerto a otro switch no
 * está soportado aquí, misma razón que en racks/slots.
 */
portsRouter.patch(
  '/:portId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const portId = normalizeParam(req.params.portId);

      if (!isPositiveIntString(portId)) {
        res.status(400).json({ error: 'invalid_port_id', message: 'portId must be a positive integer.' });
        return;
      }

      const { numeroPuerto } = req.body ?? {};

      if (
        typeof numeroPuerto !== 'number' ||
        !Number.isInteger(numeroPuerto) ||
        numeroPuerto < 0 ||
        numeroPuerto > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroPuerto must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('puerto_id', sql.NVarChar(30), portId)
        .input('numero_puerto', sql.SmallInt, numeroPuerto)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @switch_id BIGINT;
          SELECT @switch_id = switch_id FROM nucleo.puerto
          WHERE id = TRY_CONVERT(BIGINT, @puerto_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          IF @switch_id IS NULL
          BEGIN
            THROW 54802, 'El puerto no existe en este proyecto o está inactivo.', 1;
          END;

          IF EXISTS (
            SELECT 1 FROM nucleo.puerto
            WHERE switch_id = @switch_id AND numero_puerto = @numero_puerto AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @puerto_id)
          )
          BEGIN
            THROW 54801, 'Ya existe un puerto activo con ese número en ese switch.', 1;
          END;

          UPDATE nucleo.puerto
          SET numero_puerto = @numero_puerto,
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          WHERE id = TRY_CONVERT(BIGINT, @puerto_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      res.status(200).json({ port: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54801 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'port_number_conflict', message: 'An active port with this number already exists on that switch.' });
        return;
      }
      if (number === 54802) {
        res.status(404).json({ error: 'port_not_found', message: 'Port does not exist in this project or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/ports/:portId
 */
portsRouter.delete(
  '/:portId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const portId = normalizeParam(req.params.portId);

      if (!isPositiveIntString(portId)) {
        res.status(400).json({ error: 'invalid_port_id', message: 'portId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('puerto_id', sql.NVarChar(30), portId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.puerto
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          WHERE id = TRY_CONVERT(BIGINT, @puerto_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'port_not_found', message: 'Port does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ port: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);
