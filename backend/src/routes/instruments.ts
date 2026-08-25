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

export const instrumentsRouter = Router({ mergeParams: true });

instrumentsRouter.use(authenticate);


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


/*
 * GET /api/projects/:projectId/instruments
 */
instrumentsRouter.get(
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
          SELECT
            id,
            proyecto_id,
            estado_pnid_id,
            tag_instrumento,
            pnpid,
            fuente_pnpid,
            descripcion,
            tipo_instrumento,
            servicio,
            sistema,
            ubicacion,
            nodo,
            fecha_agregado,
            fecha_ultima_revision,
            activo,
            created_at,
            updated_at,
            created_by,
            updated_by
          FROM nucleo.instrumento
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY tag_instrumento;
        `);

      res.status(200).json({
        projectId,
        instruments: result.recordset.map((row) => ({
          id: String(row.id),
          projectId: String(row.proyecto_id),
          estadoPnidId:
            row.estado_pnid_id === null ? null : String(row.estado_pnid_id),

          tagInstrumento: row.tag_instrumento,
          pnpid: row.pnpid,
          fuentePnpid: row.fuente_pnpid,
          descripcion: row.descripcion,
          tipoInstrumento: row.tipo_instrumento,
          servicio: row.servicio,
          sistema: row.sistema,
          ubicacion: row.ubicacion,
          nodo: row.nodo,

          fechaAgregado: row.fecha_agregado,
          fechaUltimaRevision: row.fecha_ultima_revision,

          active: Boolean(row.activo),
          createdAt: row.created_at,
          updatedAt: row.updated_at,

          createdBy: row.created_by === null ? null : String(row.created_by),
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }))
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/instruments/:instrumentId
 */
instrumentsRouter.get(
  '/:instrumentId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const instrumentId = normalizeParam(req.params.instrumentId);

      if (!instrumentId || !/^\d+$/.test(instrumentId)) {
        res.status(400).json({
          error: 'invalid_instrument_id',
          message: 'instrumentId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentId)
        .query(`
          SELECT
            id,
            proyecto_id,
            estado_pnid_id,
            tag_instrumento,
            pnpid,
            fuente_pnpid,
            descripcion,
            tipo_instrumento,
            servicio,
            sistema,
            ubicacion,
            nodo,
            fecha_agregado,
            fecha_ultima_revision,
            activo,
            created_at,
            updated_at,
            created_by,
            updated_by
          FROM nucleo.instrumento
          WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({
          error: 'instrument_not_found',
          message: 'Instrument does not exist in this project or is inactive.'
        });
        return;
      }

      res.status(200).json({
        instrument: {
          id: String(row.id),
          projectId: String(row.proyecto_id),

          estadoPnidId:
            row.estado_pnid_id === null ? null : String(row.estado_pnid_id),

          tagInstrumento: row.tag_instrumento,
          pnpid: row.pnpid,
          fuentePnpid: row.fuente_pnpid,
          descripcion: row.descripcion,
          tipoInstrumento: row.tipo_instrumento,
          servicio: row.servicio,
          sistema: row.sistema,
          ubicacion: row.ubicacion,
          nodo: row.nodo,

          fechaAgregado: row.fecha_agregado,
          fechaUltimaRevision: row.fecha_ultima_revision,

          active: Boolean(row.activo),

          createdAt: row.created_at,
          updatedAt: row.updated_at,

          createdBy: row.created_by === null ? null : String(row.created_by),
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/instruments
 *
 * Requiere permiso WRITE.
 */
instrumentsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const {
        tagInstrumento,
        pnpid = null,
        fuentePnpid = null,
        descripcion = null,
        tipoInstrumento = null,
        servicio = null,
        sistema = null,
        ubicacion = null,
        nodo = null
      } = req.body ?? {};

      if (
        typeof tagInstrumento !== 'string' ||
        tagInstrumento.trim().length === 0
      ) {
        res.status(400).json({
          error: 'validation_error',
          message: 'tagInstrumento is required.'
        });
        return;
      }

      const tag = tagInstrumento.trim();

      if (tag.length > 50) {
        res.status(400).json({
          error: 'validation_error',
          message: 'tagInstrumento cannot exceed 50 characters.'
        });
        return;
      }

      const optionalFields: Array<{
        name: string;
        value: unknown;
        max: number;
      }> = [
        { name: 'pnpid', value: pnpid, max: 50 },
        { name: 'fuentePnpid', value: fuentePnpid, max: 50 },
        { name: 'descripcion', value: descripcion, max: 300 },
        { name: 'tipoInstrumento', value: tipoInstrumento, max: 50 },
        { name: 'servicio', value: servicio, max: 200 },
        { name: 'sistema', value: sistema, max: 50 },
        { name: 'ubicacion', value: ubicacion, max: 100 },
        { name: 'nodo', value: nodo, max: 50 }
      ];

      for (const field of optionalFields) {
        if (
          field.value !== null &&
          field.value !== undefined &&
          typeof field.value !== 'string'
        ) {
          res.status(400).json({
            error: 'validation_error',
            message: `${field.name} must be a string or null.`
          });
          return;
        }

        if (
          typeof field.value === 'string' &&
          field.value.length > field.max
        ) {
          res.status(400).json({
            error: 'validation_error',
            message: `${field.name} cannot exceed ${field.max} characters.`
          });
          return;
        }
      }

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)

        .input('tag_instrumento', sql.NVarChar(50), tag)
        .input('pnpid', sql.NVarChar(50), pnpid)
        .input('fuente_pnpid', sql.NVarChar(50), fuentePnpid)
        .input('descripcion', sql.NVarChar(300), descripcion)
        .input('tipo_instrumento', sql.NVarChar(50), tipoInstrumento)
        .input('servicio', sql.NVarChar(200), servicio)
        .input('sistema', sql.NVarChar(50), sistema)
        .input('ubicacion', sql.NVarChar(100), ubicacion)
        .input('nodo', sql.NVarChar(50), nodo)

        .query(`
          IF EXISTS (
            SELECT 1
            FROM nucleo.instrumento
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_instrumento = @tag_instrumento
              AND activo = 1
          )
          BEGIN
            THROW 53010,
              'Ya existe un instrumento activo con ese TAG en el proyecto.',
              1;
          END;

          INSERT INTO nucleo.instrumento (
            proyecto_id,
            tag_instrumento,
            pnpid,
            fuente_pnpid,
            descripcion,
            tipo_instrumento,
            servicio,
            sistema,
            ubicacion,
            nodo,
            activo,
            created_at,
            created_by
          )
          OUTPUT
            INSERTED.id,
            INSERTED.proyecto_id,
            INSERTED.tag_instrumento,
            INSERTED.pnpid,
            INSERTED.descripcion,
            INSERTED.tipo_instrumento,
            INSERTED.servicio,
            INSERTED.sistema,
            INSERTED.ubicacion,
            INSERTED.nodo,
            INSERTED.activo,
            INSERTED.created_at,
            INSERTED.created_by
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id),
            @tag_instrumento,
            @pnpid,
            @fuente_pnpid,
            @descripcion,
            @tipo_instrumento,
            @servicio,
            @sistema,
            @ubicacion,
            @nodo,
            1,
            SYSUTCDATETIME(),
            TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(
          `/api/projects/${projectId}/instruments/${String(row.id)}`
        )
        .json({
          instrument: {
            id: String(row.id),
            projectId: String(row.proyecto_id),
            tagInstrumento: row.tag_instrumento,
            pnpid: row.pnpid,
            descripcion: row.descripcion,
            tipoInstrumento: row.tipo_instrumento,
            servicio: row.servicio,
            sistema: row.sistema,
            ubicacion: row.ubicacion,
            nodo: row.nodo,
            active: Boolean(row.activo),
            createdAt: row.created_at,
            createdBy:
              row.created_by === null ? null : String(row.created_by)
          }
        });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 53010 || number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'instrument_tag_conflict',
          message: 'An active instrument with this TAG already exists in the project.'
        });
        return;
      }

      next(error);
    }
  }
);
