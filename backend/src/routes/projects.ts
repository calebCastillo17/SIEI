import { Router } from 'express';
import sql from 'mssql';

import { authenticate } from '../middleware/authenticate.js';
import { requireProjectPermission } from '../middleware/requireProjectPermission.js';
import { getDbPool } from '../db/sql.js';

export const projectsRouter = Router();

projectsRouter.use(authenticate);


/*
 * GET /api/projects
 *
 * Devuelve solamente los proyectos a los que el usuario
 * autenticado tiene acceso.
 *
 * El ADMIN global obtiene todos los proyectos activos
 * porque seguridad.vw_acceso_proyecto ya resuelve ese caso.
 */
projectsRouter.get('/', async (req, res, next) => {
  try {
    const user = req.authUser!;

    const pool = await getDbPool();

    const result = await pool
      .request()
      .input('usuario_id', sql.NVarChar(30), user.id)
      .query(`
        SELECT
          p.id,
          p.cliente_id,
          p.codigo_proyecto,
          p.nombre,
          p.activo,
          p.created_at,
          p.updated_at,

          a.rol_codigo,
          a.puede_escribir,
          a.puede_desactivar,
          a.puede_administrar

        FROM seguridad.vw_acceso_proyecto a

        INNER JOIN nucleo.proyecto p
          ON p.id = a.proyecto_id

        WHERE a.usuario_id = TRY_CONVERT(BIGINT, @usuario_id)
          AND p.activo = 1

        ORDER BY p.codigo_proyecto;
      `);

    res.status(200).json({
      projects: result.recordset.map((row) => ({
        id: String(row.id),
        clientId: String(row.cliente_id),

        code: row.codigo_proyecto,
        name: row.nombre,
        active: Boolean(row.activo),

        createdAt: row.created_at,
        updatedAt: row.updated_at,

        access: {
          role: row.rol_codigo,

          permissions: {
            write: Boolean(row.puede_escribir),
            deactivate: Boolean(row.puede_desactivar),
            administer: Boolean(row.puede_administrar)
          }
        }
      }))
    });

  } catch (error) {
    next(error);
  }
});


/*
 * GET /api/projects/:projectId
 *
 * Primero verifica que el usuario tenga acceso de lectura
 * al proyecto.
 */
projectsRouter.get(
  '/:projectId',
  requireProjectPermission('read'),
  async (req, res, next) => {
    try {
      const projectId = req.projectAccess!.projectId;

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT
            id,
            cliente_id,
            codigo_proyecto,
            nombre,
            activo,
            created_at,
            updated_at
          FROM nucleo.proyecto
          WHERE id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const project = result.recordset[0];

      if (!project) {
        res.status(404).json({
          error: 'project_not_found',
          message: 'Project does not exist or is inactive.'
        });
        return;
      }

      res.status(200).json({
        project: {
          id: String(project.id),
          clientId: String(project.cliente_id),

          code: project.codigo_proyecto,
          name: project.nombre,
          active: Boolean(project.activo),

          createdAt: project.created_at,
          updatedAt: project.updated_at,

          access: {
            role: req.projectAccess!.role,
            permissions: req.projectAccess!.permissions
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);
