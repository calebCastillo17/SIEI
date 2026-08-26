import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import sql from 'mssql';

import { authenticate } from '../middleware/authenticate.js';
import { requireSystemAdmin } from '../middleware/requireSystemAdmin.js';
import { getDbPool } from '../db/sql.js';

/*
 * cat.cat_modulo_io — catálogo global de hardware (fabricante/modelo real),
 * sin proyecto_id y sin seed (dominio abierto). No es un recurso de
 * proyecto: no usa requireProjectPermission, usa requireSystemAdmin.
 *
 * Sin PATCH ni DELETE: la tabla no tiene columna `activo` (no hay soft
 * delete definido para catálogos), y editar canales_max/tipo_io_id después
 * de creado dejaría inconsistentes los nucleo.modulo que ya referencian esa
 * fila — TR_modulo_generar_canales solo se dispara con cambios en la propia
 * tabla modulo, no si cambia el catálogo que referencia.
 */
export const moduleTypesRouter = Router();

moduleTypesRouter.use(authenticate);


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
    fabricante: row.fabricante,
    modelo: row.modelo,
    tipoIoId: String(row.tipo_io_id),
    tipoIoCodigo: row.tipo_io_codigo,
    canalesMax: row.canales_max,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SELECT_COLUMNS = `
  cmi.id,
  cmi.fabricante,
  cmi.modelo,
  cmi.tipo_io_id,
  tio.codigo AS tipo_io_codigo,
  cmi.canales_max,
  cmi.created_at,
  cmi.updated_at
`;

const FROM_CLAUSE = `
  FROM cat.cat_modulo_io cmi
  JOIN cat.cat_tipo_io tio ON tio.id = cmi.tipo_io_id
`;


/*
 * GET /api/catalogs/module-types
 *
 * Cualquier usuario autenticado puede leerlo (es un catálogo de referencia,
 * no información sensible de un proyecto).
 */
moduleTypesRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = await getDbPool();
      const result = await pool.request().query(`
        SELECT ${SELECT_COLUMNS}
        ${FROM_CLAUSE}
        ORDER BY cmi.fabricante, cmi.modelo;
      `);

      res.status(200).json({ moduleTypes: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/catalogs/module-types/:moduleTypeId
 */
moduleTypesRouter.get(
  '/:moduleTypeId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const moduleTypeId = normalizeParam(req.params.moduleTypeId);

      if (!moduleTypeId || !/^\d+$/.test(moduleTypeId)) {
        res.status(400).json({
          error: 'invalid_module_type_id',
          message: 'moduleTypeId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('id', sql.NVarChar(30), moduleTypeId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE cmi.id = TRY_CONVERT(BIGINT, @id);
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({
          error: 'module_type_not_found',
          message: 'Module type does not exist.'
        });
        return;
      }

      res.status(200).json({ moduleType: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/catalogs/module-types
 *
 * Solo es_admin_sistema: es un catálogo compartido por todos los proyectos.
 */
moduleTypesRouter.post(
  '/',
  requireSystemAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fabricante, modelo, tipoIoId, canalesMax } = req.body ?? {};

      if (typeof fabricante !== 'string' || fabricante.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'fabricante is required.' });
        return;
      }
      if (fabricante.length > 100) {
        res.status(400).json({ error: 'validation_error', message: 'fabricante cannot exceed 100 characters.' });
        return;
      }

      if (typeof modelo !== 'string' || modelo.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'modelo is required.' });
        return;
      }
      if (modelo.length > 100) {
        res.status(400).json({ error: 'validation_error', message: 'modelo cannot exceed 100 characters.' });
        return;
      }

      if (typeof tipoIoId !== 'string' || !/^\d+$/.test(tipoIoId)) {
        res.status(400).json({ error: 'validation_error', message: 'tipoIoId is required and must be a numeric id.' });
        return;
      }

      if (
        typeof canalesMax !== 'number' ||
        !Number.isInteger(canalesMax) ||
        canalesMax <= 0
      ) {
        res.status(400).json({ error: 'validation_error', message: 'canalesMax must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('fabricante', sql.NVarChar(100), fabricante.trim())
        .input('modelo', sql.NVarChar(100), modelo.trim())
        .input('tipo_io_id', sql.NVarChar(30), tipoIoId)
        .input('canales_max', sql.SmallInt, canalesMax)
        .query(`
          DECLARE @nuevos_ids TABLE (id BIGINT);

          INSERT INTO cat.cat_modulo_io (fabricante, modelo, tipo_io_id, canales_max)
          OUTPUT INSERTED.id INTO @nuevos_ids
          VALUES (@fabricante, @modelo, TRY_CONVERT(BIGINT, @tipo_io_id), @canales_max);

          SELECT id FROM @nuevos_ids;
        `);

      const newId = String(result.recordset[0].id);

      const finalResult = await pool
        .request()
        .input('id', sql.NVarChar(30), newId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          ${FROM_CLAUSE}
          WHERE cmi.id = TRY_CONVERT(BIGINT, @id);
        `);

      res
        .status(201)
        .location(`/api/catalogs/module-types/${newId}`)
        .json({ moduleType: serialize(finalResult.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'module_type_conflict',
          message: 'A module type with this fabricante+modelo already exists.'
        });
        return;
      }

      if (number === 547) {
        res.status(400).json({
          error: 'invalid_reference',
          message: 'tipoIoId does not exist.'
        });
        return;
      }

      next(error);
    }
  }
);
