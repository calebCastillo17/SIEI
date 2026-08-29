import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { getDbPool } from '../db/sql.js';

/*
 * cat.cat_tipo_gabinete — catálogo global (sin proyecto_id), solo
 * lectura. No reutiliza lib/simpleCatalogRouter.ts porque su columna de
 * texto se llama `nombre`, no `descripcion` (mismo motivo que
 * tiposEquipo.ts). Lista cerrada por ahora (RIO / CONTROL / COMUNICACION,
 * migración 012) — ampliarla es una migración, no una llamada a la API.
 */
export const tiposGabineteRouter = Router();

tiposGabineteRouter.use(authenticate);

tiposGabineteRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getDbPool();
    const result = await pool.request().query(`
      SELECT id, codigo, nombre, created_at, updated_at
      FROM cat.cat_tipo_gabinete
      ORDER BY codigo;
    `);

    res.status(200).json({
      items: result.recordset.map((row: any) => ({
        id: String(row.id),
        codigo: row.codigo,
        nombre: row.nombre,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});
