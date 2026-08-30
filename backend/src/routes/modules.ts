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
 * nucleo.modulo — depende de SLOT (1 módulo activo por slot, UX_modulo_slot)
 * y de cat.cat_modulo_io (catálogo global de hardware). A diferencia de
 * rack/slot, SÍ tiene lógica en triggers:
 *
 *   - TR_modulo_generar_canales: crear/reasignar catalogo_modulo_id genera
 *     los CANALES automáticamente (0..canales_max-1); reducir canales_max
 *     desactiva los canales sobrantes, y lo rechaza (51001) si alguno de
 *     esos canales tiene una señal activa.
 *   - TR_modulo_validar_desactivacion: rechaza (51019) desactivar un módulo
 *     que tenga canales activos en uso por señales activas.
 *
 * El backend no reimplementa nada de eso — solo traduce esos THROW y las
 * violaciones de índice único/FK a HTTP. Como la tabla tiene triggers,
 * igual que nucleo.senal, el OUTPUT de INSERT/UPDATE debe ir a una tabla
 * variable (SQL Server error 334 si no).
 */
export const modulesRouter = Router({ mergeParams: true });

modulesRouter.use(authenticate);


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

function mapModuleSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  if (number === 54601 || message.includes('UX_modulo_slot')) {
    return {
      status: 409,
      body: { error: 'module_slot_conflict', message: 'Ese slot ya tiene un módulo activo.' }
    };
  }

  if (number === 54602) {
    return {
      status: 404,
      body: { error: 'module_not_found', message: 'El módulo no existe en este proyecto o está inactivo.' }
    };
  }

  if (number === 51001) {
    return {
      status: 409,
      body: {
        error: 'module_capacity_conflict',
        message: 'No se puede reducir la capacidad del módulo: hay canales fuera de rango con señal activa.'
      }
    };
  }

  if (number === 51019) {
    return {
      status: 409,
      body: {
        error: 'module_channels_in_use',
        message: 'No se puede desactivar un módulo con canales activos en uso por señales activas.'
      }
    };
  }

  if (number === 547) {
    if (message.includes('FK_modulo_slot')) {
      return { status: 400, body: { error: 'invalid_reference', message: 'slotId no existe, está inactivo, o no pertenece a este proyecto.' } };
    }
    if (message.includes('FK_modulo_catalogo_modulo')) {
      return { status: 400, body: { error: 'invalid_reference', message: 'catalogoModuloId no existe en el catálogo de tipos de módulo.' } };
    }
  }

  return null;
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    slotId: String(row.slot_id),
    catalogoModuloId: String(row.catalogo_modulo_id),
    fabricante: row.fabricante,
    modelo: row.modelo,
    canalesMax: row.canales_max,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const SELECT_COLUMNS = `
  m.id, m.proyecto_id, m.slot_id, m.catalogo_modulo_id,
  cmi.fabricante, cmi.modelo, cmi.canales_max,
  m.activo, m.created_at, m.updated_at, m.created_by, m.updated_by
`;

const FROM_CLAUSE = `
  FROM nucleo.modulo m
  JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
`;


/*
 * GET /api/projects/:projectId/modules?slotId=
 */
modulesRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const slotIdFilter = normalizeParam(req.query.slotId as string | string[] | undefined);

      if (slotIdFilter !== undefined && !isPositiveIntString(slotIdFilter)) {
        res.status(400).json({ error: 'invalid_slot_id', message: 'slotId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (slotIdFilter) request.input('slot_id', sql.NVarChar(30), slotIdFilter);

      const result = await request.query(`
        SELECT ${SELECT_COLUMNS}
        ${FROM_CLAUSE}
        WHERE m.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND m.activo = 1
          ${slotIdFilter ? 'AND m.slot_id = TRY_CONVERT(BIGINT, @slot_id)' : ''}
        ORDER BY m.slot_id;
      `);

      res.status(200).json({ projectId, modules: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/modules/:moduleId
 */
modulesRouter.get(
  '/:moduleId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const moduleId = normalizeParam(req.params.moduleId);

      if (!isPositiveIntString(moduleId)) {
        res.status(400).json({ error: 'invalid_module_id', message: 'moduleId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE m.id = TRY_CONVERT(BIGINT, @modulo_id)
            AND m.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND m.activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'module_not_found', message: 'Module does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ module: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/modules
 *
 * Crear un módulo dispara TR_modulo_generar_canales: los canales
 * (0..canalesMax-1 del tipo elegido) se crean solos.
 */
modulesRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { slotId, catalogoModuloId } = req.body ?? {};

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'validation_error', message: 'slotId is required and must be a numeric id.' });
        return;
      }

      if (!isPositiveIntString(catalogoModuloId)) {
        res.status(400).json({ error: 'validation_error', message: 'catalogoModuloId is required and must be a numeric id.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .input('catalogo_modulo_id', sql.NVarChar(30), catalogoModuloId);

      const insertResult = await request.query(`
        IF EXISTS (
          SELECT 1 FROM nucleo.modulo
          WHERE slot_id = TRY_CONVERT(BIGINT, @slot_id) AND activo = 1
        )
        BEGIN
          THROW 54601, 'Ese slot ya tiene un módulo activo.', 1;
        END;

        DECLARE @nuevos_ids TABLE (id BIGINT);

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at, created_by)
        OUTPUT INSERTED.id INTO @nuevos_ids
        VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @slot_id), TRY_CONVERT(BIGINT, @catalogo_modulo_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));

        SELECT id FROM @nuevos_ids;
      `);

      const newId = String(insertResult.recordset[0].id);

      const finalResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), newId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE m.id = TRY_CONVERT(BIGINT, @modulo_id)
            AND m.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      res
        .status(201)
        .location(`/api/projects/${projectId}/modules/${newId}`)
        .json({ module: serialize(finalResult.recordset[0]) });

    } catch (error) {
      const mapped = mapModuleSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/modules/:moduleId
 *
 * Solo permite reasignar catalogoModuloId (p.ej. subir de un módulo de 8
 * canales a uno de 16). Reasignar slotId no está soportado aquí, igual que
 * en racks/slots.
 */
modulesRouter.patch(
  '/:moduleId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const moduleId = normalizeParam(req.params.moduleId);

      if (!isPositiveIntString(moduleId)) {
        res.status(400).json({ error: 'invalid_module_id', message: 'moduleId must be a positive integer.' });
        return;
      }

      const { catalogoModuloId } = req.body ?? {};

      if (!isPositiveIntString(catalogoModuloId)) {
        res.status(400).json({ error: 'validation_error', message: 'catalogoModuloId is required and must be a numeric id.' });
        return;
      }

      const pool = await getDbPool();

      await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .input('catalogo_modulo_id', sql.NVarChar(30), catalogoModuloId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          IF NOT EXISTS (
            SELECT 1 FROM nucleo.modulo
            WHERE id = TRY_CONVERT(BIGINT, @modulo_id)
              AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND activo = 1
          )
          BEGIN
            THROW 54602, 'El módulo no existe en este proyecto o está inactivo.', 1;
          END;

          UPDATE nucleo.modulo
          SET catalogo_modulo_id = TRY_CONVERT(BIGINT, @catalogo_modulo_id),
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @updated_by)
          WHERE id = TRY_CONVERT(BIGINT, @modulo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const finalResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE m.id = TRY_CONVERT(BIGINT, @modulo_id)
            AND m.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      res.status(200).json({ module: serialize(finalResult.recordset[0]) });

    } catch (error) {
      const mapped = mapModuleSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/modules/:moduleId
 *
 * Desactivación lógica. Bloqueada por TR_modulo_validar_desactivacion
 * (51019) si el módulo tiene canales activos en uso por señales activas.
 */
modulesRouter.delete(
  '/:moduleId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const moduleId = normalizeParam(req.params.moduleId);

      if (!isPositiveIntString(moduleId)) {
        res.status(400).json({ error: 'invalid_module_id', message: 'moduleId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivados TABLE (
            id BIGINT, proyecto_id BIGINT, slot_id BIGINT, activo BIT,
            updated_at DATETIME2, updated_by BIGINT
          );

          UPDATE nucleo.modulo
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.slot_id, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @modulo_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'module_not_found', message: 'Module does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        module: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          slotId: String(row.slot_id),
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const mapped = mapModuleSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/modules/:moduleId/terminales (migración 015)
 *
 * Lectura del bloque_terminal + terminal + posicion_terminal
 * materializados automáticamente por TR_modulo_generar_terminales — el
 * backend no construye nada aquí, solo lee lo que ya generó la BD.
 */
modulesRouter.get(
  '/:moduleId/terminales',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const moduleId = normalizeParam(req.params.moduleId);
      if (!isPositiveIntString(moduleId)) {
        res.status(400).json({ error: 'invalid_module_id', message: 'moduleId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const bloqueResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .query(`
          SELECT id, codigo, descripcion, activo
          FROM nucleo.bloque_terminal
          WHERE modulo_id = TRY_CONVERT(BIGINT, @modulo_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
        `);

      const bloque = bloqueResult.recordset[0];
      if (!bloque) {
        res.status(200).json({ bloqueTerminal: null, terminales: [] });
        return;
      }

      const terminalesResult = await pool
        .request()
        .input('bloque_id', sql.NVarChar(30), String(bloque.id))
        .query(`
          SELECT t.id, t.numero, t.catalogo_modulo_io_terminal_id, cmit.numero_canal, cmit.orden_terminal
          FROM nucleo.terminal t
          LEFT JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = t.catalogo_modulo_io_terminal_id
          WHERE t.bloque_terminal_id = TRY_CONVERT(BIGINT, @bloque_id) AND t.activo = 1
          ORDER BY cmit.numero_canal, cmit.orden_terminal, t.numero;
        `);

      const terminales = [];
      for (const t of terminalesResult.recordset) {
        const posicionesResult = await pool
          .request()
          .input('terminal_id', sql.NVarChar(30), String(t.id))
          .query(`
            SELECT pt.id, pt.codigo, pt.activo, CASE WHEN te.id IS NOT NULL THEN 1 ELSE 0 END AS in_use
            FROM nucleo.posicion_terminal pt
            LEFT JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
            WHERE pt.terminal_id = TRY_CONVERT(BIGINT, @terminal_id) AND pt.activo = 1
            ORDER BY pt.codigo;
          `);
        terminales.push({
          id: String(t.id),
          numero: t.numero,
          numeroCanal: t.numero_canal,
          ordenTerminal: t.orden_terminal,
          posiciones: posicionesResult.recordset.map((p) => ({
            id: String(p.id), codigo: p.codigo, active: Boolean(p.activo), inUse: Boolean(p.in_use)
          }))
        });
      }

      res.status(200).json({
        bloqueTerminal: { id: String(bloque.id), codigo: bloque.codigo, descripcion: bloque.descripcion, active: Boolean(bloque.activo) },
        terminales
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/modules/:moduleId/sync-terminales
 * (migración 015)
 *
 * Invoca nucleo.sp_sincronizar_terminales_modulo — necesario cuando se
 * agregan filas nuevas a cat.cat_modulo_io_terminal DESPUÉS de que el
 * módulo ya fue instalado (agregar una fila de catálogo no dispara
 * ningún trigger de nucleo.modulo, esa tabla no cambió). Idempotente:
 * no duplica los terminales ya materializados.
 */
modulesRouter.post(
  '/:moduleId/sync-terminales',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const moduleId = normalizeParam(req.params.moduleId);
      if (!isPositiveIntString(moduleId)) {
        res.status(400).json({ error: 'invalid_module_id', message: 'moduleId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      const moduleResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .query(`SELECT id FROM nucleo.modulo WHERE id = TRY_CONVERT(BIGINT, @modulo_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;`);

      if (!moduleResult.recordset[0]) {
        res.status(404).json({ error: 'module_not_found', message: 'Module does not exist in this project or is inactive.' });
        return;
      }

      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await new sql.Request(transaction)
          .input('modulo_id', sql.NVarChar(30), moduleId)
          .input('actor_id', sql.NVarChar(30), userId)
          .query(`
            DECLARE @modulo_id_bigint BIGINT = TRY_CONVERT(BIGINT, @modulo_id);
            DECLARE @actor_id_bigint BIGINT = TRY_CONVERT(BIGINT, @actor_id);
            EXEC nucleo.sp_sincronizar_terminales_modulo @modulo_id = @modulo_id_bigint, @actor_id = @actor_id_bigint;
          `);
        await transaction.commit();
      } catch (procError) {
        await transaction.rollback();
        throw procError;
      }

      res.status(200).json({ synced: true });

    } catch (error) {
      next(error);
    }
  }
);
