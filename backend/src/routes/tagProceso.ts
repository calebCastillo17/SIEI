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
 * nucleo.tag_proceso (migración 032) — formato largo de condiciones de
 * proceso, cuelga del TAG FÍSICO (instrumento_id), no de la ficha
 * técnica: dos tags que comparten la misma ficha pueden tener
 * condiciones de proceso distintas. Valores como texto (no numérico) —
 * el dato real trae placeholders no numéricos ("VTS", "N.A.", "TBD")
 * ademas de numeros.
 */
export const tagProcesoRouter = Router({ mergeParams: true });
tagProcesoRouter.use(authenticate);

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
    instrumentoId: String(row.instrumento_id),
    variable: row.variable,
    valorMin: row.valor_min,
    valorNominal: row.valor_nominal,
    valorMax: row.valor_max,
    unidad: row.unidad,
    rangoCalibradoCampo: row.rango_calibrado_campo,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const COLUMNS = 'id, proyecto_id, instrumento_id, variable, valor_min, valor_nominal, valor_max, unidad, rango_calibrado_campo, activo, created_at, updated_at';

tagProcesoRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const instrumentoId = normalizeParam(req.params.instrumentId);
      if (!isPositiveIntString(instrumentoId)) {
        res.status(400).json({ error: 'invalid_instrument_id', message: 'instrumentId must be a positive integer.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentoId)
        .query(`
          SELECT ${COLUMNS} FROM nucleo.tag_proceso
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id) AND activo = 1
          ORDER BY variable;
        `);
      res.status(200).json({ tagProceso: result.recordset.map(serialize) });
    } catch (error) {
      next(error);
    }
  }
);

tagProcesoRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const instrumentoId = normalizeParam(req.params.instrumentId);
      if (!isPositiveIntString(instrumentoId)) {
        res.status(400).json({ error: 'invalid_instrument_id', message: 'instrumentId must be a positive integer.' });
        return;
      }

      const { variable, valorMin = null, valorNominal = null, valorMax = null, unidad = null, rangoCalibradoCampo = null } = req.body ?? {};
      if (typeof variable !== 'string' || variable.trim().length === 0 || variable.length > 100) {
        res.status(400).json({ error: 'validation_error', message: 'variable is required (max 100 chars).' });
        return;
      }
      const textFields: Array<[string, unknown, number]> = [
        ['valorMin', valorMin, 50], ['valorNominal', valorNominal, 50], ['valorMax', valorMax, 50],
        ['unidad', unidad, 30], ['rangoCalibradoCampo', rangoCalibradoCampo, 50]
      ];
      for (const [key, value, max] of textFields) {
        if (value !== null && (typeof value !== 'string' || value.length > max)) {
          res.status(400).json({ error: 'validation_error', message: `${key} must be a string (max ${max} chars) or null.` });
          return;
        }
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentoId)
        .input('variable', sql.NVarChar(100), variable.trim())
        .input('valor_min', sql.NVarChar(50), valorMin)
        .input('valor_nominal', sql.NVarChar(50), valorNominal)
        .input('valor_max', sql.NVarChar(50), valorMax)
        .input('unidad', sql.NVarChar(30), unidad)
        .input('rango_calibrado_campo', sql.NVarChar(50), rangoCalibradoCampo)
        .query(`
          INSERT INTO nucleo.tag_proceso (proyecto_id, instrumento_id, variable, valor_min, valor_nominal, valor_max, unidad, rango_calibrado_campo)
          OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @instrumento_id), @variable, @valor_min, @valor_nominal, @valor_max, @unidad, @rango_calibrado_campo);
        `);

      res.status(201).json({ tagProceso: serialize(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'instrumentId does not exist in this project.' });
        return;
      }
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'variable_conflict', message: 'This variable already exists for this instrument.' });
        return;
      }
      next(error);
    }
  }
);

tagProcesoRouter.patch(
  '/:id',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const instrumentoId = normalizeParam(req.params.instrumentId);
      const id = normalizeParam(req.params.id);
      if (!isPositiveIntString(instrumentoId) || !isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'instrumentId and id must be positive integers.' });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const columnMap: Record<string, { column: string; max: number }> = {
        variable: { column: 'variable', max: 100 },
        valorMin: { column: 'valor_min', max: 50 },
        valorNominal: { column: 'valor_nominal', max: 50 },
        valorMax: { column: 'valor_max', max: 50 },
        unidad: { column: 'unidad', max: 30 },
        rangoCalibradoCampo: { column: 'rango_calibrado_campo', max: 50 }
      };

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('instrumento_id', sql.NVarChar(30), instrumentoId);
      request.input('id', sql.NVarChar(30), id);

      const setClauses: string[] = [];
      for (const [key, { column, max }] of Object.entries(columnMap)) {
        if (!(key in body)) continue;
        const value = body[key];
        if (value !== null && (typeof value !== 'string' || value.length > max)) {
          res.status(400).json({ error: 'validation_error', message: `${key} must be a string (max ${max} chars) or null.` });
          return;
        }
        request.input(column, sql.NVarChar(max), value);
        setClauses.push(`${column} = @${column}`);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No updatable fields provided.' });
        return;
      }

      const result = await request.query(`
        UPDATE nucleo.tag_proceso
        SET ${setClauses.join(', ')}, updated_at = SYSUTCDATETIME()
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id) AND activo = 1;
      `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'tag_proceso_not_found', message: 'Tag proceso row does not exist, is inactive, or belongs to a different instrument.' });
        return;
      }
      res.status(200).json({ tagProceso: serialize(row) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'variable_conflict', message: 'This variable already exists for this instrument.' });
        return;
      }
      next(error);
    }
  }
);

tagProcesoRouter.delete(
  '/:id',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const instrumentoId = normalizeParam(req.params.instrumentId);
      const id = normalizeParam(req.params.id);
      if (!isPositiveIntString(instrumentoId) || !isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'instrumentId and id must be positive integers.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentoId)
        .input('id', sql.NVarChar(30), id)
        .query(`
          UPDATE nucleo.tag_proceso
          SET activo = 0, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'tag_proceso_not_found', message: 'Tag proceso row does not exist or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);
