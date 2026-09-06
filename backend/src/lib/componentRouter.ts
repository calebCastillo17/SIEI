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
 * Factory generico para las 17 tablas de COMPONENTE del modulo Hojas de
 * Datos (nucleo.c_manometro, c_transmisor, c_sello_diafragma,
 * c_cuerpo_valvula, c_actuador, c_interruptor_posicion, c_unidad_control,
 * c_set_aire, c_solenoide, c_envolvente, c_selector_maniobra,
 * c_posicionador, c_sensor, c_indicador, c_fuente_radioactiva, c_baliza,
 * c_sirena — migraciones 033-041). Todas comparten la misma forma:
 * id, proyecto_id, ficha_tecnica_id (FK compuesta), N campos de texto
 * libre (algunos DECIMAL o BIT puntuales), activo, auditoria estandar.
 * En vez de 17 routers casi identicos, un solo factory parametrizado por
 * tabla + lista de campos — mismo criterio que ya usa
 * simpleCatalogRouter.ts para los catalogos `cat.*`.
 *
 * Cardinalidad ('uno' | 'muchos'): la mayoria son 1:0..1 con su ficha
 * tecnica (ej. c_manometro — nunca dos manometros activos para la misma
 * config). Cinco son 1:N REAL, confirmado con evidencia real y/o
 * decision explicita de la usuaria (c_interruptor_posicion, c_solenoide,
 * c_envolvente, c_selector_maniobra, c_indicador) — ver comentarios de
 * las migraciones 034/036/039. El GET siempre devuelve una LISTA
 * (0, 1 o N items) para las dos cardinalidades por igual — mas simple
 * que tener dos formas de respuesta distintas; la diferencia real está
 * en el POST: 'uno' rechaza un segundo item activo (409), 'muchos' no
 * tiene ese limite (la propia tabla ya no tiene el unique index filtrado
 * en ese caso).
 */

export interface ComponentFieldSpec {
  /** camelCase, como llega/sale en el JSON de la API. */
  key: string;
  /** snake_case, nombre real de la columna en SQL Server. */
  column: string;
  /** 'string' (default) | 'decimal' | 'bit'. */
  type?: 'string' | 'decimal' | 'bit';
  /** Solo para type 'string' — largo maximo real de la columna NVARCHAR. */
  maxLength?: number;
}

export interface ComponentTableSpec {
  /** Nombre calificado, ej. "nucleo.c_manometro". */
  table: string;
  cardinality: 'uno' | 'muchos';
  fields: ComponentFieldSpec[];
}

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

export function createComponentRouter(spec: ComponentTableSpec): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);

  function serialize(row: Record<string, any>) {
    const result: Record<string, unknown> = {
      id: String(row.id),
      proyectoId: String(row.proyecto_id),
      fichaTecnicaId: String(row.ficha_tecnica_id),
      active: Boolean(row.activo),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by === null ? null : String(row.created_by),
      updatedBy: row.updated_by === null ? null : String(row.updated_by)
    };
    for (const f of spec.fields) {
      const raw = row[f.column];
      result[f.key] = f.type === 'bit' ? (raw === null ? null : Boolean(raw)) : raw;
    }
    return result;
  }

  const selectColumns = ['id', 'proyecto_id', 'ficha_tecnica_id', ...spec.fields.map((f) => f.column), 'activo', 'created_at', 'updated_at', 'created_by', 'updated_by'].join(', ');

  /** Valida cada campo del body contra su spec — devuelve mensaje de error o null si todo bien. */
  function validateFields(body: Record<string, unknown>): string | null {
    for (const f of spec.fields) {
      if (!(f.key in body)) continue;
      const value = body[f.key];
      if (value === null || value === undefined) continue;

      if (f.type === 'bit') {
        if (typeof value !== 'boolean') return `${f.key} must be a boolean or null.`;
      } else if (f.type === 'decimal') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return `${f.key} must be a number or null.`;
      } else {
        if (typeof value !== 'string') return `${f.key} must be a string or null.`;
        if (f.maxLength && value.length > f.maxLength) return `${f.key} cannot exceed ${f.maxLength} characters.`;
      }
    }
    return null;
  }

  function bindField(request: sql.Request, f: ComponentFieldSpec, value: unknown) {
    const paramName = `f_${f.column}`;
    if (f.type === 'bit') {
      request.input(paramName, sql.Bit, value === undefined ? null : value);
    } else if (f.type === 'decimal') {
      request.input(paramName, sql.Decimal(18, 4), value === undefined ? null : value);
    } else {
      request.input(paramName, sql.NVarChar(f.maxLength ?? 300), value === undefined ? null : value);
    }
    return paramName;
  }

  /*
   * GET / — lista todos los items ACTIVOS de esta ficha tecnica (0, 1 o
   * N segun la tabla).
   */
  router.get(
    '/',
    requireProjectPermission('read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.projectAccess!.projectId;
        const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);

        if (!isPositiveIntString(fichaTecnicaId)) {
          res.status(400).json({ error: 'invalid_ficha_tecnica_id', message: 'fichaTecnicaId must be a positive integer.' });
          return;
        }

        const pool = await getDbPool();
        const result = await pool
          .request()
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
          .query(`
            SELECT ${selectColumns}
            FROM ${spec.table}
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id)
              AND activo = 1
            ORDER BY id;
          `);

        res.status(200).json({ items: result.recordset.map(serialize) });

      } catch (error) {
        next(error);
      }
    }
  );

  /*
   * POST / — crea un item nuevo. Si cardinality='uno', rechaza (409) si
   * ya existe un item activo para esta ficha tecnica.
   */
  router.post(
    '/',
    requireProjectPermission('write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.projectAccess!.projectId;
        const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);
        const userId = req.authUser!.id;

        if (!isPositiveIntString(fichaTecnicaId)) {
          res.status(400).json({ error: 'invalid_ficha_tecnica_id', message: 'fichaTecnicaId must be a positive integer.' });
          return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const validationError = validateFields(body);
        if (validationError) {
          res.status(400).json({ error: 'validation_error', message: validationError });
          return;
        }

        const pool = await getDbPool();

        // Confirma que la ficha tecnica existe en este proyecto (404
        // limpio en vez de dejar que la FK compuesta explote).
        const fichaCheck = await pool
          .request()
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
          .query(`
            SELECT 1 FROM nucleo.ficha_tecnica_instrumento
            WHERE id = TRY_CONVERT(BIGINT, @ficha_tecnica_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
          `);
        if (fichaCheck.recordset.length === 0) {
          res.status(404).json({ error: 'ficha_tecnica_not_found', message: 'Ficha técnica does not exist in this project or is inactive.' });
          return;
        }

        if (spec.cardinality === 'uno') {
          const existing = await pool
            .request()
            .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
            .query(`
              SELECT 1 FROM ${spec.table}
              WHERE ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id) AND activo = 1;
            `);
          if (existing.recordset.length > 0) {
            res.status(409).json({ error: 'component_already_exists', message: 'This ficha técnica already has an active component of this type.' });
            return;
          }
        }

        const request = pool.request();
        request.input('proyecto_id', sql.NVarChar(30), projectId);
        request.input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId);
        request.input('created_by', sql.NVarChar(30), userId);

        const paramNames = spec.fields.map((f) => bindField(request, f, body[f.key]));

        const columnList = ['proyecto_id', 'ficha_tecnica_id', ...spec.fields.map((f) => f.column), 'created_by'].join(', ');
        const valueList = ['TRY_CONVERT(BIGINT, @proyecto_id)', 'TRY_CONVERT(BIGINT, @ficha_tecnica_id)', ...paramNames.map((p) => `@${p}`), 'TRY_CONVERT(BIGINT, @created_by)'].join(', ');

        // OUTPUT sin INTO: estas tablas no tienen triggers propios,
        // ninguna requiere el patron @table de otras partes del código.
        const result = await request.query(`
          INSERT INTO ${spec.table} (${columnList})
          OUTPUT ${selectColumns.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          VALUES (${valueList});
        `);

        res.status(201).json({ item: serialize(result.recordset[0]) });

      } catch (error) {
        next(error);
      }
    }
  );

  /*
   * PATCH /:id
   */
  router.patch(
    '/:id',
    requireProjectPermission('write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.projectAccess!.projectId;
        const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);
        const id = normalizeParam(req.params.id);
        const userId = req.authUser!.id;

        if (!isPositiveIntString(fichaTecnicaId) || !isPositiveIntString(id)) {
          res.status(400).json({ error: 'invalid_id', message: 'fichaTecnicaId and id must be positive integers.' });
          return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const validationError = validateFields(body);
        if (validationError) {
          res.status(400).json({ error: 'validation_error', message: validationError });
          return;
        }

        const fieldsToUpdate = spec.fields.filter((f) => f.key in body);
        if (fieldsToUpdate.length === 0) {
          res.status(400).json({ error: 'validation_error', message: 'No updatable fields provided.' });
          return;
        }

        const pool = await getDbPool();
        const request = pool.request();
        request.input('proyecto_id', sql.NVarChar(30), projectId);
        request.input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId);
        request.input('id', sql.NVarChar(30), id);
        request.input('updated_by', sql.NVarChar(30), userId);

        const setClauses = fieldsToUpdate.map((f) => {
          const paramName = bindField(request, f, body[f.key]);
          return `${f.column} = @${paramName}`;
        });

        const result = await request.query(`
          UPDATE ${spec.table}
          SET ${setClauses.join(', ')}, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT ${selectColumns.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          WHERE id = TRY_CONVERT(BIGINT, @id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id)
            AND activo = 1;
        `);

        const row = result.recordset[0];
        if (!row) {
          res.status(404).json({ error: 'not_found', message: 'Component does not exist, is inactive, or belongs to a different ficha técnica.' });
          return;
        }

        res.status(200).json({ item: serialize(row) });

      } catch (error) {
        next(error);
      }
    }
  );

  /*
   * DELETE /:id — desactivacion logica (activo=0). Deja libre el slot
   * 1:0..1 (si aplica) para que se pueda crear otro.
   */
  router.delete(
    '/:id',
    requireProjectPermission('deactivate'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.projectAccess!.projectId;
        const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);
        const id = normalizeParam(req.params.id);
        const userId = req.authUser!.id;

        if (!isPositiveIntString(fichaTecnicaId) || !isPositiveIntString(id)) {
          res.status(400).json({ error: 'invalid_id', message: 'fichaTecnicaId and id must be positive integers.' });
          return;
        }

        const pool = await getDbPool();
        const result = await pool
          .request()
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
          .input('id', sql.NVarChar(30), id)
          .input('updated_by', sql.NVarChar(30), userId)
          .query(`
            UPDATE ${spec.table}
            SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
            OUTPUT INSERTED.id
            WHERE id = TRY_CONVERT(BIGINT, @id)
              AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id)
              AND activo = 1;
          `);

        if (result.recordset.length === 0) {
          res.status(404).json({ error: 'not_found', message: 'Component does not exist, is already inactive, or belongs to a different ficha técnica.' });
          return;
        }

        res.status(200).json({ deactivated: true });

      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
