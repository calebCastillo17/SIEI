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
 * nucleo.gabinete (ex nucleo.rio, migración 012) — raíz de la jerarquía
 * física de E/S (GABINETE -> RACK -> SLOT -> MODULO -> CANAL). RIO ya no
 * es el concepto padre: es uno de varios tipos posibles de gabinete
 * (`cat.cat_tipo_gabinete`, seedeado con RIO/CONTROL/COMUNICACION) — ver
 * docs/DIAGNOSTICO_SENALES_GABINETES.md secciones 5, 26, 31.6, 32 para la
 * evidencia real que motivó este cambio (un mismo campo "RIO" del Excel
 * de origen mezclaba gabinetes de E/S remota reales con un gabinete de
 * control de motores). Sin CHECK ni triggers propios más allá del índice
 * único filtrado de TAG por proyecto activo. Mismo patrón que
 * equipment.ts para tipo_equipo_id, salvo que acá `tipoGabineteId` es
 * OBLIGATORIO en creación (a diferencia de equipo, que lo dejó opcional
 * por retrocompatibilidad con datos reales ya cargados) — no hay ningún
 * gabinete real cargado todavía en SIEI, así que no hace falta esa
 * concesión: un gabinete nuevo siempre elige su tipo explícitamente.
 */
export const gabinetesRouter = Router({ mergeParams: true });

gabinetesRouter.use(authenticate);


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


const SELECT_GABINETE = `
  g.id, g.proyecto_id, g.tag_gabinete, g.tag_anterior, g.descripcion, g.activo,
  g.tipo_gabinete_id, t.codigo AS tipo_gabinete_codigo, t.nombre AS tipo_gabinete_nombre,
  g.created_at, g.updated_at, g.created_by, g.updated_by
`;

function serializeGabinete(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tagGabinete: row.tag_gabinete,
    tagAnterior: row.tag_anterior,
    descripcion: row.descripcion,
    active: Boolean(row.activo),
    tipoGabineteId: row.tipo_gabinete_id === null ? null : String(row.tipo_gabinete_id),
    tipoGabineteCodigo: row.tipo_gabinete_codigo,
    tipoGabineteNombre: row.tipo_gabinete_nombre,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}


/*
 * GET /api/projects/:projectId/gabinetes
 */
gabinetesRouter.get(
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
          SELECT ${SELECT_GABINETE}
          FROM nucleo.gabinete g
          LEFT JOIN cat.cat_tipo_gabinete t ON t.id = g.tipo_gabinete_id
          WHERE g.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND g.activo = 1
          ORDER BY g.tag_gabinete;
        `);

      res.status(200).json({
        projectId,
        gabinetes: result.recordset.map(serializeGabinete)
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/gabinetes/:gabineteId
 */
gabinetesRouter.get(
  '/:gabineteId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const gabineteId = normalizeParam(req.params.gabineteId);

      if (!gabineteId || !/^\d+$/.test(gabineteId)) {
        res.status(400).json({ error: 'invalid_gabinete_id', message: 'gabineteId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('gabinete_id', sql.NVarChar(30), gabineteId)
        .query(`
          SELECT ${SELECT_GABINETE}
          FROM nucleo.gabinete g
          LEFT JOIN cat.cat_tipo_gabinete t ON t.id = g.tipo_gabinete_id
          WHERE g.id = TRY_CONVERT(BIGINT, @gabinete_id)
            AND g.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND g.activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'gabinete_not_found', message: 'Gabinete does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ gabinete: serializeGabinete(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/gabinetes
 *
 * tipoGabineteId es OBLIGATORIO (ver comentario de cabecera). tagAnterior
 * es opcional, sin unicidad ni FK — mismo patrón que
 * instrumento.tag_anterior (migración 004): no participa en identidad.
 */
gabinetesRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const { tagGabinete, descripcion = null, tagAnterior = null, tipoGabineteId } = req.body ?? {};

      if (typeof tagGabinete !== 'string' || tagGabinete.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'tagGabinete is required.' });
        return;
      }

      const tag = tagGabinete.trim();

      if (tag.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'tagGabinete cannot exceed 50 characters.' });
        return;
      }

      if (descripcion !== null && descripcion !== undefined && typeof descripcion !== 'string') {
        res.status(400).json({ error: 'validation_error', message: 'descripcion must be a string or null.' });
        return;
      }

      if (typeof descripcion === 'string' && descripcion.length > 300) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion cannot exceed 300 characters.' });
        return;
      }

      if (tagAnterior !== null && tagAnterior !== undefined && typeof tagAnterior !== 'string') {
        res.status(400).json({ error: 'validation_error', message: 'tagAnterior must be a string or null.' });
        return;
      }

      if (typeof tagAnterior === 'string' && tagAnterior.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'tagAnterior cannot exceed 50 characters.' });
        return;
      }

      if (tipoGabineteId === null || tipoGabineteId === undefined || !/^\d+$/.test(String(tipoGabineteId))) {
        res.status(400).json({ error: 'validation_error', message: 'tipoGabineteId is required and must be a numeric id.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('tag_gabinete', sql.NVarChar(50), tag)
        .input('tag_anterior', sql.NVarChar(50), tagAnterior)
        .input('descripcion', sql.NVarChar(300), descripcion)
        .input('tipo_gabinete_id', sql.NVarChar(30), tipoGabineteId)
        .query(`
          IF EXISTS (
            SELECT 1 FROM nucleo.gabinete
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_gabinete = @tag_gabinete AND activo = 1
          )
          BEGIN
            THROW 54301, 'Ya existe un gabinete activo con ese TAG en el proyecto.', 1;
          END;

          INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tag_anterior, descripcion, tipo_gabinete_id, activo, created_at, created_by)
          OUTPUT INSERTED.id
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), @tag_gabinete, @tag_anterior, @descripcion,
            TRY_CONVERT(BIGINT, @tipo_gabinete_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const newId = String(insertResult.recordset[0].id);

      const fresh = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('gabinete_id', sql.NVarChar(30), newId)
        .query(`
          SELECT ${SELECT_GABINETE}
          FROM nucleo.gabinete g
          LEFT JOIN cat.cat_tipo_gabinete t ON t.id = g.tipo_gabinete_id
          WHERE g.id = TRY_CONVERT(BIGINT, @gabinete_id)
            AND g.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      res
        .status(201)
        .location(`/api/projects/${projectId}/gabinetes/${newId}`)
        .json({ gabinete: serializeGabinete(fresh.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54301 || number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'gabinete_tag_conflict',
          message: 'An active gabinete with this TAG already exists in the project.'
        });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoGabineteId does not exist.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/gabinetes/:gabineteId
 */
gabinetesRouter.patch(
  '/:gabineteId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const gabineteId = normalizeParam(req.params.gabineteId);

      if (!gabineteId || !/^\d+$/.test(gabineteId)) {
        res.status(400).json({ error: 'invalid_gabinete_id', message: 'gabineteId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        tagGabinete: { column: 'tag_gabinete', sqlType: sql.NVarChar(50), max: 50 },
        tagAnterior: { column: 'tag_anterior', sqlType: sql.NVarChar(50), max: 50 },
        descripcion: { column: 'descripcion', sqlType: sql.NVarChar(300), max: 300 },
        tipoGabineteId: { column: 'tipo_gabinete_id', sqlType: sql.NVarChar(30), max: Infinity }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if ('tagGabinete' in body) {
        if (typeof body.tagGabinete !== 'string' || body.tagGabinete.trim().length === 0) {
          res.status(400).json({ error: 'validation_error', message: 'tagGabinete cannot be empty.' });
          return;
        }
        body.tagGabinete = body.tagGabinete.trim();
      }

      if ('tipoGabineteId' in body) {
        if (body.tipoGabineteId === null || !/^\d+$/.test(String(body.tipoGabineteId))) {
          res.status(400).json({ error: 'validation_error', message: 'tipoGabineteId cannot be null and must be a numeric id.' });
          return;
        }
      }

      for (const key of keys) {
        if (key === 'tipoGabineteId') continue;
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
        .input('gabinete_id', sql.NVarChar(30), gabineteId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, config.sqlType, body[key]);
        assignments.push(
          key === 'tipoGabineteId'
            ? `${config.column} = TRY_CONVERT(BIGINT, @${parameter})`
            : `${config.column} = @${parameter}`
        );
      });

      if ('tagGabinete' in body) {
        request.input('nuevo_tag', sql.NVarChar(50), body.tagGabinete);
      }

      const tagCheck = 'tagGabinete' in body
        ? `
          IF EXISTS (
            SELECT 1 FROM nucleo.gabinete
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_gabinete = @nuevo_tag AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @gabinete_id)
          )
          BEGIN
            THROW 54301, 'Ya existe un gabinete activo con ese TAG en el proyecto.', 1;
          END;
        `
        : '';

      await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.gabinete
          WHERE id = TRY_CONVERT(BIGINT, @gabinete_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54302, 'El gabinete no existe en este proyecto o está inactivo.', 1;
        END;

        ${tagCheck}

        UPDATE nucleo.gabinete
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        WHERE id = TRY_CONVERT(BIGINT, @gabinete_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      const fresh = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('gabinete_id', sql.NVarChar(30), gabineteId)
        .query(`
          SELECT ${SELECT_GABINETE}
          FROM nucleo.gabinete g
          LEFT JOIN cat.cat_tipo_gabinete t ON t.id = g.tipo_gabinete_id
          WHERE g.id = TRY_CONVERT(BIGINT, @gabinete_id)
            AND g.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      res.status(200).json({ gabinete: serializeGabinete(fresh.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54301 || number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'gabinete_tag_conflict',
          message: 'An active gabinete with this TAG already exists in the project.'
        });
        return;
      }

      if (number === 54302) {
        res.status(404).json({ error: 'gabinete_not_found', message: 'Gabinete does not exist in this project or is inactive.' });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoGabineteId does not exist.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/gabinetes/:gabineteId
 *
 * Desactivación lógica. nucleo.gabinete no tiene triggers propios que
 * bloqueen la desactivación por uso (a diferencia de modulo/canal) — la
 * base no exige liberar racks/slots/módulos primero. El backend no lo
 * reinventa (mismo comportamiento heredado de nucleo.rio).
 */
gabinetesRouter.delete(
  '/:gabineteId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const gabineteId = normalizeParam(req.params.gabineteId);

      if (!gabineteId || !/^\d+$/.test(gabineteId)) {
        res.status(400).json({ error: 'invalid_gabinete_id', message: 'gabineteId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('gabinete_id', sql.NVarChar(30), gabineteId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.gabinete
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tag_gabinete, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @gabinete_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'gabinete_not_found', message: 'Gabinete does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        gabinete: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagGabinete: row.tag_gabinete,
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
