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
 * nucleo.cliente — dueño de uno o más PROYECTO. No es un recurso
 * por-proyecto (es lo contrario: un proyecto pertenece a un cliente), y no
 * existe ningún rol "ADMIN de cliente" en el modelo de seguridad — igual
 * que cat.cat_modulo_io, se administra a nivel de sistema
 * (requireSystemAdmin), no con requireProjectPermission.
 *
 * Sin triggers propios. Tiene `activo`, así que sí admite soft delete —
 * pero a diferencia de PROYECTO, desactivar un cliente NO tiene ningún
 * trigger que cascadee a sus proyectos (no existe TR_cliente_*). El
 * backend no inventa esa cascada: es una decisión de negocio a confirmar,
 * no a asumir.
 */
export const clientsRouter = Router();

clientsRouter.use(authenticate);


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
    nombre: row.nombre,
    codigoInterno: row.codigo_interno,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'nombre', 'codigo_interno', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/clients — cualquier usuario autenticado (dato de referencia,
 * no sensible; cada proyecto ya expone su clientId de todas formas).
 */
clientsRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = await getDbPool();
      const result = await pool.request().query(`
        SELECT ${COLUMNS}
        FROM nucleo.cliente
        WHERE activo = 1
        ORDER BY nombre;
      `);

      res.status(200).json({ clients: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/clients/:clientId
 */
clientsRouter.get(
  '/:clientId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = normalizeParam(req.params.clientId);

      if (!clientId || !/^\d+$/.test(clientId)) {
        res.status(400).json({ error: 'invalid_client_id', message: 'clientId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('cliente_id', sql.NVarChar(30), clientId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.cliente
          WHERE id = TRY_CONVERT(BIGINT, @cliente_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'client_not_found', message: 'Client does not exist or is inactive.' });
        return;
      }

      res.status(200).json({ client: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/clients — solo es_admin_sistema.
 */
clientsRouter.post(
  '/',
  requireSystemAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser!.id;
      const { nombre, codigoInterno = null } = req.body ?? {};

      if (typeof nombre !== 'string' || nombre.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'nombre is required.' });
        return;
      }
      const nombreTrim = nombre.trim();
      if (nombreTrim.length > 200) {
        res.status(400).json({ error: 'validation_error', message: 'nombre cannot exceed 200 characters.' });
        return;
      }

      if (codigoInterno !== null && codigoInterno !== undefined && typeof codigoInterno !== 'string') {
        res.status(400).json({ error: 'validation_error', message: 'codigoInterno must be a string or null.' });
        return;
      }
      if (typeof codigoInterno === 'string' && codigoInterno.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'codigoInterno cannot exceed 50 characters.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('created_by', sql.NVarChar(30), userId)
        .input('nombre', sql.NVarChar(200), nombreTrim)
        .input('codigo_interno', sql.NVarChar(50), codigoInterno)
        .query(`
          INSERT INTO nucleo.cliente (nombre, codigo_interno, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.codigo_interno, INSERTED.activo,
                 INSERTED.created_at, INSERTED.created_by
          VALUES (@nombre, @codigo_interno, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/clients/${String(row.id)}`)
        .json({ client: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'client_code_conflict', message: 'An active client with this codigoInterno already exists.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/clients/:clientId — solo es_admin_sistema.
 */
clientsRouter.patch(
  '/:clientId',
  requireSystemAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser!.id;
      const clientId = normalizeParam(req.params.clientId);

      if (!clientId || !/^\d+$/.test(clientId)) {
        res.status(400).json({ error: 'invalid_client_id', message: 'clientId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        nombre: { column: 'nombre', max: 200 },
        codigoInterno: { column: 'codigo_interno', max: 50 }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if ('nombre' in body) {
        if (typeof body.nombre !== 'string' || body.nombre.trim().length === 0) {
          res.status(400).json({ error: 'validation_error', message: 'nombre cannot be empty.' });
          return;
        }
        body.nombre = body.nombre.trim();
      }

      for (const key of keys) {
        const value = body[key];
        const config = allowedFields[key];

        if (key === 'nombre' && (typeof value !== 'string' || value.length === 0)) continue; // ya validado arriba
        if (value !== null && typeof value !== 'string') {
          res.status(400).json({ error: 'validation_error', message: `${key} must be a string or null.` });
          return;
        }
        if (typeof value === 'string' && value.length > config.max) {
          res.status(400).json({ error: 'validation_error', message: `${key} cannot exceed ${config.max} characters.` });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('cliente_id', sql.NVarChar(30), clientId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, sql.NVarChar(config.max), body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.cliente
          WHERE id = TRY_CONVERT(BIGINT, @cliente_id) AND activo = 1
        )
        BEGIN
          THROW 55501, 'El cliente no existe o está inactivo.', 1;
        END;

        UPDATE nucleo.cliente
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.codigo_interno, INSERTED.activo,
               INSERTED.created_at, INSERTED.updated_at, INSERTED.created_by, INSERTED.updated_by
        WHERE id = TRY_CONVERT(BIGINT, @cliente_id)
          AND activo = 1;
      `);

      res.status(200).json({ client: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'client_code_conflict', message: 'An active client with this codigoInterno already exists.' });
        return;
      }
      if (number === 55501) {
        res.status(404).json({ error: 'client_not_found', message: 'Client does not exist or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/clients/:clientId — solo es_admin_sistema.
 *
 * Desactivación lógica. No cascadea a los proyectos del cliente (no hay
 * trigger que lo haga) — sus proyectos quedan tal cual estaban, igual que
 * un proyecto archivado deja tal cual su información de ingeniería.
 */
clientsRouter.delete(
  '/:clientId',
  requireSystemAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser!.id;
      const clientId = normalizeParam(req.params.clientId);

      if (!clientId || !/^\d+$/.test(clientId)) {
        res.status(400).json({ error: 'invalid_client_id', message: 'clientId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('cliente_id', sql.NVarChar(30), clientId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.cliente
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.activo, INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @cliente_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'client_not_found', message: 'Client does not exist or is already inactive.' });
        return;
      }

      res.status(200).json({
        client: {
          id: String(row.id),
          nombre: row.nombre,
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
