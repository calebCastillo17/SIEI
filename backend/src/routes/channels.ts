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
 * nucleo.canal — SOLO LECTURA por API. Los canales los administra
 * TR_modulo_generar_canales según la capacidad (canales_max) del tipo de
 * módulo asignado: se crean/desactivan solos cuando se crea un módulo o se
 * le reasigna catalogoModuloId (ver modules.ts). No se expone POST/PATCH/
 * DELETE aquí — un canal no se gestiona directamente, se gestiona a través
 * del módulo que lo contiene. Si en el futuro hace falta poder marcar un
 * canal individual como dañado/fuera de servicio sin tocar el módulo, se
 * agrega como una operación aparte y explícita, no como PATCH genérico.
 */
export const channelsRouter = Router({ mergeParams: true });

channelsRouter.use(authenticate);


function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPositiveIntString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    moduloId: String(row.modulo_id),
    numeroCanal: row.numero_canal,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'proyecto_id', 'modulo_id', 'numero_canal', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/projects/:projectId/channels?moduloId=
 */
channelsRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const moduloIdFilter = normalizeParam(req.query.moduloId as string | string[] | undefined);

      if (moduloIdFilter !== undefined && !isPositiveIntString(moduloIdFilter)) {
        res.status(400).json({ error: 'invalid_modulo_id', message: 'moduloId filter must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);

      if (moduloIdFilter) request.input('modulo_id', sql.NVarChar(30), moduloIdFilter);

      const result = await request.query(`
        SELECT ${COLUMNS}
        FROM nucleo.canal
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1
          ${moduloIdFilter ? 'AND modulo_id = TRY_CONVERT(BIGINT, @modulo_id)' : ''}
        ORDER BY modulo_id, numero_canal;
      `);

      res.status(200).json({ projectId, channels: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/channels/:channelId
 */
channelsRouter.get(
  '/:channelId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const channelId = normalizeParam(req.params.channelId);

      if (!isPositiveIntString(channelId)) {
        res.status(400).json({ error: 'invalid_channel_id', message: 'channelId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('canal_id', sql.NVarChar(30), channelId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.canal
          WHERE id = TRY_CONVERT(BIGINT, @canal_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'channel_not_found', message: 'Channel does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ channel: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);
