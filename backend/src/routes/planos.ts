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
 * nucleo.plano (migración 014) — identidad del dibujo de ingeniería,
 * deliberadamente separada de ENTREGABLE/REVISION_ENTREGABLE (documento
 * generado por SIEI desde plantilla). Ver docs/DIAGNOSTICO_SENALES_
 * GABINETES.md sección 35 para la evidencia real que motivó este diseño.
 *
 * `codigoPlano` es opcional y deliberadamente SIN unicidad — se encontró
 * un duplicado real en el único dataset disponible (`620-J-20039`,
 * compartido por dos documentos distintos), así que un índice único
 * bloquearía una importación legítima. `plano.id` es la identidad real.
 *
 * Las asociaciones a gabinete/caja son N:M reales (evidencia real: un
 * gabinete con 7 planos propios; un plano con dos cajas a la vez) — se
 * modelan como tablas de unión propias (gabinete_plano/caja_plano), no
 * como una relación polimórfica genérica, mismo principio que el resto
 * del esquema.
 */
export const planosRouter = Router({ mergeParams: true });

planosRouter.use(authenticate);


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

const SELECT_PLANO = `
  p.id, p.proyecto_id, p.codigo_plano, p.codigo_anterior, p.descripcion, p.activo,
  p.tipo_plano_id, t.codigo AS tipo_plano_codigo, t.descripcion AS tipo_plano_descripcion,
  p.created_at, p.updated_at, p.created_by, p.updated_by
`;

const PLANO_FROM = `
  FROM nucleo.plano p
  LEFT JOIN cat.cat_tipo_plano t ON t.id = p.tipo_plano_id
`;

function serializePlano(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    codigoPlano: row.codigo_plano,
    codigoAnterior: row.codigo_anterior,
    descripcion: row.descripcion,
    active: Boolean(row.activo),
    tipoPlanoId: row.tipo_plano_id === null ? null : String(row.tipo_plano_id),
    tipoPlanoCodigo: row.tipo_plano_codigo,
    tipoPlanoDescripcion: row.tipo_plano_descripcion,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

function serializeGabineteAsociado(row: Record<string, any>) {
  return {
    gabineteId: String(row.gabinete_id),
    tagGabinete: row.tag_gabinete,
    tipoGabineteCodigo: row.tipo_gabinete_codigo
  };
}

function serializeCajaAsociada(row: Record<string, any>) {
  return {
    cajaId: String(row.caja_id),
    tagCaja: row.tag_caja
  };
}

/*
 * GET .../planos/:planoId → incluye, además de los campos propios, los
 * gabinetes y cajas asociados ya resueltos (no solo ids sueltos) — evita
 * que el frontend tenga que hacer 3 llamadas separadas para armar el
 * detalle.
 */
async function fetchPlanoDetail(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  projectId: string,
  planoId: string
) {
  const planoResult = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('plano_id', sql.NVarChar(30), planoId)
    .query(`
      SELECT ${SELECT_PLANO}
      ${PLANO_FROM}
      WHERE p.id = TRY_CONVERT(BIGINT, @plano_id)
        AND p.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND p.activo = 1;
    `);

  const row = planoResult.recordset[0];
  if (!row) return null;

  const gabinetesResult = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('plano_id', sql.NVarChar(30), planoId)
    .query(`
      SELECT gp.gabinete_id, g.tag_gabinete, tg.codigo AS tipo_gabinete_codigo
      FROM nucleo.gabinete_plano gp
      JOIN nucleo.gabinete g ON g.id = gp.gabinete_id AND g.proyecto_id = gp.proyecto_id
      LEFT JOIN cat.cat_tipo_gabinete tg ON tg.id = g.tipo_gabinete_id
      WHERE gp.plano_id = TRY_CONVERT(BIGINT, @plano_id)
        AND gp.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND gp.activo = 1
      ORDER BY g.tag_gabinete;
    `);

  const cajasResult = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('plano_id', sql.NVarChar(30), planoId)
    .query(`
      SELECT cp.caja_id, c.tag_caja
      FROM nucleo.caja_plano cp
      JOIN nucleo.caja c ON c.id = cp.caja_id AND c.proyecto_id = cp.proyecto_id
      WHERE cp.plano_id = TRY_CONVERT(BIGINT, @plano_id)
        AND cp.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND cp.activo = 1
      ORDER BY c.tag_caja;
    `);

  return {
    ...serializePlano(row),
    gabinetes: gabinetesResult.recordset.map(serializeGabineteAsociado),
    cajas: cajasResult.recordset.map(serializeCajaAsociada)
  };
}


/*
 * GET /api/projects/:projectId/planos
 *
 * Filtros: ?tipoPlanoId=, ?gabineteId= (join a gabinete_plano), ?cajaId=
 * (join a caja_plano) — mismo patrón de filtros por querystring ya usado
 * en connectionPoints.ts/racks.ts.
 */
planosRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const { tipoPlanoId, gabineteId, cajaId } = req.query;

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      const conditions = ['p.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)', 'p.activo = 1'];

      if (tipoPlanoId !== undefined) {
        if (!isPositiveIntString(tipoPlanoId)) {
          res.status(400).json({ error: 'validation_error', message: 'tipoPlanoId must be a positive integer.' });
          return;
        }
        request.input('tipo_plano_id', sql.NVarChar(30), tipoPlanoId);
        conditions.push('p.tipo_plano_id = TRY_CONVERT(BIGINT, @tipo_plano_id)');
      }

      if (gabineteId !== undefined) {
        if (!isPositiveIntString(gabineteId)) {
          res.status(400).json({ error: 'validation_error', message: 'gabineteId must be a positive integer.' });
          return;
        }
        request.input('gabinete_id', sql.NVarChar(30), gabineteId);
        conditions.push(`EXISTS (
          SELECT 1 FROM nucleo.gabinete_plano gp
          WHERE gp.plano_id = p.id AND gp.proyecto_id = p.proyecto_id
            AND gp.gabinete_id = TRY_CONVERT(BIGINT, @gabinete_id) AND gp.activo = 1
        )`);
      }

      if (cajaId !== undefined) {
        if (!isPositiveIntString(cajaId)) {
          res.status(400).json({ error: 'validation_error', message: 'cajaId must be a positive integer.' });
          return;
        }
        request.input('caja_id', sql.NVarChar(30), cajaId);
        conditions.push(`EXISTS (
          SELECT 1 FROM nucleo.caja_plano cp
          WHERE cp.plano_id = p.id AND cp.proyecto_id = p.proyecto_id
            AND cp.caja_id = TRY_CONVERT(BIGINT, @caja_id) AND cp.activo = 1
        )`);
      }

      const result = await request.query(`
        SELECT ${SELECT_PLANO}
        ${PLANO_FROM}
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.codigo_plano, p.id;
      `);

      res.status(200).json({
        projectId,
        planos: result.recordset.map(serializePlano)
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/planos/:planoId
 */
planosRouter.get(
  '/:planoId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const planoId = normalizeParam(req.params.planoId);

      if (!planoId || !isPositiveIntString(planoId)) {
        res.status(400).json({ error: 'invalid_plano_id', message: 'planoId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const detail = await fetchPlanoDetail(pool, projectId, planoId);

      if (!detail) {
        res.status(404).json({ error: 'plano_not_found', message: 'Plano does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ plano: detail });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/planos
 *
 * codigoPlano y codigoAnterior son opcionales, sin unicidad. descripcion
 * y tipoPlanoId son obligatorios. Las asociaciones a gabinete/caja NO se
 * aceptan en este body — son su propio sub-recurso (ver más abajo),
 * porque la relación es N:M real, no un "dueño único" resoluble al crear.
 */
planosRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const { codigoPlano = null, codigoAnterior = null, descripcion, tipoPlanoId } = req.body ?? {};

      if (typeof descripcion !== 'string' || descripcion.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion is required.' });
        return;
      }

      if (descripcion.length > 300) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion cannot exceed 300 characters.' });
        return;
      }

      if (tipoPlanoId === null || tipoPlanoId === undefined || !isPositiveIntString(String(tipoPlanoId))) {
        res.status(400).json({ error: 'validation_error', message: 'tipoPlanoId is required and must be a numeric id.' });
        return;
      }

      if (codigoPlano !== null && (typeof codigoPlano !== 'string' || codigoPlano.length > 50)) {
        res.status(400).json({ error: 'validation_error', message: 'codigoPlano must be a string of at most 50 characters, or null.' });
        return;
      }

      if (codigoAnterior !== null && (typeof codigoAnterior !== 'string' || codigoAnterior.length > 50)) {
        res.status(400).json({ error: 'validation_error', message: 'codigoAnterior must be a string of at most 50 characters, or null.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('codigo_plano', sql.NVarChar(50), codigoPlano)
        .input('codigo_anterior', sql.NVarChar(50), codigoAnterior)
        .input('descripcion', sql.NVarChar(300), descripcion.trim())
        .input('tipo_plano_id', sql.NVarChar(30), tipoPlanoId)
        .query(`
          INSERT INTO nucleo.plano (proyecto_id, codigo_plano, codigo_anterior, descripcion, tipo_plano_id, activo, created_at, created_by)
          OUTPUT INSERTED.id
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), @codigo_plano, @codigo_anterior, @descripcion,
            TRY_CONVERT(BIGINT, @tipo_plano_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const newId = String(insertResult.recordset[0].id);
      const detail = await fetchPlanoDetail(pool, projectId, newId);

      res
        .status(201)
        .location(`/api/projects/${projectId}/planos/${newId}`)
        .json({ plano: detail });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoPlanoId does not exist.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/planos/:planoId
 */
planosRouter.patch(
  '/:planoId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const planoId = normalizeParam(req.params.planoId);

      if (!planoId || !isPositiveIntString(planoId)) {
        res.status(400).json({ error: 'invalid_plano_id', message: 'planoId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        codigoPlano: { column: 'codigo_plano', sqlType: sql.NVarChar(50), max: 50 },
        codigoAnterior: { column: 'codigo_anterior', sqlType: sql.NVarChar(50), max: 50 },
        descripcion: { column: 'descripcion', sqlType: sql.NVarChar(300), max: 300 },
        tipoPlanoId: { column: 'tipo_plano_id', sqlType: sql.NVarChar(30), max: Infinity }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if ('descripcion' in body && (typeof body.descripcion !== 'string' || body.descripcion.trim().length === 0)) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion cannot be empty or null.' });
        return;
      }

      if ('tipoPlanoId' in body && (body.tipoPlanoId === null || !isPositiveIntString(String(body.tipoPlanoId)))) {
        res.status(400).json({ error: 'validation_error', message: 'tipoPlanoId cannot be null and must be a numeric id.' });
        return;
      }

      for (const key of keys) {
        if (key === 'tipoPlanoId' || key === 'descripcion') continue;
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
        .input('plano_id', sql.NVarChar(30), planoId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        const value = key === 'descripcion' ? body[key].trim() : body[key];
        request.input(parameter, config.sqlType, value);
        assignments.push(
          key === 'tipoPlanoId'
            ? `${config.column} = TRY_CONVERT(BIGINT, @${parameter})`
            : `${config.column} = @${parameter}`
        );
      });

      await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.plano
          WHERE id = TRY_CONVERT(BIGINT, @plano_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54402, 'El plano no existe en este proyecto o está inactivo.', 1;
        END;

        UPDATE nucleo.plano
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        WHERE id = TRY_CONVERT(BIGINT, @plano_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      const detail = await fetchPlanoDetail(pool, projectId, planoId);
      res.status(200).json({ plano: detail });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54402) {
        res.status(404).json({ error: 'plano_not_found', message: 'Plano does not exist in this project or is inactive.' });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoPlanoId does not exist.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/planos/:planoId
 *
 * Desactivación lógica. No hay trigger que bloquee por uso (a diferencia
 * de canal/módulo) — desactivar un plano deja sus asociaciones a
 * gabinete/caja como filas activas huérfanas apuntando a un plano
 * inactivo (mismo criterio que otras tablas del esquema: la
 * desactivación no cascadea hacia relaciones que no cascadean hoy).
 */
planosRouter.delete(
  '/:planoId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const planoId = normalizeParam(req.params.planoId);

      if (!planoId || !isPositiveIntString(planoId)) {
        res.status(400).json({ error: 'invalid_plano_id', message: 'planoId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('plano_id', sql.NVarChar(30), planoId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.plano
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.codigo_plano, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @plano_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'plano_not_found', message: 'Plano does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        plano: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          codigoPlano: row.codigo_plano,
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


/*
 * Asociaciones N:M — gabinete_plano / caja_plano.
 *
 * Si ya existe la misma pareja (gabinete_id, plano_id) INACTIVA, se
 * reactiva en vez de insertar una fila nueva — evita duplicar historial
 * de asociaciones sin necesidad (aprobado explícitamente para 014).
 */

async function associateEntidad(
  kind: 'gabinete' | 'caja',
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const projectId = req.projectAccess!.projectId;
    const userId = req.authUser!.id;
    const planoId = normalizeParam(req.params.planoId);
    const entidadId = kind === 'gabinete' ? req.body?.gabineteId : req.body?.cajaId;
    const entidadIdField = kind === 'gabinete' ? 'gabineteId' : 'cajaId';

    if (!planoId || !isPositiveIntString(planoId)) {
      res.status(400).json({ error: 'invalid_plano_id', message: 'planoId must be a positive integer.' });
      return;
    }

    if (!isPositiveIntString(entidadId)) {
      res.status(400).json({ error: 'validation_error', message: `${entidadIdField} is required and must be a numeric id.` });
      return;
    }

    const table = kind === 'gabinete' ? 'nucleo.gabinete_plano' : 'nucleo.caja_plano';
    const fkColumn = kind === 'gabinete' ? 'gabinete_id' : 'caja_id';
    const entidadTable = kind === 'gabinete' ? 'nucleo.gabinete' : 'nucleo.caja';

    const pool = await getDbPool();

    const result = await pool
      .request()
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .input('plano_id', sql.NVarChar(30), planoId)
      .input('entidad_id', sql.NVarChar(30), entidadId)
      .input('created_by', sql.NVarChar(30), userId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.plano
          WHERE id = TRY_CONVERT(BIGINT, @plano_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
        )
        BEGIN
          THROW 54402, 'El plano no existe en este proyecto o está inactivo.', 1;
        END;

        IF NOT EXISTS (
          SELECT 1 FROM ${entidadTable}
          WHERE id = TRY_CONVERT(BIGINT, @entidad_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
        )
        BEGIN
          THROW 54403, 'La entidad referenciada no existe en este proyecto o está inactiva.', 1;
        END;

        IF EXISTS (
          SELECT 1 FROM ${table}
          WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @entidad_id)
            AND plano_id = TRY_CONVERT(BIGINT, @plano_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54404, 'Esa asociación ya existe y está activa.', 1;
        END;

        IF EXISTS (
          SELECT 1 FROM ${table}
          WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @entidad_id)
            AND plano_id = TRY_CONVERT(BIGINT, @plano_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 0
        )
        BEGIN
          DECLARE @reactivados TABLE (id BIGINT);

          UPDATE ${table}
          SET activo = 1, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @created_by)
          OUTPUT INSERTED.id INTO @reactivados
          WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @entidad_id)
            AND plano_id = TRY_CONVERT(BIGINT, @plano_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 0;

          SELECT id, 'reactivated' AS action FROM @reactivados;
        END
        ELSE
        BEGIN
          DECLARE @nuevos TABLE (id BIGINT);

          INSERT INTO ${table} (proyecto_id, ${fkColumn}, plano_id, activo, created_at, created_by)
          OUTPUT INSERTED.id INTO @nuevos
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @entidad_id), TRY_CONVERT(BIGINT, @plano_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));

          SELECT id, 'created' AS action FROM @nuevos;
        END
      `);

    const row = result.recordset[0];
    const detail = await fetchPlanoDetail(pool, projectId, planoId);

    res.status(row.action === 'created' ? 201 : 200).json({ plano: detail });

  } catch (error) {
    const number = sqlErrorNumber(error);

    if (number === 54402) {
      res.status(404).json({ error: 'plano_not_found', message: 'Plano does not exist in this project or is inactive.' });
      return;
    }

    if (number === 54403) {
      res.status(400).json({ error: 'invalid_reference', message: 'La entidad referenciada no existe en este proyecto o está inactiva.' });
      return;
    }

    if (number === 54404) {
      const conflictError = kind === 'gabinete' ? 'gabinete_plano_conflict' : 'caja_plano_conflict';
      res.status(409).json({ error: conflictError, message: 'Esa asociación ya existe y está activa.' });
      return;
    }

    if (number === 547) {
      res.status(400).json({ error: 'invalid_reference', message: 'La referencia no existe o no pertenece a este proyecto.' });
      return;
    }

    next(error);
  }
}

planosRouter.post(
  '/:planoId/gabinetes',
  requireProjectPermission('write'),
  (req, res, next) => associateEntidad('gabinete', req, res, next)
);

planosRouter.post(
  '/:planoId/cajas',
  requireProjectPermission('write'),
  (req, res, next) => associateEntidad('caja', req, res, next)
);

async function disassociateEntidad(
  kind: 'gabinete' | 'caja',
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const projectId = req.projectAccess!.projectId;
    const userId = req.authUser!.id;
    const planoId = normalizeParam(req.params.planoId);
    const entidadId = normalizeParam(kind === 'gabinete' ? req.params.gabineteId : req.params.cajaId);

    if (!planoId || !isPositiveIntString(planoId) || !entidadId || !isPositiveIntString(entidadId)) {
      res.status(400).json({ error: 'validation_error', message: 'planoId and the associated entity id must be positive integers.' });
      return;
    }

    const table = kind === 'gabinete' ? 'nucleo.gabinete_plano' : 'nucleo.caja_plano';
    const fkColumn = kind === 'gabinete' ? 'gabinete_id' : 'caja_id';

    const pool = await getDbPool();
    const result = await pool
      .request()
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .input('plano_id', sql.NVarChar(30), planoId)
      .input('entidad_id', sql.NVarChar(30), entidadId)
      .input('updated_by', sql.NVarChar(30), userId)
      .query(`
        UPDATE ${table}
        SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT INSERTED.id
        WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @entidad_id)
          AND plano_id = TRY_CONVERT(BIGINT, @plano_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

    if (result.recordset.length === 0) {
      res.status(404).json({ error: 'association_not_found', message: 'No se encontró una asociación activa con esos datos.' });
      return;
    }

    const detail = await fetchPlanoDetail(pool, projectId, planoId);
    res.status(200).json({ plano: detail });

  } catch (error) {
    next(error);
  }
}

planosRouter.delete(
  '/:planoId/gabinetes/:gabineteId',
  requireProjectPermission('write'),
  (req, res, next) => disassociateEntidad('gabinete', req, res, next)
);

planosRouter.delete(
  '/:planoId/cajas/:cajaId',
  requireProjectPermission('write'),
  (req, res, next) => disassociateEntidad('caja', req, res, next)
);
