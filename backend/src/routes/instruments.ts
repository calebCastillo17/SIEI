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
import { calcularOrdenAgrupado } from '../lib/instrumentGrouping.js';

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
            i.id,
            i.proyecto_id,
            i.estado_pnid_id,
            i.tag_instrumento,
            i.pnpid,
            i.fuente_pnpid,
            i.descripcion,
            i.tipo_instrumento,
            i.servicio,
            i.sistema,
            i.ubicacion,
            i.nodo,
            i.tag_anterior,
            i.tecnologia,
            i.funcionamiento,
            i.cuerpo_instrumento,
            i.conexion_proceso,
            i.plano_pnid,
            i.linea_pnid,
            i.tipo_senal_pnid,
            i.equipo_asociado_id,
            i.equipo_asociado_tag,
            i.instrumento_asociado_id,
            i.instrumento_asociado_tag,
            i.fecha_agregado,
            i.fecha_ultima_revision,
            i.activo,
            i.created_at,
            i.updated_at,
            i.created_by,
            i.updated_by,
            -- Agrupamiento por Instrumento Asociado (migración 005, sin
            -- columna nueva — se calcula acá en vez de duplicarlo en una
            -- columna porque siempre es derivable y nunca debe
            -- desincronizarse). es_cabeza_de_grupo = algún otro
            -- instrumento activo lo señala como su instrumento_asociado.
            -- grupo_tag = el tag del PADRE del grupo (el propio tag si es
            -- cabeza, o su instrumento_asociado_tag si es hijo — el mismo
            -- campo "curado" que ya imprime EQUIPO/INSTRUMENTO ASOCIADO,
            -- no resuelto vía id) — NULL si no pertenece a ningún grupo.
            CASE WHEN EXISTS (
              SELECT 1 FROM nucleo.instrumento h
              WHERE h.proyecto_id = i.proyecto_id
                AND h.instrumento_asociado_id = i.id
                AND h.activo = 1
            ) THEN 1 ELSE 0 END AS es_cabeza_de_grupo,
            CASE
              WHEN i.instrumento_asociado_tag IS NOT NULL THEN i.instrumento_asociado_tag
              WHEN EXISTS (
                SELECT 1 FROM nucleo.instrumento h
                WHERE h.proyecto_id = i.proyecto_id
                  AND h.instrumento_asociado_id = i.id
                  AND h.activo = 1
              ) THEN i.tag_instrumento
              ELSE NULL
            END AS grupo_tag
          FROM nucleo.instrumento i
          WHERE i.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND i.activo = 1
          ORDER BY i.tag_instrumento;
        `);

      /*
       * ordenGrupoTag: clave de orden que SÍ usa el fallback por texto
       * (mismo motor que el LDI, ver lib/instrumentGrouping.ts) — a
       * diferencia de `grupoTag` (arriba, calculado en SQL, solo relación
       * curada real), esto agrupa también instrumentos SUELTOS que
       * comparten tipo+correlativo, para que el listado del Master salga
       * clusterizado igual que el LDI ("los PIT juntos") — pedido
       * explícito del usuario tras ver el mismo fix ya aplicado ahí. No
       * se usa para lo que se le MUESTRA al usuario como "Grupo" (eso
       * sigue siendo solo la relación real), únicamente para el orden por
       * defecto que arma el frontend.
       */
      const ordenAgrupado = calcularOrdenAgrupado(
        result.recordset.map((row) => ({
          id: String(row.id),
          tagInstrumento: row.tag_instrumento as string,
          instrumentoAsociadoId:
            row.instrumento_asociado_id === null ? null : String(row.instrumento_asociado_id),
          instrumentoAsociadoTag: row.instrumento_asociado_tag as string | null
        }))
      );

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
          esCabezaDeGrupo: Boolean(row.es_cabeza_de_grupo),
          grupoTag: row.grupo_tag,
          ordenGrupoTag: ordenAgrupado.get(String(row.id))!.ordenGrupoTag,

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
            i.id,
            i.proyecto_id,
            i.estado_pnid_id,
            i.tag_instrumento,
            i.pnpid,
            i.fuente_pnpid,
            i.descripcion,
            i.tipo_instrumento,
            i.servicio,
            i.sistema,
            i.ubicacion,
            i.nodo,
            i.tag_anterior,
            i.tecnologia,
            i.funcionamiento,
            i.cuerpo_instrumento,
            i.conexion_proceso,
            i.plano_pnid,
            i.linea_pnid,
            i.tipo_senal_pnid,
            i.equipo_asociado_id,
            i.equipo_asociado_tag,
            i.instrumento_asociado_id,
            i.instrumento_asociado_tag,
            i.fecha_agregado,
            i.fecha_ultima_revision,
            i.activo,
            i.created_at,
            i.updated_at,
            i.created_by,
            i.updated_by,
            -- Mismo cálculo de agrupamiento que GET / (ver comentario ahí) —
            -- se mantiene igual en detalle para no romper el contrato
            -- compartido del tipo Instrument entre lista y detalle.
            CASE WHEN EXISTS (
              SELECT 1 FROM nucleo.instrumento h
              WHERE h.proyecto_id = i.proyecto_id
                AND h.instrumento_asociado_id = i.id
                AND h.activo = 1
            ) THEN 1 ELSE 0 END AS es_cabeza_de_grupo,
            CASE
              WHEN i.instrumento_asociado_tag IS NOT NULL THEN i.instrumento_asociado_tag
              WHEN EXISTS (
                SELECT 1 FROM nucleo.instrumento h
                WHERE h.proyecto_id = i.proyecto_id
                  AND h.instrumento_asociado_id = i.id
                  AND h.activo = 1
              ) THEN i.tag_instrumento
              ELSE NULL
            END AS grupo_tag
          FROM nucleo.instrumento i
          WHERE i.id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND i.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND i.activo = 1;
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
          esCabezaDeGrupo: Boolean(row.es_cabeza_de_grupo),
          grupoTag: row.grupo_tag,

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
    let transaction: sql.Transaction | undefined;
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
      transaction = new sql.Transaction(pool);
      await transaction.begin();
      const request = new sql.Request(transaction);

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
          INSERTED.estado_pnid_id,
          INSERTED.tag_instrumento,
          INSERTED.pnpid,
          INSERTED.fuente_pnpid,
          INSERTED.descripcion,
          INSERTED.tipo_instrumento,
          INSERTED.servicio,
          INSERTED.sistema,
          INSERTED.ubicacion,
          INSERTED.nodo,
          INSERTED.tag_anterior,
          INSERTED.tecnologia,
          INSERTED.funcionamiento,
          INSERTED.cuerpo_instrumento,
          INSERTED.conexion_proceso,
          INSERTED.plano_pnid,
          INSERTED.linea_pnid,
          INSERTED.tipo_senal_pnid,
          INSERTED.equipo_asociado_id,
          INSERTED.equipo_asociado_tag,
          INSERTED.instrumento_asociado_id,
          INSERTED.instrumento_asociado_tag,
          INSERTED.fecha_agregado,
          INSERTED.fecha_ultima_revision,
          INSERTED.activo,
          INSERTED.created_at,
          INSERTED.updated_at,
          INSERTED.created_by,
          INSERTED.updated_by,
          DELETED.tag_instrumento AS tag_instrumento_anterior
        WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      const row = result.recordset[0];

      /*
       * Re-derivación del TAG de señal cuando cambia el TAG del
       * instrumento (confirmado explícitamente por el usuario): la
       * convención observada en los datos reales es
       * `tag_senal = tagDelDueñoOAgrupador + '_' + nombre_corto` (p. ej.
       * `620-PIT-5058_PI`, o `620-HV-5084_REM` cuando el agrupador es
       * 620-HV-5084 aunque el dueño real de esa señal sea 620-HS-5084 —
       * el agrupador manda sobre el dueño directo cuando existe).
       *
       * Guardado a propósito: solo se toca una señal si su tag_senal
       * ACTUAL todavía coincide exactamente con `tagAnterior + '_' +
       * nombreCorto` — si alguien ya lo personalizó a mano rompiendo esa
       * convención, no se sobrescribe. Es una convención de este dataset,
       * no una regla de negocio universal (puede no aplicar a otro
       * proyecto), así que se resuelve acá en el backend, no con un
       * trigger de base de datos.
       */
      if ('tagInstrumento' in body && row.tag_instrumento_anterior && row.tag_instrumento_anterior !== row.tag_instrumento) {
        const syncRequest = new sql.Request(transaction);
        await syncRequest
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .input('tag_anterior', sql.NVarChar(50), row.tag_instrumento_anterior)
          .input('tag_nuevo', sql.NVarChar(50), row.tag_instrumento)
          .input('updated_by', sql.NVarChar(30), userId)
          .query(`
            UPDATE nucleo.senal
            SET tag_senal = @tag_nuevo + '_' + nombre_corto,
                updated_at = SYSUTCDATETIME(),
                updated_by = TRY_CONVERT(BIGINT, @updated_by)
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND activo = 1
              AND nombre_corto IS NOT NULL
              AND tag_senal = @tag_anterior + '_' + nombre_corto
              AND LEN(@tag_nuevo + '_' + nombre_corto) <= 80
              AND (
                instrumento_agrupador_id = TRY_CONVERT(BIGINT, @instrumento_id)
                OR (instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id) AND instrumento_agrupador_id IS NULL)
              );
          `);
      }

      await transaction.commit();

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
      if (transaction) await transaction.rollback().catch(() => {});

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
 * Dos comportamientos, igual que revisionesEntregable.ts:
 *  - Sin `eliminarDefinitivamente` en el body (o body vacío): desactivación
 *    lógica de siempre (activo=0). Ningún cambio de comportamiento acá.
 *  - Con `eliminarDefinitivamente: true`: borrado físico REAL, pero
 *    SOLO permitido cuando el estado P&ID del instrumento es exactamente
 *    NO_EXISTE_EN_PNID (puerta de negocio angosta, pedido explícito del
 *    usuario — nunca un "borrar cualquier instrumento"). Requiere permiso
 *    'administer' del proyecto (más estricto que el 'deactivate' que ya
 *    exige este router para todo el resto). Ver migración 011: la fila de
 *    snapshot de una revisión LDI ya EMITIDA que referenciaba este
 *    instrumento sobrevive con `instrumento_id = NULL` (su contenido
 *    impreso, `datos_snapshot`, es autocontenido y no se toca) — el
 *    UPDATE que la nulea, sobre una revisión ya EMITIDA, necesita el
 *    mismo bypass de SESSION_CONTEXT que usa la eliminación definitiva
 *    de revisiones (migración 009).
 */
instrumentsRouter.delete(
  '/:instrumentId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = req.body ?? {};

      const instrumentId = normalizeParam(req.params.instrumentId);

      if (!instrumentId || !/^\d+$/.test(instrumentId)) {
        res.status(400).json({
          error: 'invalid_instrument_id',
          message: 'instrumentId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();

      if (body.eliminarDefinitivamente !== true) {
        // ==================== desactivación lógica (comportamiento de siempre) ====================
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
        return;
      }

      // ==================== eliminación definitiva ====================

      if (!req.projectAccess!.permissions.administer) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Eliminar un instrumento definitivamente requiere permiso de administración en el proyecto.'
        });
        return;
      }

      const actual = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentId)
        .query(`
          SELECT i.id, i.tag_instrumento, e.codigo AS estado_pnid_codigo
          FROM nucleo.instrumento i
          LEFT JOIN cat.cat_estado_pnid e ON e.id = i.estado_pnid_id
          WHERE i.id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND i.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      const instrumentoActual = actual.recordset[0];

      if (!instrumentoActual) {
        res.status(404).json({
          error: 'instrument_not_found',
          message: 'Instrument does not exist in this project.'
        });
        return;
      }

      if (instrumentoActual.estado_pnid_codigo !== 'NO_EXISTE_EN_PNID') {
        res.status(409).json({
          error: 'instrumento_no_elegible_para_eliminacion',
          message:
            'Solo se puede eliminar definitivamente un instrumento cuyo estado P&ID sea "No existe en P&ID". ' +
            `Este instrumento tiene estado "${instrumentoActual.estado_pnid_codigo ?? 'sin estado'}".`
        });
        return;
      }

      // Recursos "duros" (nunca se cascadea un borrado sobre estos —
      // el usuario tiene que resolverlos a mano primero, mismo principio
      // de "resources in use cannot be deactivated" del resto de SIEI).
      //
      // nucleo.senal quedó deliberadamente FUERA de este bloqueo desde la
      // migración 016 (nucleo.senal.dueno_ausente): una señal referenciando
      // a este instrumento ya NO impide la eliminación — se resuelve más
      // abajo, dentro de la transacción, marcándola "dueño ausente" en vez
      // de bloquear.
      //
      // punto_conexion salió de este bloqueo después (pedido explícito del
      // usuario, sobre datos reales del proyecto 22043/620: instrumentos
      // placeholder tipo "620-HS-XXX1" con NO_EXISTE_EN_PNID que ya tenían
      // un punto de conexión propio y una ruta real de 1 solo tramo, sin
      // TRAMO_CONDUCTOR/TERMINACION todavía). Ahora se cascada físicamente
      // dentro de la transacción (ver más abajo: TRAMO_CONEXION que usa el
      // punto se borra, la RUTA_CONEXION dueña se desactiva —conserva el
      // historial señal↔ruta—, y el PUNTO_CONEXION se borra al final). Esto
      // SOLO es seguro para rutas de un tramo sin conductores materializados
      // — no se investigó el caso de una ruta multi-tramo con TERMINACION
      // real, así que si aparece se deja que el error de SQL Server lo
      // frene (nunca se ignora silenciosamente).
      //
      // lazo/enlace_com siguen bloqueando exactamente igual que antes
      // ("Opción A": ver 016_senal_dueno_ausente.sql).
      const usoReal = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentId)
        .query(`
          SELECT
            (SELECT COUNT(*) FROM nucleo.lazo WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)) AS lazos,
            (SELECT COUNT(*) FROM nucleo.enlace_com WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)) AS enlaces_com;
        `);

      const { lazos, enlaces_com } = usoReal.recordset[0];

      if (lazos > 0 || enlaces_com > 0) {
        const detalle = {
          lazos: Number(lazos),
          enlacesCom: Number(enlaces_com)
        };
        // El desglose va también en el texto del mensaje (no solo en
        // `detalle`) porque el cliente HTTP del frontend (ApiError, ver
        // frontend/src/api/client.ts) descarta cualquier campo que no sea
        // error/message — sin esto el usuario ve el genérico "tiene
        // lazos o enlaces..." sin saber cuál ni cuántos.
        const partes: string[] = [];
        if (detalle.lazos > 0) partes.push(`${detalle.lazos} lazo(s)`);
        if (detalle.enlacesCom > 0) partes.push(`${detalle.enlacesCom} enlace(s) de comunicación`);

        res.status(409).json({
          error: 'instrument_in_use',
          message: `No se puede eliminar: el instrumento tiene ${partes.join(', ')} asociados. Elimina o reasigna esos recursos primero.`,
          detalle
        });
        return;
      }

      let transaction: sql.Transaction | undefined;

      try {
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Historial de importación P&ID (integracion.importacion_pnid_resultado):
        // las filas SIN fila_id (NO_EXISTE_EN_PNID no viene de una fila del
        // reporte, ver CLAUDE.md) pierden todo sentido sin el instrumento —
        // se borran. Las que SÍ tienen fila_id conservan su identidad propia
        // (la fila del archivo importado) y solo se les desvincula el
        // instrumento (CK_importacion_pnid_resultado_origen exige que al
        // menos uno de los dos siga NOT NULL).
        const resultadosBorrados = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .query(`
            DELETE FROM integracion.importacion_pnid_resultado
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)
              AND fila_id IS NULL;
          `);

        const resultadosDesvinculados = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .query(`
            UPDATE integracion.importacion_pnid_resultado
            SET instrumento_id = NULL
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)
              AND fila_id IS NOT NULL;
          `);

        // instrumento_asociado_id/_tag de OTROS instrumentos que apuntaban
        // a este — es una asociación curada manualmente, no un recurso
        // físico; se limpia en vez de bloquear el borrado (mismo criterio
        // que ya se usa para equipo_asociado_id al reimportar P&ID, ver
        // CLAUDE.md "Equipos").
        const asociacionesLimpiadas = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .input('updated_by', sql.NVarChar(30), userId)
          .query(`
            UPDATE nucleo.instrumento
            SET instrumento_asociado_id = NULL,
                instrumento_asociado_tag = NULL,
                updated_at = SYSUTCDATETIME(),
                updated_by = TRY_CONVERT(BIGINT, @updated_by)
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND instrumento_asociado_id = TRY_CONVERT(BIGINT, @instrumento_id);
          `);

        // Bypass de inmutabilidad (migración 009) — el UPDATE de abajo
        // sobre revision_entregable_fila puede tocar una fila que
        // pertenece a una revisión ya EMITIDA/DESCARTADA.
        await new sql.Request(transaction).query(
          `EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 1;`
        );

        const filasDesvinculadas = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .query(`
            UPDATE nucleo.revision_entregable_fila
            SET instrumento_id = NULL
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id);
          `);

        /*
         * Migración 016: señales cuyo DUEÑO real era este instrumento se
         * conservan activas, marcadas dueno_ausente=1 — nunca se bloquea
         * el borrado por esto (ver comentario más arriba). tag_senal NO
         * se toca: queda como historial legible aunque ya no coincida con
         * ningún instrumento vivo (la re-derivación automática de
         * tag_senal, ver PATCH .../instruments/:id, solo actúa sobre
         * instrumentos que siguen existiendo).
         */
        const senalesSinDueno = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .input('updated_by', sql.NVarChar(30), userId)
          .query(`
            UPDATE nucleo.senal
            SET instrumento_id = NULL,
                dueno_ausente = 1,
                updated_at = SYSUTCDATETIME(),
                updated_by = TRY_CONVERT(BIGINT, @updated_by)
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id);
          `);

        // Señales que solo tenían a este instrumento como AGRUPADOR (no
        // como dueño) — se limpia la referencia sin marcar dueno_ausente:
        // el dueño real de esas señales sigue existiendo, solo se pierde
        // el agrupador (mismo criterio ya usado para instrumento_asociado
        // más arriba: limpiar en vez de bloquear una asociación curada).
        const agrupadorDesvinculado = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .input('updated_by', sql.NVarChar(30), userId)
          .query(`
            UPDATE nucleo.senal
            SET instrumento_agrupador_id = NULL,
                updated_at = SYSUTCDATETIME(),
                updated_by = TRY_CONVERT(BIGINT, @updated_by)
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND instrumento_agrupador_id = TRY_CONVERT(BIGINT, @instrumento_id);
          `);

        /*
         * punto_conexion propio de este instrumento (ver comentario más
         * arriba, "Recursos duros") — se cascada físicamente. El punto del
         * instrumento es siempre el ORIGEN del primer tramo de su ruta
         * (regla de negocio: INSTRUMENTO nunca es nodo intermedio ni
         * final), así que si la ruta tiene más de un tramo (ej.
         * INSTRUMENTO -> CAJA -> GABINETE) hay que borrar TODOS los tramos
         * de esa ruta, no solo el que toca el punto — borrar únicamente el
         * primero deja los tramos restantes con numero_orden no
         * consecutivo y dispara 51004 en TR_tramo_conexion_validar_
         * secuencia (comprobado en vivo). La RUTA_CONEXION completa se
         * desactiva después (conserva el historial señal↔ruta en vez de
         * borrarla), y el propio PUNTO_CONEXION se borra al final. Sin
         * esto el DELETE de nucleo.instrumento de más abajo fallaría por
         * la FK punto_conexion.instrumento_id (única FK real hacia
         * punto_conexion, confirmado contra sys.foreign_keys). Los ids
         * salen siempre de una SELECT propia (nunca de input de usuario),
         * así que se interpolan directo en el IN (...) sin riesgo de
         * inyección.
         */
        const puntosPropios = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .query(`
            SELECT id FROM nucleo.punto_conexion
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id);
          `);

        const puntoIds = puntosPropios.recordset.map((r) => String(r.id));
        let tramosConexionEliminados = 0;
        let rutasConexionDesactivadas = 0;
        let puntosConexionEliminados = 0;

        if (puntoIds.length > 0) {
          const puntoIdsSql = puntoIds.join(',');

          const rutasTocadas = await new sql.Request(transaction).query(`
            SELECT DISTINCT ruta_conexion_id FROM nucleo.tramo_conexion
            WHERE punto_origen_id IN (${puntoIdsSql}) OR punto_destino_id IN (${puntoIdsSql});
          `);

          const rutaIds = rutasTocadas.recordset.map((r) => String(r.ruta_conexion_id));

          if (rutaIds.length > 0) {
            const tramoBorrado = await new sql.Request(transaction).query(`
              DELETE FROM nucleo.tramo_conexion WHERE ruta_conexion_id IN (${rutaIds.join(',')});
            `);
            tramosConexionEliminados = tramoBorrado.rowsAffected[0];

            const rutaDesactivada = await new sql.Request(transaction)
              .input('updated_by', sql.NVarChar(30), userId)
              .query(`
                UPDATE nucleo.ruta_conexion
                SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
                WHERE id IN (${rutaIds.join(',')}) AND activo = 1;
              `);
            rutasConexionDesactivadas = rutaDesactivada.rowsAffected[0];
          }

          const puntoBorrado = await new sql.Request(transaction).query(`
            DELETE FROM nucleo.punto_conexion WHERE id IN (${puntoIdsSql});
          `);
          puntosConexionEliminados = puntoBorrado.rowsAffected[0];
        }

        const eliminado = await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('instrumento_id', sql.NVarChar(30), instrumentId)
          .query(`
            DELETE FROM nucleo.instrumento
            WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
              AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
          `);

        await new sql.Request(transaction).query(
          `EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 0;`
        );

        if (eliminado.rowsAffected[0] === 0) {
          await transaction.rollback();
          res.status(404).json({
            error: 'instrument_not_found',
            message: 'Instrument does not exist in this project.'
          });
          return;
        }

        await transaction.commit();

        res.status(200).json({
          eliminado: true,
          instrumentId,
          tagInstrumento: instrumentoActual.tag_instrumento,
          limpieza: {
            resultadosPnidBorrados: resultadosBorrados.rowsAffected[0],
            resultadosPnidDesvinculados: resultadosDesvinculados.rowsAffected[0],
            asociacionesInstrumentoAsociadoLimpiadas: asociacionesLimpiadas.rowsAffected[0],
            filasRevisionEntregableDesvinculadas: filasDesvinculadas.rowsAffected[0],
            senalesMarcadasSinDueno: senalesSinDueno.rowsAffected[0],
            senalesAgrupadorDesvinculado: agrupadorDesvinculado.rowsAffected[0],
            puntosConexionEliminados,
            tramosConexionEliminados,
            rutasConexionDesactivadas
          }
        });
      } catch (error) {
        if (transaction) {
          try {
            await transaction.rollback();
          } catch {
            // ya pudo haber quedado sin transacción viva
          }
        }
        throw error;
      }

    } catch (error) {
      next(error);
    }
  }
);
