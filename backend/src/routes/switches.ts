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
 * nucleo.switch — raíz de comunicaciones (SWITCH -> PUERTO -> ENLACE_COM).
 * Sin CHECK ni triggers propios, solo el índice único filtrado de TAG por
 * proyecto activo. Mismo patrón que equipment.ts.
 *
 * gabinete_id (migración 012) es una relación OPCIONAL: un switch puede
 * o no estar físicamente contenido en un gabinete modelado — un gabinete
 * tipo COMUNICACION no reemplaza al switch, son entidades distintas que
 * coexisten (ver docs/DIAGNOSTICO_SENALES_GABINETES.md sección 32/punto 8
 * de la aprobación del usuario).
 */
export const switchesRouter = Router({ mergeParams: true });

switchesRouter.use(authenticate);


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
    projectId: String(row.proyecto_id),
    tagSwitch: row.tag_switch,
    descripcion: row.descripcion,
    marcaModelo: row.marca_modelo,
    gabineteId: row.gabinete_id === null ? null : String(row.gabinete_id),
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'proyecto_id', 'tag_switch', 'descripcion', 'marca_modelo', 'gabinete_id', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/projects/:projectId/switches
 */
switchesRouter.get(
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
          SELECT ${COLUMNS}
          FROM nucleo.switch
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY tag_switch;
        `);

      res.status(200).json({ projectId, switches: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/switches/:switchId
 */
switchesRouter.get(
  '/:switchId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const switchId = normalizeParam(req.params.switchId);

      if (!switchId || !/^\d+$/.test(switchId)) {
        res.status(400).json({ error: 'invalid_switch_id', message: 'switchId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('switch_id', sql.NVarChar(30), switchId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.switch
          WHERE id = TRY_CONVERT(BIGINT, @switch_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'switch_not_found', message: 'Switch does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ switch: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/switches
 */
switchesRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const { tagSwitch, descripcion = null, marcaModelo = null, gabineteId = null } = req.body ?? {};

      if (typeof tagSwitch !== 'string' || tagSwitch.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'tagSwitch is required.' });
        return;
      }

      const tag = tagSwitch.trim();

      if (tag.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'tagSwitch cannot exceed 50 characters.' });
        return;
      }

      const optionalFields: Array<{ name: string; value: unknown; max: number }> = [
        { name: 'descripcion', value: descripcion, max: 300 },
        { name: 'marcaModelo', value: marcaModelo, max: 100 }
      ];

      for (const field of optionalFields) {
        if (field.value !== null && field.value !== undefined && typeof field.value !== 'string') {
          res.status(400).json({ error: 'validation_error', message: `${field.name} must be a string or null.` });
          return;
        }
        if (typeof field.value === 'string' && field.value.length > field.max) {
          res.status(400).json({ error: 'validation_error', message: `${field.name} cannot exceed ${field.max} characters.` });
          return;
        }
      }

      if (gabineteId !== null && gabineteId !== undefined && !/^\d+$/.test(String(gabineteId))) {
        res.status(400).json({ error: 'validation_error', message: 'gabineteId must be a numeric id or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('tag_switch', sql.NVarChar(50), tag)
        .input('descripcion', sql.NVarChar(300), descripcion)
        .input('marca_modelo', sql.NVarChar(100), marcaModelo)
        .input('gabinete_id', sql.NVarChar(30), gabineteId)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.switch
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_switch = @tag_switch AND activo = 1
          )
          BEGIN
            THROW 54701, 'Ya existe un switch activo con ese TAG en el proyecto.', 1;
          END;

          INSERT INTO nucleo.switch (proyecto_id, tag_switch, descripcion, marca_modelo, gabinete_id, activo, created_at, created_by)
          OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), @tag_switch, @descripcion, @marca_modelo, TRY_CONVERT(BIGINT, @gabinete_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/switches/${String(row.id)}`)
        .json({ switch: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54701 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'switch_tag_conflict', message: 'An active switch with this TAG already exists in the project.' });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'gabineteId does not exist, is inactive, or does not belong to this project.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/switches/:switchId
 */
switchesRouter.patch(
  '/:switchId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const switchId = normalizeParam(req.params.switchId);

      if (!switchId || !/^\d+$/.test(switchId)) {
        res.status(400).json({ error: 'invalid_switch_id', message: 'switchId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        tagSwitch: { column: 'tag_switch', sqlType: sql.NVarChar(50), max: 50 },
        descripcion: { column: 'descripcion', sqlType: sql.NVarChar(300), max: 300 },
        marcaModelo: { column: 'marca_modelo', sqlType: sql.NVarChar(100), max: 100 },
        gabineteId: { column: 'gabinete_id', sqlType: sql.NVarChar(30), max: Infinity }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if ('tagSwitch' in body) {
        if (typeof body.tagSwitch !== 'string' || body.tagSwitch.trim().length === 0) {
          res.status(400).json({ error: 'validation_error', message: 'tagSwitch cannot be empty.' });
          return;
        }
        body.tagSwitch = body.tagSwitch.trim();
      }

      if ('gabineteId' in body && body.gabineteId !== null && !/^\d+$/.test(String(body.gabineteId))) {
        res.status(400).json({ error: 'validation_error', message: 'gabineteId must be a numeric id or null.' });
        return;
      }

      for (const key of keys) {
        if (key === 'gabineteId') continue;
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
        .input('switch_id', sql.NVarChar(30), switchId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, config.sqlType, body[key]);
        assignments.push(
          key === 'gabineteId'
            ? `${config.column} = TRY_CONVERT(BIGINT, @${parameter})`
            : `${config.column} = @${parameter}`
        );
      });

      if ('tagSwitch' in body) {
        request.input('nuevo_tag', sql.NVarChar(50), body.tagSwitch);
      }

      const tagCheck = 'tagSwitch' in body
        ? `
          IF EXISTS (
            SELECT 1 FROM nucleo.switch
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_switch = @nuevo_tag AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @switch_id)
          )
          BEGIN
            THROW 54701, 'Ya existe un switch activo con ese TAG en el proyecto.', 1;
          END;
        `
        : '';

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.switch
          WHERE id = TRY_CONVERT(BIGINT, @switch_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54702, 'El switch no existe en este proyecto o está inactivo.', 1;
        END;

        ${tagCheck}

        UPDATE nucleo.switch
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @switch_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      res.status(200).json({ switch: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54701 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'switch_tag_conflict', message: 'An active switch with this TAG already exists in the project.' });
        return;
      }
      if (number === 54702) {
        res.status(404).json({ error: 'switch_not_found', message: 'Switch does not exist in this project or is inactive.' });
        return;
      }
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'gabineteId does not exist, is inactive, or does not belong to this project.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/switches/:switchId
 */
switchesRouter.delete(
  '/:switchId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const switchId = normalizeParam(req.params.switchId);

      if (!switchId || !/^\d+$/.test(switchId)) {
        res.status(400).json({ error: 'invalid_switch_id', message: 'switchId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('switch_id', sql.NVarChar(30), switchId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.switch
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_switch, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @switch_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'switch_not_found', message: 'Switch does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        switch: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagSwitch: row.tag_switch,
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
