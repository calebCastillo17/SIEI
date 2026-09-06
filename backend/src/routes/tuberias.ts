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
 * nucleo.tuberia (migración 030) — CRUD estándar por proyecto. tag_linea
 * sin unique (mismo criterio que plano.codigo_plano) — se resuelve
 * manualmente contra instrumento.linea_pnid en un futuro importador, no
 * hay unicidad forzada aquí.
 */
export const tuberiasRouter = Router({ mergeParams: true });
tuberiasRouter.use(authenticate);

function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPositiveIntString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tagLinea: row.tag_linea,
    tamanoDiametro: row.tamano_diametro,
    materialTuberia: row.material_tuberia,
    materialRevestimiento: row.material_revestimiento,
    espesorRevestimiento: row.espesor_revestimiento,
    schedule: row.schedule,
    normaBridas: row.norma_bridas,
    caraBridas: row.cara_bridas,
    conexionInstrumento: row.conexion_instrumento,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = 'id, proyecto_id, tag_linea, tamano_diametro, material_tuberia, material_revestimiento, espesor_revestimiento, schedule, norma_bridas, cara_bridas, conexion_instrumento, activo, created_at, updated_at, created_by, updated_by';

const TEXT_FIELDS: Array<[string, string, number]> = [
  ['tagLinea', 'tag_linea', 100],
  ['tamanoDiametro', 'tamano_diametro', 20],
  ['materialTuberia', 'material_tuberia', 200],
  ['materialRevestimiento', 'material_revestimiento', 200],
  ['espesorRevestimiento', 'espesor_revestimiento', 50],
  ['schedule', 'schedule', 20],
  ['normaBridas', 'norma_bridas', 50],
  ['caraBridas', 'cara_bridas', 200],
  ['conexionInstrumento', 'conexion_instrumento', 200]
];

function validateBody(body: Record<string, unknown>): string | null {
  for (const [key, , max] of TEXT_FIELDS) {
    const value = body[key];
    if (key in body && value !== null) {
      if (typeof value !== 'string') return `${key} must be a string or null.`;
      if (value.length > max) return `${key} cannot exceed ${max} characters.`;
    }
  }
  return null;
}

tuberiasRouter.get(
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
          SELECT ${COLUMNS} FROM nucleo.tuberia
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
          ORDER BY tag_linea;
        `);
      res.status(200).json({ projectId, tuberias: result.recordset.map(serialize) });
    } catch (error) {
      next(error);
    }
  }
);

tuberiasRouter.get(
  '/:id',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const id = normalizeParam(req.params.id);
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('id', sql.NVarChar(30), id)
        .query(`SELECT ${COLUMNS} FROM nucleo.tuberia WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;`);
      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ tuberia: serialize(row) });
    } catch (error) {
      next(error);
    }
  }
);

tuberiasRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const validationError = validateBody(body);
      if (validationError) {
        res.status(400).json({ error: 'validation_error', message: validationError });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('created_by', sql.NVarChar(30), userId);
      for (const [key, column, max] of TEXT_FIELDS) {
        request.input(column, sql.NVarChar(max), body[key] ?? null);
      }

      const result = await request.query(`
        INSERT INTO nucleo.tuberia (proyecto_id, ${TEXT_FIELDS.map(([, c]) => c).join(', ')}, created_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        VALUES (TRY_CONVERT(BIGINT, @proyecto_id), ${TEXT_FIELDS.map(([, c]) => `@${c}`).join(', ')}, TRY_CONVERT(BIGINT, @created_by));
      `);

      res.status(201).json({ tuberia: serialize(result.recordset[0]) });
    } catch (error) {
      next(error);
    }
  }
);

tuberiasRouter.patch(
  '/:id',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const id = normalizeParam(req.params.id);
      const userId = req.authUser!.id;
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const validationError = validateBody(body);
      if (validationError) {
        res.status(400).json({ error: 'validation_error', message: validationError });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('id', sql.NVarChar(30), id);
      request.input('updated_by', sql.NVarChar(30), userId);

      const setClauses: string[] = [];
      for (const [key, column, max] of TEXT_FIELDS) {
        if (!(key in body)) continue;
        request.input(column, sql.NVarChar(max), body[key]);
        setClauses.push(`${column} = @${column}`);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No updatable fields provided.' });
        return;
      }

      const result = await request.query(`
        UPDATE nucleo.tuberia
        SET ${setClauses.join(', ')}, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ tuberia: serialize(row) });
    } catch (error) {
      next(error);
    }
  }
);

tuberiasRouter.delete(
  '/:id',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const id = normalizeParam(req.params.id);
      const userId = req.authUser!.id;
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('id', sql.NVarChar(30), id)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.tuberia
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);
