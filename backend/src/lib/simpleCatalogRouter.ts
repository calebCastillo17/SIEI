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
 * Seis catálogos globales del schema `cat` comparten exactamente la misma
 * forma: id, codigo (NVARCHAR(30) NOT NULL UNIQUE), descripcion
 * (NVARCHAR(200) NULL), created_at, updated_at — sin `activo` (los
 * catálogos no tienen soft delete, ver docs/MODELO_FISICO_SIEI.md 2.2) y
 * sin triggers propios. En vez de duplicar el mismo router 6 veces
 * (cat_tipo_interfaz, cat_tipo_com, cat_tipo_medio_com, cat_estado_revision,
 * cat_prioridad_alarma, cat_estado_pnid), este factory genera uno
 * parametrizado por nombre de tabla.
 *
 * `writable`:
 *   - true  -> catálogo de dominio ABIERTO (tipo_interfaz, tipo_com,
 *     tipo_medio_com): sin seed, la documentación los marca explícitamente
 *     como "no lista cerrada confirmada". Admite POST, solo
 *     es_admin_sistema (mismo criterio que cat_modulo_io: es un catálogo
 *     compartido por todos los proyectos).
 *   - false -> lista CERRADA ya confirmada en los Excel de origen
 *     (estado_revision, prioridad_alarma, estado_pnid), ya sembrada por la
 *     migración 001. Solo lectura: agregar códigos nuevos a una lista que
 *     la documentación marca como cerrada no es una decisión que este
 *     endpoint deba tomar por su cuenta — si hiciera falta ampliarla, es
 *     una migración, no una llamada a la API.
 *
 * Sin PATCH/DELETE en ningún caso: no hay `activo` para desactivar, y
 * editar/borrar un código ya referenciado por filas de `nucleo` rompería
 * FKs existentes sin ganar nada (mismo razonamiento que cat_modulo_io).
 */
export function createSimpleCatalogRouter(
  schemaTable: string,
  writable: boolean
): Router {
  const router = Router();

  router.use(authenticate);

  function serialize(row: Record<string, any>) {
    return {
      id: String(row.id),
      codigo: row.codigo,
      descripcion: row.descripcion,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

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

  /*
   * GET / — cualquier usuario autenticado.
   */
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = await getDbPool();
      const result = await pool.request().query(`
        SELECT id, codigo, descripcion, created_at, updated_at
        FROM ${schemaTable}
        ORDER BY codigo;
      `);

      res.status(200).json({ items: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  });

  /*
   * GET /:id
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = normalizeParam(req.params.id);

      if (!id || !/^\d+$/.test(id)) {
        res.status(400).json({ error: 'invalid_id', message: 'id must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('id', sql.NVarChar(30), id)
        .query(`
          SELECT id, codigo, descripcion, created_at, updated_at
          FROM ${schemaTable}
          WHERE id = TRY_CONVERT(BIGINT, @id);
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'not_found', message: 'Item does not exist.' });
        return;
      }

      res.status(200).json({ item: serialize(row) });

    } catch (error) {
      next(error);
    }
  });

  if (writable) {
    /*
     * POST / — solo es_admin_sistema (catálogo de dominio abierto).
     */
    router.post(
      '/',
      requireSystemAdmin,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { codigo, descripcion = null } = req.body ?? {};

          if (typeof codigo !== 'string' || codigo.trim().length === 0) {
            res.status(400).json({ error: 'validation_error', message: 'codigo is required.' });
            return;
          }
          const codigoTrim = codigo.trim();
          if (codigoTrim.length > 30) {
            res.status(400).json({ error: 'validation_error', message: 'codigo cannot exceed 30 characters.' });
            return;
          }

          if (descripcion !== null && descripcion !== undefined && typeof descripcion !== 'string') {
            res.status(400).json({ error: 'validation_error', message: 'descripcion must be a string or null.' });
            return;
          }
          if (typeof descripcion === 'string' && descripcion.length > 200) {
            res.status(400).json({ error: 'validation_error', message: 'descripcion cannot exceed 200 characters.' });
            return;
          }

          const pool = await getDbPool();
          const result = await pool
            .request()
            .input('codigo', sql.NVarChar(30), codigoTrim)
            .input('descripcion', sql.NVarChar(200), descripcion)
            .query(`
              INSERT INTO ${schemaTable} (codigo, descripcion, created_at)
              OUTPUT INSERTED.id, INSERTED.codigo, INSERTED.descripcion, INSERTED.created_at
              VALUES (@codigo, @descripcion, SYSUTCDATETIME());
            `);

          const row = result.recordset[0];

          res.status(201).json({ item: serialize(row) });

        } catch (error) {
          const number = sqlErrorNumber(error);

          if (number === 2601 || number === 2627) {
            res.status(409).json({ error: 'code_conflict', message: 'An item with this codigo already exists.' });
            return;
          }

          next(error);
        }
      }
    );
  }

  return router;
}
