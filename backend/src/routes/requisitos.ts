import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import sql from 'mssql';

import { authenticate } from '../middleware/authenticate.js';
import { requireSystemAdmin } from '../middleware/requireSystemAdmin.js';
import { getDbPool } from '../db/sql.js';

/*
 * cat.cat_requisito (migración 032) — catálogo global, abierto. Casi
 * idéntico a los catálogos genéricos de simpleCatalogRouter.ts, pero
 * necesita un router propio por la columna extra `categoria`
 * (Prueba/Suministro/Documento/Servicio/Regulatorio, texto libre — no es
 * su propio catálogo, no hay evidencia todavía de que valga la pena esa
 * segunda capa).
 */
export const requisitosRouter = Router();
requisitosRouter.use(authenticate);

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
    codigo: row.codigo,
    descripcion: row.descripcion,
    categoria: row.categoria,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

requisitosRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getDbPool();
    const result = await pool.request().query(`
      SELECT id, codigo, descripcion, categoria, created_at, updated_at
      FROM cat.cat_requisito
      ORDER BY categoria, codigo;
    `);
    res.status(200).json({ items: result.recordset.map(serialize) });
  } catch (error) {
    next(error);
  }
});

requisitosRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = normalizeParam(req.params.id);
    if (!id || !/^\d+$/.test(id)) {
      res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
      return;
    }
    const pool = await getDbPool();
    const result = await pool
      .request()
      .input('id', sql.NVarChar(30), id)
      .query(`SELECT id, codigo, descripcion, categoria, created_at, updated_at FROM cat.cat_requisito WHERE id = TRY_CONVERT(BIGINT, @id);`);
    const row = result.recordset[0];
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Item does not exist.' });
      return;
    }
    res.status(200).json({ item: serialize(row) });
  } catch (error) {
    next(error);
  }
});

requisitosRouter.post(
  '/',
  requireSystemAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { codigo, descripcion = null, categoria = null } = req.body ?? {};

      if (typeof codigo !== 'string' || codigo.trim().length === 0 || codigo.trim().length > 30) {
        res.status(400).json({ error: 'validation_error', message: 'codigo is required (max 30 chars).' });
        return;
      }
      if (descripcion !== null && (typeof descripcion !== 'string' || descripcion.length > 200)) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion must be a string (max 200 chars) or null.' });
        return;
      }
      if (categoria !== null && (typeof categoria !== 'string' || categoria.length > 50)) {
        res.status(400).json({ error: 'validation_error', message: 'categoria must be a string (max 50 chars) or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('codigo', sql.NVarChar(30), codigo.trim())
        .input('descripcion', sql.NVarChar(200), descripcion)
        .input('categoria', sql.NVarChar(50), categoria)
        .query(`
          INSERT INTO cat.cat_requisito (codigo, descripcion, categoria)
          OUTPUT INSERTED.id, INSERTED.codigo, INSERTED.descripcion, INSERTED.categoria, INSERTED.created_at, INSERTED.updated_at
          VALUES (@codigo, @descripcion, @categoria);
        `);

      res.status(201).json({ item: serialize(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'code_conflict', message: 'An item with this codigo already exists.' });
        return;
      }
      next(error);
    }
  }
);
