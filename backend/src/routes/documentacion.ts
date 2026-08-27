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
 * nucleo.proyecto_documentacion — metadatos de carátula, 1:1 con
 * nucleo.proyecto (migración 006). Deliberadamente separada de
 * nucleo.proyecto: son "metadatos de documentación", no identidad
 * estructural del proyecto (ver CLAUDE.md / docs/MODELO_FISICO_SIEI.md).
 * GET requiere 'read'; PATCH requiere 'administer' (mismo nivel que
 * miembros/roles del proyecto).
 */
export const documentacionRouter = Router({ mergeParams: true });

documentacionRouter.use(authenticate);

const CAMPOS = [
  'codigoProyectoCumbra',
  'codigoProyectoCliente',
  'tituloCaratula',
  'etapaCodigo',
  'etapaNombre',
  'afe',
  'vp',
  'jefeDisciplina',
  'liderProyecto',
  'gerenteIngenieriaConstruccion',
  'inicialesPorDefault',
  'inicialesRevisadoDefault',
  'inicialesAprobadoDefault'
] as const;

const COLUMNA_POR_CAMPO: Record<(typeof CAMPOS)[number], string> = {
  codigoProyectoCumbra: 'codigo_proyecto_cumbra',
  codigoProyectoCliente: 'codigo_proyecto_cliente',
  tituloCaratula: 'titulo_caratula',
  etapaCodigo: 'etapa_codigo',
  etapaNombre: 'etapa_nombre',
  afe: 'afe',
  vp: 'vp',
  jefeDisciplina: 'jefe_disciplina',
  liderProyecto: 'lider_proyecto',
  gerenteIngenieriaConstruccion: 'gerente_ingenieria_construccion',
  inicialesPorDefault: 'iniciales_por_default',
  inicialesRevisadoDefault: 'iniciales_revisado_default',
  inicialesAprobadoDefault: 'iniciales_aprobado_default'
};

const MAX_LEN: Record<(typeof CAMPOS)[number], number> = {
  codigoProyectoCumbra: 50,
  codigoProyectoCliente: 50,
  tituloCaratula: 400,
  etapaCodigo: 20,
  etapaNombre: 200,
  afe: 50,
  vp: 200,
  jefeDisciplina: 200,
  liderProyecto: 200,
  gerenteIngenieriaConstruccion: 200,
  inicialesPorDefault: 20,
  inicialesRevisadoDefault: 20,
  inicialesAprobadoDefault: 20
};

function serialize(row: Record<string, any> | undefined, projectId: string) {
  if (!row) {
    return {
      projectId,
      codigoProyectoCumbra: null,
      codigoProyectoCliente: null,
      tituloCaratula: null,
      etapaCodigo: null,
      etapaNombre: null,
      afe: null,
      vp: null,
      jefeDisciplina: null,
      liderProyecto: null,
      gerenteIngenieriaConstruccion: null,
      inicialesPorDefault: null,
      inicialesRevisadoDefault: null,
      inicialesAprobadoDefault: null,
      createdAt: null,
      updatedAt: null
    };
  }

  return {
    projectId,
    codigoProyectoCumbra: row.codigo_proyecto_cumbra,
    codigoProyectoCliente: row.codigo_proyecto_cliente,
    tituloCaratula: row.titulo_caratula,
    etapaCodigo: row.etapa_codigo,
    etapaNombre: row.etapa_nombre,
    afe: row.afe,
    vp: row.vp,
    jefeDisciplina: row.jefe_disciplina,
    liderProyecto: row.lider_proyecto,
    gerenteIngenieriaConstruccion: row.gerente_ingenieria_construccion,
    inicialesPorDefault: row.iniciales_por_default,
    inicialesRevisadoDefault: row.iniciales_revisado_default,
    inicialesAprobadoDefault: row.iniciales_aprobado_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/*
 * GET /api/projects/:projectId/documentacion
 * No falla si todavía no existe la fila — un proyecto recién creado no
 * tiene documentación cargada, eso es normal, se devuelve todo en null.
 */
documentacionRouter.get(
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
          SELECT *
          FROM nucleo.proyecto_documentacion
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      res.status(200).json({ documentacion: serialize(result.recordset[0], projectId) });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * PATCH /api/projects/:projectId/documentacion
 * Upsert: si no existe la fila, la crea; si existe, la actualiza. Requiere
 * 'administer' — mismo nivel que miembros/roles (ver members.ts).
 */
documentacionRouter.patch(
  '/',
  requireProjectPermission('administer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = req.body ?? {};

      if (!CAMPOS.some((campo) => campo in body)) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      for (const campo of CAMPOS) {
        if (!(campo in body)) continue;
        const value = body[campo];
        if (value !== null && typeof value !== 'string') {
          res.status(400).json({ error: 'validation_error', message: `${campo} must be a string or null.` });
          return;
        }
        if (typeof value === 'string' && value.length > MAX_LEN[campo]) {
          res.status(400).json({
            error: 'validation_error',
            message: `${campo} cannot exceed ${MAX_LEN[campo]} characters.`
          });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();
      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      for (const campo of CAMPOS) {
        if (!(campo in body)) continue;
        const paramName = `p_${COLUMNA_POR_CAMPO[campo]}`;
        request.input(paramName, sql.NVarChar(MAX_LEN[campo]), body[campo]);
        assignments.push(`${COLUMNA_POR_CAMPO[campo]} = @${paramName}`);
      }

      // Construye la lista completa de columnas/valores para el INSERT
      // inicial (mismo body, con NULL para lo no enviado).
      const insertColumns = CAMPOS.map((c) => COLUMNA_POR_CAMPO[c]);
      const insertParams = CAMPOS.map((c) => {
        const paramName = `i_${COLUMNA_POR_CAMPO[c]}`;
        request.input(paramName, sql.NVarChar(MAX_LEN[c]), c in body ? body[c] : null);
        return `@${paramName}`;
      });

      const result = await request.query(`
        IF EXISTS (
          SELECT 1 FROM nucleo.proyecto_documentacion WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        )
        BEGIN
          UPDATE nucleo.proyecto_documentacion
          SET ${assignments.length > 0 ? assignments.join(',\n              ') + ',' : ''}
              updated_at = SYSUTCDATETIME(),
              updated_by = TRY_CONVERT(BIGINT, @updated_by)
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        END
        ELSE
        BEGIN
          INSERT INTO nucleo.proyecto_documentacion (
            proyecto_id, ${insertColumns.join(', ')}, created_at, created_by
          )
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), ${insertParams.join(', ')}, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @updated_by)
          );
        END

        SELECT * FROM nucleo.proyecto_documentacion WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
      `);

      res.status(200).json({ documentacion: serialize(result.recordset[0], projectId) });
    } catch (error) {
      next(error);
    }
  }
);
