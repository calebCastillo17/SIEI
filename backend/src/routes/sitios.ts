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
 * nucleo.sitio (migración 030) — 1:1 con proyecto, sin `activo` (mismo
 * criterio que nucleo.proyecto_documentacion: una fila singleton no se
 * "desactiva", se reemplaza su contenido). Solo GET/POST/PATCH, sin
 * DELETE.
 */
export const sitiosRouter = Router({ mergeParams: true });
sitiosRouter.use(authenticate);

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
    altitudMsnm: row.altitud_msnm,
    tempMinC: row.temp_min_c,
    tempMaxC: row.temp_max_c,
    humedadRelativaPct: row.humedad_relativa_pct,
    medioAmbiente: row.medio_ambiente,
    cicloTrabajo: row.ciclo_trabajo,
    clasificacionArea: row.clasificacion_area,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = 'id, proyecto_id, altitud_msnm, temp_min_c, temp_max_c, humedad_relativa_pct, medio_ambiente, ciclo_trabajo, clasificacion_area, created_at, updated_at, created_by, updated_by';

/*
 * GET / — el sitio del proyecto, o { sitio: null } si todavía no se
 * cargó ninguno.
 */
sitiosRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`SELECT ${COLUMNS} FROM nucleo.sitio WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);`);
      res.status(200).json({ sitio: result.recordset[0] ? serialize(result.recordset[0]) : null });
    } catch (error) {
      next(error);
    }
  }
);

function validateBody(body: Record<string, unknown>): string | null {
  const numericFields = ['altitudMsnm', 'tempMinC', 'tempMaxC', 'humedadRelativaPct'];
  for (const f of numericFields) {
    if (f in body && body[f] !== null && typeof body[f] !== 'number') return `${f} must be a number or null.`;
  }
  const textFields: Array<[string, number]> = [['medioAmbiente', 300], ['cicloTrabajo', 200], ['clasificacionArea', 100]];
  for (const [f, max] of textFields) {
    const value = body[f];
    if (f in body && value !== null) {
      if (typeof value !== 'string') return `${f} must be a string or null.`;
      if (value.length > max) return `${f} cannot exceed ${max} characters.`;
    }
  }
  return null;
}

/*
 * POST / — crea el sitio del proyecto. 409 si ya existe (usar PATCH para
 * modificarlo).
 */
sitiosRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const validationError = validateBody(body);
      if (validationError) {
        res.status(400).json({ error: 'validation_error', message: validationError });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('altitud_msnm', sql.Int, body.altitudMsnm ?? null)
        .input('temp_min_c', sql.Decimal(5, 1), body.tempMinC ?? null)
        .input('temp_max_c', sql.Decimal(5, 1), body.tempMaxC ?? null)
        .input('humedad_relativa_pct', sql.Decimal(5, 1), body.humedadRelativaPct ?? null)
        .input('medio_ambiente', sql.NVarChar(300), body.medioAmbiente ?? null)
        .input('ciclo_trabajo', sql.NVarChar(200), body.cicloTrabajo ?? null)
        .input('clasificacion_area', sql.NVarChar(100), body.clasificacionArea ?? null)
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO nucleo.sitio (proyecto_id, altitud_msnm, temp_min_c, temp_max_c, humedad_relativa_pct, medio_ambiente, ciclo_trabajo, clasificacion_area, created_by)
          OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), @altitud_msnm, @temp_min_c, @temp_max_c, @humedad_relativa_pct, @medio_ambiente, @ciclo_trabajo, @clasificacion_area, TRY_CONVERT(BIGINT, @created_by));
        `);

      res.status(201).json({ sitio: serialize(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'sitio_already_exists', message: 'This project already has a sitio — use PATCH to modify it.' });
        return;
      }
      next(error);
    }
  }
);

sitiosRouter.patch(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const validationError = validateBody(body);
      if (validationError) {
        res.status(400).json({ error: 'validation_error', message: validationError });
        return;
      }

      const columnMap: Record<string, { column: string; sqlType: any }> = {
        altitudMsnm: { column: 'altitud_msnm', sqlType: sql.Int },
        tempMinC: { column: 'temp_min_c', sqlType: sql.Decimal(5, 1) },
        tempMaxC: { column: 'temp_max_c', sqlType: sql.Decimal(5, 1) },
        humedadRelativaPct: { column: 'humedad_relativa_pct', sqlType: sql.Decimal(5, 1) },
        medioAmbiente: { column: 'medio_ambiente', sqlType: sql.NVarChar(300) },
        cicloTrabajo: { column: 'ciclo_trabajo', sqlType: sql.NVarChar(200) },
        clasificacionArea: { column: 'clasificacion_area', sqlType: sql.NVarChar(100) }
      };

      const pool = await getDbPool();
      const request = pool.request();
      request.input('proyecto_id', sql.NVarChar(30), projectId);
      request.input('updated_by', sql.NVarChar(30), userId);

      const setClauses: string[] = [];
      for (const [key, { column, sqlType }] of Object.entries(columnMap)) {
        if (!(key in body)) continue;
        request.input(column, sqlType, body[key]);
        setClauses.push(`${column} = @${column}`);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No updatable fields provided.' });
        return;
      }

      const result = await request.query(`
        UPDATE nucleo.sitio
        SET ${setClauses.join(', ')}, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
      `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'sitio_not_found', message: 'This project does not have a sitio yet — use POST to create it.' });
        return;
      }
      res.status(200).json({ sitio: serialize(row) });
    } catch (error) {
      next(error);
    }
  }
);
