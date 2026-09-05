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

  if (number === 51035) {
    return {
      status: 409,
      body: {
        error: 'module_tipo_io_conflict',
        message: 'No se puede cambiar el tipo de E/S del módulo: tiene canales con señal activa.'
      }
    };
  }

  if (number === 51036) {
    return {
      status: 409,
      body: {
        error: 'module_plano_gabinete_conflict',
        message: 'Todos los módulos asignados a un mismo plano deben pertenecer al mismo gabinete.'
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
    if (message.includes('FK_modulo_plano')) {
      return { status: 400, body: { error: 'invalid_reference', message: 'planoId no existe o no pertenece a este proyecto.' } };
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
    tipoIoCodigo: row.tipo_io_codigo,
    canalesMax: row.canales_max,
    tag: row.tag,
    surgeProtectorTag: row.surge_protector_tag,
    planoId: row.plano_id === null ? null : String(row.plano_id),
    planoCodigoPlano: row.plano_codigo_plano,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const SELECT_COLUMNS = `
  m.id, m.proyecto_id, m.slot_id, m.catalogo_modulo_id,
  cmi.fabricante, cmi.modelo, cmi.canales_max, tio.codigo AS tipo_io_codigo,
  m.tag, m.surge_protector_tag,
  m.plano_id, pl.codigo_plano AS plano_codigo_plano,
  m.activo, m.created_at, m.updated_at, m.created_by, m.updated_by
`;

const FROM_CLAUSE = `
  FROM nucleo.modulo m
  JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
  JOIN cat.cat_tipo_io tio ON tio.id = cmi.tipo_io_id
  LEFT JOIN nucleo.plano pl ON pl.id = m.plano_id
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
      const { slotId, catalogoModuloId, tag = null, surgeProtectorTag = null } = req.body ?? {};

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'validation_error', message: 'slotId is required and must be a numeric id.' });
        return;
      }

      if (!isPositiveIntString(catalogoModuloId)) {
        res.status(400).json({ error: 'validation_error', message: 'catalogoModuloId is required and must be a numeric id.' });
        return;
      }

      if (tag !== null && (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > 20)) {
        res.status(400).json({ error: 'validation_error', message: 'tag must be a non-empty string of at most 20 characters, or null.' });
        return;
      }

      if (surgeProtectorTag !== null && (typeof surgeProtectorTag !== 'string' || surgeProtectorTag.trim().length === 0 || surgeProtectorTag.length > 20)) {
        res.status(400).json({ error: 'validation_error', message: 'surgeProtectorTag must be a non-empty string of at most 20 characters, or null.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .input('catalogo_modulo_id', sql.NVarChar(30), catalogoModuloId)
        .input('tag_explicito', sql.NVarChar(20), tag)
        .input('surge_protector_tag', sql.NVarChar(20), surgeProtectorTag);

      const insertResult = await request.query(`
        IF EXISTS (
          SELECT 1 FROM nucleo.modulo
          WHERE slot_id = TRY_CONVERT(BIGINT, @slot_id) AND activo = 1
        )
        BEGIN
          THROW 54601, 'Ese slot ya tiene un módulo activo.', 1;
        END;

        -- tag sugerido por defecto (solo si no vino explícito en el body):
        -- {TIPO_IO}-{2 dígitos}, contando SOLO los módulos del mismo
        -- tipo_io en el mismo rack que YA tienen tag puesto — un módulo
        -- del mismo tipo sin tag todavía no consume número (pedido
        -- explícito del usuario: "si a un módulo no le pongo tag, se
        -- salta"). Nunca recalcula tags ya asignados a otros módulos.
        DECLARE @tag NVARCHAR(20) = @tag_explicito;
        IF @tag IS NULL
        BEGIN
          DECLARE @rack_id BIGINT = (SELECT rack_id FROM nucleo.slot WHERE id = TRY_CONVERT(BIGINT, @slot_id));
          DECLARE @tipo_io_codigo NVARCHAR(20) = (
            SELECT tio.codigo FROM cat.cat_modulo_io cmi
            JOIN cat.cat_tipo_io tio ON tio.id = cmi.tipo_io_id
            WHERE cmi.id = TRY_CONVERT(BIGINT, @catalogo_modulo_id)
          );
          DECLARE @siguiente_orden INT = (
            SELECT COUNT(*) + 1
            FROM nucleo.modulo m2
            JOIN nucleo.slot s2 ON s2.id = m2.slot_id
            JOIN cat.cat_modulo_io cmi2 ON cmi2.id = m2.catalogo_modulo_id
            JOIN cat.cat_tipo_io tio2 ON tio2.id = cmi2.tipo_io_id
            WHERE s2.rack_id = @rack_id
              AND m2.activo = 1
              AND m2.tag IS NOT NULL
              AND tio2.codigo = @tipo_io_codigo
          );
          SET @tag = @tipo_io_codigo + '-' + RIGHT('0' + CAST(@siguiente_orden AS NVARCHAR(10)), 2);
        END;

        DECLARE @nuevos_ids TABLE (id BIGINT);

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, tag, surge_protector_tag, activo, created_at, created_by)
        OUTPUT INSERTED.id INTO @nuevos_ids
        VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @slot_id), TRY_CONVERT(BIGINT, @catalogo_modulo_id), @tag, @surge_protector_tag, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));

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
 * catalogoModuloId (p.ej. subir de un módulo de 8 canales a uno de 16),
 * tag y surgeProtectorTag (NVARCHAR(20), migración 017) se pueden editar
 * de forma independiente — al menos uno es requerido. tag/surgeProtectorTag
 * aceptan `null` explícito (quitar el tag / quitar el surge protector).
 * planoId (migración 024, "en qué plano de conexionado está este módulo")
 * también acepta `null` explícito (quitarlo de su plano actual);
 * asignarlo dispara TR_modulo_validar_plano_gabinete, que rechaza
 * (51036) mezclar módulos de dos gabinetes distintos en el mismo plano.
 * Reasignar slotId no está soportado aquí, igual que en racks/slots.
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

      const body = req.body ?? {};
      const hasCatalogoModuloId = 'catalogoModuloId' in body;
      const hasTag = 'tag' in body;
      const hasSurgeProtectorTag = 'surgeProtectorTag' in body;
      const hasPlanoId = 'planoId' in body;

      if (!hasCatalogoModuloId && !hasTag && !hasSurgeProtectorTag && !hasPlanoId) {
        res.status(400).json({ error: 'validation_error', message: 'At least one of catalogoModuloId/tag/surgeProtectorTag/planoId is required.' });
        return;
      }

      if (hasPlanoId && body.planoId !== null && !isPositiveIntString(body.planoId)) {
        res.status(400).json({ error: 'validation_error', message: 'planoId must be a numeric id or null.' });
        return;
      }

      if (hasCatalogoModuloId && !isPositiveIntString(body.catalogoModuloId)) {
        res.status(400).json({ error: 'validation_error', message: 'catalogoModuloId must be a numeric id.' });
        return;
      }

      if (hasTag && body.tag !== null && (typeof body.tag !== 'string' || body.tag.trim().length === 0 || body.tag.length > 20)) {
        res.status(400).json({ error: 'validation_error', message: 'tag must be a non-empty string of at most 20 characters, or null.' });
        return;
      }

      if (
        hasSurgeProtectorTag &&
        body.surgeProtectorTag !== null &&
        (typeof body.surgeProtectorTag !== 'string' || body.surgeProtectorTag.trim().length === 0 || body.surgeProtectorTag.length > 20)
      ) {
        res.status(400).json({ error: 'validation_error', message: 'surgeProtectorTag must be a non-empty string of at most 20 characters, or null.' });
        return;
      }

      const pool = await getDbPool();
      const assignments: string[] = [];
      const request = pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .input('updated_by', sql.NVarChar(30), userId);

      if (hasCatalogoModuloId) {
        request.input('catalogo_modulo_id', sql.NVarChar(30), body.catalogoModuloId);
        assignments.push('catalogo_modulo_id = TRY_CONVERT(BIGINT, @catalogo_modulo_id)');
      }
      if (hasTag) {
        request.input('tag', sql.NVarChar(20), body.tag);
        assignments.push('tag = @tag');
      }
      if (hasSurgeProtectorTag) {
        request.input('surge_protector_tag', sql.NVarChar(20), body.surgeProtectorTag);
        assignments.push('surge_protector_tag = @surge_protector_tag');
      }
      if (hasPlanoId) {
        request.input('plano_id', sql.NVarChar(30), body.planoId);
        assignments.push('plano_id = TRY_CONVERT(BIGINT, @plano_id)');
      }

      await request.query(`
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
          SET ${assignments.join(', ')},
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
/*
 * DELETE /api/projects/:projectId/modules/:moduleId
 *
 * BORRADO FÍSICO REAL (pedido explícito del usuario — "no quiero
 * desactivar en este caso"), igual criterio que DELETE /slots/:slotId:
 * un módulo no tiene valor histórico propio, así que se borra de verdad
 * en vez de desactivarse. El slot queda vacío (no se toca) — para borrar
 * también el slot, ver DELETE /slots/:slotId.
 *
 * Como es un DELETE físico, ningún trigger "validar desactivación"
 * existente se dispara (son AFTER UPDATE) — se reimplementan a mano las
 * mismas 3 validaciones de "está realmente vacío" antes de borrar nada:
 * canales con señal activa, puntos de conexión reales, y posiciones de
 * terminal ocupadas por una terminación real.
 */
modulesRouter.delete(
  '/:moduleId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const moduleId = normalizeParam(req.params.moduleId);

      if (!isPositiveIntString(moduleId)) {
        res.status(400).json({ error: 'invalid_module_id', message: 'moduleId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      transaction = new sql.Transaction(pool);
      await transaction.begin();

      const moduloInfo = await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('modulo_id', sql.NVarChar(30), moduleId)
        .query(`
          SELECT
            m.id, m.slot_id,
            bt.id AS bloque_terminal_id,
            (SELECT COUNT(*) FROM nucleo.canal c JOIN nucleo.senal s ON s.canal_id = c.id AND s.activo = 1 WHERE c.modulo_id = m.id AND c.activo = 1) AS senales_activas,
            (SELECT COUNT(*) FROM nucleo.punto_conexion pc WHERE pc.modulo_id = m.id) AS puntos_conexion,
            (SELECT COUNT(*) FROM nucleo.terminal t JOIN nucleo.posicion_terminal pt ON pt.terminal_id = t.id AND pt.activo = 1
               JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
             WHERE t.bloque_terminal_id = bt.id AND t.activo = 1) AS posiciones_ocupadas
          FROM nucleo.modulo m
          LEFT JOIN nucleo.bloque_terminal bt ON bt.modulo_id = m.id AND bt.activo = 1
          WHERE m.id = TRY_CONVERT(BIGINT, @modulo_id)
            AND m.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND m.activo = 1;
        `);
      const modulo = moduloInfo.recordset[0];

      if (!modulo) {
        await transaction.rollback();
        res.status(404).json({ error: 'module_not_found', message: 'Module does not exist in this project or is already inactive.' });
        return;
      }

      if (modulo.senales_activas > 0) {
        await transaction.rollback();
        res.status(409).json({
          error: 'module_channels_in_use',
          message: 'No se puede eliminar: el módulo tiene canales activos en uso por señales activas.'
        });
        return;
      }

      if (modulo.puntos_conexion > 0) {
        await transaction.rollback();
        res.status(409).json({
          error: 'module_in_use',
          message: 'No se puede eliminar: el módulo tiene puntos de conexión reales asociados.'
        });
        return;
      }

      if (modulo.posiciones_ocupadas > 0) {
        await transaction.rollback();
        res.status(409).json({
          error: 'module_in_use',
          message: 'No se puede eliminar: el Terminal Block de este módulo tiene una posición ocupada por una terminación real.'
        });
        return;
      }

      if (modulo.bloque_terminal_id) {
        await new sql.Request(transaction)
          .input('bloque_terminal_id', sql.NVarChar(30), String(modulo.bloque_terminal_id))
          .query(`
            DELETE pt
            FROM nucleo.posicion_terminal pt
            JOIN nucleo.terminal t ON t.id = pt.terminal_id
            WHERE t.bloque_terminal_id = TRY_CONVERT(BIGINT, @bloque_terminal_id);

            DELETE FROM nucleo.terminal WHERE bloque_terminal_id = TRY_CONVERT(BIGINT, @bloque_terminal_id);

            DELETE FROM nucleo.bloque_terminal WHERE id = TRY_CONVERT(BIGINT, @bloque_terminal_id);
          `);
      }

      await new sql.Request(transaction)
        .input('modulo_id', sql.NVarChar(30), String(modulo.id))
        .query(`
          DELETE FROM nucleo.canal WHERE modulo_id = TRY_CONVERT(BIGINT, @modulo_id);
          DELETE FROM nucleo.modulo WHERE id = TRY_CONVERT(BIGINT, @modulo_id);
        `);

      await transaction.commit();

      res.status(200).json({
        module: { id: String(modulo.id), projectId, slotId: String(modulo.slot_id), active: false }
      });

    } catch (error) {
      if (transaction) await transaction.rollback().catch(() => {});
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
