import { Router } from 'express';
import sql from 'mssql';

import { authenticate } from '../middleware/authenticate.js';
import { getDbPool } from '../db/sql.js';

export const meRouter = Router();

meRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const user = req.authUser!;

    const pool = await getDbPool();

    const result = await pool
      .request()
      .input('usuario_id', sql.BigInt, user.id)
      .query(`
        SELECT
          proyecto_id,
          codigo_proyecto,
          rol_codigo,
          puede_escribir,
          puede_desactivar,
          puede_administrar
        FROM seguridad.vw_acceso_proyecto
        WHERE usuario_id = @usuario_id
        ORDER BY codigo_proyecto;
      `);

    res.status(200).json({
      user,
      projects: result.recordset.map((row) => ({
        id: String(row.proyecto_id),
        codigo: row.codigo_proyecto,
        role: row.rol_codigo,
        permissions: {
          write: Boolean(row.puede_escribir),
          deactivate: Boolean(row.puede_desactivar),
          administer: Boolean(row.puede_administrar)
        }
      }))
    });

  } catch (error) {
    next(error);
  }
});
