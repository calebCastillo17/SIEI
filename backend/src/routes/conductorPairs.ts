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
 * nucleo.par_conductor — sin columna `activo` (ver docs/MODELO_FISICO_SIEI.md
 * 2.2): su estado "libre/ocupado" se DERIVA de si un TRAMO_CONEXION activo
 * lo referencia (UX_tramo_conexion_par_conductor_id), no tiene flag propio.
 * Sin trigger de auto-generación (a diferencia de canal): se crea
 * manualmente, un par a la vez, indicando a qué cable pertenece.
 *
 * Sin PATCH ni DELETE: no hay campos editables más allá de numeroPar (y
 * renumerar podría confundir el conexionado físico documentado fuera del
 * sistema), y sin `activo` no hay soft delete — borrar físicamente violaría
 * la FK de cualquier tramo_conexion que lo haya usado alguna vez, activo o
 * no. Igual que cat.cat_modulo_io: es un catálogo/registro permanente una
 * vez creado.
 */
export const conductorPairsRouter = Router({ mergeParams: true });

conductorPairsRouter.use(authenticate);


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
    cableId: String(row.cable_id),
    numeroPar: row.numero_par,
    /*
     * "En uso" no es un campo propio de la fila: se calcula con un LEFT
     * JOIN a tramo_conexion activo, para ahorrarle al cliente tener que
     * cruzar las dos listas para saber si un par está libre.
     */
    inUse: Boolean(row.in_use),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const SELECT_COLUMNS = `
  pc.id, pc.proyecto_id, pc.cable_id, pc.numero_par,
  CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END AS in_use,
  pc.created_at, pc.updated_at, pc.created_by, pc.updated_by
`;

const FROM_CLAUSE = `
  FROM nucleo.par_conductor pc
  LEFT JOIN nucleo.tramo_conexion t ON t.par_conductor_id = pc.id AND t.activo = 1
`;


/*
 * GET /api/projects/:projectId/conductor-pairs?cableId=
 */
conductorPairsRouter.get(
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
        WHERE pc.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          ${cableIdFilter ? 'AND pc.cable_id = TRY_CONVERT(BIGINT, @cable_id)' : ''}
        ORDER BY pc.cable_id, pc.numero_par;
      `);

      res.status(200).json({ projectId, conductorPairs: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/conductor-pairs/:pairId
 */
conductorPairsRouter.get(
  '/:pairId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pairId = normalizeParam(req.params.pairId);

      if (!isPositiveIntString(pairId)) {
        res.status(400).json({ error: 'invalid_pair_id', message: 'pairId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('par_id', sql.NVarChar(30), pairId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE pc.id = TRY_CONVERT(BIGINT, @par_id)
            AND pc.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'conductor_pair_not_found', message: 'Conductor pair does not exist in this project.' });
        return;
      }

      res.status(200).json({ conductorPair: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/conductor-pairs
 *
 * numeroPar dentro de [1, capacidadConductores] del cable es una validación
 * de sanity del backend, NO una regla protegida por la base (no hay CHECK
 * ni trigger que la exija) — si la convención real de numeración es otra
 * (ej. empieza en 0, o admite pares de repuesto fuera de la capacidad
 * nominal), hay que ajustarla.
 */
conductorPairsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { cableId, numeroPar } = req.body ?? {};

      if (!isPositiveIntString(cableId)) {
        res.status(400).json({ error: 'validation_error', message: 'cableId is required and must be a numeric id.' });
        return;
      }

      if (
        typeof numeroPar !== 'number' ||
        !Number.isInteger(numeroPar) ||
        numeroPar <= 0 ||
        numeroPar > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroPar must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      const cableResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('cable_id', sql.NVarChar(30), cableId)
        .query(`
          SELECT capacidad_conductores
          FROM nucleo.cable
          WHERE id = TRY_CONVERT(BIGINT, @cable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const cable = cableResult.recordset[0];

      if (!cable) {
        res.status(400).json({ error: 'invalid_reference', message: 'cableId does not exist, is inactive, or does not belong to this project.' });
        return;
      }

      if (numeroPar > cable.capacidad_conductores) {
        res.status(400).json({
          error: 'validation_error',
          message: `numeroPar (${numeroPar}) excede la capacidadConductores del cable (${cable.capacidad_conductores}).`
        });
        return;
      }

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('cable_id', sql.NVarChar(30), cableId)
        .input('numero_par', sql.SmallInt, numeroPar)
        .query(`
          INSERT INTO nucleo.par_conductor (proyecto_id, cable_id, numero_par, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.cable_id, INSERTED.numero_par,
                 CAST(0 AS BIT) AS in_use, INSERTED.created_at, INSERTED.created_by
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @cable_id), @numero_par, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/conductor-pairs/${String(row.id)}`)
        .json({ conductorPair: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'conductor_pair_conflict', message: 'This cable already has a conductor pair with that number.' });
        return;
      }

      next(error);
    }
  }
);
