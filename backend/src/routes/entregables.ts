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
 * nucleo.entregable (migración 006) — identidad + numeración de un
 * documento controlado (ej. un LDI). No lleva plantilla_id ni
 * configuracion_orden_id: esos conceptos son de proyecto+tipo_entregable,
 * se resuelven y se CONGELAN por separado en cada revisión (ver
 * revisionesEntregable.ts) — un entregable de larga vida puede atravesar
 * varias plantillas distintas a lo largo de sus revisiones.
 */
export const entregablesRouter = Router({ mergeParams: true });

entregablesRouter.use(authenticate);

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

/** Composición actual del número de documento — NO es un motor de
 * esquemas configurable todavía (decisión explícita: no generalizar sin
 * más decisiones de negocio). Componentes vacíos se omiten en vez de
 * dejar un segmento "-" colgando, para no atarse a que siempre haya
 * exactamente 7 segmentos. */
function componerNumeroDocumento(componentes: Array<string | null>): string {
  return componentes.filter((c) => c !== null && c !== undefined && c !== '').join('-');
}

function serialize(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    tipoEntregableId: String(row.tipo_entregable_id),
    numeroDocumento: row.numero_documento,
    componenteEtapa: row.componente_etapa,
    componenteProyecto: row.componente_proyecto,
    componenteCliente: row.componente_cliente,
    componenteTipo: row.componente_tipo,
    componenteArea: row.componente_area,
    componenteDisciplina: row.componente_disciplina,
    componenteCorrelativo: row.componente_correlativo,
    titulo: row.titulo,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const SELECT_COLUMNS = `
  id, proyecto_id, tipo_entregable_id, numero_documento,
  componente_etapa, componente_proyecto, componente_cliente, componente_tipo,
  componente_area, componente_disciplina, componente_correlativo,
  titulo, activo, created_at, updated_at, created_by, updated_by
`;

/*
 * GET /api/projects/:projectId/entregables
 */
entregablesRouter.get(
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
          SELECT ${SELECT_COLUMNS}
          FROM nucleo.entregable
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY numero_documento;
        `);

      res.status(200).json({ projectId, entregables: result.recordset.map(serialize) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * GET /api/projects/:projectId/entregables/:entregableId
 */
entregablesRouter.get(
  '/:entregableId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const entregableId = normalizeParam(req.params.entregableId);

      if (!entregableId || !/^\d+$/.test(entregableId)) {
        res.status(400).json({ error: 'invalid_entregable_id', message: 'entregableId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('id', sql.NVarChar(30), entregableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${SELECT_COLUMNS}
          FROM nucleo.entregable
          WHERE id = TRY_CONVERT(BIGINT, @id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'entregable_not_found', message: 'Entregable does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ entregable: serialize(row) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * POST /api/projects/:projectId/entregables
 * Congela los componentes del número en el momento de creación —
 * etapa/proyecto/cliente vienen de proyecto_documentacion TAL COMO ESTÁN
 * AHORA (no se re-leen después); area/disciplina/correlativo los da el
 * usuario (ver diseño: la letra de disciplina documental NO es propiedad
 * universal del tipo de entregable).
 */
entregablesRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = req.body ?? {};

      const {
        tipoEntregableId,
        componenteArea = null,
        componenteDisciplina = null,
        componenteCorrelativo,
        titulo = null
      } = body;

      if (!isPositiveIntString(tipoEntregableId)) {
        res.status(400).json({ error: 'validation_error', message: 'tipoEntregableId is required and must be numeric.' });
        return;
      }
      if (typeof componenteCorrelativo !== 'string' || componenteCorrelativo.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'componenteCorrelativo is required.' });
        return;
      }
      for (const [name, value] of [
        ['componenteArea', componenteArea],
        ['componenteDisciplina', componenteDisciplina],
        ['titulo', titulo]
      ] as const) {
        if (value !== null && typeof value !== 'string') {
          res.status(400).json({ error: 'validation_error', message: `${name} must be a string or null.` });
          return;
        }
      }

      const pool = await getDbPool();

      const tipoResult = await pool
        .request()
        .input('id', sql.NVarChar(30), tipoEntregableId)
        .query(`SELECT id, codigo FROM cat.cat_tipo_entregable WHERE id = TRY_CONVERT(BIGINT, @id);`);

      const tipo = tipoResult.recordset[0];
      if (!tipo) {
        res.status(400).json({ error: 'invalid_reference', message: 'tipoEntregableId does not exist.' });
        return;
      }

      const docResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT etapa_codigo, codigo_proyecto_cumbra, codigo_proyecto_cliente, titulo_caratula
          FROM nucleo.proyecto_documentacion
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);
      const doc = docResult.recordset[0] ?? {
        etapa_codigo: null,
        codigo_proyecto_cumbra: null,
        codigo_proyecto_cliente: null,
        titulo_caratula: null
      };

      const componenteEtapa = doc.etapa_codigo;
      const componenteProyecto = doc.codigo_proyecto_cumbra;
      const componenteCliente = doc.codigo_proyecto_cliente;
      const componenteTipo = tipo.codigo;
      const correlativo = componenteCorrelativo.trim();
      const tituloFinal = titulo ?? doc.titulo_caratula;

      const numeroDocumento = componerNumeroDocumento([
        componenteEtapa,
        componenteProyecto,
        componenteCliente,
        componenteTipo,
        componenteArea,
        componenteDisciplina,
        correlativo
      ]);

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tipo_entregable_id', sql.NVarChar(30), tipoEntregableId)
        .input('numero_documento', sql.NVarChar(200), numeroDocumento)
        .input('componente_etapa', sql.NVarChar(20), componenteEtapa)
        .input('componente_proyecto', sql.NVarChar(50), componenteProyecto)
        .input('componente_cliente', sql.NVarChar(50), componenteCliente)
        .input('componente_tipo', sql.NVarChar(20), componenteTipo)
        .input('componente_area', sql.NVarChar(20), componenteArea)
        .input('componente_disciplina', sql.NVarChar(10), componenteDisciplina)
        .input('componente_correlativo', sql.NVarChar(20), correlativo)
        .input('titulo', sql.NVarChar(400), tituloFinal)
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO nucleo.entregable (
            proyecto_id, tipo_entregable_id, numero_documento,
            componente_etapa, componente_proyecto, componente_cliente, componente_tipo,
            componente_area, componente_disciplina, componente_correlativo,
            titulo, activo, created_at, created_by
          )
          OUTPUT
            INSERTED.id, INSERTED.proyecto_id, INSERTED.tipo_entregable_id, INSERTED.numero_documento,
            INSERTED.componente_etapa, INSERTED.componente_proyecto, INSERTED.componente_cliente,
            INSERTED.componente_tipo, INSERTED.componente_area, INSERTED.componente_disciplina,
            INSERTED.componente_correlativo, INSERTED.titulo, INSERTED.activo,
            INSERTED.created_at, INSERTED.updated_at, INSERTED.created_by, INSERTED.updated_by
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @tipo_entregable_id), @numero_documento,
            @componente_etapa, @componente_proyecto, @componente_cliente, @componente_tipo,
            @componente_area, @componente_disciplina, @componente_correlativo,
            @titulo, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/entregables/${String(row.id)}`)
        .json({ entregable: serialize(row) });
    } catch (error) {
      const number = sqlErrorNumber(error);

      if (number === 2601 || number === 2627) {
        const message = String((error as { message?: string }).message ?? '');
        if (message.includes('UQ_entregable_numero_documento')) {
          res.status(409).json({ error: 'numero_documento_conflict', message: 'Ya existe un entregable con ese número de documento en el proyecto.' });
          return;
        }
        res.status(409).json({
          error: 'componentes_conflict',
          message: 'Ya existe un entregable con esa combinación de etapa/tipo/área/disciplina/correlativo en el proyecto.'
        });
        return;
      }

      next(error);
    }
  }
);
