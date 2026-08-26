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
 * nucleo.ruta_conexion + nucleo.tramo_conexion — la ruta física completa
 * de una señal CONTROL: INSTRUMENTO/EQUIPO -> 0..N CAJAS -> RIO/MODULO.
 *
 * REGLA NO NEGOCIABLE (ver CLAUDE.md "Key modelling decisions" y el
 * comentario de TR_tramo_conexion_validar_secuencia en la migración):
 * TR_tramo_conexion_validar_secuencia revalida el conjunto ACTIVO completo
 * de tramos de una ruta después de CADA sentencia. Si los tramos se
 * insertaran uno por uno, el estado intermedio (solo el primer tramo,
 * terminando en una CAJA) sería rechazado por "el último tramo no termina
 * en RIO/MODULO" (51007) antes de poder insertar el segundo. Por eso
 * POST /routes inserta TODOS los tramos de la ruta en un único INSERT
 * multi-fila, dentro de una transacción explícita junto con el INSERT de
 * ruta_conexion — si cualquier tramo falla su validación, la transacción
 * completa se revierte (incluida la ruta recién creada), no queda una ruta
 * huérfana sin tramos.
 *
 * No hay PATCH: "reconectar" una ruta es desactivarla y crear una nueva
 * (ver docs/MODELO_FISICO_SIEI.md — reactivar una ruta NO reactiva sus
 * tramos automáticamente, porque el par_conductor que usaban pudo haberse
 * ocupado en el ínterin). Editar tramos de una ruta ya activa en el sitio
 * caería en la misma trampa de validación por-sentencia que crearlos uno
 * por uno.
 */
export const connectionRoutesRouter = Router({ mergeParams: true });

connectionRoutesRouter.use(authenticate);


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

const TRAMO_FK_FIELD_BY_CONSTRAINT: Record<string, string> = {
  FK_tramo_conexion_par_conductor: 'parConductorId',
  FK_tramo_conexion_punto_origen: 'puntoOrigenId',
  FK_tramo_conexion_punto_destino: 'puntoDestinoId'
};

function mapRouteSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  // ruta_conexion
  if (message.includes('UX_ruta_conexion_senal_id')) {
    return { status: 409, body: { error: 'route_signal_conflict', message: 'Esa señal ya tiene una ruta de conexión activa.' } };
  }
  if (message.includes('FK_ruta_conexion_senal')) {
    return { status: 400, body: { error: 'invalid_reference', message: 'senalId no existe o no pertenece a este proyecto.' } };
  }
  if (number === 51010) {
    return { status: 409, body: { error: 'route_signal_is_com', message: 'No puede existir una ruta de conexión activa para una señal COM.' } };
  }
  if (number === 51022) {
    return { status: 409, body: { error: 'route_signal_inactive', message: 'Una ruta de conexión activa requiere una señal activa.' } };
  }

  // tramo_conexion — secuencia (TR_tramo_conexion_validar_secuencia)
  if (number === 51004) {
    return { status: 400, body: { error: 'validation_error', message: 'numero_orden no es consecutivo dentro de la ruta.' } };
  }
  if (number === 51005) {
    return { status: 400, body: { error: 'route_sequence_broken', message: 'El destino de un tramo no coincide con el origen del siguiente tramo.' } };
  }
  if (number === 51006) {
    return { status: 400, body: { error: 'route_origin_mismatch', message: 'El origen del primer tramo no corresponde al dueño real de la señal (instrumentoId/equipoId).' } };
  }
  if (number === 51007) {
    return { status: 400, body: { error: 'route_destination_invalid', message: 'El último tramo debe terminar en un punto de conexión de RIO o MODULO.' } };
  }
  if (number === 51015) {
    return { status: 409, body: { error: 'route_resource_inactive', message: 'Un tramo activo no puede usar puntos de conexión o cable inactivos.' } };
  }
  if (number === 51017) {
    return { status: 400, body: { error: 'route_intermediate_not_box', message: 'Un nodo intermedio de la ruta debe corresponder a una CAJA.' } };
  }
  if (number === 51023) {
    return { status: 409, body: { error: 'route_inactive', message: 'Un tramo activo requiere una ruta de conexión activa.' } };
  }

  if (message.includes('CK_tramo_conexion_puntos_distintos')) {
    return { status: 400, body: { error: 'validation_error', message: 'puntoOrigenId y puntoDestinoId no pueden ser el mismo punto en un tramo.' } };
  }
  if (message.includes('CK_tramo_conexion_numero_orden')) {
    return { status: 400, body: { error: 'validation_error', message: 'numero_orden debe ser mayor que 0.' } };
  }
  if (message.includes('UX_tramo_conexion_par_conductor_id')) {
    return { status: 409, body: { error: 'route_conductor_pair_conflict', message: 'Uno de los pares conductores ya está en uso por otro tramo activo.' } };
  }
  if (message.includes('UX_tramo_conexion_orden')) {
    return { status: 409, body: { error: 'route_order_conflict', message: 'Número de orden duplicado dentro de la ruta.' } };
  }

  if (number === 547) {
    for (const [constraint, field] of Object.entries(TRAMO_FK_FIELD_BY_CONSTRAINT)) {
      if (message.includes(constraint)) {
        return { status: 400, body: { error: 'invalid_reference', message: `${field} no existe o no pertenece a este proyecto.` } };
      }
    }
  }

  if (number === 55301) {
    return { status: 404, body: { error: 'route_not_found', message: 'La ruta no existe en este proyecto o está inactiva.' } };
  }

  return null;
}

function serializeRoute(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    senalId: String(row.senal_id),
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

function serializeSegment(row: Record<string, any>) {
  return {
    id: String(row.id),
    routeId: String(row.ruta_conexion_id),
    numeroOrden: row.numero_orden,
    parConductorId: String(row.par_conductor_id),
    puntoOrigenId: String(row.punto_origen_id),
    puntoDestinoId: String(row.punto_destino_id),
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const ROUTE_COLUMNS = 'id, proyecto_id, senal_id, activo, created_at, updated_at, created_by, updated_by';
const SEGMENT_COLUMNS = 'id, ruta_conexion_id, numero_orden, par_conductor_id, punto_origen_id, punto_destino_id, activo, created_at, updated_at, created_by, updated_by';


/*
 * GET /api/projects/:projectId/routes?senalId=
 */
connectionRoutesRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const senalIdFilter = normalizeParam(req.query.senalId as string | string[] | undefined);

      if (senalIdFilter !== undefined && !isPositiveIntString(senalIdFilter)) {
        res.status(400).json({ error: 'invalid_senal_id', message: 'senalId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (senalIdFilter) request.input('senal_id', sql.NVarChar(30), senalIdFilter);

      const result = await request.query(`
        SELECT ${ROUTE_COLUMNS}
        FROM nucleo.ruta_conexion
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${senalIdFilter ? 'AND senal_id = TRY_CONVERT(BIGINT, @senal_id)' : ''}
        ORDER BY id;
      `);

      res.status(200).json({ projectId, routes: result.recordset.map(serializeRoute) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/routes/:routeId
 * Incluye los tramos activos, ordenados.
 */
connectionRoutesRouter.get(
  '/:routeId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const routeId = normalizeParam(req.params.routeId);

      if (!isPositiveIntString(routeId)) {
        res.status(400).json({ error: 'invalid_route_id', message: 'routeId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      const routeResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ruta_id', sql.NVarChar(30), routeId)
        .query(`
          SELECT ${ROUTE_COLUMNS}
          FROM nucleo.ruta_conexion
          WHERE id = TRY_CONVERT(BIGINT, @ruta_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const routeRow = routeResult.recordset[0];

      if (!routeRow) {
        res.status(404).json({ error: 'route_not_found', message: 'Route does not exist in this project or is inactive.' });
        return;
      }

      const segmentsResult = await pool
        .request()
        .input('ruta_id', sql.NVarChar(30), routeId)
        .query(`
          SELECT ${SEGMENT_COLUMNS}
          FROM nucleo.tramo_conexion
          WHERE ruta_conexion_id = TRY_CONVERT(BIGINT, @ruta_id)
            AND activo = 1
          ORDER BY numero_orden;
        `);

      res.status(200).json({
        route: {
          ...serializeRoute(routeRow),
          segments: segmentsResult.recordset.map(serializeSegment)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/routes
 *
 * Body:
 * {
 *   "senalId": "123",
 *   "segments": [
 *     { "parConductorId": "10", "puntoOrigenId": "5", "puntoDestinoId": "6" },
 *     { "parConductorId": "11", "puntoOrigenId": "6", "puntoDestinoId": "7" }
 *   ]
 * }
 *
 * numeroOrden se deriva de la posición en el arreglo (1..N) — no se acepta
 * del cliente, así queda garantizado consecutivo por construcción.
 */
connectionRoutesRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { senalId, segments } = req.body ?? {};

      if (!isPositiveIntString(senalId)) {
        res.status(400).json({ error: 'validation_error', message: 'senalId is required and must be a numeric id.' });
        return;
      }

      if (!Array.isArray(segments) || segments.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'segments is required and must be a non-empty array.' });
        return;
      }

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        for (const field of ['parConductorId', 'puntoOrigenId', 'puntoDestinoId'] as const) {
          if (!isPositiveIntString(seg?.[field])) {
            res.status(400).json({
              error: 'validation_error',
              message: `segments[${i}].${field} is required and must be a numeric id.`
            });
            return;
          }
        }
      }

      const pool = await getDbPool();
      transaction = new sql.Transaction(pool);
      await transaction.begin();

      const rutaRequest = new sql.Request(transaction);
      const rutaResult = await rutaRequest
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('senal_id', sql.NVarChar(30), senalId)
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @nueva_ruta TABLE (id BIGINT);

          INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id, activo, created_at, created_by)
          OUTPUT INSERTED.id INTO @nueva_ruta
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @senal_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));

          SELECT id FROM @nueva_ruta;
        `);

      const routeId = String(rutaResult.recordset[0].id);

      const tramosRequest = new sql.Request(transaction);
      tramosRequest
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ruta_id', sql.NVarChar(30), routeId)
        .input('created_by', sql.NVarChar(30), userId);

      const valuesClauses: string[] = segments.map((seg: any, i: number) => {
        tramosRequest.input(`par_${i}`, sql.NVarChar(30), seg.parConductorId);
        tramosRequest.input(`origen_${i}`, sql.NVarChar(30), seg.puntoOrigenId);
        tramosRequest.input(`destino_${i}`, sql.NVarChar(30), seg.puntoDestinoId);

        return `(
          TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @ruta_id),
          TRY_CONVERT(BIGINT, @par_${i}), TRY_CONVERT(BIGINT, @origen_${i}), TRY_CONVERT(BIGINT, @destino_${i}),
          ${i + 1}, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
        )`;
      });

      // Único INSERT multi-fila para TODOS los tramos — ver comentario de
      // cabecera: es lo que hace posible que la ruta completa se valide de
      // una sola vez contra TR_tramo_conexion_validar_secuencia.
      await tramosRequest.query(`
        INSERT INTO nucleo.tramo_conexion (
          proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id,
          numero_orden, activo, created_at, created_by
        )
        VALUES ${valuesClauses.join(',\n        ')};
      `);

      await transaction.commit();

      const pool2 = await getDbPool();

      const routeResult = await pool2
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ruta_id', sql.NVarChar(30), routeId)
        .query(`SELECT ${ROUTE_COLUMNS} FROM nucleo.ruta_conexion WHERE id = TRY_CONVERT(BIGINT, @ruta_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);`);

      const segmentsResult = await pool2
        .request()
        .input('ruta_id', sql.NVarChar(30), routeId)
        .query(`SELECT ${SEGMENT_COLUMNS} FROM nucleo.tramo_conexion WHERE ruta_conexion_id = TRY_CONVERT(BIGINT, @ruta_id) AND activo = 1 ORDER BY numero_orden;`);

      res
        .status(201)
        .location(`/api/projects/${projectId}/routes/${routeId}`)
        .json({
          route: {
            ...serializeRoute(routeResult.recordset[0]),
            segments: segmentsResult.recordset.map(serializeSegment)
          }
        });

    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch {
          // Un trigger ya pudo haber hecho ROLLBACK TRANSACTION dentro de la
          // propia sentencia (p.ej. TR_tramo_conexion_validar_secuencia) —
          // en ese caso no queda transacción viva que revertir aquí.
        }
      }

      const mapped = mapRouteSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/routes/:routeId
 *
 * Desactivación lógica. TR_ruta_conexion_desactivar_tramos cascada
 * automáticamente a sus TRAMO_CONEXION activos — el backend no lo
 * reimplementa. Los PAR_CONDUCTOR usados quedan libres solo por efecto del
 * índice único filtrado (no requiere acción del backend).
 */
connectionRoutesRouter.delete(
  '/:routeId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const routeId = normalizeParam(req.params.routeId);

      if (!isPositiveIntString(routeId)) {
        res.status(400).json({ error: 'invalid_route_id', message: 'routeId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ruta_id', sql.NVarChar(30), routeId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivadas TABLE (
            id BIGINT, proyecto_id BIGINT, senal_id BIGINT, activo BIT,
            updated_at DATETIME2, updated_by BIGINT
          );

          UPDATE nucleo.ruta_conexion
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.senal_id, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          INTO @desactivadas
          WHERE id = TRY_CONVERT(BIGINT, @ruta_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivadas;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'route_not_found', message: 'Route does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        route: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          senalId: String(row.senal_id),
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const mapped = mapRouteSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);
