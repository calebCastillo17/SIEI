import { Router } from 'express';
import sql from 'mssql';

import { authenticate } from '../middleware/authenticate.js';
import { requireProjectPermission } from '../middleware/requireProjectPermission.js';
import { requireSystemAdmin } from '../middleware/requireSystemAdmin.js';
import { getDbPool } from '../db/sql.js';

export const projectsRouter = Router();

projectsRouter.use(authenticate);


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


/*
 * POST /api/projects
 *
 * Un proyecto nuevo no tiene todavía ninguna fila en
 * usuario_proyecto_rol, así que requireProjectPermission no aplica (no
 * hay :projectId que resolver) — la única autoridad posible para crear
 * uno es el administrador global del sistema. Quien lo crea no necesita
 * una asignación explícita: es_admin_sistema ya le da ADMIN implícito
 * sobre todo proyecto activo vía seguridad.vw_acceso_proyecto.
 */
projectsRouter.post(
  '/',
  requireSystemAdmin,
  async (req, res, next) => {
    try {
      const userId = req.authUser!.id;
      const { clientId, code, name } = req.body ?? {};

      if (!clientId || !/^\d+$/.test(String(clientId))) {
        res.status(400).json({ error: 'validation_error', message: 'clientId is required and must be a numeric id.' });
        return;
      }

      if (typeof code !== 'string' || code.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'code is required.' });
        return;
      }
      const codeTrim = code.trim();
      if (codeTrim.length > 30) {
        res.status(400).json({ error: 'validation_error', message: 'code cannot exceed 30 characters.' });
        return;
      }

      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'name is required.' });
        return;
      }
      const nameTrim = name.trim();
      if (nameTrim.length > 200) {
        res.status(400).json({ error: 'validation_error', message: 'name cannot exceed 200 characters.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('cliente_id', sql.NVarChar(30), String(clientId))
        .input('created_by', sql.NVarChar(30), userId)
        .input('codigo_proyecto', sql.NVarChar(30), codeTrim)
        .input('nombre', sql.NVarChar(200), nameTrim)
        .query(`
          IF NOT EXISTS (
            SELECT 1 FROM nucleo.cliente
            WHERE id = TRY_CONVERT(BIGINT, @cliente_id) AND activo = 1
          )
          BEGIN
            THROW 55601, 'clientId no existe o está inactivo.', 1;
          END;

          IF EXISTS (
            SELECT 1 FROM nucleo.proyecto
            WHERE cliente_id = TRY_CONVERT(BIGINT, @cliente_id)
              AND codigo_proyecto = @codigo_proyecto
              AND activo = 1
          )
          BEGIN
            THROW 55602, 'Ya existe un proyecto activo con ese código para ese cliente.', 1;
          END;

          INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.cliente_id, INSERTED.codigo_proyecto, INSERTED.nombre,
                 INSERTED.activo, INSERTED.created_at, INSERTED.created_by
          VALUES (TRY_CONVERT(BIGINT, @cliente_id), @codigo_proyecto, @nombre, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${String(row.id)}`)
        .json({
          project: {
            id: String(row.id),
            clientId: String(row.cliente_id),
            code: row.codigo_proyecto,
            name: row.nombre,
            active: Boolean(row.activo),
            createdAt: row.created_at,
            createdBy: row.created_by === null ? null : String(row.created_by)
          }
        });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 55601) {
        res.status(400).json({ error: 'invalid_reference', message: 'clientId does not exist or is inactive.' });
        return;
      }
      if (number === 55602 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'project_code_conflict', message: 'An active project with this code already exists for that client.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId
 *
 * Requiere permiso ADMINISTER (ADMIN del proyecto, o es_admin_sistema).
 * Solo permite renombrar/recodificar — cambiar de cliente no está
 * soportado aquí (mover un proyecto entero a otro cliente es una decisión
 * de negocio a confirmar, no a asumir).
 */
projectsRouter.patch(
  '/:projectId',
  requireProjectPermission('administer'),
  async (req, res, next) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const allowedFields = {
        code: { column: 'codigo_proyecto', max: 30 },
        name: { column: 'nombre', max: 200 }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      for (const key of keys) {
        if (typeof body[key] !== 'string' || (body[key] as string).trim().length === 0) {
          res.status(400).json({ error: 'validation_error', message: `${key} cannot be empty.` });
          return;
        }
        body[key] = (body[key] as string).trim();
        if ((body[key] as string).length > allowedFields[key].max) {
          res.status(400).json({ error: 'validation_error', message: `${key} cannot exceed ${allowedFields[key].max} characters.` });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();

      request.input('proyecto_id', sql.NVarChar(30), projectId).input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, sql.NVarChar(config.max), body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      if ('code' in body) {
        request.input('nuevo_codigo', sql.NVarChar(30), body.code);
      }

      const codeCheck = 'code' in body
        ? `
          IF EXISTS (
            SELECT 1 FROM nucleo.proyecto p2
            JOIN nucleo.proyecto p1 ON p1.cliente_id = p2.cliente_id
            WHERE p1.id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND p2.codigo_proyecto = @nuevo_codigo
              AND p2.activo = 1
              AND p2.id <> TRY_CONVERT(BIGINT, @proyecto_id)
          )
          BEGIN
            THROW 55602, 'Ya existe un proyecto activo con ese código para ese cliente.', 1;
          END;
        `
        : '';

      const result = await request.query(`
        DECLARE @actualizados TABLE (
          id BIGINT, cliente_id BIGINT, codigo_proyecto NVARCHAR(30), nombre NVARCHAR(200),
          activo BIT, created_at DATETIME2, updated_at DATETIME2, created_by BIGINT, updated_by BIGINT
        );

        IF NOT EXISTS (
          SELECT 1 FROM nucleo.proyecto
          WHERE id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
        )
        BEGIN
          THROW 55603, 'El proyecto no existe o está inactivo.', 1;
        END;

        ${codeCheck}

        UPDATE nucleo.proyecto
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT INSERTED.id, INSERTED.cliente_id, INSERTED.codigo_proyecto, INSERTED.nombre,
               INSERTED.activo, INSERTED.created_at, INSERTED.updated_at, INSERTED.created_by, INSERTED.updated_by
        INTO @actualizados
        WHERE id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;

        SELECT * FROM @actualizados;
      `);

      const row = result.recordset[0];

      res.status(200).json({
        project: {
          id: String(row.id),
          clientId: String(row.cliente_id),
          code: row.codigo_proyecto,
          name: row.nombre,
          active: Boolean(row.activo),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          createdBy: row.created_by === null ? null : String(row.created_by),
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 55602 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'project_code_conflict', message: 'An active project with this code already exists for that client.' });
        return;
      }
      if (number === 55603) {
        res.status(404).json({ error: 'project_not_found', message: 'Project does not exist or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId
 *
 * Archiva el proyecto (activo = 0), NO lo borra. TR_proyecto_desactivar_accesos
 * desactiva en cascada las asignaciones de usuario_proyecto_rol — el
 * backend no lo reimplementa. La información de ingeniería del proyecto
 * queda intacta (CLAUDE.md: "su información de ingeniería queda
 * deliberadamente intacta").
 *
 * nucleo.proyecto tiene ese trigger, así que el OUTPUT de este UPDATE va a
 * una tabla variable (mismo motivo que senal/modulo/cable).
 */
projectsRouter.delete(
  '/:projectId',
  requireProjectPermission('administer'),
  async (req, res, next) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivados TABLE (
            id BIGINT, cliente_id BIGINT, codigo_proyecto NVARCHAR(30), activo BIT,
            updated_at DATETIME2, updated_by BIGINT
          );

          UPDATE nucleo.proyecto
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.cliente_id, INSERTED.codigo_proyecto, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'project_not_found', message: 'Project does not exist or is already inactive.' });
        return;
      }

      res.status(200).json({
        project: {
          id: String(row.id),
          clientId: String(row.cliente_id),
          code: row.codigo_proyecto,
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);
