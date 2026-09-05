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
 * nucleo.slot — depende de RACK. Sin TAG: se identifica por numero_slot,
 * único dentro de su RACK entre filas activas (UX_slot_rack_numero). Sin
 * CHECK ni triggers propios. Mismo patrón que racks.ts.
 */
export const slotsRouter = Router({ mergeParams: true });

slotsRouter.use(authenticate);


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

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    rackId: String(row.rack_id),
    numeroSlot: row.numero_slot,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMN_NAMES = [
  'id', 'proyecto_id', 'rack_id', 'numero_slot', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
];
const COLUMNS = COLUMN_NAMES.join(', ');
const OUTPUT_INSERTED_COLUMNS = COLUMN_NAMES.map((c) => `INSERTED.${c}`).join(', ');


/*
 * GET /api/projects/:projectId/slots?rackId=
 */
slotsRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const rackIdFilter = normalizeParam(req.query.rackId as string | string[] | undefined);

      if (rackIdFilter !== undefined && !isPositiveIntString(rackIdFilter)) {
        res.status(400).json({ error: 'invalid_rack_id', message: 'rackId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (rackIdFilter) request.input('rack_id', sql.NVarChar(30), rackIdFilter);

      const result = await request.query(`
        SELECT ${COLUMNS}
        FROM nucleo.slot
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${rackIdFilter ? 'AND rack_id = TRY_CONVERT(BIGINT, @rack_id)' : ''}
        ORDER BY rack_id, numero_slot;
      `);

      res.status(200).json({ projectId, slots: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/slots/:slotId
 */
slotsRouter.get(
  '/:slotId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const slotId = normalizeParam(req.params.slotId);

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'invalid_slot_id', message: 'slotId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.slot
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'slot_not_found', message: 'Slot does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ slot: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/slots
 */
slotsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { rackId, numeroSlot } = req.body ?? {};

      if (!isPositiveIntString(rackId)) {
        res.status(400).json({ error: 'validation_error', message: 'rackId is required and must be a numeric id.' });
        return;
      }

      if (
        typeof numeroSlot !== 'number' ||
        !Number.isInteger(numeroSlot) ||
        numeroSlot < 0 ||
        numeroSlot > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroSlot must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('rack_id', sql.NVarChar(30), rackId)
        .input('numero_slot', sql.SmallInt, numeroSlot)
        .query(`
          -- Límite de slots del rack (migración 017) — nullable, sin límite
          -- si no se fijó ninguno. Se valida acá porque necesita el conteo
          -- actual de slots activos, no solo la fila que se está creando.
          IF EXISTS (
            SELECT 1 FROM nucleo.rack r
            WHERE r.id = TRY_CONVERT(BIGINT, @rack_id)
              AND r.limite_slots IS NOT NULL
              AND r.limite_slots <= (SELECT COUNT(*) FROM nucleo.slot WHERE rack_id = TRY_CONVERT(BIGINT, @rack_id) AND activo = 1)
          )
          BEGIN
            THROW 54502, 'El rack alcanzó su límite de slots.', 1;
          END;

          -- Insertar EN esa posición (pedido explícito del usuario, "como
          -- insertar una fila en Excel"): si el número ya está ocupado, en
          -- vez de rechazar, todo slot activo de ese rack con numero_slot
          -- >= el pedido corre +1 para hacerle espacio — un solo UPDATE de
          -- conjunto (mismo principio que la renumeración del DELETE: SQL
          -- Server valida UX_slot_rack_numero contra la imagen FINAL del
          -- statement, nunca fila por fila, así que ningún valor
          -- intermedio choca aunque el rango de destino se solape).
          UPDATE nucleo.slot
          SET numero_slot = numero_slot + 1,
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @created_by)
          WHERE rack_id = TRY_CONVERT(BIGINT, @rack_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
            AND numero_slot >= @numero_slot;

          INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at, created_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @rack_id), @numero_slot, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/slots/${String(row.id)}`)
        .json({ slot: serialize(row) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      // 54501 ya no se lanza en el POST (corre los slots existentes en vez de
      // rechazar, ver arriba) — sigue vigente en el PATCH de abajo.
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'slot_number_conflict', message: 'An active slot with this number already exists in that rack.' });
        return;
      }

      if (number === 54502) {
        res.status(409).json({ error: 'rack_limite_slots_alcanzado', message: 'El rack alcanzó su límite de slots.' });
        return;
      }

      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'rackId does not exist, is inactive, or does not belong to this project.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/slots/:slotId
 *
 * Solo permite renumerar (numeroSlot); mover un slot a otro rack no está
 * soportado aquí por la misma razón que en racks.ts.
 */
slotsRouter.patch(
  '/:slotId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const slotId = normalizeParam(req.params.slotId);

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'invalid_slot_id', message: 'slotId must be a positive integer.' });
        return;
      }

      const { numeroSlot } = req.body ?? {};

      if (
        typeof numeroSlot !== 'number' ||
        !Number.isInteger(numeroSlot) ||
        numeroSlot < 0 ||
        numeroSlot > 32767
      ) {
        res.status(400).json({ error: 'validation_error', message: 'numeroSlot must be a non-negative integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .input('numero_slot', sql.SmallInt, numeroSlot)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @rack_id BIGINT;
          SELECT @rack_id = rack_id FROM nucleo.slot
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          IF @rack_id IS NULL
          BEGIN
            THROW 54502, 'El slot no existe en este proyecto o está inactivo.', 1;
          END;

          IF EXISTS (
            SELECT 1 FROM nucleo.slot
            WHERE rack_id = @rack_id AND numero_slot = @numero_slot AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @slot_id)
          )
          BEGIN
            THROW 54501, 'Ya existe un slot activo con ese número en ese rack.', 1;
          END;

          UPDATE nucleo.slot
          SET numero_slot = @numero_slot,
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${OUTPUT_INSERTED_COLUMNS}
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      res.status(200).json({ slot: serialize(result.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 54501 || number === 2601 || number === 2627) {
        res.status(409).json({ error: 'slot_number_conflict', message: 'An active slot with this number already exists in that rack.' });
        return;
      }
      if (number === 54502) {
        res.status(404).json({ error: 'slot_not_found', message: 'Slot does not exist in this project or is inactive.' });
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/slots/:slotId
 *
 * BORRADO FÍSICO REAL (pedido explícito del usuario — "no quiero
 * desactivar en este caso"). A diferencia de casi todo el resto de SIEI,
 * un slot no tiene valor histórico/de auditoría propio (no es un
 * documento emitido ni un instrumento con procedencia P&ID) y la
 * renumeración sin huecos ya asume que los slots son reordenables — así
 * que acá NO se desactiva, se borra la fila de verdad.
 *
 * Como es un DELETE físico (no un UPDATE activo=0), ninguno de los
 * triggers de "validar desactivación" existentes se dispara (todos son
 * AFTER UPDATE) — este endpoint reimplementa las mismas 3 validaciones de
 * "está realmente vacío" a mano, antes de borrar nada:
 *   1. Ningún canal del módulo con señal activa (antes: TR_modulo_
 *      validar_desactivacion, 51019).
 *   2. Ningún punto_conexion real referenciando el módulo (mismo criterio
 *      "recurso real nunca se cascada" que ya usa la eliminación
 *      definitiva de instrumentos).
 *   3. Ninguna posición de terminal ocupada por una terminación real
 *      (antes: TR_terminal_validar_desactivacion / TR_bloque_terminal_
 *      validar_desactivacion, 51030/51031).
 * Si las 3 pasan, se cascada el borrado físico completo: posicion_terminal
 * -> terminal -> bloque_terminal -> canal -> modulo -> slot -> renumerar.
 */
slotsRouter.delete(
  '/:slotId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const slotId = normalizeParam(req.params.slotId);

      if (!isPositiveIntString(slotId)) {
        res.status(400).json({ error: 'invalid_slot_id', message: 'slotId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      const slotInfo = await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .query(`
          SELECT id, rack_id, numero_slot
          FROM nucleo.slot
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);
      const slot = slotInfo.recordset[0];

      if (!slot) {
        await transaction.rollback();
        res.status(404).json({ error: 'slot_not_found', message: 'Slot does not exist in this project or is already inactive.' });
        return;
      }

      const moduloInfo = await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .query(`
          SELECT
            m.id, m.tag, m.surge_protector_tag,
            bt.id AS bloque_terminal_id, bt.codigo AS tb_codigo,
            (SELECT COUNT(*) FROM nucleo.canal c JOIN nucleo.senal s ON s.canal_id = c.id AND s.activo = 1 WHERE c.modulo_id = m.id AND c.activo = 1) AS senales_activas,
            (SELECT COUNT(*) FROM nucleo.punto_conexion pc WHERE pc.modulo_id = m.id) AS puntos_conexion,
            (SELECT COUNT(*) FROM nucleo.terminal t JOIN nucleo.posicion_terminal pt ON pt.terminal_id = t.id AND pt.activo = 1
               JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
             WHERE t.bloque_terminal_id = bt.id AND t.activo = 1) AS posiciones_ocupadas
          FROM nucleo.modulo m
          LEFT JOIN nucleo.bloque_terminal bt ON bt.modulo_id = m.id AND bt.activo = 1
          WHERE m.slot_id = TRY_CONVERT(BIGINT, @slot_id)
            AND m.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND m.activo = 1;
        `);
      const modulo = moduloInfo.recordset[0];

      if (modulo && modulo.senales_activas > 0) {
        await transaction.rollback();
        res.status(409).json({
          error: 'slot_no_vacio',
          message: 'No se puede eliminar: el slot tiene un módulo con canales activos en uso por señales activas.'
        });
        return;
      }

      if (modulo && modulo.puntos_conexion > 0) {
        await transaction.rollback();
        res.status(409).json({
          error: 'slot_no_vacio',
          message: 'No se puede eliminar: el módulo de este slot tiene puntos de conexión reales asociados.'
        });
        return;
      }

      if (modulo && modulo.posiciones_ocupadas > 0) {
        await transaction.rollback();
        res.status(409).json({
          error: 'slot_no_vacio',
          message: 'No se puede eliminar: el Terminal Block de este módulo tiene una posición ocupada por una terminación real.'
        });
        return;
      }

      const teniaTagsAsignados = Boolean(
        modulo && (modulo.tag || modulo.surge_protector_tag || (modulo.tb_codigo && modulo.tb_codigo !== 'MODULO'))
      );

      if (modulo) {
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
      }

      await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('slot_id', sql.NVarChar(30), slotId)
        .query(`
          DELETE FROM nucleo.slot
          WHERE id = TRY_CONVERT(BIGINT, @slot_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      /*
       * Renumeración sin huecos (pedido explícito del usuario) — todo slot
       * ACTIVO del mismo rack con numero_slot mayor al que se acaba de
       * eliminar baja 1. Es un único UPDATE de conjunto (no fila por fila):
       * SQL Server valida UX_slot_rack_numero contra la imagen FINAL del
       * statement completo, así que ningún valor intermedio choca aunque
       * el rango de destino se solape con el de origen.
       */
      const renumerados = await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('rack_id', sql.NVarChar(30), String(slot.rack_id))
        .input('numero_slot_eliminado', sql.SmallInt, slot.numero_slot)
        .query(`
          UPDATE nucleo.slot
          SET numero_slot = numero_slot - 1,
              updated_at = SYSUTCDATETIME()
          WHERE rack_id = TRY_CONVERT(BIGINT, @rack_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
            AND numero_slot > @numero_slot_eliminado;
        `);

      await transaction.commit();

      res.status(200).json({
        slot: { id: String(slot.id), projectId, rackId: String(slot.rack_id), numeroSlot: slot.numero_slot, active: false },
        slotsRenumerados: renumerados.rowsAffected[0],
        advertenciaRetagear: teniaTagsAsignados
      });

    } catch (error) {
      if (transaction) await transaction.rollback().catch(() => {});
      next(error);
    }
  }
);
