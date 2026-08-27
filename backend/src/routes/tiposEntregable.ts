import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { getDbPool } from '../db/sql.js';

/*
 * cat.cat_tipo_entregable — catálogo global (sin proyecto_id), solo
 * lectura. No reutiliza lib/simpleCatalogRouter.ts porque tiene una
 * columna de más (`disciplina`, conceptual — NO la letra documental, ver
 * database/migrations/006_entregables_base.sql).
 */
export const tiposEntregableRouter = Router();

tiposEntregableRouter.use(authenticate);

tiposEntregableRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getDbPool();
    const result = await pool.request().query(`
      SELECT id, codigo, descripcion, disciplina, created_at, updated_at
      FROM cat.cat_tipo_entregable
      ORDER BY codigo;
    `);

    res.status(200).json({
      items: result.recordset.map((row: any) => ({
        id: String(row.id),
        codigo: row.codigo,
        descripcion: row.descripcion,
        disciplina: row.disciplina,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});
