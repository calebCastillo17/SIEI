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
 * seguridad.usuario_proyecto_rol, visto desde un proyecto: quién tiene
 * acceso y con qué rol. A diferencia de users.ts (registro global del
 * usuario, solo es_admin_sistema), esto lo administra el ADMIN de CADA
 * proyecto (requireProjectPermission('administer')) — no hace falta ser
 * administrador del sistema para invitar gente a tu propio proyecto.
 *
 * POST acepta email+nombre+rol: si el email no existe todavía en
 * seguridad.usuario, se crea como usuario "pre-registrado" (sin
 * auth_issuer/auth_subject — los completará su primer login OIDC, ver
 * CLAUDE.md "Security model") y se le asigna el rol en el mismo paso.
 *
 * Cambiar de rol NO es un UPDATE en el sitio: se desactiva la asignación
 * vigente y se crea una nueva, preservando el historial — es el mismo
 * patrón que ya documenta la migración 002 (ver comentario de
 * UX_seg_upr_usuario_proyecto_activo).
 *
 * seguridad.usuario_proyecto_rol tiene un trigger AFTER INSERT, UPDATE
 * (TR_usuario_proyecto_rol_validar), así que cualquier INSERT/UPDATE sobre
 * ella usa el patrón OUTPUT ... INTO.
 */
export const membersRouter = Router({ mergeParams: true });

membersRouter.use(authenticate);

const VALID_ROLES = ['ADMIN', 'EDITOR', 'VIEWER'] as const;

function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPositiveIntString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
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

function sqlErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function mapMemberSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  if (number === 55801 || message.includes('UX_seg_upr_usuario_proyecto_activo')) {
    return { status: 409, body: { error: 'member_already_assigned', message: 'Ese usuario ya tiene una asignación activa en este proyecto.' } };
  }
  if (number === 55802) {
    return { status: 404, body: { error: 'member_not_found', message: 'El usuario no tiene una asignación activa en este proyecto.' } };
  }
  if (number === 52001) {
    return { status: 400, body: { error: 'invalid_reference', message: 'No se puede asignar acceso a un usuario inactivo.' } };
  }
  if (number === 52002) {
    return { status: 400, body: { error: 'invalid_reference', message: 'No se puede asignar acceso a un proyecto inactivo.' } };
  }
  if (number === 2601 || number === 2627) {
    return { status: 409, body: { error: 'user_email_conflict', message: 'An active user with this email already exists.' } };
  }
  if (number === 547) {
    return { status: 400, body: { error: 'invalid_reference', message: 'usuarioId/proyectoId/rol no existe o no es válido.' } };
  }

  return null;
}

function serialize(row: Record<string, any>) {
  return {
    usuarioId: String(row.usuario_id),
    email: row.email,
    nombre: row.nombre,
    projectId: String(row.proyecto_id),
    role: row.rol_codigo,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SELECT_COLUMNS = `
  upr.usuario_id, u.email, u.nombre, upr.proyecto_id, r.codigo AS rol_codigo,
  upr.activo, upr.created_at, upr.updated_at
`;

const FROM_CLAUSE = `
  FROM seguridad.usuario_proyecto_rol upr
  JOIN seguridad.usuario u ON u.id = upr.usuario_id
  JOIN seguridad.rol r ON r.id = upr.rol_id
`;


/*
 * GET /api/projects/:projectId/members
 */
membersRouter.get(
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
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE upr.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND upr.activo = 1
          ORDER BY u.email;
        `);

      res.status(200).json({ projectId, members: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/members
 *
 * Body: { email, nombre?, rol }. `nombre` solo hace falta si el email
 * todavía no existe como usuario (pre-registro en el mismo paso).
 */
membersRouter.post(
  '/',
  requireProjectPermission('administer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const { email, nombre, rol } = req.body ?? {};

      if (typeof email !== 'string' || email.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'email is required.' });
        return;
      }
      const emailTrim = email.trim();

      if (typeof rol !== 'string' || !VALID_ROLES.includes(rol as any)) {
        res.status(400).json({ error: 'validation_error', message: `rol must be one of: ${VALID_ROLES.join(', ')}.` });
        return;
      }

      if (nombre !== undefined && (typeof nombre !== 'string' || nombre.trim().length === 0)) {
        res.status(400).json({ error: 'validation_error', message: 'nombre must be a non-empty string when provided.' });
        return;
      }

      const pool = await getDbPool();

      const existingUser = await pool
        .request()
        .input('email', sql.NVarChar(320), emailTrim)
        .query(`SELECT id FROM seguridad.usuario WHERE email = @email AND activo = 1;`);

      let usuarioId = existingUser.recordset[0]?.id as number | undefined;

      if (!usuarioId) {
        if (typeof nombre !== 'string' || nombre.trim().length === 0) {
          res.status(400).json({
            error: 'validation_error',
            message: 'nombre is required to pre-register a new user (no active user exists with that email).'
          });
          return;
        }

        const createUser = await pool
          .request()
          .input('email', sql.NVarChar(320), emailTrim)
          .input('nombre', sql.NVarChar(200), nombre.trim())
          .query(`
            INSERT INTO seguridad.usuario (email, nombre, es_admin_sistema, activo, created_at)
            OUTPUT INSERTED.id
            VALUES (@email, @nombre, 0, 1, SYSUTCDATETIME());
          `);

        usuarioId = createUser.recordset[0].id;
      }

      const result = await pool
        .request()
        .input('usuario_id', sql.BigInt, usuarioId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rol_codigo', sql.NVarChar(20), rol)
        .query(`
          IF EXISTS (
            SELECT 1 FROM seguridad.usuario_proyecto_rol
            WHERE usuario_id = @usuario_id
              AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND activo = 1
          )
          BEGIN
            THROW 55801, 'Ese usuario ya tiene una asignación activa en este proyecto.', 1;
          END;

          DECLARE @nuevas TABLE (usuario_id BIGINT, proyecto_id BIGINT, rol_id BIGINT, activo BIT, created_at DATETIME2, updated_at DATETIME2);

          INSERT INTO seguridad.usuario_proyecto_rol (usuario_id, proyecto_id, rol_id, activo, created_at)
          OUTPUT INSERTED.usuario_id, INSERTED.proyecto_id, INSERTED.rol_id, INSERTED.activo, INSERTED.created_at, INSERTED.updated_at
          INTO @nuevas
          SELECT @usuario_id, TRY_CONVERT(BIGINT, @proyecto_id), r.id, 1, SYSUTCDATETIME()
          FROM seguridad.rol r
          WHERE r.codigo = @rol_codigo;

          SELECT
            n.usuario_id, u.email, u.nombre, n.proyecto_id, r.codigo AS rol_codigo,
            n.activo, n.created_at, n.updated_at
          FROM @nuevas n
          JOIN seguridad.usuario u ON u.id = n.usuario_id
          JOIN seguridad.rol r ON r.id = n.rol_id;
        `);

      res
        .status(201)
        .location(`/api/projects/${projectId}/members/${usuarioId}`)
        .json({ member: serialize(result.recordset[0]) });

    } catch (error) {
      const mapped = mapMemberSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/members/:userId
 *
 * Body: { rol }. Desactiva la asignación vigente y crea una nueva con el
 * rol indicado — no es un UPDATE en el sitio (ver cabecera del archivo).
 */
membersRouter.patch(
  '/:userId',
  requireProjectPermission('administer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = normalizeParam(req.params.userId);

      if (!isPositiveIntString(userId)) {
        res.status(400).json({ error: 'invalid_user_id', message: 'userId must be a positive integer.' });
        return;
      }

      const { rol } = req.body ?? {};

      if (typeof rol !== 'string' || !VALID_ROLES.includes(rol as any)) {
        res.status(400).json({ error: 'validation_error', message: `rol must be one of: ${VALID_ROLES.join(', ')}.` });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('usuario_id', sql.NVarChar(30), userId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rol_codigo', sql.NVarChar(20), rol)
        .query(`
          IF NOT EXISTS (
            SELECT 1 FROM seguridad.usuario_proyecto_rol
            WHERE usuario_id = TRY_CONVERT(BIGINT, @usuario_id)
              AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND activo = 1
          )
          BEGIN
            THROW 55802, 'El usuario no tiene una asignación activa en este proyecto.', 1;
          END;

          UPDATE seguridad.usuario_proyecto_rol
          SET activo = 0, updated_at = SYSUTCDATETIME()
          WHERE usuario_id = TRY_CONVERT(BIGINT, @usuario_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          DECLARE @nuevas TABLE (usuario_id BIGINT, proyecto_id BIGINT, rol_id BIGINT, activo BIT, created_at DATETIME2, updated_at DATETIME2);

          INSERT INTO seguridad.usuario_proyecto_rol (usuario_id, proyecto_id, rol_id, activo, created_at)
          OUTPUT INSERTED.usuario_id, INSERTED.proyecto_id, INSERTED.rol_id, INSERTED.activo, INSERTED.created_at, INSERTED.updated_at
          INTO @nuevas
          SELECT TRY_CONVERT(BIGINT, @usuario_id), TRY_CONVERT(BIGINT, @proyecto_id), r.id, 1, SYSUTCDATETIME()
          FROM seguridad.rol r
          WHERE r.codigo = @rol_codigo;

          SELECT
            n.usuario_id, u.email, u.nombre, n.proyecto_id, r.codigo AS rol_codigo,
            n.activo, n.created_at, n.updated_at
          FROM @nuevas n
          JOIN seguridad.usuario u ON u.id = n.usuario_id
          JOIN seguridad.rol r ON r.id = n.rol_id;
        `);

      res.status(200).json({ member: serialize(result.recordset[0]) });

    } catch (error) {
      const mapped = mapMemberSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/members/:userId
 *
 * Revoca el acceso de ese usuario a ESTE proyecto únicamente — no toca su
 * registro global (para eso está DELETE /api/users/:id).
 */
membersRouter.delete(
  '/:userId',
  requireProjectPermission('administer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = normalizeParam(req.params.userId);

      if (!isPositiveIntString(userId)) {
        res.status(400).json({ error: 'invalid_user_id', message: 'userId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('usuario_id', sql.NVarChar(30), userId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          DECLARE @desactivados TABLE (usuario_id BIGINT, proyecto_id BIGINT, activo BIT, updated_at DATETIME2);

          UPDATE seguridad.usuario_proyecto_rol
          SET activo = 0, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.usuario_id, INSERTED.proyecto_id, INSERTED.activo, INSERTED.updated_at
          INTO @desactivados
          WHERE usuario_id = TRY_CONVERT(BIGINT, @usuario_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'member_not_found', message: 'User does not have an active assignment in this project.' });
        return;
      }

      res.status(200).json({
        member: {
          usuarioId: String(row.usuario_id),
          projectId: String(row.proyecto_id),
          active: Boolean(row.activo),
          updatedAt: row.updated_at
        }
      });

    } catch (error) {
      next(error);
    }
  }
);
