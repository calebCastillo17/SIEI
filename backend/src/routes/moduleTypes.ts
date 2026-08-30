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


/*
 * GET /api/catalogs/module-types/:moduleTypeId/terminals (migración 015)
 *
 * cat.cat_modulo_io_terminal — 1:N por canal (catalogo_modulo_id +
 * numero_canal + orden_terminal). Una etiqueta puede repetirse
 * legítimamente para el mismo canal (caso real RTD: 2 filas "IN_0/A" +
 * "IN_0/RTD C" para el canal 0) — orden_terminal es lo único que las
 * distingue, nunca se colapsan por texto igual.
 */
moduleTypesRouter.get(
  '/:moduleTypeId/terminals',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const moduleTypeId = normalizeParam(req.params.moduleTypeId);
      if (!moduleTypeId || !/^\d+$/.test(moduleTypeId)) {
        res.status(400).json({ error: 'invalid_module_type_id', message: 'moduleTypeId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('id', sql.NVarChar(30), moduleTypeId)
        .query(`
          SELECT id, catalogo_modulo_id, numero_canal, orden_terminal, etiqueta_terminal, created_at, updated_at
          FROM cat.cat_modulo_io_terminal
          WHERE catalogo_modulo_id = TRY_CONVERT(BIGINT, @id)
          ORDER BY numero_canal, orden_terminal;
        `);

      res.status(200).json({
        terminals: result.recordset.map((row) => ({
          id: String(row.id),
          catalogoModuloId: String(row.catalogo_modulo_id),
          numeroCanal: row.numero_canal,
          ordenTerminal: row.orden_terminal,
          etiquetaTerminal: row.etiqueta_terminal,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/catalogs/module-types/:moduleTypeId/terminals
 *
 * Solo es_admin_sistema (mismo criterio que crear un tipo de módulo):
 * es un catálogo global compartido por todos los proyectos.
 */
moduleTypesRouter.post(
  '/:moduleTypeId/terminals',
  requireSystemAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const moduleTypeId = normalizeParam(req.params.moduleTypeId);
      if (!moduleTypeId || !/^\d+$/.test(moduleTypeId)) {
        res.status(400).json({ error: 'invalid_module_type_id', message: 'moduleTypeId must be a positive integer.' });
        return;
      }

      const { numeroCanal, ordenTerminal, etiquetaTerminal } = req.body ?? {};

      if (typeof numeroCanal !== 'number' || !Number.isInteger(numeroCanal) || numeroCanal < 0) {
        res.status(400).json({ error: 'validation_error', message: 'numeroCanal must be a non-negative integer.' });
        return;
      }
      if (typeof ordenTerminal !== 'number' || !Number.isInteger(ordenTerminal) || ordenTerminal <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'ordenTerminal must be a positive integer.' });
        return;
      }
      if (typeof etiquetaTerminal !== 'string' || etiquetaTerminal.trim().length === 0 || etiquetaTerminal.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'etiquetaTerminal is required and must be at most 50 characters.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('catalogo_modulo_id', sql.NVarChar(30), moduleTypeId)
        .input('numero_canal', sql.SmallInt, numeroCanal)
        .input('orden_terminal', sql.SmallInt, ordenTerminal)
        .input('etiqueta_terminal', sql.NVarChar(50), etiquetaTerminal.trim())
        .query(`
          INSERT INTO cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal, etiqueta_terminal)
          OUTPUT INSERTED.id, INSERTED.catalogo_modulo_id, INSERTED.numero_canal, INSERTED.orden_terminal, INSERTED.etiqueta_terminal, INSERTED.created_at, INSERTED.updated_at
          VALUES (TRY_CONVERT(BIGINT, @catalogo_modulo_id), @numero_canal, @orden_terminal, @etiqueta_terminal);
        `);

      const row = insertResult.recordset[0];

      res.status(201).json({
        terminal: {
          id: String(row.id),
          catalogoModuloId: String(row.catalogo_modulo_id),
          numeroCanal: row.numero_canal,
          ordenTerminal: row.orden_terminal,
          etiquetaTerminal: row.etiqueta_terminal,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      });

    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'terminal_conflict', message: 'Ya existe una fila de catálogo con ese numeroCanal + ordenTerminal para este modelo.' });
        return;
      }
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'moduleTypeId does not exist.' });
        return;
      }

      next(error);
    }
  }
);
