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
 * nucleo.tuberia (migración 030) — CRUD por proyecto, con una regla de
 * negocio explícita del usuario: la ÚNICA asociación correcta entre línea
 * e instrumento la da el P&ID (instrumento.linea_pnid). Por eso tag_linea
 * (y su respaldo tag_anterior, migración 043) NO se edita como texto libre
 * vía PATCH — solo dos acciones dedicadas la tocan:
 *   - POST /:id/actualizar-tag-desde-pnid — la línea es la misma física,
 *     el P&ID solo corrigió/renombró el rótulo.
 *   - POST /crear-desde-pnid — el P&ID trae una línea distinta de verdad
 *     (o el instrumento nunca tuvo tubería): crea una tubería nueva
 *     (clonando las propiedades de la vieja si había una) y reengancha el
 *     instrumento. Si la vieja se queda sin ningún tag activo, se
 *     desactiva sola.
 * El resto de las propiedades (tamaño, material, schedule, etc.) sigue
 * siendo editable a mano vía PATCH — eso no cambia.
 */
export const tuberiasRouter = Router({ mergeParams: true });
tuberiasRouter.use(authenticate);

function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPositiveIntString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function sqlErrorNumber(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'number' in error && typeof (error as { number?: unknown }).number === 'number') {
    return (error as { number: number }).number;
  }
  return undefined;
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tagLinea: row.tag_linea,
    tagAnterior: row.tag_anterior,
    tamanoDiametro: row.tamano_diametro,
    materialTuberia: row.material_tuberia,
    materialRevestimiento: row.material_revestimiento,
    espesorRevestimiento: row.espesor_revestimiento,
    schedule: row.schedule,
    normaBridas: row.norma_bridas,
    caraBridas: row.cara_bridas,
    conexionInstrumento: row.conexion_instrumento,
    // Solo viene poblado en GET (lista/detalle) — ver COLUMNS_LIST. Le dice
    // al frontend si "Eliminar" (borrado físico) puede ofrecerse.
    tagsAsociados: row.tags_asociados === undefined ? undefined : Number(row.tags_asociados),
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = 'id, proyecto_id, tag_linea, tag_anterior, tamano_diametro, material_tuberia, material_revestimiento, espesor_revestimiento, schedule, norma_bridas, cara_bridas, conexion_instrumento, activo, created_at, updated_at, created_by, updated_by';

// tag_linea/tag_anterior: solo se escriben al crear (import inicial) o desde
// las dos acciones dedicadas de arriba — nunca desde un PATCH de texto libre.
const CREATE_ONLY_FIELDS: Array<[string, string, number]> = [
  ['tagLinea', 'tag_linea', 100],
  ['tagAnterior', 'tag_anterior', 200]
];

// El resto sigue siendo editable a mano en cualquier momento.
const EDITABLE_FIELDS: Array<[string, string, number]> = [
  ['tamanoDiametro', 'tamano_diametro', 20],
  ['materialTuberia', 'material_tuberia', 200],
  ['materialRevestimiento', 'material_revestimiento', 200],
  ['espesorRevestimiento', 'espesor_revestimiento', 50],
  ['schedule', 'schedule', 20],
  ['normaBridas', 'norma_bridas', 50],
  ['caraBridas', 'cara_bridas', 200],
  ['conexionInstrumento', 'conexion_instrumento', 200]
];

const ALL_FIELDS = [...CREATE_ONLY_FIELDS, ...EDITABLE_FIELDS];

function validateBody(body: Record<string, unknown>, fields: Array<[string, string, number]>): string | null {
  for (const [key, , max] of fields) {
    const value = body[key];
    if (key in body && value !== null) {
      if (typeof value !== 'string') return `${key} must be a string or null.`;
      if (value.length > max) return `${key} cannot exceed ${max} characters.`;
    }
  }
  return null;
}

tuberiasRouter.get(
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
          SELECT ${COLUMNS},
            (SELECT COUNT(*) FROM nucleo.instrumento ii WHERE ii.tuberia_id = t.id AND ii.proyecto_id = t.proyecto_id AND ii.activo = 1) AS tags_asociados
          FROM nucleo.tuberia t
          WHERE t.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND t.activo = 1
          ORDER BY t.tag_linea;
        `);
      res.status(200).json({ projectId, tuberias: result.recordset.map(serialize) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * GET /pendientes — instrumentos activos cuya línea de P&ID no coincide con
 * la línea de su tubería en HD (o que no tienen tubería todavía). Debe
 * registrarse ANTES de GET /:id para no ser capturada por ese patrón.
 */
tuberiasRouter.get(
  '/pendientes',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT i.id AS instrumento_id, i.tag_instrumento, i.linea_pnid, i.tuberia_id, t.tag_linea AS tuberia_tag_linea
          FROM nucleo.instrumento i
          LEFT JOIN nucleo.tuberia t ON t.id = i.tuberia_id AND t.proyecto_id = i.proyecto_id AND t.activo = 1
          WHERE i.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND i.activo = 1
            AND i.linea_pnid IS NOT NULL
            AND (i.tuberia_id IS NULL OR i.linea_pnid <> t.tag_linea)
          ORDER BY i.tag_instrumento;
        `);
      res.status(200).json({
        projectId,
        pendientes: result.recordset.map((row) => ({
          instrumentId: String(row.instrumento_id),
          tagInstrumento: row.tag_instrumento,
          lineaPnid: row.linea_pnid,
          tuberiaId: row.tuberia_id === null ? null : String(row.tuberia_id),
          tagLineaActual: row.tuberia_tag_linea,
          // FALTANTE: el instrumento no tiene tubería vinculada todavía.
          // CAMBIO: tiene tubería, pero su línea de P&ID ya no coincide.
          tipo: row.tuberia_id === null ? 'FALTANTE' : 'CAMBIO'
        }))
      });
    } catch (error) {
      next(error);
    }
  }
);

tuberiasRouter.get(
  '/:id',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const id = normalizeParam(req.params.id);
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('id', sql.NVarChar(30), id)
        .query(`
          SELECT ${COLUMNS},
            (SELECT COUNT(*) FROM nucleo.instrumento ii WHERE ii.tuberia_id = t.id AND ii.proyecto_id = t.proyecto_id AND ii.activo = 1) AS tags_asociados
          FROM nucleo.tuberia t
          WHERE t.id = TRY_CONVERT(BIGINT, @id) AND t.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND t.activo = 1;
        `);
      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ tuberia: serialize(row) });
    } catch (error) {
      next(error);
    }
  }
);

tuberiasRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const validationError = validateBody(body, ALL_FIELDS);
      if (validationError) {
        res.status(400).json({ error: 'validation_error', message: validationError });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('created_by', sql.NVarChar(30), userId);
      for (const [key, column, max] of ALL_FIELDS) {
        request.input(column, sql.NVarChar(max), body[key] ?? null);
      }

      const result = await request.query(`
        INSERT INTO nucleo.tuberia (proyecto_id, ${ALL_FIELDS.map(([, c]) => c).join(', ')}, created_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        VALUES (TRY_CONVERT(BIGINT, @proyecto_id), ${ALL_FIELDS.map(([, c]) => `@${c}`).join(', ')}, TRY_CONVERT(BIGINT, @created_by));
      `);

      res.status(201).json({ tuberia: serialize(result.recordset[0]) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * POST /crear-desde-pnid — resuelve un pendiente creando una tubería NUEVA
 * para un instrumento puntual, a partir de su linea_pnid. Si el instrumento
 * ya tenía tubería, clona sus propiedades (tamaño/material/etc.) y guarda
 * el tag viejo en tag_anterior de la nueva fila; si esa tubería vieja se
 * queda sin ningún tag activo, se desactiva sola. Debe registrarse ANTES
 * de POST /:id/... no aplica acá (no colisiona, es una ruta de un solo
 * segmento vs. dos), pero se deja junto a /pendientes por prolijidad.
 */
tuberiasRouter.post(
  '/crear-desde-pnid',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const instrumentId = body.instrumentId;
      if (!isPositiveIntString(instrumentId)) {
        res.status(400).json({ error: 'validation_error', message: 'instrumentId is required and must be a numeric id.' });
        return;
      }

      const pool = await getDbPool();
      transaction = new sql.Transaction(pool);
      await transaction.begin();
      const request = new sql.Request(transaction);
      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('instrumento_id', sql.NVarChar(30), instrumentId)
        .input('created_by', sql.NVarChar(30), userId);

      const result = await request.query(`
        DECLARE @linea_pnid NVARCHAR(200), @tuberia_vieja_id BIGINT;
        SELECT @linea_pnid = linea_pnid, @tuberia_vieja_id = tuberia_id
        FROM nucleo.instrumento
        WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;

        IF @linea_pnid IS NULL
            THROW 54302, 'El instrumento no existe, no esta activo, o no tiene linea de P&ID.', 1;

        IF @tuberia_vieja_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM nucleo.tuberia WHERE id = @tuberia_vieja_id AND tag_linea = @linea_pnid
        )
            THROW 54303, 'La tuberia actual ya coincide con la linea del P&ID -- no hay nada que separar.', 1;

        DECLARE @nueva TABLE (id BIGINT);

        IF @tuberia_vieja_id IS NOT NULL
        BEGIN
            INSERT INTO nucleo.tuberia (proyecto_id, tag_linea, tag_anterior, tamano_diametro, material_tuberia, material_revestimiento, espesor_revestimiento, schedule, norma_bridas, cara_bridas, conexion_instrumento, created_by)
            OUTPUT INSERTED.id INTO @nueva
            SELECT proyecto_id, @linea_pnid, tag_linea, tamano_diametro, material_tuberia, material_revestimiento, espesor_revestimiento, schedule, norma_bridas, cara_bridas, conexion_instrumento, TRY_CONVERT(BIGINT, @created_by)
            FROM nucleo.tuberia WHERE id = @tuberia_vieja_id;
        END
        ELSE
        BEGIN
            INSERT INTO nucleo.tuberia (proyecto_id, tag_linea, created_by)
            OUTPUT INSERTED.id INTO @nueva
            VALUES (TRY_CONVERT(BIGINT, @proyecto_id), @linea_pnid, TRY_CONVERT(BIGINT, @created_by));
        END

        DECLARE @nueva_id BIGINT = (SELECT id FROM @nueva);

        UPDATE nucleo.instrumento
        SET tuberia_id = @nueva_id, updated_at = SYSUTCDATETIME()
        WHERE id = TRY_CONVERT(BIGINT, @instrumento_id);

        IF @tuberia_vieja_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM nucleo.instrumento WHERE tuberia_id = @tuberia_vieja_id AND activo = 1
        )
            UPDATE nucleo.tuberia SET activo = 0, updated_at = SYSUTCDATETIME() WHERE id = @tuberia_vieja_id;

        SELECT ${COLUMNS} FROM nucleo.tuberia WHERE id = @nueva_id;
      `);

      const row = result.recordset[0];
      await transaction.commit();
      res.status(201).json({ tuberia: serialize(row) });
    } catch (error) {
      if (transaction) await transaction.rollback().catch(() => {});
      const number = sqlErrorNumber(error);
      if (number === 54302) {
        res.status(404).json({ error: 'instrumento_no_encontrado', message: 'El instrumento no existe, no está activo, o no tiene línea de P&ID.' });
        return;
      }
      if (number === 54303) {
        res.status(409).json({ error: 'ya_coincide', message: 'La tubería actual ya coincide con la línea del P&ID.' });
        return;
      }
      next(error);
    }
  }
);

/*
 * POST /:id/actualizar-tag-desde-pnid — resuelve un pendiente actualizando
 * la MISMA tubería (el P&ID solo corrigió/renombró el rótulo). Guarda el
 * valor viejo en tag_anterior.
 */
tuberiasRouter.post(
  '/:id/actualizar-tag-desde-pnid',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const id = normalizeParam(req.params.id);
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const instrumentId = body.instrumentId;
      if (!isPositiveIntString(instrumentId)) {
        res.status(400).json({ error: 'validation_error', message: 'instrumentId is required and must be a numeric id.' });
        return;
      }

      const pool = await getDbPool();
      transaction = new sql.Transaction(pool);
      await transaction.begin();
      const request = new sql.Request(transaction);
      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('id', sql.NVarChar(30), id)
        .input('instrumento_id', sql.NVarChar(30), instrumentId)
        .input('updated_by', sql.NVarChar(30), userId);

      const result = await request.query(`
        DECLARE @linea_pnid NVARCHAR(200);
        SELECT @linea_pnid = linea_pnid
        FROM nucleo.instrumento
        WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          AND tuberia_id = TRY_CONVERT(BIGINT, @id);

        IF @linea_pnid IS NULL
            THROW 54301, 'El instrumento no existe, no esta activo, no apunta a esta tuberia, o no tiene linea de P&ID.', 1;

        UPDATE nucleo.tuberia
        SET tag_anterior = tag_linea, tag_linea = @linea_pnid, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);

      const row = result.recordset[0];
      if (!row) {
        await transaction.rollback();
        res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project or is inactive.' });
        return;
      }
      await transaction.commit();
      res.status(200).json({ tuberia: serialize(row) });
    } catch (error) {
      if (transaction) await transaction.rollback().catch(() => {});
      const number = sqlErrorNumber(error);
      if (number === 54301) {
        res.status(409).json({ error: 'instrumento_no_coincide', message: 'El instrumento no apunta a esta tubería, no tiene línea de P&ID, o no está activo.' });
        return;
      }
      next(error);
    }
  }
);

tuberiasRouter.patch(
  '/:id',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const id = normalizeParam(req.params.id);
      const userId = req.authUser!.id;
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      if ('tagLinea' in body || 'tagAnterior' in body) {
        res.status(400).json({
          error: 'campo_no_editable',
          message:
            'tagLinea/tagAnterior no se editan por PATCH — la línea la define el P&ID. Usá POST /:id/actualizar-tag-desde-pnid o POST /crear-desde-pnid.'
        });
        return;
      }

      const validationError = validateBody(body, EDITABLE_FIELDS);
      if (validationError) {
        res.status(400).json({ error: 'validation_error', message: validationError });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('id', sql.NVarChar(30), id);
      request.input('updated_by', sql.NVarChar(30), userId);

      const setClauses: string[] = [];
      for (const [key, column, max] of EDITABLE_FIELDS) {
        if (!(key in body)) continue;
        request.input(column, sql.NVarChar(max), body[key]);
        setClauses.push(`${column} = @${column}`);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No updatable fields provided.' });
        return;
      }

      const result = await request.query(`
        UPDATE nucleo.tuberia
        SET ${setClauses.join(', ')}, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ tuberia: serialize(row) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * DELETE /:id
 *  - Sin `eliminarDefinitivamente` (o body vacío): comportamiento de
 *    siempre, desactivación lógica (activo=0).
 *  - Con `eliminarDefinitivamente: true`: borrado físico REAL, permitido
 *    únicamente si ningún instrumento activo la usa (regla explícita del
 *    usuario: "si una línea no está siendo usada en el P&ID sí se puede
 *    eliminar").
 */
tuberiasRouter.delete(
  '/:id',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const id = normalizeParam(req.params.id);
      const userId = req.authUser!.id;
      if (!isPositiveIntString(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const eliminarDefinitivamente = body.eliminarDefinitivamente === true;
      const pool = await getDbPool();

      if (eliminarDefinitivamente) {
        const check = await pool
          .request()
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('id', sql.NVarChar(30), id)
          .query(`
            SELECT
              (SELECT COUNT(*) FROM nucleo.tuberia WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)) AS existe,
              (SELECT COUNT(*) FROM nucleo.instrumento WHERE tuberia_id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1) AS en_uso;
          `);
        const row = check.recordset[0];
        if (!row || Number(row.existe) === 0) {
          res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project.' });
          return;
        }
        if (Number(row.en_uso) > 0) {
          res.status(409).json({ error: 'tuberia_en_uso', message: 'No se puede eliminar: hay instrumentos activos que usan esta tubería.' });
          return;
        }
        await pool
          .request()
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('id', sql.NVarChar(30), id)
          .query('DELETE FROM nucleo.tuberia WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);');
        res.status(200).json({ deleted: true });
        return;
      }

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('id', sql.NVarChar(30), id)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.tuberia
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'tuberia_not_found', message: 'Tubería does not exist in this project or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);
