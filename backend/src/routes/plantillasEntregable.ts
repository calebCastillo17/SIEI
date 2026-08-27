import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import sql from 'mssql';
import multer from 'multer';
import { createHash } from 'node:crypto';

import { authenticate } from '../middleware/authenticate.js';
import { requireProjectPermission } from '../middleware/requireProjectPermission.js';
import { getDbPool } from '../db/sql.js';

/*
 * nucleo.plantilla_entregable (migración 006) — el archivo de plantilla
 * (.xlsm/.xlsx) que provee el proyecto para un tipo de entregable dado.
 * Nunca se edita in-place (TR_plantilla_entregable_blob_inmutable lo
 * rechaza a nivel de base): "reemplazar" es desactivar la vigente +
 * insertar una nueva, dentro de una misma transacción. Requiere
 * 'administer' para subir — mismo nivel que miembros/roles.
 */
export const plantillasEntregableRouter = Router({ mergeParams: true });

plantillasEntregableRouter.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

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
    tipoEntregableId: String(row.tipo_entregable_id),
    nombreArchivo: row.nombre_archivo,
    archivoHash: row.archivo_hash,
    tamanioBytes: Number(row.tamanio_bytes),
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by)
  };
}

/*
 * GET /api/projects/:projectId/plantillas-entregable
 * Trae también las históricas (activo=0) — hace falta para poder ver qué
 * plantilla usó cada revisión pasada.
 */
plantillasEntregableRouter.get(
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
          SELECT id, proyecto_id, tipo_entregable_id, nombre_archivo, archivo_hash,
                 tamanio_bytes, activo, created_at, updated_at, created_by
          FROM nucleo.plantilla_entregable
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          ORDER BY created_at DESC;
        `);

      res.status(200).json({ projectId, plantillas: result.recordset.map(serialize) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * POST /api/projects/:projectId/plantillas-entregable
 * multipart/form-data: campo "file" (el .xlsm/.xlsx) + campo de texto
 * "tipoEntregableId". Reemplaza cualquier plantilla activa para ese
 * proyecto+tipo (desactivar + insertar, transaccional).
 */
plantillasEntregableRouter.post(
  '/',
  requireProjectPermission('administer'),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      if (!req.file) {
        res.status(400).json({ error: 'validation_error', message: 'file is required (multipart field "file").' });
        return;
      }

      const tipoEntregableId = req.body?.tipoEntregableId;
      if (!isPositiveIntString(tipoEntregableId)) {
        res.status(400).json({ error: 'validation_error', message: 'tipoEntregableId is required and must be numeric.' });
        return;
      }

      const originalName = req.file.originalname ?? 'plantilla.xlsx';
      if (originalName.length > 260) {
        res.status(400).json({ error: 'validation_error', message: 'nombre de archivo demasiado largo.' });
        return;
      }

      const hash = createHash('sha256').update(req.file.buffer).digest('hex');
      const pool = await getDbPool();

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tipo_entregable_id', sql.NVarChar(30), tipoEntregableId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.plantilla_entregable
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND tipo_entregable_id = TRY_CONVERT(BIGINT, @tipo_entregable_id)
            AND activo = 1;
        `);

      const insertResult = await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tipo_entregable_id', sql.NVarChar(30), tipoEntregableId)
        .input('nombre_archivo', sql.NVarChar(260), originalName)
        .input('archivo_blob', sql.VarBinary(sql.MAX), req.file.buffer)
        .input('archivo_hash', sql.Char(64), hash)
        .input('tamanio_bytes', sql.BigInt, req.file.buffer.length)
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO nucleo.plantilla_entregable (
            proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob,
            archivo_hash, tamanio_bytes, activo, created_at, created_by
          )
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tipo_entregable_id,
                 INSERTED.nombre_archivo, INSERTED.archivo_hash, INSERTED.tamanio_bytes,
                 INSERTED.activo, INSERTED.created_at, INSERTED.updated_at, INSERTED.created_by
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @tipo_entregable_id),
            @nombre_archivo, @archivo_blob, @archivo_hash, @tamanio_bytes,
            1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      await transaction.commit();

      const row = insertResult.recordset[0];
      res.status(201).json({ plantilla: serialize(row) });
    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch {
          // ya pudo haber quedado sin transacción viva
        }
      }

      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoEntregableId does not exist.' });
        return;
      }

      next(error);
    }
  }
);
