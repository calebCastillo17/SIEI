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
import { esCampoOrdenValido } from '../lib/ldi/order.js';

/*
 * nucleo.configuracion_orden (migración 006) — criterios de ordenamiento
 * reutilizables para preparar una revisión de entregable (ej. LDI). Cada
 * revisión congela su propia copia en revision_entregable.
 * criterios_aplicados_json; esta tabla es solo el "punto de partida"
 * reutilizable, editable por 'write' (no requiere 'administer': es
 * configuración de trabajo, no gobierno del proyecto).
 */
export const configuracionesOrdenRouter = Router({ mergeParams: true });

configuracionesOrdenRouter.use(authenticate);

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

interface Criterio {
  campo: string;
  direccion: 'ASC' | 'DESC';
}

function validarCriterios(value: unknown): Criterio[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const criterios: Criterio[] = [];
  for (const entry of value) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as any).campo !== 'string' ||
      !esCampoOrdenValido((entry as any).campo) ||
      ((entry as any).direccion !== 'ASC' && (entry as any).direccion !== 'DESC')
    ) {
      return null;
    }
    criterios.push({ campo: (entry as any).campo, direccion: (entry as any).direccion });
  }
  return criterios;
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tipoEntregableId: row.tipo_entregable_id === null ? null : String(row.tipo_entregable_id),
    nombre: row.nombre,
    criterios: JSON.parse(row.criterios_json),
    esDefault: Boolean(row.es_default),
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/*
 * GET /api/projects/:projectId/configuraciones-orden
 */
configuracionesOrdenRouter.get(
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
          SELECT id, proyecto_id, tipo_entregable_id, nombre, criterios_json,
                 es_default, activo, created_at, updated_at
          FROM nucleo.configuracion_orden
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY es_default DESC, nombre;
        `);

      res.status(200).json({ projectId, configuraciones: result.recordset.map(serialize) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * POST /api/projects/:projectId/configuraciones-orden
 */
configuracionesOrdenRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = req.body ?? {};

      const { nombre, tipoEntregableId = null, esDefault = false } = body;

      if (typeof nombre !== 'string' || nombre.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'nombre is required.' });
        return;
      }
      if (nombre.length > 200) {
        res.status(400).json({ error: 'validation_error', message: 'nombre cannot exceed 200 characters.' });
        return;
      }
      if (tipoEntregableId !== null && !isPositiveIntString(String(tipoEntregableId))) {
        res.status(400).json({ error: 'validation_error', message: 'tipoEntregableId must be a numeric id or null.' });
        return;
      }
      if (typeof esDefault !== 'boolean') {
        res.status(400).json({ error: 'validation_error', message: 'esDefault must be a boolean.' });
        return;
      }

      const criterios = validarCriterios(body.criterios);
      if (!criterios) {
        res.status(400).json({
          error: 'validation_error',
          message: 'criterios must be a non-empty array of { campo, direccion: "ASC"|"DESC" } with a recognized campo.'
        });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tipo_entregable_id', sql.NVarChar(30), tipoEntregableId)
        .input('nombre', sql.NVarChar(200), nombre.trim())
        .input('criterios_json', sql.NVarChar(sql.MAX), JSON.stringify(criterios))
        .input('es_default', sql.Bit, esDefault)
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO nucleo.configuracion_orden (
            proyecto_id, tipo_entregable_id, nombre, criterios_json, es_default, activo, created_at, created_by
          )
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.tipo_entregable_id, INSERTED.nombre,
                 INSERTED.criterios_json, INSERTED.es_default, INSERTED.activo,
                 INSERTED.created_at, INSERTED.updated_at
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @tipo_entregable_id), @nombre,
            @criterios_json, @es_default, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      res.status(201).json({ configuracion: serialize(result.recordset[0]) });
    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 547) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoEntregableId does not exist.' });
        return;
      }
      if (number === 2601 || number === 2627) {
        res.status(409).json({
          error: 'default_conflict',
          message: 'Ya existe una configuración marcada como default para este proyecto+tipo.'
        });
        return;
      }
      next(error);
    }
  }
);
