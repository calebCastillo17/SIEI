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
 * nucleo.conductor (migración 015) — unidad física fundamental de un
 * cable. `codigo` es texto libre (no un entero): un hilo puede
 * identificarse como "1", "2", "BK", "WH", "+", "-" — nunca se asume una
 * numeración secuencial. `parConductorId` es opcional (agrupación de a 2,
 * nunca la unidad fundamental — ver nucleo.par_conductor/conductorPairs.ts)
 * y la base garantiza en FK que, si está poblado, pertenece al MISMO
 * cable del conductor (FK_conductor_par_mismo_cable).
 *
 * `inUse` es derivado (no propio de la fila), igual que par_conductor:
 * calculado por LEFT JOIN contra tramo_conductor activo. Desactivar un
 * conductor en uso lo rechaza TR_conductor_validar_desactivacion — el
 * backend no reimplementa esa validación, solo traduce el error.
 */
export const conductorsRouter = Router({ mergeParams: true });

conductorsRouter.use(authenticate);


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

function mapConductorSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  if (message.includes('UX_conductor_cable_codigo') || number === 2601 || number === 2627) {
    return { status: 409, body: { error: 'conductor_codigo_conflict', message: 'Ese cable ya tiene un conductor activo con ese código.' } };
  }
  if (message.includes('FK_conductor_par_mismo_cable')) {
    return { status: 400, body: { error: 'validation_error', message: 'parConductorId no pertenece al mismo cable del conductor.' } };
  }
  if (number === 547) {
    if (message.includes('FK_conductor_cable')) {
      return { status: 400, body: { error: 'invalid_reference', message: 'cableId no existe o no pertenece a este proyecto.' } };
    }
    return { status: 400, body: { error: 'invalid_reference', message: 'Referencia inválida.' } };
  }
  if (number === 51028) {
    return { status: 409, body: { error: 'conductor_in_use', message: 'No se puede desactivar un conductor que participa en un TRAMO_CONDUCTOR activo.' } };
  }

  return null;
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    cableId: String(row.cable_id),
    codigo: row.codigo,
    orden: row.orden,
    parConductorId: row.par_conductor_id === null ? null : String(row.par_conductor_id),
    active: Boolean(row.activo),
    inUse: Boolean(row.in_use),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const SELECT_COLUMNS = `
  c.id, c.proyecto_id, c.cable_id, c.codigo, c.orden, c.par_conductor_id, c.activo,
  CASE WHEN tc.id IS NOT NULL THEN 1 ELSE 0 END AS in_use,
  c.created_at, c.updated_at, c.created_by, c.updated_by
`;

const FROM_CLAUSE = `
  FROM nucleo.conductor c
  LEFT JOIN nucleo.tramo_conductor tc ON tc.conductor_id = c.id AND tc.activo = 1
`;


/*
 * GET /api/projects/:projectId/conductors?cableId=
 */
conductorsRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const cableIdFilter = normalizeParam(req.query.cableId as string | string[] | undefined);

      if (cableIdFilter !== undefined && !isPositiveIntString(cableIdFilter)) {
        res.status(400).json({ error: 'invalid_cable_id', message: 'cableId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);
      if (cableIdFilter) request.input('cable_id', sql.NVarChar(30), cableIdFilter);

      const result = await request.query(`
        SELECT ${SELECT_COLUMNS}
        ${FROM_CLAUSE}
        WHERE c.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND c.activo = 1
          ${cableIdFilter ? 'AND c.cable_id = TRY_CONVERT(BIGINT, @cable_id)' : ''}
        ORDER BY c.cable_id, c.orden, c.codigo;
      `);

      res.status(200).json({ projectId, conductors: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/conductors/:conductorId
 */
conductorsRouter.get(
  '/:conductorId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const conductorId = normalizeParam(req.params.conductorId);

      if (!isPositiveIntString(conductorId)) {
        res.status(400).json({ error: 'invalid_conductor_id', message: 'conductorId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('conductor_id', sql.NVarChar(30), conductorId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE c.id = TRY_CONVERT(BIGINT, @conductor_id)
            AND c.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND c.activo = 1;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'conductor_not_found', message: 'Conductor does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ conductor: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/conductors
 *
 * parConductorId es opcional — cuando se envía, la BD garantiza (FK
 * compuesta) que el par pertenece al mismo cable.
 */
conductorsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { cableId, codigo, orden = null, parConductorId = null } = req.body ?? {};

      if (!isPositiveIntString(cableId)) {
        res.status(400).json({ error: 'validation_error', message: 'cableId is required and must be a numeric id.' });
        return;
      }
      if (typeof codigo !== 'string' || codigo.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'codigo is required.' });
        return;
      }
      if (codigo.length > 20) {
        res.status(400).json({ error: 'validation_error', message: 'codigo cannot exceed 20 characters.' });
        return;
      }
      if (orden !== null && orden !== undefined && (typeof orden !== 'number' || !Number.isInteger(orden))) {
        res.status(400).json({ error: 'validation_error', message: 'orden must be an integer or null.' });
        return;
      }
      if (parConductorId !== null && parConductorId !== undefined && !isPositiveIntString(parConductorId)) {
        res.status(400).json({ error: 'validation_error', message: 'parConductorId must be a numeric id or null.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('cable_id', sql.NVarChar(30), cableId)
        .input('codigo', sql.NVarChar(20), codigo.trim())
        .input('orden', sql.SmallInt, orden)
        .input('par_conductor_id', sql.NVarChar(30), parConductorId)
        .query(`
          INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo, orden, par_conductor_id, activo, created_at, created_by)
          OUTPUT INSERTED.id
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @cable_id), @codigo, @orden,
            TRY_CONVERT(BIGINT, @par_conductor_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const newId = String(insertResult.recordset[0].id);
      const fresh = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('conductor_id', sql.NVarChar(30), newId)
        .query(`SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE} WHERE c.id = TRY_CONVERT(BIGINT, @conductor_id) AND c.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);`);

      res
        .status(201)
        .location(`/api/projects/${projectId}/conductors/${newId}`)
        .json({ conductor: serialize(fresh.recordset[0]) });

    } catch (error) {
      const mapped = mapConductorSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/conductors/:conductorId
 *
 * Desactivación lógica. TR_conductor_validar_desactivacion rechaza
 * (51028) si el conductor participa en un TRAMO_CONDUCTOR activo.
 */
conductorsRouter.delete(
  '/:conductorId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const conductorId = normalizeParam(req.params.conductorId);

      if (!isPositiveIntString(conductorId)) {
        res.status(400).json({ error: 'invalid_conductor_id', message: 'conductorId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('conductor_id', sql.NVarChar(30), conductorId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          -- nucleo.conductor tiene TR_conductor_validar_desactivacion
          -- (AFTER UPDATE) — OUTPUT sin INTO en una tabla con trigger
          -- habilitado para el mismo tipo de DML es el error 334 de SQL
          -- Server; se usa una tabla variable, igual que el resto del
          -- esquema con triggers (ver comentario de cabecera de modules.ts).
          DECLARE @desactivados TABLE (id BIGINT, proyecto_id BIGINT, codigo NVARCHAR(20), activo BIT, updated_at DATETIME2, updated_by BIGINT);

          UPDATE nucleo.conductor
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.codigo, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @conductor_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'conductor_not_found', message: 'Conductor does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        conductor: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          codigo: row.codigo,
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const mapped = mapConductorSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);
