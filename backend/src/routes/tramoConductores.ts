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
 * nucleo.tramo_conductor + nucleo.terminacion (migración 015) — qué
 * CONDUCTOR participa en qué TRAMO_CONEXION, y el hecho físico exacto
 * "este conductor, en este tramo, en este extremo, aterriza en esta
 * posición de terminal". Ver docs/DIAGNOSTICO_SENALES_GABINETES.md
 * secciones 36-39.
 *
 * Un conductor admite como máximo un tramo_conductor activo
 * (UX_tramo_conductor_conductor_exclusivo) — el backend no reimplementa
 * esa exclusividad, solo traduce el 2601/2627 resultante. Las
 * validaciones de propietario/canal de una terminación
 * (TR_terminacion_validar_propietario_y_canal) también viven
 * exclusivamente en la base — un intento inválido se traduce aquí, no se
 * previene por adelantado con una consulta extra.
 *
 * No hay PATCH: reasignar el conductor o el tramo de una fila ya creada
 * no tiene un caso de uso claro — se desactiva y se crea de nuevo, igual
 * que nucleo.ruta_conexion.
 */
export const tramoConductoresRouter = Router({ mergeParams: true });

tramoConductoresRouter.use(authenticate);


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

function mapSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);
  if (number === undefined) return null;

  if (message.includes('UX_tramo_conductor_conductor_exclusivo') || number === 2601 || number === 2627) {
    return { status: 409, body: { error: 'conductor_ya_en_uso', message: 'Ese conductor ya participa en otro TRAMO_CONDUCTOR activo.' } };
  }
  if (message.includes('UX_terminacion_tramo_conductor_extremo')) {
    return { status: 409, body: { error: 'terminacion_extremo_conflict', message: 'Ya existe una terminación activa para ese extremo de este tramo_conductor.' } };
  }
  if (message.includes('UX_terminacion_posicion_ocupacion')) {
    return { status: 409, body: { error: 'posicion_ocupada', message: 'Esa posición de terminal ya tiene una terminación activa.' } };
  }
  if (message.includes('CK_terminacion_extremo')) {
    return { status: 400, body: { error: 'validation_error', message: "extremo debe ser 'ORIGEN' o 'DESTINO'." } };
  }
  if (number === 51024) {
    return { status: 409, body: { error: 'terminacion_propietario_incorrecto', message: 'La terminación no pertenece al mismo propietario que el punto_conexion del extremo del tramo (o el extremo es instrumento/equipo, fuera de alcance).' } };
  }
  if (number === 51025) {
    return { status: 409, body: { error: 'terminacion_canal_incorrecto', message: 'La terminación en un terminal de módulo no corresponde al canal real de la señal.' } };
  }
  if (number === 547) {
    return { status: 400, body: { error: 'invalid_reference', message: 'Referencia inválida o de otro proyecto.' } };
  }

  return null;
}

function serializeTramoConductor(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tramoConexionId: String(row.tramo_conexion_id),
    conductorId: String(row.conductor_id),
    active: Boolean(row.activo)
  };
}

function serializeTerminacion(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tramoConductorId: String(row.tramo_conductor_id),
    posicionTerminalId: String(row.posicion_terminal_id),
    extremo: row.extremo,
    active: Boolean(row.activo)
  };
}

async function fetchTramoConductorDetail(pool: Awaited<ReturnType<typeof getDbPool>>, projectId: string, id: string) {
  const result = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('id', sql.NVarChar(30), id)
    .query(`
      SELECT id, proyecto_id, tramo_conexion_id, conductor_id, activo
      FROM nucleo.tramo_conductor
      WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
    `);
  const row = result.recordset[0];
  if (!row) return null;

  const terminacionesResult = await pool
    .request()
    .input('tramo_conductor_id', sql.NVarChar(30), id)
    .query(`
      SELECT id, proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo, activo
      FROM nucleo.terminacion
      WHERE tramo_conductor_id = TRY_CONVERT(BIGINT, @tramo_conductor_id) AND activo = 1
      ORDER BY extremo;
    `);

  return { ...serializeTramoConductor(row), terminaciones: terminacionesResult.recordset.map(serializeTerminacion) };
}


/*
 * GET /api/projects/:projectId/tramo-conductores?tramoConexionId=
 */
tramoConductoresRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const tramoConexionIdFilter = normalizeParam(req.query.tramoConexionId as string | string[] | undefined);

      if (tramoConexionIdFilter !== undefined && !isPositiveIntString(tramoConexionIdFilter)) {
        res.status(400).json({ error: 'validation_error', message: 'tramoConexionId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);
      if (tramoConexionIdFilter) request.input('tramo_conexion_id', sql.NVarChar(30), tramoConexionIdFilter);

      const result = await request.query(`
        SELECT id, proyecto_id, tramo_conexion_id, conductor_id, activo
        FROM nucleo.tramo_conductor
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
          ${tramoConexionIdFilter ? 'AND tramo_conexion_id = TRY_CONVERT(BIGINT, @tramo_conexion_id)' : ''}
        ORDER BY id;
      `);

      res.status(200).json({ projectId, tramosConductores: result.recordset.map(serializeTramoConductor) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/tramo-conductores/:id
 */
tramoConductoresRouter.get(
  '/:id',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const id = normalizeParam(req.params.id);
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const detail = await fetchTramoConductorDetail(pool, projectId, id);
      if (!detail) {
        res.status(404).json({ error: 'tramo_conductor_not_found', message: 'tramo_conductor does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ tramoConductor: detail });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/tramo-conductores
 */
tramoConductoresRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { tramoConexionId, conductorId } = req.body ?? {};

      if (!isPositiveIntString(tramoConexionId)) {
        res.status(400).json({ error: 'validation_error', message: 'tramoConexionId is required and must be a numeric id.' });
        return;
      }
      if (!isPositiveIntString(conductorId)) {
        res.status(400).json({ error: 'validation_error', message: 'conductorId is required and must be a numeric id.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('tramo_conexion_id', sql.NVarChar(30), tramoConexionId)
        .input('conductor_id', sql.NVarChar(30), conductorId)
        .query(`
          INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id, activo, created_at, created_by)
          OUTPUT INSERTED.id
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @tramo_conexion_id), TRY_CONVERT(BIGINT, @conductor_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const newId = String(insertResult.recordset[0].id);
      const detail = await fetchTramoConductorDetail(pool, projectId, newId);

      res
        .status(201)
        .location(`/api/projects/${projectId}/tramo-conductores/${newId}`)
        .json({ tramoConductor: detail });

    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/tramo-conductores/:id
 *
 * Desactivación lógica. TR_tramo_conductor_desactivar_terminaciones
 * cascada automáticamente a sus TERMINACION activas.
 */
tramoConductoresRouter.delete(
  '/:id',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const id = normalizeParam(req.params.id);
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('id', sql.NVarChar(30), id)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          -- TR_tramo_conductor_desactivar_terminaciones es AFTER UPDATE.
          DECLARE @desactivados TABLE (id BIGINT, activo BIT);

          UPDATE nucleo.tramo_conductor
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.activo
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'tramo_conductor_not_found', message: 'tramo_conductor does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ tramoConductor: { id: String(row.id), active: Boolean(row.activo) } });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/tramo-conductores/:id/terminaciones
 *
 * body: { extremo: 'ORIGEN'|'DESTINO', posicionTerminalId }
 */
tramoConductoresRouter.post(
  '/:id/terminaciones',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const tramoConductorId = normalizeParam(req.params.id);
      const { extremo, posicionTerminalId } = req.body ?? {};

      if (!isPositiveIntString(tramoConductorId)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }
      if (extremo !== 'ORIGEN' && extremo !== 'DESTINO') {
        res.status(400).json({ error: 'validation_error', message: "extremo is required and must be 'ORIGEN' or 'DESTINO'." });
        return;
      }
      if (!isPositiveIntString(posicionTerminalId)) {
        res.status(400).json({ error: 'validation_error', message: 'posicionTerminalId is required and must be a numeric id.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('tramo_conductor_id', sql.NVarChar(30), tramoConductorId)
        .input('posicion_terminal_id', sql.NVarChar(30), posicionTerminalId)
        .input('extremo', sql.NVarChar(10), extremo)
        .query(`
          -- nucleo.terminacion tiene TR_terminacion_validar_propietario_y_canal
          -- (AFTER INSERT, UPDATE): OUTPUT sin INTO es el error 334.
          DECLARE @nuevas TABLE (id BIGINT, proyecto_id BIGINT, tramo_conductor_id BIGINT, posicion_terminal_id BIGINT, extremo NVARCHAR(10), activo BIT);

          INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tramo_conductor_id, INSERTED.posicion_terminal_id, INSERTED.extremo, INSERTED.activo
          INTO @nuevas
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @tramo_conductor_id), TRY_CONVERT(BIGINT, @posicion_terminal_id), @extremo, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));

          SELECT * FROM @nuevas;
        `);

      res.status(201).json({ terminacion: serializeTerminacion(insertResult.recordset[0]) });

    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/tramo-conductores/:id/terminaciones/:terminacionId
 */
tramoConductoresRouter.delete(
  '/:id/terminaciones/:terminacionId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const tramoConductorId = normalizeParam(req.params.id);
      const terminacionId = normalizeParam(req.params.terminacionId);
      if (!isPositiveIntString(tramoConductorId)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }
      if (!isPositiveIntString(terminacionId)) {
        res.status(400).json({ error: 'invalid_terminacion_id', message: 'terminacionId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tramo_conductor_id', sql.NVarChar(30), tramoConductorId)
        .input('terminacion_id', sql.NVarChar(30), terminacionId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivadas TABLE (id BIGINT, extremo NVARCHAR(10), activo BIT);

          -- tramo_conductor_id se valida ademas del proyecto: el path
          -- anidado debe operar solo sobre una terminacion que realmente
          -- pertenezca a ese tramo_conductor.
          UPDATE nucleo.terminacion
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.extremo, INSERTED.activo
          INTO @desactivadas
          WHERE id = TRY_CONVERT(BIGINT, @terminacion_id)
            AND tramo_conductor_id = TRY_CONVERT(BIGINT, @tramo_conductor_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;

          SELECT * FROM @desactivadas;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'terminacion_not_found', message: 'Terminación does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ terminacion: { id: String(row.id), extremo: row.extremo, active: Boolean(row.activo) } });

    } catch (error) {
      next(error);
    }
  }
);
