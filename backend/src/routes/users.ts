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
 * seguridad.usuario — el registro global del usuario (email/nombre). No es
 * un recurso por-proyecto: la asignación de ROL por proyecto vive en
 * seguridad.usuario_proyecto_rol y se administra aparte, en
 * /api/projects/:projectId/members (ver members.ts), donde el ADMIN de
 * CADA proyecto puede invitar gente sin ser administrador del sistema.
 *
 * Este router es solo para el registro del usuario en sí — crear/editar/
 * desactivar un usuario a nivel de sistema — y por eso va enteramente
 * detrás de requireSystemAdmin.
 *
 * CRÍTICO (CLAUDE.md, "Security model"): es_admin_sistema es el privilegio
 * más alto del sistema y NO tiene guarda a nivel de base de datos — "the
 * backend must never expose it through a generic user-update endpoint".
 * Por eso ningún campo de POST/PATCH de este router acepta es_admin_sistema
 * ni auth_issuer/auth_subject (esos los gestiona el futuro flujo de login
 * OIDC, no un admin a mano). Si alguna vez hace falta un endpoint para
 * otorgar/revocar es_admin_sistema, tiene que ser uno nuevo, explícito y
 * deliberadamente separado de este — no una ampliación de PATCH /users/:id.
 *
 * seguridad.usuario tiene un trigger AFTER UPDATE
 * (TR_usuario_desactivar_accesos), así que PATCH/DELETE usan el patrón
 * OUTPUT ... INTO. POST no lo necesita (no hay trigger de INSERT).
 */
export const usersRouter = Router();

usersRouter.use(authenticate);
usersRouter.use(requireSystemAdmin);


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
    email: row.email,
    nombre: row.nombre,
    esAdminSistema: Boolean(row.es_admin_sistema),
    hasSignedIn: row.auth_subject !== null,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const COLUMNS = [
  'id', 'email', 'nombre', 'es_admin_sistema', 'auth_subject', 'activo',
  'created_at', 'updated_at'
].join(', ');


/*
 * GET /api/users
 */
usersRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = await getDbPool();
      const result = await pool.request().query(`
        SELECT ${COLUMNS}
        FROM seguridad.usuario
        WHERE activo = 1
        ORDER BY email;
      `);

      res.status(200).json({ users: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/users/:userId
 */
usersRouter.get(
  '/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = normalizeParam(req.params.userId);

      if (!userId || !/^\d+$/.test(userId)) {
        res.status(400).json({ error: 'invalid_user_id', message: 'userId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('usuario_id', sql.NVarChar(30), userId)
        .query(`
          SELECT ${COLUMNS}
          FROM seguridad.usuario
          WHERE id = TRY_CONVERT(BIGINT, @usuario_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'user_not_found', message: 'User does not exist or is inactive.' });
        return;
      }

      res.status(200).json({ user: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/users
 *
 * Crea un usuario "pre-registrado": sin auth_issuer/auth_subject (los
 * completará su primer login OIDC), sin es_admin_sistema (siempre 0 aquí).
 */
usersRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if ('esAdminSistema' in (req.body ?? {})) {
        res.status(400).json({
          error: 'validation_error',
          message: 'esAdminSistema cannot be set through this endpoint.'
        });
        return;
      }

      const { email, nombre } = req.body ?? {};

      if (typeof email !== 'string' || email.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'email is required.' });
        return;
      }
      const emailTrim = email.trim();
      if (emailTrim.length > 320) {
        res.status(400).json({ error: 'validation_error', message: 'email cannot exceed 320 characters.' });
        return;
      }

      if (typeof nombre !== 'string' || nombre.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'nombre is required.' });
        return;
      }
      const nombreTrim = nombre.trim();
      if (nombreTrim.length > 200) {
        res.status(400).json({ error: 'validation_error', message: 'nombre cannot exceed 200 characters.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('email', sql.NVarChar(320), emailTrim)
        .input('nombre', sql.NVarChar(200), nombreTrim)
        .query(`
          INSERT INTO seguridad.usuario (email, nombre, es_admin_sistema, activo, created_at)
          OUTPUT INSERTED.id, INSERTED.email, INSERTED.nombre, INSERTED.es_admin_sistema,
                 INSERTED.auth_subject, INSERTED.activo, INSERTED.created_at
          VALUES (@email, @nombre, 0, 1, SYSUTCDATETIME());
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/users/${String(row.id)}`)
        .json({ user: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'user_email_conflict', message: 'An active user with this email already exists.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/users/:userId
 *
 * Solo email/nombre. NUNCA esAdminSistema, authIssuer o authSubject.
 */
usersRouter.patch(
  '/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = normalizeParam(req.params.userId);

      if (!userId || !/^\d+$/.test(userId)) {
        res.status(400).json({ error: 'invalid_user_id', message: 'userId must be a positive integer.' });
        return;
      }

      const body = req.body ?? {};

      for (const forbidden of ['esAdminSistema', 'authIssuer', 'authSubject']) {
        if (forbidden in body) {
          res.status(400).json({
            error: 'validation_error',
            message: `${forbidden} cannot be set through this endpoint.`
          });
          return;
        }
      }

      const allowedFields = {
        email: { column: 'email', max: 320 },
        nombre: { column: 'nombre', max: 200 }
      } as const;

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

      request.input('usuario_id', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, sql.NVarChar(config.max), body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      const result = await request.query(`
        DECLARE @actualizados TABLE (
          id BIGINT, email NVARCHAR(320), nombre NVARCHAR(200), es_admin_sistema BIT,
          auth_subject NVARCHAR(200), activo BIT, created_at DATETIME2, updated_at DATETIME2
        );

        IF NOT EXISTS (
          SELECT 1 FROM seguridad.usuario
          WHERE id = TRY_CONVERT(BIGINT, @usuario_id) AND activo = 1
        )
        BEGIN
          THROW 55701, 'El usuario no existe o está inactivo.', 1;
        END;

        UPDATE seguridad.usuario
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.id, INSERTED.email, INSERTED.nombre, INSERTED.es_admin_sistema,
               INSERTED.auth_subject, INSERTED.activo, INSERTED.created_at, INSERTED.updated_at
        INTO @actualizados
        WHERE id = TRY_CONVERT(BIGINT, @usuario_id)
          AND activo = 1;

        SELECT * FROM @actualizados;
      `);

      res.status(200).json({ user: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'user_email_conflict', message: 'An active user with this email already exists.' });
        return;
      }
      if (number === 55701) {
        res.status(404).json({ error: 'user_not_found', message: 'User does not exist or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/users/:userId
 *
 * Desactivación GLOBAL: el usuario pierde acceso a TODOS sus proyectos
 * (TR_usuario_desactivar_accesos desactiva en cascada su
 * usuario_proyecto_rol en cada uno). Muy distinto de DELETE
 * /projects/:id/members/:userId (members.ts), que solo revoca el acceso a
 * un proyecto puntual.
 */
usersRouter.delete(
  '/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = normalizeParam(req.params.userId);

      if (!userId || !/^\d+$/.test(userId)) {
        res.status(400).json({ error: 'invalid_user_id', message: 'userId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('usuario_id', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivados TABLE (id BIGINT, email NVARCHAR(320), activo BIT, updated_at DATETIME2);

          UPDATE seguridad.usuario
          SET activo = 0, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id, INSERTED.email, INSERTED.activo, INSERTED.updated_at
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @usuario_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'user_not_found', message: 'User does not exist or is already inactive.' });
        return;
      }

      res.status(200).json({
        user: {
          id: String(row.id),
          email: row.email,
          active: Boolean(row.activo),
          updatedAt: row.updated_at
        }
      });

    } catch (error) {
      next(error);
    }
  }
);
