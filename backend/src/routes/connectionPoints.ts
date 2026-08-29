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
 * nucleo.punto_conexion — un terminal físico, dueño de exactamente uno de
 * instrumento/equipo/caja/gabinete/modulo (CK_punto_conexion_pertenencia_xor,
 * 5 opciones; gabinete ex rio, migración 012). Sin trigger en INSERT; sí en UPDATE
 * (TR_punto_conexion_validar_desactivacion, 51020): no se puede desactivar
 * un punto usado por un TRAMO_CONEXION activo como origen o destino.
 */
export const connectionPointsRouter = Router({ mergeParams: true });

connectionPointsRouter.use(authenticate);


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

const OWNER_FIELDS = ['instrumentoId', 'equipoId', 'cajaId', 'gabineteId', 'moduloId'] as const;
type OwnerField = (typeof OWNER_FIELDS)[number];

const OWNER_COLUMN: Record<OwnerField, string> = {
  instrumentoId: 'instrumento_id',
  equipoId: 'equipo_id',
  cajaId: 'caja_id',
  gabineteId: 'gabinete_id',
  moduloId: 'modulo_id'
};

const FK_FIELD_BY_CONSTRAINT: Record<string, string> = {
  FK_punto_conexion_instrumento: 'instrumentoId',
  FK_punto_conexion_equipo: 'equipoId',
  FK_punto_conexion_caja: 'cajaId',
  FK_punto_conexion_gabinete: 'gabineteId',
  FK_punto_conexion_modulo: 'moduloId'
};

function mapConnectionPointSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  if (number === 55201) {
    return { status: 404, body: { error: 'connection_point_not_found', message: 'El punto de conexión no existe en este proyecto o está inactivo.' } };
  }

  if (number === 51020) {
    return {
      status: 409,
      body: { error: 'connection_point_in_use', message: 'No se puede desactivar un punto de conexión utilizado por un tramo de conexión activo.' }
    };
  }

  if (message.includes('CK_punto_conexion_pertenencia_xor')) {
    return {
      status: 400,
      body: { error: 'validation_error', message: 'El punto de conexión debe pertenecer a exactamente uno de instrumentoId, equipoId, cajaId, gabineteId o moduloId.' }
    };
  }

  if (number === 547) {
    for (const [constraint, field] of Object.entries(FK_FIELD_BY_CONSTRAINT)) {
      if (message.includes(constraint)) {
        return { status: 400, body: { error: 'invalid_reference', message: `${field} no existe, está inactivo, o no pertenece a este proyecto.` } };
      }
    }
  }

  return null;
}

function serialize(row: Record<string, any>) {
  const nullableId = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    instrumentoId: nullableId(row.instrumento_id),
    equipoId: nullableId(row.equipo_id),
    cajaId: nullableId(row.caja_id),
    gabineteId: nullableId(row.gabinete_id),
    moduloId: nullableId(row.modulo_id),
    regleta: row.regleta,
    bornera: row.bornera,
    borne: row.borne,
    lado: row.lado,
    circuito: row.circuito,
    hilo: row.hilo,
    descripcion: row.descripcion,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'proyecto_id', 'instrumento_id', 'equipo_id', 'caja_id', 'gabinete_id', 'modulo_id',
  'regleta', 'bornera', 'borne', 'lado', 'circuito', 'hilo', 'descripcion', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/projects/:projectId/connection-points
 * Filtros opcionales: instrumentoId, equipoId, cajaId, gabineteId, moduloId.
 */
connectionPointsRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      const filters: string[] = [];

      for (const field of OWNER_FIELDS) {
        const value = normalizeParam(req.query[field] as string | string[] | undefined);
        if (value === undefined) continue;

        if (!isPositiveIntString(value)) {
          res.status(400).json({ error: `invalid_${field}`, message: `${field} filter must be a positive integer.` });
          return;
        }

        request.input(field, sql.NVarChar(30), value);
        filters.push(`AND ${OWNER_COLUMN[field]} = TRY_CONVERT(BIGINT, @${field})`);
      }

      const result = await request.query(`
        SELECT ${COLUMNS}
        FROM nucleo.punto_conexion
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${filters.join('\n          ')}
        ORDER BY id;
      `);

      res.status(200).json({ projectId, connectionPoints: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/connection-points/:pointId
 */
connectionPointsRouter.get(
  '/:pointId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pointId = normalizeParam(req.params.pointId);

      if (!isPositiveIntString(pointId)) {
        res.status(400).json({ error: 'invalid_point_id', message: 'pointId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('punto_id', sql.NVarChar(30), pointId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.punto_conexion
          WHERE id = TRY_CONVERT(BIGINT, @punto_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'connection_point_not_found', message: 'Connection point does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ connectionPoint: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/connection-points
 */
connectionPointsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = req.body ?? {};

      const owners: Partial<Record<OwnerField, string>> = {};
      for (const field of OWNER_FIELDS) {
        if (body[field] !== undefined && body[field] !== null) {
          if (!isPositiveIntString(body[field])) {
            res.status(400).json({ error: 'validation_error', message: `${field} must be a numeric id.` });
            return;
          }
          owners[field] = body[field];
        }
      }

      if (Object.keys(owners).length !== 1) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Debe indicarse exactamente uno de instrumentoId, equipoId, cajaId, gabineteId o moduloId.'
        });
        return;
      }

      const stringFields: Array<{ name: string; value: unknown; max: number }> = [
        { name: 'regleta', value: body.regleta ?? null, max: 30 },
        { name: 'bornera', value: body.bornera ?? null, max: 30 },
        { name: 'borne', value: body.borne ?? null, max: 30 },
        { name: 'lado', value: body.lado ?? null, max: 20 },
        { name: 'circuito', value: body.circuito ?? null, max: 30 },
        { name: 'hilo', value: body.hilo ?? null, max: 30 },
        { name: 'descripcion', value: body.descripcion ?? null, max: 200 }
      ];

      for (const field of stringFields) {
        if (field.value !== null && typeof field.value !== 'string') {
          res.status(400).json({ error: 'validation_error', message: `${field.name} must be a string or null.` });
          return;
        }
        if (typeof field.value === 'string' && field.value.length > field.max) {
          res.status(400).json({ error: 'validation_error', message: `${field.name} cannot exceed ${field.max} characters.` });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId);

      for (const field of OWNER_FIELDS) {
        request.input(field, sql.NVarChar(30), owners[field] ?? null);
      }
      for (const field of stringFields) {
        request.input(field.name, sql.NVarChar(field.max), field.value);
      }

      const result = await request.query(`
        INSERT INTO nucleo.punto_conexion (
          proyecto_id, instrumento_id, equipo_id, caja_id, gabinete_id, modulo_id,
          regleta, bornera, borne, lado, circuito, hilo, descripcion,
          activo, created_at, created_by
        )
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        VALUES (
          TRY_CONVERT(BIGINT, @proyecto_id),
          TRY_CONVERT(BIGINT, @instrumentoId),
          TRY_CONVERT(BIGINT, @equipoId),
          TRY_CONVERT(BIGINT, @cajaId),
          TRY_CONVERT(BIGINT, @gabineteId),
          TRY_CONVERT(BIGINT, @moduloId),
          @regleta, @bornera, @borne, @lado, @circuito, @hilo, @descripcion,
          1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
        );
      `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/connection-points/${String(row.id)}`)
        .json({ connectionPoint: serialize(row) });

    } catch (error) {
      const mapped = mapConnectionPointSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/connection-points/:pointId
 *
 * Solo los campos descriptivos (regleta/bornera/borne/lado/circuito/hilo/
 * descripcion). El dueño (instrumento/equipo/caja/gabinete/modulo) no es
 * editable aquí: cambiar de dueño un punto ya usado en una ruta activa
 * dejaría el tramo apuntando a un terminal físico distinto sin que la
 * ruta se haya vuelto a validar contra ese cambio.
 */
connectionPointsRouter.patch(
  '/:pointId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const pointId = normalizeParam(req.params.pointId);

      if (!isPositiveIntString(pointId)) {
        res.status(400).json({ error: 'invalid_point_id', message: 'pointId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        regleta: { column: 'regleta', max: 30 },
        bornera: { column: 'bornera', max: 30 },
        borne: { column: 'borne', max: 30 },
        lado: { column: 'lado', max: 20 },
        circuito: { column: 'circuito', max: 30 },
        hilo: { column: 'hilo', max: 30 },
        descripcion: { column: 'descripcion', max: 200 }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      for (const key of keys) {
        const value = body[key];
        const config = allowedFields[key];

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
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('punto_id', sql.NVarChar(30), pointId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, sql.NVarChar(config.max), body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      const result = await request.query(`
        DECLARE @actualizados TABLE (
          id BIGINT, proyecto_id BIGINT, instrumento_id BIGINT, equipo_id BIGINT,
          caja_id BIGINT, gabinete_id BIGINT, modulo_id BIGINT,
          regleta NVARCHAR(30), bornera NVARCHAR(30), borne NVARCHAR(30), lado NVARCHAR(20),
          circuito NVARCHAR(30), hilo NVARCHAR(30), descripcion NVARCHAR(200), activo BIT,
          created_at DATETIME2, updated_at DATETIME2, created_by BIGINT, updated_by BIGINT
        );

        IF NOT EXISTS (
          SELECT 1 FROM nucleo.punto_conexion
          WHERE id = TRY_CONVERT(BIGINT, @punto_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 55201, 'El punto de conexión no existe en este proyecto o está inactivo.', 1;
        END;

        UPDATE nucleo.punto_conexion
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        INTO @actualizados
        WHERE id = TRY_CONVERT(BIGINT, @punto_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;

        SELECT * FROM @actualizados;
      `);

      res.status(200).json({ connectionPoint: serialize(result.recordset[0]) });

    } catch (error) {
      const mapped = mapConnectionPointSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/connection-points/:pointId
 *
 * Bloqueada por TR_punto_conexion_validar_desactivacion (51020) si un
 * TRAMO_CONEXION activo usa este punto como origen o destino.
 */
connectionPointsRouter.delete(
  '/:pointId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const pointId = normalizeParam(req.params.pointId);

      if (!isPositiveIntString(pointId)) {
        res.status(400).json({ error: 'invalid_point_id', message: 'pointId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('punto_id', sql.NVarChar(30), pointId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivados TABLE (
            id BIGINT, proyecto_id BIGINT, activo BIT, updated_at DATETIME2, updated_by BIGINT
          );

          UPDATE nucleo.punto_conexion
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.activo, INSERTED.updated_at, INSERTED.updated_by
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @punto_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'connection_point_not_found', message: 'Connection point does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        connectionPoint: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const mapped = mapConnectionPointSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);
