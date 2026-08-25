import type {
  NextFunction,
  Request,
  Response
} from 'express';

import sql from 'mssql';

import { env } from '../config/env.js';
import { getDbPool } from '../db/sql.js';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    /*
     * Por ahora solamente implementamos autenticacion DEV.
     * Cuando integremos Microsoft Entra, esta capa será
     * reemplazada por validacion de access token.
     */
    if (env.auth.mode !== 'dev') {
      res.status(501).json({
        error: 'authentication_not_implemented',
        message: 'Microsoft Entra authentication is not implemented yet.'
      });
      return;
    }

    const email = req.header('x-dev-user-email')?.trim();

    if (!email) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Missing X-Dev-User-Email header.'
      });
      return;
    }

    const pool = await getDbPool();

    const result = await pool
      .request()
      .input('email', sql.NVarChar(320), email)
      .query(`
        SELECT TOP (1)
          id,
          email,
          nombre,
          es_admin_sistema
        FROM seguridad.usuario
        WHERE email = @email
          AND activo = 1;
      `);

    const user = result.recordset[0];

    if (!user) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'User is not active or does not exist in SIEI.'
      });
      return;
    }

    req.authUser = {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      esAdminSistema: Boolean(user.es_admin_sistema)
    };

    next();

  } catch (error) {
    next(error);
  }
}
