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
 * nucleo.equipo — dueño alternativo de señales (junto a instrumento, ver
 * CK_senal_origen_xor). Estructura mucho más simple que instrumento/senal:
 * sin CHECK propios y sin triggers propios en la tabla equipo, solo la
 * FK a proyecto y el índice único filtrado de TAG por proyecto activo.
 * Este router sigue exactamente el mismo patrón que instruments.ts.
 */
export const equipmentRouter = Router({ mergeParams: true });

equipmentRouter.use(authenticate);


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
 * GET /api/projects/:projectId/equipment
 */
equipmentRouter.get(
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
            tag_equipo,
            descripcion,
            sistema,
            nodo,
            panel,
            activo,
            created_at,
            updated_at,
            created_by,
            updated_by
          FROM nucleo.equipo
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY tag_equipo;
        `);

      res.status(200).json({
        projectId,
        equipment: result.recordset.map((row) => ({
          id: String(row.id),
          projectId: String(row.proyecto_id),

          tagEquipo: row.tag_equipo,
          descripcion: row.descripcion,
          sistema: row.sistema,
          nodo: row.nodo,
          panel: row.panel,

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
 * GET /api/projects/:projectId/equipment/:equipmentId
 */
equipmentRouter.get(
  '/:equipmentId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const equipmentId = normalizeParam(req.params.equipmentId);

      if (!equipmentId || !/^\d+$/.test(equipmentId)) {
        res.status(400).json({
          error: 'invalid_equipment_id',
          message: 'equipmentId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('equipo_id', sql.NVarChar(30), equipmentId)
        .query(`
          SELECT
            id,
            proyecto_id,
            tag_equipo,
            descripcion,
            sistema,
            nodo,
            panel,
            activo,
            created_at,
            updated_at,
            created_by,
            updated_by
          FROM nucleo.equipo
          WHERE id = TRY_CONVERT(BIGINT, @equipo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({
          error: 'equipment_not_found',
          message: 'Equipment does not exist in this project or is inactive.'
        });
        return;
      }

      res.status(200).json({
        equipment: {
          id: String(row.id),
          projectId: String(row.proyecto_id),

          tagEquipo: row.tag_equipo,
          descripcion: row.descripcion,
          sistema: row.sistema,
          nodo: row.nodo,
          panel: row.panel,

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
 * POST /api/projects/:projectId/equipment
 *
 * Requiere permiso WRITE.
 */
equipmentRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const {
        tagEquipo,
        descripcion = null,
        sistema = null,
        nodo = null,
        panel = null
      } = req.body ?? {};

      if (typeof tagEquipo !== 'string' || tagEquipo.trim().length === 0) {
        res.status(400).json({
          error: 'validation_error',
          message: 'tagEquipo is required.'
        });
        return;
      }

      const tag = tagEquipo.trim();

      if (tag.length > 50) {
        res.status(400).json({
          error: 'validation_error',
          message: 'tagEquipo cannot exceed 50 characters.'
        });
        return;
      }

      const optionalFields: Array<{ name: string; value: unknown; max: number }> = [
        { name: 'descripcion', value: descripcion, max: 300 },
        { name: 'sistema', value: sistema, max: 50 },
        { name: 'nodo', value: nodo, max: 50 },
        { name: 'panel', value: panel, max: 50 }
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

        if (typeof field.value === 'string' && field.value.length > field.max) {
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
        .input('tag_equipo', sql.NVarChar(50), tag)
        .input('descripcion', sql.NVarChar(300), descripcion)
        .input('sistema', sql.NVarChar(50), sistema)
        .input('nodo', sql.NVarChar(50), nodo)
        .input('panel', sql.NVarChar(50), panel)
        .query(`
          IF EXISTS (
            SELECT 1
            FROM nucleo.equipo
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_equipo = @tag_equipo
              AND activo = 1
          )
          BEGIN
            THROW 54201, 'Ya existe un equipo activo con ese TAG en el proyecto.', 1;
          END;

          INSERT INTO nucleo.equipo (
            proyecto_id,
            tag_equipo,
            descripcion,
            sistema,
            nodo,
            panel,
            activo,
            created_at,
            created_by
          )
          OUTPUT
            INSERTED.id,
            INSERTED.proyecto_id,
            INSERTED.tag_equipo,
            INSERTED.descripcion,
            INSERTED.sistema,
            INSERTED.nodo,
            INSERTED.panel,
            INSERTED.activo,
            INSERTED.created_at,
            INSERTED.created_by
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id),
            @tag_equipo,
            @descripcion,
            @sistema,
            @nodo,
            @panel,
            1,
            SYSUTCDATETIME(),
            TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/equipment/${String(row.id)}`)
        .json({
          equipment: {
            id: String(row.id),
            projectId: String(row.proyecto_id),
            tagEquipo: row.tag_equipo,
            descripcion: row.descripcion,
            sistema: row.sistema,
            nodo: row.nodo,
            panel: row.panel,
            active: Boolean(row.activo),
            createdAt: row.created_at,
            createdBy: row.created_by === null ? null : String(row.created_by)
          }
        });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54201 || number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'equipment_tag_conflict',
          message: 'An active equipment with this TAG already exists in the project.'
        });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/equipment/:equipmentId
 *
 * Modifica parcialmente un equipo. Requiere permiso WRITE.
 */
equipmentRouter.patch(
  '/:equipmentId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const equipmentId = normalizeParam(req.params.equipmentId);

      if (!equipmentId || !/^\d+$/.test(equipmentId)) {
        res.status(400).json({
          error: 'invalid_equipment_id',
          message: 'equipmentId must be a positive integer.'
        });
        return;
      }

      const allowedFields = {
        tagEquipo: { column: 'tag_equipo', sqlType: sql.NVarChar(50), max: 50 },
        descripcion: { column: 'descripcion', sqlType: sql.NVarChar(300), max: 300 },
        sistema: { column: 'sistema', sqlType: sql.NVarChar(50), max: 50 },
        nodo: { column: 'nodo', sqlType: sql.NVarChar(50), max: 50 },
        panel: { column: 'panel', sqlType: sql.NVarChar(50), max: 50 }
      } as const;

      const body = req.body ?? {};

      const keys = Object.keys(body).filter(
        (key) => key in allowedFields
      ) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({
          error: 'validation_error',
          message: 'No editable fields were provided.'
        });
        return;
      }

      if ('tagEquipo' in body) {
        if (typeof body.tagEquipo !== 'string' || body.tagEquipo.trim().length === 0) {
          res.status(400).json({
            error: 'validation_error',
            message: 'tagEquipo cannot be empty.'
          });
          return;
        }

        body.tagEquipo = body.tagEquipo.trim();
      }

      for (const key of keys) {
        const value = body[key];
        const config = allowedFields[key];

        if (value !== null && typeof value !== 'string') {
          res.status(400).json({
            error: 'validation_error',
            message: `${key} must be a string or null.`
          });
          return;
        }

        if (typeof value === 'string' && value.length > config.max) {
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
        .input('equipo_id', sql.NVarChar(30), equipmentId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];

      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;

        request.input(parameter, config.sqlType, body[key]);
        assignments.push(`${config.column} = @${parameter}`);
      });

      if ('tagEquipo' in body) {
        request.input('nuevo_tag', sql.NVarChar(50), body.tagEquipo);
      }

      const tagCheck = 'tagEquipo' in body
        ? `
          IF EXISTS (
            SELECT 1
            FROM nucleo.equipo
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_equipo = @nuevo_tag
              AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @equipo_id)
          )
          BEGIN
            THROW 54201, 'Ya existe un equipo activo con ese TAG en el proyecto.', 1;
          END;
        `
        : '';

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1
          FROM nucleo.equipo
          WHERE id = TRY_CONVERT(BIGINT, @equipo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54202, 'El equipo no existe en este proyecto o está inactivo.', 1;
        END;

        ${tagCheck}

        UPDATE nucleo.equipo
        SET
          ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT
          INSERTED.id,
          INSERTED.proyecto_id,
          INSERTED.tag_equipo,
          INSERTED.descripcion,
          INSERTED.sistema,
          INSERTED.nodo,
          INSERTED.panel,
          INSERTED.activo,
          INSERTED.created_at,
          INSERTED.updated_at,
          INSERTED.created_by,
          INSERTED.updated_by
        WHERE id = TRY_CONVERT(BIGINT, @equipo_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      const row = result.recordset[0];

      res.status(200).json({
        equipment: {
          id: String(row.id),
          projectId: String(row.proyecto_id),

          tagEquipo: row.tag_equipo,
          descripcion: row.descripcion,
          sistema: row.sistema,
          nodo: row.nodo,
          panel: row.panel,

          active: Boolean(row.activo),

          createdAt: row.created_at,
          updatedAt: row.updated_at,

          createdBy: row.created_by === null ? null : String(row.created_by),
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54201 || number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'equipment_tag_conflict',
          message: 'An active equipment with this TAG already exists in the project.'
        });
        return;
      }

      if (number === 54202) {
        res.status(404).json({
          error: 'equipment_not_found',
          message: 'Equipment does not exist in this project or is inactive.'
        });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/equipment/:equipmentId
 *
 * Desactivación lógica. Requiere permiso DEACTIVATE.
 *
 * nucleo.equipo no tiene triggers propios, así que a diferencia de
 * nucleo.senal el OUTPUT sin INTO sí es válido aquí (igual que en
 * instruments.ts).
 */
equipmentRouter.delete(
  '/:equipmentId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const equipmentId = normalizeParam(req.params.equipmentId);

      if (!equipmentId || !/^\d+$/.test(equipmentId)) {
        res.status(400).json({
          error: 'invalid_equipment_id',
          message: 'equipmentId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('equipo_id', sql.NVarChar(30), equipmentId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.equipo
          SET
            activo = 0,
            updated_at = SYSUTCDATETIME(),
            updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT
            INSERTED.id,
            INSERTED.proyecto_id,
            INSERTED.tag_equipo,
            INSERTED.activo,
            INSERTED.updated_at,
            INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @equipo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({
          error: 'equipment_not_found',
          message: 'Equipment does not exist in this project or is already inactive.'
        });
        return;
      }

      res.status(200).json({
        equipment: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagEquipo: row.tag_equipo,
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
