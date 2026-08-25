import type {
  NextFunction,
  Request,
  Response
} from 'express';

import sql from 'mssql';

import { getDbPool } from '../db/sql.js';

export type ProjectPermission =
  | 'read'
  | 'write'
  | 'deactivate'
  | 'administer';


export function requireProjectPermission(
  permission: ProjectPermission
) {
  return async function projectPermissionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.authUser;

      if (!user) {
        res.status(401).json({
          error: 'unauthorized',
          message: 'Authentication is required.'
        });
        return;
      }

      const rawProjectId = req.params.projectId;
      const projectId = Array.isArray(rawProjectId)
        ? rawProjectId[0]
        : rawProjectId;

      if (!projectId || !/^\d+$/.test(projectId)) {
        res.status(400).json({
          error: 'invalid_project_id',
          message: 'projectId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();

      /*
       * Usamos NVARCHAR + TRY_CONVERT para no convertir BIGINT
       * de SQL Server a Number de JavaScript.
       */
      const result = await pool
        .request()
        .input('usuario_id', sql.NVarChar(30), user.id)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT TOP (1)
            proyecto_id,
            codigo_proyecto,
            rol_codigo,
            puede_escribir,
            puede_desactivar,
            puede_administrar
          FROM seguridad.vw_acceso_proyecto
          WHERE usuario_id = TRY_CONVERT(BIGINT, @usuario_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      const access = result.recordset[0];

      /*
       * Usuario válido, pero sin acceso a este proyecto.
       */
      if (!access) {
        res.status(403).json({
          error: 'forbidden',
          message: 'You do not have access to this project.'
        });
        return;
      }

      const permissions = {
        write: Boolean(access.puede_escribir),
        deactivate: Boolean(access.puede_desactivar),
        administer: Boolean(access.puede_administrar)
      };

      let allowed = true;

      switch (permission) {
        case 'read':
          allowed = true;
          break;

        case 'write':
          allowed = permissions.write;
          break;

        case 'deactivate':
          allowed = permissions.deactivate;
          break;

        case 'administer':
          allowed = permissions.administer;
          break;
      }

      if (!allowed) {
        res.status(403).json({
          error: 'forbidden',
          message: `Role ${access.rol_codigo} does not have permission: ${permission}.`
        });
        return;
      }

      req.projectAccess = {
        projectId: String(access.proyecto_id),
        codigoProyecto: access.codigo_proyecto,
        role: access.rol_codigo,
        permissions
      };

      next();

    } catch (error) {
      next(error);
    }
  };
}
