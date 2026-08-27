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
import {
  parsePnidExcelBuffer,
  extractFieldsFromSnapshot,
  PnidFileStructureError
} from '../lib/pnidImport/parseExcel.js';
import { buildComparisonPlan, type InstrumentSnapshot } from '../lib/pnidImport/compare.js';
import { computePresentFields, PNID_FIELD_MAX_LENGTH, type PnidField } from '../lib/pnidImport/headers.js';

/*
 * nucleo.instrumento importado desde reporte P&ID / Plant 3D — ver
 * database/migrations/004_pnid_import.sql para el modelo completo
 * (integracion.importacion_pnid / _fila / _resultado) y el diseño
 * aprobado (PREVIEW nunca toca nucleo.instrumento; APPLY es una sola
 * transacción, todo o nada).
 */
export const pnidImportsRouter = Router({ mergeParams: true });

pnidImportsRouter.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

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

const MAPPED_FIELD_COLUMNS: Record<Exclude<PnidField, 'pnpid' | 'tagInstrumento' | 'listado'>, string> = {
  tagAnterior: 'tag_anterior',
  planoPnid: 'plano_pnid',
  tipoInstrumento: 'tipo_instrumento',
  descripcion: 'descripcion',
  funcionamiento: 'funcionamiento',
  cuerpoInstrumento: 'cuerpo_instrumento',
  tecnologia: 'tecnologia',
  conexionProceso: 'conexion_proceso',
  tipoSenalPnid: 'tipo_senal_pnid',
  lineaPnid: 'linea_pnid',
  equipoAsociadoTag: 'equipo_asociado_tag',
  instrumentoAsociadoTag: 'instrumento_asociado_tag',
  servicio: 'servicio',
  ubicacion: 'ubicacion',
  sistema: 'sistema',
  nodo: 'nodo'
};

function serializeImportacion(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    nombreArchivo: row.nombre_archivo,
    hashArchivo: row.hash_archivo,
    fuente: row.fuente,
    estado: row.estado,
    totalFilas: row.total_filas,
    totalListadoTrue: row.total_listado_true,
    conteos: {
      sinCambios: row.conteo_sin_cambios,
      nuevos: row.conteo_nuevos,
      tagModificado: row.conteo_tag_modificado,
      datosModificados: row.conteo_datos_modificados,
      excluidosListado: row.conteo_excluidos_listado,
      noExisteReporte: row.conteo_no_existe_reporte,
      requiereRevision: row.conteo_requiere_revision
    },
    advertencias: row.advertencias ? JSON.parse(row.advertencias) : { missingKnownColumns: [], unknownColumns: [] },
    fechaCarga: row.fecha_carga,
    fechaAplicacion: row.fecha_aplicacion,
    createdBy: row.created_by === null ? null : String(row.created_by),
    appliedBy: row.applied_by === null ? null : String(row.applied_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeResultado(row: Record<string, any>) {
  return {
    id: String(row.id),
    importacionId: String(row.importacion_id),
    filaId: row.fila_id === null ? null : String(row.fila_id),
    numeroFila: row.numero_fila ?? null,
    pnpid: row.pnpid,
    tagInstrumento: row.tag_instrumento,
    instrumentoId: row.instrumento_id === null ? null : String(row.instrumento_id),
    resultado: row.resultado_codigo,
    diferencias: row.diferencias ? JSON.parse(row.diferencias) : null,
    requiereRevision: Boolean(row.requiere_revision),
    aplicado: Boolean(row.aplicado),
    aplicadoAt: row.aplicado_at,
    /*
     * Todos los campos mapeados de la fila fuente, no solo los que
     * cambiaron — sin esto, una fila NUEVO_EN_PNID (que nunca tiene
     * `diferencias`, no hay nada previo contra qué comparar) no muestra
     * NINGÚN dato del reporte en preview (ej. "Instrumento Asociado" era
     * invisible hasta aplicar). null si no hay fila fuente (NO_EXISTE_EN_PNID).
     */
    datosPropuestos: row.datos_fuente
      ? extractFieldsFromSnapshot(JSON.parse(row.datos_fuente))
      : null
  };
}

const RESULTADO_SELECT = `
  r.id, r.importacion_id, r.fila_id, f.numero_fila, r.pnpid, r.tag_instrumento,
  r.instrumento_id, e.codigo AS resultado_codigo, r.diferencias, r.requiere_revision,
  r.aplicado, r.aplicado_at, f.datos_fuente
`;

/*
 * GET /api/projects/:projectId/pnid-imports
 */
pnidImportsRouter.get(
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
          SELECT id, proyecto_id, nombre_archivo, hash_archivo, fuente, estado,
                 total_filas, total_listado_true, conteo_sin_cambios, conteo_nuevos,
                 conteo_tag_modificado, conteo_datos_modificados, conteo_excluidos_listado,
                 conteo_no_existe_reporte, conteo_requiere_revision, advertencias,
                 fecha_carga, fecha_aplicacion, created_by, applied_by, created_at, updated_at
          FROM integracion.importacion_pnid
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          ORDER BY fecha_carga DESC;
        `);

      res.status(200).json({
        projectId,
        imports: result.recordset.map(serializeImportacion)
      });
    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/pnid-imports/:importId
 * Cabecera + todos sus resultados (con el numero_fila de su fila fuente,
 * si tiene). Sin paginar: el volumen esperado (cientos de filas) es chico.
 */
pnidImportsRouter.get(
  '/:importId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const importId = normalizeParam(req.params.importId);

      if (!isPositiveIntString(importId)) {
        res.status(400).json({ error: 'invalid_import_id', message: 'importId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      const headerResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('importacion_id', sql.NVarChar(30), importId)
        .query(`
          SELECT id, proyecto_id, nombre_archivo, hash_archivo, fuente, estado,
                 total_filas, total_listado_true, conteo_sin_cambios, conteo_nuevos,
                 conteo_tag_modificado, conteo_datos_modificados, conteo_excluidos_listado,
                 conteo_no_existe_reporte, conteo_requiere_revision, advertencias,
                 fecha_carga, fecha_aplicacion, created_by, applied_by, created_at, updated_at
          FROM integracion.importacion_pnid
          WHERE id = TRY_CONVERT(BIGINT, @importacion_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      const headerRow = headerResult.recordset[0];

      if (!headerRow) {
        res.status(404).json({ error: 'import_not_found', message: 'Import does not exist in this project.' });
        return;
      }

      const resultadosResult = await pool
        .request()
        .input('importacion_id', sql.NVarChar(30), importId)
        .query(`
          SELECT ${RESULTADO_SELECT}
          FROM integracion.importacion_pnid_resultado r
          LEFT JOIN integracion.importacion_pnid_fila f ON f.id = r.fila_id
          JOIN cat.cat_estado_pnid e ON e.id = r.resultado_id
          WHERE r.importacion_id = TRY_CONVERT(BIGINT, @importacion_id)
          ORDER BY ISNULL(f.numero_fila, 2147483647), r.id;
        `);

      res.status(200).json({
        import: serializeImportacion(headerRow),
        resultados: resultadosResult.recordset.map(serializeResultado)
      });
    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/pnid-imports/preview
 *
 * Sube y parsea el archivo, guarda snapshot completo + resultados de
 * comparación. NUNCA modifica nucleo.instrumento.
 */
pnidImportsRouter.post(
  '/preview',
  requireProjectPermission('write'),
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

      const originalName = req.file.originalname ?? 'reporte.xlsx';
      if (originalName.length > 260) {
        res.status(400).json({ error: 'validation_error', message: 'nombre de archivo demasiado largo.' });
        return;
      }

      let parsed;
      try {
        parsed = await parsePnidExcelBuffer(req.file.buffer);
      } catch (parseError) {
        if (parseError instanceof PnidFileStructureError) {
          res.status(422).json({ error: 'invalid_file_structure', message: parseError.message });
          return;
        }
        throw parseError;
      }

      const hash = createHash('sha256').update(req.file.buffer).digest('hex');

      const pool = await getDbPool();

      // Aviso informativo (no bloqueante) si este archivo ya se importó antes.
      const priorSameHash = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('hash_archivo', sql.Char(64), hash)
        .query(`
          SELECT TOP (1) id, fecha_carga, estado
          FROM integracion.importacion_pnid
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND hash_archivo = @hash_archivo
          ORDER BY fecha_carga DESC;
        `);

      // --- Instrumentos activos del proyecto, para el motor de comparación ---
      const instrumentsResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT id, tag_instrumento, pnpid, fuente_pnpid, updated_at,
                 descripcion, tipo_instrumento, servicio, sistema, ubicacion, nodo,
                 tag_anterior, tecnologia, funcionamiento, cuerpo_instrumento,
                 conexion_proceso, plano_pnid, linea_pnid, tipo_senal_pnid, equipo_asociado_tag,
                 instrumento_asociado_tag
          FROM nucleo.instrumento
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const existingByPnpid = new Map<string, InstrumentSnapshot>();
      const existingByTag = new Map<string, InstrumentSnapshot>();
      const plant3dManagedByPnpid = new Map<string, InstrumentSnapshot>();

      for (const row of instrumentsResult.recordset) {
        const snapshot: InstrumentSnapshot = {
          id: String(row.id),
          tagInstrumento: row.tag_instrumento,
          pnpid: row.pnpid,
          fuentePnpid: row.fuente_pnpid,
          updatedAt: row.updated_at,
          descripcion: row.descripcion,
          tipoInstrumento: row.tipo_instrumento,
          servicio: row.servicio,
          sistema: row.sistema,
          ubicacion: row.ubicacion,
          nodo: row.nodo,
          tagAnterior: row.tag_anterior,
          tecnologia: row.tecnologia,
          funcionamiento: row.funcionamiento,
          cuerpoInstrumento: row.cuerpo_instrumento,
          conexionProceso: row.conexion_proceso,
          planoPnid: row.plano_pnid,
          lineaPnid: row.linea_pnid,
          tipoSenalPnid: row.tipo_senal_pnid,
          equipoAsociadoTag: row.equipo_asociado_tag,
          instrumentoAsociadoTag: row.instrumento_asociado_tag
        };

        if (snapshot.pnpid) {
          existingByPnpid.set(snapshot.pnpid, snapshot);
          if (snapshot.fuentePnpid === 'PLANT3D') {
            plant3dManagedByPnpid.set(snapshot.pnpid, snapshot);
          }
        }
        existingByTag.set(snapshot.tagInstrumento.trim(), snapshot);
      }

      const plan = buildComparisonPlan({
        rows: parsed.rows,
        presentFields: parsed.presentFields,
        existingByPnpid,
        existingByTag,
        plant3dManagedByPnpid
      });

      const counts = {
        sinCambios: 0,
        nuevos: 0,
        tagModificado: 0,
        datosModificados: 0,
        excluidosListado: 0,
        noExisteReporte: 0,
        requiereRevision: 0
      };

      for (const entry of plan) {
        switch (entry.resultadoCodigo) {
          case 'OK': counts.sinCambios++; break;
          case 'NUEVO_EN_PNID': counts.nuevos++; break;
          case 'TAG_MODIFICADO': counts.tagModificado++; break;
          case 'DATOS_MODIFICADOS': counts.datosModificados++; break;
          case 'NO_LISTADO': counts.excluidosListado++; break;
          case 'NO_EXISTE_EN_PNID': counts.noExisteReporte++; break;
          case 'REQUIERE_REVISION':
          case 'TAG_DUPLICADO':
          case 'TAG_VACIO':
            counts.requiereRevision++;
            break;
        }
      }

      const totalListadoTrue = parsed.rows.filter((r) => r.listado).length;

      const advertencias: Record<string, unknown> = {
        missingKnownColumns: parsed.missingKnownColumns,
        unknownColumns: parsed.unknownColumns
      };
      if (priorSameHash.recordset[0]) {
        advertencias.archivoYaImportadoAntes = {
          importacionId: String(priorSameHash.recordset[0].id),
          fechaCarga: priorSameHash.recordset[0].fecha_carga,
          estado: priorSameHash.recordset[0].estado
        };
      }

      const estadoCodesResult = await pool.request().query(`
        SELECT id, codigo FROM cat.cat_estado_pnid;
      `);
      const estadoIdByCodigo = new Map<string, string>(
        estadoCodesResult.recordset.map((r: any) => [r.codigo, String(r.id)])
      );

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      const headerRequest = new sql.Request(transaction);
      const headerResult = await headerRequest
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('nombre_archivo', sql.NVarChar(260), originalName)
        .input('hash_archivo', sql.Char(64), hash)
        .input('estado', sql.NVarChar(20), 'PREVISUALIZADO')
        .input('total_filas', sql.Int, parsed.rows.length)
        .input('total_listado_true', sql.Int, totalListadoTrue)
        .input('sin_cambios', sql.Int, counts.sinCambios)
        .input('nuevos', sql.Int, counts.nuevos)
        .input('tag_modificado', sql.Int, counts.tagModificado)
        .input('datos_modificados', sql.Int, counts.datosModificados)
        .input('excluidos_listado', sql.Int, counts.excluidosListado)
        .input('no_existe_reporte', sql.Int, counts.noExisteReporte)
        .input('requiere_revision', sql.Int, counts.requiereRevision)
        .input('advertencias', sql.NVarChar(sql.MAX), JSON.stringify(advertencias))
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO integracion.importacion_pnid (
            proyecto_id, nombre_archivo, hash_archivo, estado,
            total_filas, total_listado_true,
            conteo_sin_cambios, conteo_nuevos, conteo_tag_modificado, conteo_datos_modificados,
            conteo_excluidos_listado, conteo_no_existe_reporte, conteo_requiere_revision,
            advertencias, created_by
          )
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.nombre_archivo, INSERTED.hash_archivo,
                 INSERTED.fuente, INSERTED.estado, INSERTED.total_filas, INSERTED.total_listado_true,
                 INSERTED.conteo_sin_cambios, INSERTED.conteo_nuevos, INSERTED.conteo_tag_modificado,
                 INSERTED.conteo_datos_modificados, INSERTED.conteo_excluidos_listado,
                 INSERTED.conteo_no_existe_reporte, INSERTED.conteo_requiere_revision,
                 INSERTED.advertencias, INSERTED.fecha_carga, INSERTED.fecha_aplicacion,
                 INSERTED.created_by, INSERTED.applied_by, INSERTED.created_at, INSERTED.updated_at
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), @nombre_archivo, @hash_archivo, @estado,
            @total_filas, @total_listado_true,
            @sin_cambios, @nuevos, @tag_modificado, @datos_modificados,
            @excluidos_listado, @no_existe_reporte, @requiere_revision,
            @advertencias, TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const importacionId = String(headerResult.recordset[0].id);

      // --- Snapshot: una fila por cada fila del Excel, sin excepción ---
      const filaIdByIndex = new Map<number, string>();

      for (const [idx, row] of parsed.rows.entries()) {
        const filaRequest = new sql.Request(transaction);
        const filaResult = await filaRequest
          .input('importacion_id', sql.NVarChar(30), importacionId)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('numero_fila', sql.Int, row.numeroFila)
          .input('pnpid', sql.NVarChar(50), row.pnpid)
          .input('tag_instrumento', sql.NVarChar(50), row.tagInstrumento)
          .input('listado', sql.Bit, row.listado)
          .input('datos_fuente', sql.NVarChar(sql.MAX), JSON.stringify(row.datosFuente))
          .query(`
            INSERT INTO integracion.importacion_pnid_fila (
              importacion_id, proyecto_id, numero_fila, pnpid, tag_instrumento, listado, datos_fuente
            )
            OUTPUT INSERTED.id
            VALUES (
              TRY_CONVERT(BIGINT, @importacion_id), TRY_CONVERT(BIGINT, @proyecto_id),
              @numero_fila, @pnpid, @tag_instrumento, @listado, @datos_fuente
            );
          `);
        filaIdByIndex.set(idx, String(filaResult.recordset[0].id));
      }

      // --- Resultados de la comparación ---
      for (const entry of plan) {
        const resultadoId = estadoIdByCodigo.get(entry.resultadoCodigo);
        if (!resultadoId) {
          throw new Error(`Código de resultado desconocido: ${entry.resultadoCodigo}`);
        }

        const filaId = entry.filaIndex !== null ? (filaIdByIndex.get(entry.filaIndex) ?? null) : null;

        const resultadoRequest = new sql.Request(transaction);
        await resultadoRequest
          .input('importacion_id', sql.NVarChar(30), importacionId)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('fila_id', sql.NVarChar(30), filaId)
          .input('pnpid', sql.NVarChar(50), entry.pnpid)
          .input('tag_instrumento', sql.NVarChar(50), entry.tagInstrumento)
          .input('instrumento_id', sql.NVarChar(30), entry.instrumentoId)
          .input('resultado_id', sql.NVarChar(30), resultadoId)
          .input('diferencias', sql.NVarChar(sql.MAX), entry.diferencias === null ? null : JSON.stringify(entry.diferencias))
          .input('requiere_revision', sql.Bit, entry.requiereRevision)
          .input('instrumento_updated_at_preview', sql.DateTime2, entry.instrumentoUpdatedAtPreview)
          .query(`
            INSERT INTO integracion.importacion_pnid_resultado (
              importacion_id, proyecto_id, fila_id, pnpid, tag_instrumento,
              instrumento_id, resultado_id, diferencias, requiere_revision,
              instrumento_updated_at_preview
            )
            VALUES (
              TRY_CONVERT(BIGINT, @importacion_id), TRY_CONVERT(BIGINT, @proyecto_id),
              TRY_CONVERT(BIGINT, @fila_id), @pnpid, @tag_instrumento,
              TRY_CONVERT(BIGINT, @instrumento_id), TRY_CONVERT(BIGINT, @resultado_id),
              @diferencias, @requiere_revision, @instrumento_updated_at_preview
            );
          `);
      }

      await transaction.commit();

      res
        .status(201)
        .location(`/api/projects/${projectId}/pnid-imports/${importacionId}`)
        .json({
          import: serializeImportacion(headerResult.recordset[0]),
          resultados: plan.map((entry) => ({
            filaIndex: entry.filaIndex,
            pnpid: entry.pnpid,
            tagInstrumento: entry.tagInstrumento,
            instrumentoId: entry.instrumentoId,
            resultado: entry.resultadoCodigo,
            diferencias: entry.diferencias,
            requiereRevision: entry.requiereRevision,
            // Mismo motivo que en serializeResultado (GET detalle): todos los
            // campos mapeados de la fila, no solo los que difieren.
            datosPropuestos: entry.filaIndex !== null ? parsed.rows[entry.filaIndex].fields : null
          }))
        });
    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch {
          // ya pudo haber quedado sin transacción viva
        }
      }
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/pnid-imports/:importId/apply
 */
pnidImportsRouter.post(
  '/:importId/apply',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const importId = normalizeParam(req.params.importId);

      if (!isPositiveIntString(importId)) {
        res.status(400).json({ error: 'invalid_import_id', message: 'importId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      const headerResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('importacion_id', sql.NVarChar(30), importId)
        .query(`
          SELECT id, estado, advertencias
          FROM integracion.importacion_pnid
          WHERE id = TRY_CONVERT(BIGINT, @importacion_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      const headerRow = headerResult.recordset[0];

      if (!headerRow) {
        res.status(404).json({ error: 'import_not_found', message: 'Import does not exist in this project.' });
        return;
      }

      if (headerRow.estado !== 'PREVISUALIZADO') {
        res.status(409).json({
          error: 'import_not_previewable',
          message: `Este import está en estado ${headerRow.estado}; solo se puede aplicar un import en estado PREVISUALIZADO.`
        });
        return;
      }

      const advertencias = headerRow.advertencias ? JSON.parse(headerRow.advertencias) : { missingKnownColumns: [] };
      const presentFields = computePresentFields(advertencias.missingKnownColumns ?? []);

      const resultadosResult = await pool
        .request()
        .input('importacion_id', sql.NVarChar(30), importId)
        .query(`
          SELECT r.id, r.fila_id, r.instrumento_id, e.codigo AS resultado_codigo,
                 r.instrumento_updated_at_preview,
                 f.datos_fuente
          FROM integracion.importacion_pnid_resultado r
          LEFT JOIN integracion.importacion_pnid_fila f ON f.id = r.fila_id
          JOIN cat.cat_estado_pnid e ON e.id = r.resultado_id
          WHERE r.importacion_id = TRY_CONVERT(BIGINT, @importacion_id);
        `);

      const resultados = resultadosResult.recordset;

      // --- Chequeo de concurrencia: TODO o NADA ---
      const affected = resultados.filter((r: any) => r.instrumento_id !== null);

      if (affected.length > 0) {
        const currentResult = await pool
          .request()
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .query(`
            SELECT id, updated_at
            FROM nucleo.instrumento
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND activo = 1;
          `);

        const currentUpdatedAtById = new Map<string, string | null>(
          currentResult.recordset.map((r: any) => [String(r.id), r.updated_at])
        );

        for (const r of affected) {
          const instrumentoId = String(r.instrumento_id);
          const currentUpdatedAt = currentUpdatedAtById.get(instrumentoId);
          const previewUpdatedAt = r.instrumento_updated_at_preview
            ? new Date(r.instrumento_updated_at_preview).toISOString()
            : null;
          const currentIso = currentUpdatedAt ? new Date(currentUpdatedAt).toISOString() : null;

          if (currentUpdatedAt === undefined) {
            res.status(409).json({
              error: 'stale_pnid_preview',
              message: `El instrumento #${instrumentoId} ya no existe o fue desactivado desde que se generó este preview. Generá un nuevo preview.`
            });
            return;
          }

          if (currentIso !== previewUpdatedAt) {
            res.status(409).json({
              error: 'stale_pnid_preview',
              message: `El instrumento #${instrumentoId} fue modificado desde que se generó este preview. Generá un nuevo preview.`
            });
            return;
          }
        }
      }

      const estadoCodesResult = await pool.request().query(`SELECT id, codigo FROM cat.cat_estado_pnid;`);
      const estadoIdByCodigo = new Map<string, string>(
        estadoCodesResult.recordset.map((r: any) => [r.codigo, String(r.id)])
      );

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      for (const r of resultados) {
        const codigo = r.resultado_codigo as string;

        if (codigo === 'REQUIERE_REVISION' || codigo === 'TAG_DUPLICADO' || codigo === 'TAG_VACIO') {
          continue; // nunca se aplican
        }

        const datosFuente = r.datos_fuente ? JSON.parse(r.datos_fuente) : {};
        const fields = extractFieldsFromSnapshot(datosFuente);

        if (codigo === 'NUEVO_EN_PNID') {
          await applyNuevoInstrumento(transaction, projectId, userId, datosFuente, fields, presentFields, estadoIdByCodigo);
        } else if (codigo === 'TAG_MODIFICADO' || codigo === 'DATOS_MODIFICADOS' || codigo === 'OK') {
          await applyActualizarInstrumento(
            transaction,
            projectId,
            userId,
            String(r.instrumento_id),
            datosFuente,
            fields,
            presentFields,
            codigo,
            estadoIdByCodigo
          );
        } else if (codigo === 'NO_LISTADO' || codigo === 'NO_EXISTE_EN_PNID') {
          await applySoloEstado(transaction, projectId, userId, String(r.instrumento_id), codigo, estadoIdByCodigo);
        }

        const marcarRequest = new sql.Request(transaction);
        await marcarRequest.input('resultado_id', sql.NVarChar(30), String(r.id)).query(`
          UPDATE integracion.importacion_pnid_resultado
          SET aplicado = 1, aplicado_at = SYSUTCDATETIME()
          WHERE id = TRY_CONVERT(BIGINT, @resultado_id);
        `);
      }

      const finalizarRequest = new sql.Request(transaction);
      await finalizarRequest
        .input('importacion_id', sql.NVarChar(30), importId)
        .input('applied_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE integracion.importacion_pnid
          SET estado = 'APLICADO',
              fecha_aplicacion = SYSUTCDATETIME(),
              applied_by = TRY_CONVERT(BIGINT, @applied_by),
              updated_at = SYSUTCDATETIME()
          WHERE id = TRY_CONVERT(BIGINT, @importacion_id);
        `);

      await transaction.commit();

      res.status(200).json({
        import: { id: importId, projectId, estado: 'APLICADO' }
      });
    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch {
          // ya pudo haber quedado sin transacción viva
        }
      }

      const number = sqlErrorNumber(error);
      if (number === 55920) {
        res.status(409).json({
          error: 'instrument_tag_conflict',
          message: 'Ya existe un instrumento activo con ese TAG en el proyecto (conflicto detectado recién al aplicar).'
        });
        return;
      }

      next(error);
    }
  }
);


function getFieldRaw(datosFuente: Record<string, unknown>, header: string): string | null {
  const value = datosFuente[header];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

async function applyNuevoInstrumento(
  transaction: sql.Transaction,
  projectId: string,
  userId: string,
  datosFuente: Record<string, unknown>,
  fields: Partial<Record<PnidField, string | null>>,
  presentFields: Set<PnidField>,
  estadoIdByCodigo: Map<string, string>
): Promise<void> {
  const request = new sql.Request(transaction);

  const columns = [
    'proyecto_id', 'tag_instrumento', 'pnpid', 'fuente_pnpid', 'estado_pnid_id',
    'fecha_agregado', 'fecha_ultima_revision', 'created_by'
  ];
  const values = [
    'TRY_CONVERT(BIGINT, @proyecto_id)',
    '@tag_instrumento',
    '@pnpid',
    "N'PLANT3D'",
    'TRY_CONVERT(BIGINT, @estado_pnid_id)',
    'CAST(SYSUTCDATETIME() AS DATE)',
    'CAST(SYSUTCDATETIME() AS DATE)',
    'TRY_CONVERT(BIGINT, @created_by)'
  ];

  request
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('tag_instrumento', sql.NVarChar(50), getFieldRaw(datosFuente, 'Tag'))
    .input('pnpid', sql.NVarChar(50), getFieldRaw(datosFuente, 'PnPID'))
    .input('estado_pnid_id', sql.NVarChar(30), estadoIdByCodigo.get('NUEVO_EN_PNID'))
    .input('created_by', sql.NVarChar(30), userId);

  for (const field of Object.keys(MAPPED_FIELD_COLUMNS) as Array<keyof typeof MAPPED_FIELD_COLUMNS>) {
    if (!presentFields.has(field)) continue;
    const column = MAPPED_FIELD_COLUMNS[field];
    const paramName = `field_${column}`;
    const maxLen = PNID_FIELD_MAX_LENGTH[field];
    columns.push(column);
    values.push(`@${paramName}`);
    request.input(paramName, sql.NVarChar(maxLen), (fields[field] ?? null)?.slice(0, maxLen) ?? null);

    if (field === 'equipoAsociadoTag') {
      columns.push('equipo_asociado_id');
      values.push(`(
        SELECT TOP (1) id FROM nucleo.equipo
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND tag_equipo = @${paramName}
          AND activo = 1
      )`);
    }

    if (field === 'instrumentoAsociadoTag') {
      // Auto-referencia a nucleo.instrumento — nunca hace falta excluir la
      // propia fila acá: todavía no existe (es un INSERT), no puede
      // resolver a sí misma.
      columns.push('instrumento_asociado_id');
      values.push(`(
        SELECT TOP (1) id FROM nucleo.instrumento
        WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND tag_instrumento = @${paramName}
          AND activo = 1
      )`);
    }
  }

  await request.query(`
    IF EXISTS (
      SELECT 1 FROM nucleo.instrumento
      WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND tag_instrumento = @tag_instrumento
        AND activo = 1
    )
    BEGIN
      THROW 55920, 'Ya existe un instrumento activo con ese TAG en el proyecto (conflicto detectado recien en APPLY).', 1;
    END;

    INSERT INTO nucleo.instrumento (${columns.join(', ')})
    VALUES (${values.join(', ')});
  `);
}

async function applyActualizarInstrumento(
  transaction: sql.Transaction,
  projectId: string,
  userId: string,
  instrumentoId: string,
  datosFuente: Record<string, unknown>,
  fields: Partial<Record<PnidField, string | null>>,
  presentFields: Set<PnidField>,
  codigo: string,
  estadoIdByCodigo: Map<string, string>
): Promise<void> {
  const request = new sql.Request(transaction);

  const assignments = [
    'tag_instrumento = @nuevo_tag',
    'estado_pnid_id = TRY_CONVERT(BIGINT, @estado_pnid_id)',
    'fecha_ultima_revision = CAST(SYSUTCDATETIME() AS DATE)',
    "fuente_pnpid = N'PLANT3D'",
    'updated_at = SYSUTCDATETIME()',
    'updated_by = TRY_CONVERT(BIGINT, @updated_by)'
  ];

  request
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('instrumento_id', sql.NVarChar(30), instrumentoId)
    .input('nuevo_tag', sql.NVarChar(50), getFieldRaw(datosFuente, 'Tag'))
    .input('estado_pnid_id', sql.NVarChar(30), estadoIdByCodigo.get(codigo))
    .input('updated_by', sql.NVarChar(30), userId);

  for (const field of Object.keys(MAPPED_FIELD_COLUMNS) as Array<keyof typeof MAPPED_FIELD_COLUMNS>) {
    if (!presentFields.has(field)) continue;
    const column = MAPPED_FIELD_COLUMNS[field];
    const paramName = `field_${column}`;
    const maxLen = PNID_FIELD_MAX_LENGTH[field];
    assignments.push(`${column} = @${paramName}`);
    request.input(paramName, sql.NVarChar(maxLen), (fields[field] ?? null)?.slice(0, maxLen) ?? null);

    if (field === 'equipoAsociadoTag') {
      assignments.push(`
        equipo_asociado_id = (
          SELECT TOP (1) id FROM nucleo.equipo
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND tag_equipo = @${paramName}
            AND activo = 1
        )
      `);
    }

    if (field === 'instrumentoAsociadoTag') {
      // Excluye la propia fila: un TAG asociado que por error coincide con
      // el TAG del mismo instrumento nunca debe resolver a auto-referencia
      // (CK_instrumento_asociado_no_self la rechazaría igual, pero acá
      // resolvemos a NULL en silencio en vez de abortar todo el batch).
      assignments.push(`
        instrumento_asociado_id = (
          SELECT TOP (1) id FROM nucleo.instrumento
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND tag_instrumento = @${paramName}
            AND activo = 1
            AND id <> TRY_CONVERT(BIGINT, @instrumento_id)
        )
      `);
    }
  }

  await request.query(`
    UPDATE nucleo.instrumento
    SET ${assignments.join(',\n        ')}
    WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
      AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
      AND activo = 1;
  `);
}

async function applySoloEstado(
  transaction: sql.Transaction,
  projectId: string,
  userId: string,
  instrumentoId: string,
  codigo: string,
  estadoIdByCodigo: Map<string, string>
): Promise<void> {
  const request = new sql.Request(transaction);

  await request
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('instrumento_id', sql.NVarChar(30), instrumentoId)
    .input('estado_pnid_id', sql.NVarChar(30), estadoIdByCodigo.get(codigo))
    .input('updated_by', sql.NVarChar(30), userId)
    .query(`
      UPDATE nucleo.instrumento
      SET estado_pnid_id = TRY_CONVERT(BIGINT, @estado_pnid_id),
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
      WHERE id = TRY_CONVERT(BIGINT, @instrumento_id)
        AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND activo = 1;
    `);
}


/*
 * DELETE /api/projects/:projectId/pnid-imports/:importId
 * Descarta un import que todavia no se aplico (no borra el snapshot).
 */
pnidImportsRouter.delete(
  '/:importId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const importId = normalizeParam(req.params.importId);

      if (!isPositiveIntString(importId)) {
        res.status(400).json({ error: 'invalid_import_id', message: 'importId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('importacion_id', sql.NVarChar(30), importId)
        .query(`
          UPDATE integracion.importacion_pnid
          SET estado = 'DESCARTADO', updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id, INSERTED.estado
          WHERE id = TRY_CONVERT(BIGINT, @importacion_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND estado = 'PREVISUALIZADO';
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(409).json({
          error: 'import_not_discardable',
          message: 'El import no existe, no pertenece a este proyecto, o ya no está en estado PREVISUALIZADO.'
        });
        return;
      }

      res.status(200).json({ import: { id: String(row.id), projectId, estado: row.estado } });
    } catch (error) {
      next(error);
    }
  }
);
