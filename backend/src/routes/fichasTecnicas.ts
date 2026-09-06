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
 * nucleo.ficha_tecnica_instrumento (migración 032) + sus dos hijos
 * transversales, ficha_tecnica_requisito (migración 032) y
 * marca_aceptable (migración 032) — parte del módulo Hojas de Datos. Los
 * 17 routers de componente (c_manometro, c_transmisor, etc.) NO viven
 * acá — se montan aparte vía componentRouter.ts/componentSpecs.ts, uno
 * por tipo, en server.ts, todos anidados bajo
 * /fichas-tecnicas/:fichaTecnicaId/componentes/<tipo>.
 */
export const fichasTecnicasRouter = Router({ mergeParams: true });
fichasTecnicasRouter.use(authenticate);

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

/* ---- nucleo.ficha_tecnica_instrumento ------------------------------------- */

function serializeFicha(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    documentoId: row.documento_id === null ? null : String(row.documento_id),
    fabricanteId: row.fabricante_id === null ? null : String(row.fabricante_id),
    modelo: row.modelo,
    codigoReferencia: row.codigo_referencia,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const FICHA_COLUMNS = 'id, proyecto_id, documento_id, fabricante_id, modelo, codigo_referencia, activo, created_at, updated_at, created_by, updated_by';

fichasTecnicasRouter.get(
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
          SELECT ${FICHA_COLUMNS}
          FROM nucleo.ficha_tecnica_instrumento
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
          ORDER BY id;
        `);
      res.status(200).json({ projectId, fichasTecnicas: result.recordset.map(serializeFicha) });
    } catch (error) {
      next(error);
    }
  }
);

fichasTecnicasRouter.get(
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
          SELECT ${FICHA_COLUMNS}
          FROM nucleo.ficha_tecnica_instrumento
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
        `);
      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'ficha_tecnica_not_found', message: 'Ficha técnica does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ fichaTecnica: serializeFicha(row) });
    } catch (error) {
      next(error);
    }
  }
);

fichasTecnicasRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { documentoId = null, fabricanteId = null, modelo = null, codigoReferencia = null } = req.body ?? {};

      if (documentoId !== null && !isPositiveIntString(String(documentoId))) {
        res.status(400).json({ error: 'validation_error', message: 'documentoId must be a numeric id or null.' });
        return;
      }
      if (fabricanteId !== null && !isPositiveIntString(String(fabricanteId))) {
        res.status(400).json({ error: 'validation_error', message: 'fabricanteId must be a numeric id or null.' });
        return;
      }
      if (modelo !== null && (typeof modelo !== 'string' || modelo.length > 100)) {
        res.status(400).json({ error: 'validation_error', message: 'modelo must be a string (max 100 chars) or null.' });
        return;
      }
      if (codigoReferencia !== null && (typeof codigoReferencia !== 'string' || codigoReferencia.length > 50)) {
        res.status(400).json({ error: 'validation_error', message: 'codigoReferencia must be a string (max 50 chars) or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('documento_id', sql.NVarChar(30), documentoId)
        .input('fabricante_id', sql.NVarChar(30), fabricanteId)
        .input('modelo', sql.NVarChar(100), modelo)
        .input('codigo_referencia', sql.NVarChar(50), codigoReferencia)
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id, documento_id, fabricante_id, modelo, codigo_referencia, created_by)
          OUTPUT ${FICHA_COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @documento_id), TRY_CONVERT(BIGINT, @fabricante_id), @modelo, @codigo_referencia, TRY_CONVERT(BIGINT, @created_by));
        `);

      res.status(201).json({ fichaTecnica: serializeFicha(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'documentoId or fabricanteId does not exist in this project/catalog.' });
        return;
      }
      next(error);
    }
  }
);

fichasTecnicasRouter.patch(
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
      const allowed: Record<string, { column: string; sqlType: any }> = {
        documentoId: { column: 'documento_id', sqlType: sql.NVarChar(30) },
        fabricanteId: { column: 'fabricante_id', sqlType: sql.NVarChar(30) },
        modelo: { column: 'modelo', sqlType: sql.NVarChar(100) },
        codigoReferencia: { column: 'codigo_referencia', sqlType: sql.NVarChar(50) }
      };

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('id', sql.NVarChar(30), id);
      request.input('updated_by', sql.NVarChar(30), userId);

      const setClauses: string[] = [];
      for (const [key, { column, sqlType }] of Object.entries(allowed)) {
        if (!(key in body)) continue;
        const value = body[key];
        const isIdColumn = column.endsWith('_id');
        request.input(column, sqlType, value);
        setClauses.push(isIdColumn ? `${column} = TRY_CONVERT(BIGINT, @${column})` : `${column} = @${column}`);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No updatable fields provided.' });
        return;
      }

      const result = await request.query(`
        UPDATE nucleo.ficha_tecnica_instrumento
        SET ${setClauses.join(', ')}, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${FICHA_COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'ficha_tecnica_not_found', message: 'Ficha técnica does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ fichaTecnica: serializeFicha(row) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'documentoId or fabricanteId does not exist in this project/catalog.' });
        return;
      }
      next(error);
    }
  }
);

fichasTecnicasRouter.delete(
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
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('id', sql.NVarChar(30), id)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.ficha_tecnica_instrumento
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'ficha_tecnica_not_found', message: 'Ficha técnica does not exist in this project or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);

/* ---- nucleo.ficha_tecnica_requisito (formato largo, sin unique) ----------- */

function serializeRequisito(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    fichaTecnicaId: String(row.ficha_tecnica_id),
    requisitoId: String(row.requisito_id),
    valor: row.valor,
    detalle: row.detalle,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const VALORES_REQUISITO = ['REQUERIDO', 'NO_REQUERIDO', 'NO_APLICA'];

fichasTecnicasRouter.get(
  '/:fichaTecnicaId/requisitos',
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
          SELECT id, proyecto_id, ficha_tecnica_id, requisito_id, valor, detalle, activo, created_at, updated_at
          FROM nucleo.ficha_tecnica_requisito
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id) AND activo = 1
          ORDER BY id;
        `);
      res.status(200).json({ requisitos: result.recordset.map(serializeRequisito) });
    } catch (error) {
      next(error);
    }
  }
);

fichasTecnicasRouter.post(
  '/:fichaTecnicaId/requisitos',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);
      if (!isPositiveIntString(fichaTecnicaId)) {
        res.status(400).json({ error: 'invalid_ficha_tecnica_id', message: 'fichaTecnicaId must be a positive integer.' });
        return;
      }

      const { requisitoId, valor, detalle = null } = req.body ?? {};
      if (!isPositiveIntString(String(requisitoId))) {
        res.status(400).json({ error: 'validation_error', message: 'requisitoId is required and must be a numeric id.' });
        return;
      }
      if (typeof valor !== 'string' || !VALORES_REQUISITO.includes(valor)) {
        res.status(400).json({ error: 'validation_error', message: `valor must be one of: ${VALORES_REQUISITO.join(', ')}.` });
        return;
      }
      if (detalle !== null && (typeof detalle !== 'string' || detalle.length > 300)) {
        res.status(400).json({ error: 'validation_error', message: 'detalle must be a string (max 300 chars) or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
        .input('requisito_id', sql.NVarChar(30), String(requisitoId))
        .input('valor', sql.NVarChar(20), valor)
        .input('detalle', sql.NVarChar(300), detalle)
        .query(`
          INSERT INTO nucleo.ficha_tecnica_requisito (proyecto_id, ficha_tecnica_id, requisito_id, valor, detalle)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.ficha_tecnica_id, INSERTED.requisito_id, INSERTED.valor, INSERTED.detalle, INSERTED.activo, INSERTED.created_at, INSERTED.updated_at
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @ficha_tecnica_id), TRY_CONVERT(BIGINT, @requisito_id), @valor, @detalle);
        `);

      res.status(201).json({ requisito: serializeRequisito(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'fichaTecnicaId or requisitoId does not exist.' });
        return;
      }
      next(error);
    }
  }
);

fichasTecnicasRouter.delete(
  '/:fichaTecnicaId/requisitos/:requisitoRowId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);
      const requisitoRowId = normalizeParam(req.params.requisitoRowId);
      if (!isPositiveIntString(fichaTecnicaId) || !isPositiveIntString(requisitoRowId)) {
        res.status(400).json({ error: 'invalid_id', message: 'fichaTecnicaId and requisitoRowId must be positive integers.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
        .input('id', sql.NVarChar(30), requisitoRowId)
        .query(`
          UPDATE nucleo.ficha_tecnica_requisito
          SET activo = 0, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'requisito_not_found', message: 'Requisito row does not exist or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);

/* ---- nucleo.marca_aceptable ------------------------------------------------ */

function serializeMarca(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    fichaTecnicaId: String(row.ficha_tecnica_id),
    componente: row.componente,
    fabricanteId: String(row.fabricante_id),
    preferente: row.preferente === null ? null : Boolean(row.preferente),
    notasRef: row.notas_ref,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

fichasTecnicasRouter.get(
  '/:fichaTecnicaId/marcas-aceptables',
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
          SELECT id, proyecto_id, ficha_tecnica_id, componente, fabricante_id, preferente, notas_ref, activo, created_at, updated_at
          FROM nucleo.marca_aceptable
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id) AND activo = 1
          ORDER BY componente, id;
        `);
      res.status(200).json({ marcasAceptables: result.recordset.map(serializeMarca) });
    } catch (error) {
      next(error);
    }
  }
);

fichasTecnicasRouter.post(
  '/:fichaTecnicaId/marcas-aceptables',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);
      if (!isPositiveIntString(fichaTecnicaId)) {
        res.status(400).json({ error: 'invalid_ficha_tecnica_id', message: 'fichaTecnicaId must be a positive integer.' });
        return;
      }

      const { componente, fabricanteId, preferente = null, notasRef = null } = req.body ?? {};
      if (typeof componente !== 'string' || componente.trim().length === 0 || componente.length > 50) {
        res.status(400).json({ error: 'validation_error', message: 'componente is required (max 50 chars).' });
        return;
      }
      if (!isPositiveIntString(String(fabricanteId))) {
        res.status(400).json({ error: 'validation_error', message: 'fabricanteId is required and must be a numeric id.' });
        return;
      }
      if (preferente !== null && typeof preferente !== 'boolean') {
        res.status(400).json({ error: 'validation_error', message: 'preferente must be a boolean or null.' });
        return;
      }
      if (notasRef !== null && (typeof notasRef !== 'string' || notasRef.length > 200)) {
        res.status(400).json({ error: 'validation_error', message: 'notasRef must be a string (max 200 chars) or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
        .input('componente', sql.NVarChar(50), componente.trim())
        .input('fabricante_id', sql.NVarChar(30), String(fabricanteId))
        .input('preferente', sql.Bit, preferente)
        .input('notas_ref', sql.NVarChar(200), notasRef)
        .query(`
          INSERT INTO nucleo.marca_aceptable (proyecto_id, ficha_tecnica_id, componente, fabricante_id, preferente, notas_ref)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.ficha_tecnica_id, INSERTED.componente, INSERTED.fabricante_id, INSERTED.preferente, INSERTED.notas_ref, INSERTED.activo, INSERTED.created_at, INSERTED.updated_at
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @ficha_tecnica_id), @componente, TRY_CONVERT(BIGINT, @fabricante_id), @preferente, @notas_ref);
        `);

      res.status(201).json({ marcaAceptable: serializeMarca(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'fichaTecnicaId or fabricanteId does not exist.' });
        return;
      }
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'marca_already_exists', message: 'This fabricante is already registered as acceptable for this componente.' });
        return;
      }
      next(error);
    }
  }
);

fichasTecnicasRouter.delete(
  '/:fichaTecnicaId/marcas-aceptables/:marcaId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const fichaTecnicaId = normalizeParam(req.params.fichaTecnicaId);
      const marcaId = normalizeParam(req.params.marcaId);
      if (!isPositiveIntString(fichaTecnicaId) || !isPositiveIntString(marcaId)) {
        res.status(400).json({ error: 'invalid_id', message: 'fichaTecnicaId and marcaId must be positive integers.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('ficha_tecnica_id', sql.NVarChar(30), fichaTecnicaId)
        .input('id', sql.NVarChar(30), marcaId)
        .query(`
          UPDATE nucleo.marca_aceptable
          SET activo = 0, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND ficha_tecnica_id = TRY_CONVERT(BIGINT, @ficha_tecnica_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'marca_not_found', message: 'Marca aceptable does not exist or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);
