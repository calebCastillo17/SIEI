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
            tag_anterior,
            tecnologia,
            funcionamiento,
            cuerpo_instrumento,
            conexion_proceso,
            plano_pnid,
            linea_pnid,
            tipo_senal_pnid,
            equipo_asociado_id,
            equipo_asociado_tag,
            instrumento_asociado_id,
            instrumento_asociado_tag,
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

          tagAnterior: row.tag_anterior,
          tecnologia: row.tecnologia,
          funcionamiento: row.funcionamiento,
          cuerpoInstrumento: row.cuerpo_instrumento,
          conexionProceso: row.conexion_proceso,
          planoPnid: row.plano_pnid,
          lineaPnid: row.linea_pnid,
          tipoSenalPnid: row.tipo_senal_pnid,
          equipoAsociadoId:
            row.equipo_asociado_id === null ? null : String(row.equipo_asociado_id),
          equipoAsociadoTag: row.equipo_asociado_tag,
          instrumentoAsociadoId:
            row.instrumento_asociado_id === null ? null : String(row.instrumento_asociado_id),
          instrumentoAsociadoTag: row.instrumento_asociado_tag,

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
            tag_anterior,
            tecnologia,
            funcionamiento,
            cuerpo_instrumento,
            conexion_proceso,
            plano_pnid,
            linea_pnid,
            tipo_senal_pnid,
            equipo_asociado_id,
            equipo_asociado_tag,
            instrumento_asociado_id,
            instrumento_asociado_tag,
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

          tagAnterior: row.tag_anterior,
          tecnologia: row.tecnologia,
          funcionamiento: row.funcionamiento,
          cuerpoInstrumento: row.cuerpo_instrumento,
          conexionProceso: row.conexion_proceso,
          planoPnid: row.plano_pnid,
          lineaPnid: row.linea_pnid,
          tipoSenalPnid: row.tipo_senal_pnid,
          equipoAsociadoId:
            row.equipo_asociado_id === null ? null : String(row.equipo_asociado_id),
          equipoAsociadoTag: row.equipo_asociado_tag,
          instrumentoAsociadoId:
            row.instrumento_asociado_id === null ? null : String(row.instrumento_asociado_id),
          instrumentoAsociadoTag: row.instrumento_asociado_tag,

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

      const body = req.body ?? {};

      /*
       * pnpid / fuentePnpid dejan de ser un input humano a partir de la
       * importación P&ID (ver database/migrations/004_pnid_import.sql):
       * solo el flujo de import los administra. Un instrumento manual
       * puede seguir existiendo con pnpid NULL indefinidamente.
       */
      for (const forbidden of ['pnpid', 'fuentePnpid']) {
        if (forbidden in body) {
          res.status(400).json({
            error: 'validation_error',
            message: `${forbidden} cannot be set through this endpoint — lo administra la importación P&ID.`
          });
          return;
        }
      }

      const {
        tagInstrumento,
        descripcion = null,
        tipoInstrumento = null,
        servicio = null,
        sistema = null,
        ubicacion = null,
        nodo = null,
        tagAnterior = null,
        tecnologia = null,
        funcionamiento = null,
        cuerpoInstrumento = null,
        conexionProceso = null,
        planoPnid = null,
        lineaPnid = null,
        tipoSenalPnid = null,
        equipoAsociadoId = null,
        equipoAsociadoTag = null,
        instrumentoAsociadoId = null,
        instrumentoAsociadoTag = null
      } = body;

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

      if (
        equipoAsociadoId !== null &&
        equipoAsociadoId !== undefined &&
        !/^\d+$/.test(String(equipoAsociadoId))
      ) {
        res.status(400).json({
          error: 'validation_error',
          message: 'equipoAsociadoId must be a numeric id or null.'
        });
        return;
      }

      if (
        instrumentoAsociadoId !== null &&
        instrumentoAsociadoId !== undefined &&
        !/^\d+$/.test(String(instrumentoAsociadoId))
      ) {
        res.status(400).json({
          error: 'validation_error',
          message: 'instrumentoAsociadoId must be a numeric id or null.'
        });
        return;
      }

      const optionalFields: Array<{
        name: string;
        value: unknown;
        max: number;
      }> = [
        { name: 'descripcion', value: descripcion, max: 300 },
        { name: 'tipoInstrumento', value: tipoInstrumento, max: 50 },
        { name: 'servicio', value: servicio, max: 200 },
        { name: 'sistema', value: sistema, max: 50 },
        { name: 'ubicacion', value: ubicacion, max: 100 },
        { name: 'nodo', value: nodo, max: 50 },
        { name: 'tagAnterior', value: tagAnterior, max: 50 },
        { name: 'tecnologia', value: tecnologia, max: 100 },
        { name: 'funcionamiento', value: funcionamiento, max: 50 },
        { name: 'cuerpoInstrumento', value: cuerpoInstrumento, max: 50 },
        { name: 'conexionProceso', value: conexionProceso, max: 100 },
        { name: 'planoPnid', value: planoPnid, max: 30 },
        { name: 'lineaPnid', value: lineaPnid, max: 100 },
        { name: 'tipoSenalPnid', value: tipoSenalPnid, max: 50 },
        { name: 'equipoAsociadoTag', value: equipoAsociadoTag, max: 50 },
        { name: 'instrumentoAsociadoTag', value: instrumentoAsociadoTag, max: 50 }
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
        .input('descripcion', sql.NVarChar(300), descripcion)
        .input('tipo_instrumento', sql.NVarChar(50), tipoInstrumento)
        .input('servicio', sql.NVarChar(200), servicio)
        .input('sistema', sql.NVarChar(50), sistema)
        .input('ubicacion', sql.NVarChar(100), ubicacion)
        .input('nodo', sql.NVarChar(50), nodo)
        .input('tag_anterior', sql.NVarChar(50), tagAnterior)
        .input('tecnologia', sql.NVarChar(100), tecnologia)
        .input('funcionamiento', sql.NVarChar(50), funcionamiento)
        .input('cuerpo_instrumento', sql.NVarChar(50), cuerpoInstrumento)
        .input('conexion_proceso', sql.NVarChar(100), conexionProceso)
        .input('plano_pnid', sql.NVarChar(30), planoPnid)
        .input('linea_pnid', sql.NVarChar(100), lineaPnid)
        .input('tipo_senal_pnid', sql.NVarChar(50), tipoSenalPnid)
        .input('equipo_asociado_id', sql.NVarChar(30), equipoAsociadoId)
        .input('equipo_asociado_tag', sql.NVarChar(50), equipoAsociadoTag)
        .input('instrumento_asociado_id', sql.NVarChar(30), instrumentoAsociadoId)
        .input('instrumento_asociado_tag', sql.NVarChar(50), instrumentoAsociadoTag)

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
            descripcion,
            tipo_instrumento,
            servicio,
            sistema,
            ubicacion,
            nodo,
            tag_anterior,
            tecnologia,
            funcionamiento,
            cuerpo_instrumento,
            conexion_proceso,
            plano_pnid,
            linea_pnid,
            tipo_senal_pnid,
            equipo_asociado_id,
            equipo_asociado_tag,
            instrumento_asociado_id,
            instrumento_asociado_tag,
            activo,
            created_at,
            created_by
          )
          OUTPUT
            INSERTED.id,
            INSERTED.proyecto_id,
            INSERTED.tag_instrumento,
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
            @descripcion,
            @tipo_instrumento,
            @servicio,
            @sistema,
            @ubicacion,
            @nodo,
            @tag_anterior,
            @tecnologia,
            @funcionamiento,
            @cuerpo_instrumento,
            @conexion_proceso,
            @plano_pnid,
            @linea_pnid,
            @tipo_senal_pnid,
            TRY_CONVERT(BIGINT, @equipo_asociado_id),
            @equipo_asociado_tag,
            TRY_CONVERT(BIGINT, @instrumento_asociado_id),
            @instrumento_asociado_tag,
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

      if (number === 547) {
        res.status(400).json({
          error: 'invalid_reference',
          message:
            'equipoAsociadoId/instrumentoAsociadoId does not exist, is inactive, or does not belong to this project.'
        });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/instruments/:instrumentId
 *
 * Modifica parcialmente un instrumento.
 * Requiere permiso WRITE.
 */
instrumentsRouter.patch(
  '/:instrumentId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const instrumentId = normalizeParam(req.params.instrumentId);

      if (!instrumentId || !/^\d+$/.test(instrumentId)) {
        res.status(400).json({
          error: 'invalid_instrument_id',
          message: 'instrumentId must be a positive integer.'
        });
        return;
      }

      const allowedFields = {
        tagInstrumento: {
          column: 'tag_instrumento',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        descripcion: {
          column: 'descripcion',
          sqlType: sql.NVarChar(300),
          max: 300
        },
        tipoInstrumento: {
          column: 'tipo_instrumento',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        servicio: {
          column: 'servicio',
          sqlType: sql.NVarChar(200),
          max: 200
        },
        sistema: {
          column: 'sistema',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        ubicacion: {
          column: 'ubicacion',
          sqlType: sql.NVarChar(100),
          max: 100
        },
        nodo: {
          column: 'nodo',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        tagAnterior: {
          column: 'tag_anterior',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        tecnologia: {
          column: 'tecnologia',
          sqlType: sql.NVarChar(100),
          max: 100
        },
        funcionamiento: {
          column: 'funcionamiento',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        cuerpoInstrumento: {
          column: 'cuerpo_instrumento',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        conexionProceso: {
          column: 'conexion_proceso',
          sqlType: sql.NVarChar(100),
          max: 100
        },
        planoPnid: {
          column: 'plano_pnid',
          sqlType: sql.NVarChar(30),
          max: 30
        },
        lineaPnid: {
          column: 'linea_pnid',
          sqlType: sql.NVarChar(100),
          max: 100
        },
        tipoSenalPnid: {
          column: 'tipo_senal_pnid',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        equipoAsociadoTag: {
          column: 'equipo_asociado_tag',
          sqlType: sql.NVarChar(50),
          max: 50
        },
        instrumentoAsociadoTag: {
          column: 'instrumento_asociado_tag',
          sqlType: sql.NVarChar(50),
          max: 50
        }
      } as const;

      const body = req.body ?? {};

      /*
       * pnpid / fuentePnpid: ver mismo comentario que en POST — a partir
       * de la importación P&ID, solo ese flujo los administra.
       */
      for (const forbidden of ['pnpid', 'fuentePnpid']) {
        if (forbidden in body) {
          res.status(400).json({
            error: 'validation_error',
            message: `${forbidden} cannot be set through this endpoint — lo administra la importación P&ID.`
          });
          return;
        }
      }

      const hasEquipoAsociadoId = 'equipoAsociadoId' in body;
      if (hasEquipoAsociadoId) {
        const value = body.equipoAsociadoId;
        if (value !== null && !/^\d+$/.test(String(value))) {
          res.status(400).json({
            error: 'validation_error',
            message: 'equipoAsociadoId must be a numeric id or null.'
          });
          return;
        }
      }

      const hasInstrumentoAsociadoId = 'instrumentoAsociadoId' in body;
      if (hasInstrumentoAsociadoId) {
        const value = body.instrumentoAsociadoId;
        if (value !== null && !/^\d+$/.test(String(value))) {
          res.status(400).json({
            error: 'validation_error',
            message: 'instrumentoAsociadoId must be a numeric id or null.'
          });
          return;
        }
        // Un instrumento no puede asociarse a sí mismo (ver
        // CK_instrumento_asociado_no_self, database/migrations/
        // 005_instrumento_asociado.sql) — se valida acá también para dar
        // un 400 claro en vez de un 500 por violación de CHECK.
        if (value !== null && String(value) === instrumentId) {
          res.status(400).json({
            error: 'validation_error',
            message: 'instrumentoAsociadoId cannot be the instrument itself.'
          });
          return;
        }
      }

      const keys = Object.keys(body).filter(
        (key) => key in allowedFields
      ) as Array<keyof typeof allowedFields>;

      if (keys.length === 0 && !hasEquipoAsociadoId && !hasInstrumentoAsociadoId) {
        res.status(400).json({
          error: 'validation_error',
          message: 'No editable fields were provided.'
        });
        return;
      }

      /*
       * tagInstrumento no puede ser null ni vacío.
       */
      if ('tagInstrumento' in body) {
        if (
          typeof body.tagInstrumento !== 'string' ||
          body.tagInstrumento.trim().length === 0
        ) {
          res.status(400).json({
            error: 'validation_error',
            message: 'tagInstrumento cannot be empty.'
          });
          return;
        }

        body.tagInstrumento = body.tagInstrumento.trim();
      }

      /*
       * Validar tipos y tamaños.
       */
      for (const key of keys) {
        const value = body[key];
        const config = allowedFields[key];

        if (
          value !== null &&
          typeof value !== 'string'
        ) {
          res.status(400).json({
            error: 'validation_error',
            message: `${key} must be a string or null.`
          });
          return;
        }

        if (
          typeof value === 'string' &&
          value.length > config.max
        ) {
          res.status(400).json({
            error: 'validation_error',
            message: `${key} cannot exceed ${config.max} characters.`
          });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];

      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;

        request.input(
          parameter,
          config.sqlType,
          body[key]
        );

        assignments.push(
          `${config.column} = @${parameter}`
        );
      });

      if (hasEquipoAsociadoId) {
        request.input('equipo_asociado_id', sql.NVarChar(30), body.equipoAsociadoId);
        assignments.push('equipo_asociado_id = TRY_CONVERT(BIGINT, @equipo_asociado_id)');
      }

      if (hasInstrumentoAsociadoId) {
        request.input('instrumento_asociado_id', sql.NVarChar(30), body.instrumentoAsociadoId);
        assignments.push('instrumento_asociado_id = TRY_CONVERT(BIGINT, @instrumento_asociado_id)');
      }

      /*
       * Si cambia el TAG, validar que no exista otro activo
       * con el mismo TAG dentro del proyecto.
       */
      if ('tagInstrumento' in body) {
        request.input(
          'nuevo_tag',
          sql.NVarChar(50),
          body.tagInstrumento
        );
      }

      const tagCheck = 'tagInstrumento' in body
        ? `
          IF EXISTS (
            SELECT 1
            FROM nucleo.instrumento
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_instrumento = @nuevo_tag
              AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @instrumento_id)
          )
          BEGIN
            THROW 53010,
              'Ya existe un instrumento activo con ese TAG en el proyecto.',
              1;
          END;
        `
        : '';

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1
          FROM nucleo.instrumento
          WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 53011,
            'El instrumento no existe en este proyecto o está inactivo.',
            1;
        END;

        ${tagCheck}

        UPDATE nucleo.instrumento
        SET
          ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
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
          INSERTED.updated_at,
          INSERTED.created_by,
          INSERTED.updated_by
        WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      const row = result.recordset[0];

      res.status(200).json({
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
          updatedAt: row.updated_at,

          createdBy:
            row.created_by === null
              ? null
              : String(row.created_by),

          updatedBy:
            row.updated_by === null
              ? null
              : String(row.updated_by)
        }
      });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (
        number === 53010 ||
        number === 2601 ||
        number === 2627
      ) {
        res.status(409).json({
          error: 'instrument_tag_conflict',
          message:
            'An active instrument with this TAG already exists in the project.'
        });
        return;
      }

      if (number === 53011) {
        res.status(404).json({
          error: 'instrument_not_found',
          message:
            'Instrument does not exist in this project or is inactive.'
        });
        return;
      }

      if (number === 547) {
        res.status(400).json({
          error: 'invalid_reference',
          message:
            'equipoAsociadoId/instrumentoAsociadoId does not exist, is inactive, or does not belong to this project.'
        });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/instruments/:instrumentId
 *
 * Desactivación lógica.
 * No elimina físicamente el instrumento.
 *
 * Requiere permiso DEACTIVATE.
 */
instrumentsRouter.delete(
  '/:instrumentId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

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
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.instrumento
          SET
            activo = 0,
            updated_at = SYSUTCDATETIME(),
            updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT
            INSERTED.id,
            INSERTED.proyecto_id,
            INSERTED.tag_instrumento,
            INSERTED.activo,
            INSERTED.updated_at,
            INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({
          error: 'instrument_not_found',
          message:
            'Instrument does not exist in this project or is already inactive.'
        });
        return;
      }

      res.status(200).json({
        instrument: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagInstrumento: row.tag_instrumento,
          active: Boolean(row.activo),

          updatedAt: row.updated_at,

          updatedBy:
            row.updated_by === null
              ? null
              : String(row.updated_by)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);
