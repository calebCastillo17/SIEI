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
 * nucleo.documento + nucleo.nota + las dos asociaciones N:M
 * (instrumento_documento, instrumento_nota) — migración 031, módulo
 * Hojas de Datos. Mismo espíritu que nucleo.plano (contenido externo que
 * SIEI cataloga, no genera hoy — ver cabecera de la migración 031 sobre
 * por qué esto no choca con un futuro entregable de HD).
 */
export const documentosRouter = Router({ mergeParams: true });
documentosRouter.use(authenticate);

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

/* ---- nucleo.documento -------------------------------------------------- */

function serializeDocumento(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    codigoDocumento: row.codigo_documento,
    descripcion: row.descripcion,
    tipoDocumentoId: String(row.tipo_documento_id),
    revision: row.revision,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const DOCUMENTO_COLUMNS = 'id, proyecto_id, codigo_documento, descripcion, tipo_documento_id, revision, activo, created_at, updated_at, created_by, updated_by';

documentosRouter.get(
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
          SELECT ${DOCUMENTO_COLUMNS}
          FROM nucleo.documento
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
          ORDER BY descripcion;
        `);
      res.status(200).json({ projectId, documentos: result.recordset.map(serializeDocumento) });
    } catch (error) {
      next(error);
    }
  }
);

documentosRouter.get(
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
          SELECT ${DOCUMENTO_COLUMNS}
          FROM nucleo.documento
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
        `);
      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'documento_not_found', message: 'Documento does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ documento: serializeDocumento(row) });
    } catch (error) {
      next(error);
    }
  }
);

documentosRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { codigoDocumento = null, descripcion, tipoDocumentoId, revision = null } = req.body ?? {};

      if (typeof descripcion !== 'string' || descripcion.trim().length === 0 || descripcion.length > 300) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion is required (max 300 chars).' });
        return;
      }
      if (!isPositiveIntString(String(tipoDocumentoId))) {
        res.status(400).json({ error: 'validation_error', message: 'tipoDocumentoId is required and must be a numeric id.' });
        return;
      }
      if (codigoDocumento !== null && (typeof codigoDocumento !== 'string' || codigoDocumento.length > 100)) {
        res.status(400).json({ error: 'validation_error', message: 'codigoDocumento must be a string (max 100 chars) or null.' });
        return;
      }
      if (revision !== null && (typeof revision !== 'string' || revision.length > 10)) {
        res.status(400).json({ error: 'validation_error', message: 'revision must be a string (max 10 chars) or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('codigo_documento', sql.NVarChar(100), codigoDocumento)
        .input('descripcion', sql.NVarChar(300), descripcion.trim())
        .input('tipo_documento_id', sql.NVarChar(30), String(tipoDocumentoId))
        .input('revision', sql.NVarChar(10), revision)
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO nucleo.documento (proyecto_id, codigo_documento, descripcion, tipo_documento_id, revision, created_by)
          OUTPUT ${DOCUMENTO_COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), @codigo_documento, @descripcion, TRY_CONVERT(BIGINT, @tipo_documento_id), @revision, TRY_CONVERT(BIGINT, @created_by));
        `);

      res.status(201).json({ documento: serializeDocumento(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoDocumentoId does not exist in cat.cat_tipo_documento.' });
        return;
      }
      next(error);
    }
  }
);

documentosRouter.patch(
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
      const allowed: Record<string, { column: string; sqlType: any; isId?: boolean }> = {
        codigoDocumento: { column: 'codigo_documento', sqlType: sql.NVarChar(100) },
        descripcion: { column: 'descripcion', sqlType: sql.NVarChar(300) },
        tipoDocumentoId: { column: 'tipo_documento_id', sqlType: sql.NVarChar(30), isId: true },
        revision: { column: 'revision', sqlType: sql.NVarChar(10) }
      };

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('id', sql.NVarChar(30), id);
      request.input('updated_by', sql.NVarChar(30), userId);

      const setClauses: string[] = [];
      for (const [key, { column, sqlType, isId }] of Object.entries(allowed)) {
        if (!(key in body)) continue;
        request.input(column, sqlType, body[key]);
        setClauses.push(isId ? `${column} = TRY_CONVERT(BIGINT, @${column})` : `${column} = @${column}`);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No updatable fields provided.' });
        return;
      }

      const result = await request.query(`
        UPDATE nucleo.documento
        SET ${setClauses.join(', ')}, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${DOCUMENTO_COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'documento_not_found', message: 'Documento does not exist in this project or is inactive.' });
        return;
      }
      res.status(200).json({ documento: serializeDocumento(row) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoDocumentoId does not exist in cat.cat_tipo_documento.' });
        return;
      }
      next(error);
    }
  }
);

documentosRouter.delete(
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
          UPDATE nucleo.documento
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'documento_not_found', message: 'Documento does not exist in this project or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);

/* ---- nucleo.nota (numeración propia POR documento) ------------------------ */

function serializeNota(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    documentoId: String(row.documento_id),
    numero: row.numero,
    texto: row.texto,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

documentosRouter.get(
  '/:documentoId/notas',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const documentoId = normalizeParam(req.params.documentoId);
      if (!isPositiveIntString(documentoId)) {
        res.status(400).json({ error: 'invalid_documento_id', message: 'documentoId must be a positive integer.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('documento_id', sql.NVarChar(30), documentoId)
        .query(`
          SELECT id, proyecto_id, documento_id, numero, texto, activo, created_at, updated_at
          FROM nucleo.nota
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND documento_id = TRY_CONVERT(BIGINT, @documento_id) AND activo = 1
          ORDER BY numero;
        `);
      res.status(200).json({ notas: result.recordset.map(serializeNota) });
    } catch (error) {
      next(error);
    }
  }
);

documentosRouter.post(
  '/:documentoId/notas',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const documentoId = normalizeParam(req.params.documentoId);
      if (!isPositiveIntString(documentoId)) {
        res.status(400).json({ error: 'invalid_documento_id', message: 'documentoId must be a positive integer.' });
        return;
      }

      const { numero, texto } = req.body ?? {};
      if (typeof numero !== 'number' || !Number.isInteger(numero) || numero <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'numero is required and must be a positive integer.' });
        return;
      }
      if (typeof texto !== 'string' || texto.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'texto is required.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('documento_id', sql.NVarChar(30), documentoId)
        .input('numero', sql.SmallInt, numero)
        .input('texto', sql.NVarChar(sql.MAX), texto)
        .query(`
          INSERT INTO nucleo.nota (proyecto_id, documento_id, numero, texto)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.documento_id, INSERTED.numero, INSERTED.texto, INSERTED.activo, INSERTED.created_at, INSERTED.updated_at
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @documento_id), @numero, @texto);
        `);

      res.status(201).json({ nota: serializeNota(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'documentoId does not exist in this project.' });
        return;
      }
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'numero_conflict', message: 'A note with this numero already exists for this documento.' });
        return;
      }
      next(error);
    }
  }
);

documentosRouter.delete(
  '/:documentoId/notas/:notaId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const documentoId = normalizeParam(req.params.documentoId);
      const notaId = normalizeParam(req.params.notaId);
      if (!isPositiveIntString(documentoId) || !isPositiveIntString(notaId)) {
        res.status(400).json({ error: 'invalid_id', message: 'documentoId and notaId must be positive integers.' });
        return;
      }
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('documento_id', sql.NVarChar(30), documentoId)
        .input('id', sql.NVarChar(30), notaId)
        .query(`
          UPDATE nucleo.nota
          SET activo = 0, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND documento_id = TRY_CONVERT(BIGINT, @documento_id) AND activo = 1;
        `);
      if (result.recordset.length === 0) {
        res.status(404).json({ error: 'nota_not_found', message: 'Nota does not exist or is already inactive.' });
        return;
      }
      res.status(200).json({ deactivated: true });
    } catch (error) {
      next(error);
    }
  }
);

/* ---- Asociaciones N:M: instrumento_documento / instrumento_nota ----------
 *
 * Mismo patrón que gabinete_plano/caja_plano (planos.ts): reasociar una
 * pareja que existe pero está inactiva la reactiva en vez de duplicar
 * (200 vs 201 en la respuesta distingue los dos casos).
 */

async function associar(
  kind: 'documento' | 'nota',
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const projectId = req.projectAccess!.projectId;
    const userId = req.authUser!.id;
    const parentId = normalizeParam(kind === 'documento' ? req.params.documentoId : req.params.notaId);
    const instrumentoId = normalizeParam(req.params.instrumentoId);

    if (!isPositiveIntString(parentId) || !isPositiveIntString(instrumentoId)) {
      res.status(400).json({ error: 'invalid_id', message: 'Both ids must be positive integers.' });
      return;
    }

    const table = kind === 'documento' ? 'nucleo.instrumento_documento' : 'nucleo.instrumento_nota';
    const fkColumn = kind === 'documento' ? 'documento_id' : 'nota_id';
    const parentTable = kind === 'documento' ? 'nucleo.documento' : 'nucleo.nota';

    const pool = await getDbPool();
    const result = await pool
      .request()
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .input('parent_id', sql.NVarChar(30), parentId)
      .input('instrumento_id', sql.NVarChar(30), instrumentoId)
      .input('created_by', sql.NVarChar(30), userId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM ${parentTable}
          WHERE id = TRY_CONVERT(BIGINT, @parent_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
        )
        BEGIN
          THROW 54501, 'El documento/nota no existe en este proyecto o está inactivo.', 1;
        END;

        IF NOT EXISTS (
          SELECT 1 FROM nucleo.instrumento
          WHERE id = TRY_CONVERT(BIGINT, @instrumento_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
        )
        BEGIN
          THROW 54502, 'El instrumento no existe en este proyecto o está inactivo.', 1;
        END;

        IF EXISTS (
          SELECT 1 FROM ${table}
          WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @parent_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
        )
        BEGIN
          THROW 54503, 'Esa asociación ya existe y está activa.', 1;
        END;

        IF EXISTS (
          SELECT 1 FROM ${table}
          WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @parent_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 0
        )
        BEGIN
          DECLARE @reactivados TABLE (id BIGINT);
          UPDATE ${table}
          SET activo = 1, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @created_by)
          OUTPUT INSERTED.id INTO @reactivados
          WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @parent_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 0;
          SELECT id, 'reactivated' AS action FROM @reactivados;
        END
        ELSE
        BEGIN
          DECLARE @nuevos TABLE (id BIGINT);
          INSERT INTO ${table} (proyecto_id, ${fkColumn}, instrumento_id, activo, created_at, created_by)
          OUTPUT INSERTED.id INTO @nuevos
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @parent_id), TRY_CONVERT(BIGINT, @instrumento_id), 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
          SELECT id, 'created' AS action FROM @nuevos;
        END
      `);

    const row = result.recordset[0];
    res.status(row.action === 'created' ? 201 : 200).json({ id: String(row.id), action: row.action });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('está inactivo') && !message.includes('asociación ya existe')) {
      res.status(404).json({ error: 'not_found', message });
      return;
    }
    if (message.includes('asociación ya existe')) {
      res.status(409).json({ error: 'already_associated', message });
      return;
    }
    next(error);
  }
}

async function desasociar(
  kind: 'documento' | 'nota',
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const projectId = req.projectAccess!.projectId;
    const parentId = normalizeParam(kind === 'documento' ? req.params.documentoId : req.params.notaId);
    const instrumentoId = normalizeParam(req.params.instrumentoId);

    if (!isPositiveIntString(parentId) || !isPositiveIntString(instrumentoId)) {
      res.status(400).json({ error: 'invalid_id', message: 'Both ids must be positive integers.' });
      return;
    }

    const table = kind === 'documento' ? 'nucleo.instrumento_documento' : 'nucleo.instrumento_nota';
    const fkColumn = kind === 'documento' ? 'documento_id' : 'nota_id';

    const pool = await getDbPool();
    const result = await pool
      .request()
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .input('parent_id', sql.NVarChar(30), parentId)
      .input('instrumento_id', sql.NVarChar(30), instrumentoId)
      .query(`
        UPDATE ${table}
        SET activo = 0, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.id
        WHERE ${fkColumn} = TRY_CONVERT(BIGINT, @parent_id) AND instrumento_id = TRY_CONVERT(BIGINT, @instrumento_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);

    if (result.recordset.length === 0) {
      res.status(404).json({ error: 'association_not_found', message: 'This association does not exist or is already inactive.' });
      return;
    }
    res.status(200).json({ deactivated: true });

  } catch (error) {
    next(error);
  }
}

documentosRouter.post('/:documentoId/instrumentos/:instrumentoId', requireProjectPermission('write'), (req, res, next) => associar('documento', req, res, next));
documentosRouter.delete('/:documentoId/instrumentos/:instrumentoId', requireProjectPermission('write'), (req, res, next) => desasociar('documento', req, res, next));
documentosRouter.post('/:documentoId/notas/:notaId/instrumentos/:instrumentoId', requireProjectPermission('write'), (req, res, next) => associar('nota', req, res, next));
documentosRouter.delete('/:documentoId/notas/:notaId/instrumentos/:instrumentoId', requireProjectPermission('write'), (req, res, next) => desasociar('nota', req, res, next));
