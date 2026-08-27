import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { getDbPool } from '../db/sql.js';

/*
 * cat.cat_orden_tipo_instrumento — preset global de "orden de instrumentos
 * asociados" (prefijo de TAG -> valor numérico), solo lectura por ahora.
 * Ver comentario en database/migrations/006_entregables_base.sql sobre
 * cómo evolucionar esto a configurable por proyecto si hiciera falta.
 */
export const ordenTipoInstrumentoRouter = Router();

ordenTipoInstrumentoRouter.use(authenticate);

ordenTipoInstrumentoRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getDbPool();
    const result = await pool.request().query(`
      SELECT id, prefijo, orden, created_at, updated_at
      FROM cat.cat_orden_tipo_instrumento
      ORDER BY orden, prefijo;
    `);

    res.status(200).json({
      items: result.recordset.map((row: any) => ({
        id: String(row.id),
        prefijo: row.prefijo,
        orden: row.orden,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});
