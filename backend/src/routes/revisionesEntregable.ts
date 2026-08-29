import {
  Router,
  type Request,
  type Response,
  type NextFunction
} from 'express';

import sql from 'mssql';
import { createHash } from 'node:crypto';

import { authenticate } from '../middleware/authenticate.js';
import { requireProjectPermission } from '../middleware/requireProjectPermission.js';
import { getDbPool } from '../db/sql.js';
import {
  ordenarInstrumentosLdi,
  esCampoOrdenValido,
  type CriterioOrden,
  type LdiOrderableInstrumento
} from '../lib/ldi/order.js';
import { construirSnapshotFila } from '../lib/ldi/snapshot.js';
import { generarLdiExcel, type CaratulaMetadata, type RevisionCaratula } from '../lib/ldi/generateExcel.js';

/*
 * nucleo.revision_entregable / _fila / _archivo (migración 006).
 * Flujo BORRADOR -> EMITIDA | DESCARTADA (ambos finales, ver los 3
 * triggers de inmutabilidad de la migración). El backend nunca expone un
 * camino de edición para EMITIDA/DESCARTADA — los triggers son el
 * respaldo de última línea, no el único control.
 */
export const revisionesEntregableRouter = Router({ mergeParams: true });

revisionesEntregableRouter.use(authenticate);

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

function serializeRevision(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    entregableId: String(row.entregable_id),
    codigoRevision: row.codigo_revision,
    fecha: row.fecha,
    descripcion: row.descripcion,
    inicialesPor: row.iniciales_por,
    inicialesRevisado: row.iniciales_revisado,
    inicialesAprobado: row.iniciales_aprobado,
    estado: row.estado,
    configuracionOrdenId: row.configuracion_orden_id === null ? null : String(row.configuracion_orden_id),
    criteriosAplicados: row.criterios_aplicados_json ? JSON.parse(row.criterios_aplicados_json) : null,
    plantillaId: row.plantilla_id === null ? null : String(row.plantilla_id),
    archivoId: row.archivo_id === null ? null : String(row.archivo_id),
    filaCaratula: row.fila_caratula === null ? null : Number(row.fila_caratula),
    emitidaBy: row.emitida_by === null ? null : String(row.emitida_by),
    emitidaAt: row.emitida_at,
    descartadaBy: row.descartada_by === null ? null : String(row.descartada_by),
    descartadaAt: row.descartada_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by)
  };
}

const REVISION_SELECT = `
  id, proyecto_id, entregable_id, codigo_revision, fecha, descripcion,
  iniciales_por, iniciales_revisado, iniciales_aprobado, estado,
  configuracion_orden_id, criterios_aplicados_json, metadatos_snapshot_json,
  plantilla_id, archivo_id, fila_caratula, emitida_by, emitida_at, descartada_by, descartada_at,
  created_at, updated_at, created_by, updated_by
`;

/** REVISION_SELECT es una lista plana "col, col, col" (sin alias ni
 * expresiones) — prefijar cada nombre con INSERTED. es una transformación
 * de texto segura acá, y evita retipear a mano las mismas 22 columnas en
 * cada OUTPUT de este archivo (INSERT/UPDATE de emitir/descartar/editar). */
function toInsertedList(columnList: string): string {
  return columnList.replace(/(\w+)/g, (match) => `INSERTED.${match}`);
}

/**
 * nucleo.revision_entregable tiene un trigger AFTER UPDATE
 * (TR_revision_entregable_estado_final_inmutable) — SQL Server rechaza
 * `OUTPUT ... ` (sin INTO) en un UPDATE/DELETE contra una tabla con un
 * trigger habilitado para ese mismo evento (error 334). Por eso cada
 * UPDATE de esta tabla hace un SELECT aparte en vez de OUTPUT directo (el
 * INSERT de creación sí puede usar OUTPUT: el trigger es solo de UPDATE).
 */
async function fetchRevisionRow(pool: sql.ConnectionPool, revisionId: string) {
  const result = await pool
    .request()
    .input('id', sql.NVarChar(30), revisionId)
    .query(`SELECT ${REVISION_SELECT} FROM nucleo.revision_entregable WHERE id = TRY_CONVERT(BIGINT, @id);`);
  return result.recordset[0];
}

async function fetchEntregable(pool: sql.ConnectionPool, entregableId: string, projectId: string) {
  const result = await pool
    .request()
    .input('id', sql.NVarChar(30), entregableId)
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .query(`
      SELECT e.id, e.proyecto_id, e.tipo_entregable_id, e.numero_documento, e.titulo,
             e.componente_etapa
      FROM nucleo.entregable e
      WHERE e.id = TRY_CONVERT(BIGINT, @id)
        AND e.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND e.activo = 1;
    `);
  return result.recordset[0];
}

function validarCriterios(value: unknown): CriterioOrden[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const criterios: CriterioOrden[] = [];
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

/** Resuelve los criterios a usar: los del body si vienen, si no los de
 * configuracionOrdenId, si no el default activo del proyecto+tipo. */
async function resolverCriterios(
  pool: sql.ConnectionPool,
  projectId: string,
  tipoEntregableId: string,
  body: any
): Promise<{ criterios: CriterioOrden[]; configuracionOrdenId: string | null } | { error: string }> {
  if (body.criterios !== undefined) {
    const criterios = validarCriterios(body.criterios);
    if (!criterios) return { error: 'criterios must be a non-empty array of { campo, direccion } with a recognized campo.' };
    return { criterios, configuracionOrdenId: body.configuracionOrdenId ?? null };
  }

  if (body.configuracionOrdenId !== undefined && body.configuracionOrdenId !== null) {
    if (!isPositiveIntString(body.configuracionOrdenId)) return { error: 'configuracionOrdenId must be numeric.' };
    const result = await pool
      .request()
      .input('id', sql.NVarChar(30), body.configuracionOrdenId)
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .query(`
        SELECT criterios_json FROM nucleo.configuracion_orden
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);
    const row = result.recordset[0];
    if (!row) return { error: 'configuracionOrdenId does not exist in this project.' };
    return { criterios: JSON.parse(row.criterios_json), configuracionOrdenId: body.configuracionOrdenId };
  }

  const defaultResult = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('tipo_entregable_id', sql.NVarChar(30), tipoEntregableId)
    .query(`
      SELECT TOP (1) id, criterios_json
      FROM nucleo.configuracion_orden
      WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND (tipo_entregable_id = TRY_CONVERT(BIGINT, @tipo_entregable_id) OR tipo_entregable_id IS NULL)
        AND es_default = 1
        AND activo = 1
      ORDER BY CASE WHEN tipo_entregable_id IS NOT NULL THEN 0 ELSE 1 END;
    `);
  const row = defaultResult.recordset[0];
  if (!row) {
    return { error: 'criterios are required (no default configuracion_orden exists yet for this project/type).' };
  }
  return { criterios: JSON.parse(row.criterios_json), configuracionOrdenId: String(row.id) };
}

async function fetchInstrumentosOrdenables(
  pool: sql.ConnectionPool,
  projectId: string
): Promise<LdiOrderableInstrumento[]> {
  const result = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .query(`
      SELECT id, tag_instrumento, tag_anterior, descripcion, tipo_instrumento, tecnologia,
             conexion_proceso, linea_pnid, equipo_asociado_tag, servicio, ubicacion, sistema,
             plano_pnid, nodo, instrumento_asociado_id, instrumento_asociado_tag
      FROM nucleo.instrumento
      WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND activo = 1;
    `);

  return result.recordset.map((row: any) => ({
    id: String(row.id),
    tagInstrumento: row.tag_instrumento,
    tagAnterior: row.tag_anterior,
    descripcion: row.descripcion,
    tipoInstrumento: row.tipo_instrumento,
    tecnologia: row.tecnologia,
    conexionProceso: row.conexion_proceso,
    lineaPnid: row.linea_pnid,
    equipoAsociadoTag: row.equipo_asociado_tag,
    servicio: row.servicio,
    ubicacion: row.ubicacion,
    sistema: row.sistema,
    planoPnid: row.plano_pnid,
    nodo: row.nodo,
    instrumentoAsociadoId: row.instrumento_asociado_id === null ? null : String(row.instrumento_asociado_id),
    instrumentoAsociadoTag: row.instrumento_asociado_tag
  }));
}

async function fetchOrdenTipoInstrumento(pool: sql.ConnectionPool) {
  const result = await pool.request().query(`SELECT prefijo, orden FROM cat.cat_orden_tipo_instrumento;`);
  return result.recordset.map((r: any) => ({ prefijo: r.prefijo, orden: r.orden }));
}

interface RevisionParaCaratula {
  codigoRevision: string;
  fecha: string;
  descripcion: string;
  inicialesPor: string;
  inicialesRevisado: string;
  inicialesAprobado: string;
  /** Fila física 32-36, o null si todavía no se asignó (revisión que aún
   * no se emitió — ver `planificarFilaCaratula`). */
  filaCaratula: number | null;
}

function toIsoDate(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  return d.toISOString().slice(0, 10);
}

/** Igual que RevisionParaCaratula, pero con `filaCaratula` garantizado no
 * nulo (el SELECT que la produce ya filtra `fila_caratula IS NOT NULL`) e
 * `id` propio — evita repetir `!` en cada uso de planificarFilaCaratula. */
interface RevisionEmitidaConFila extends Omit<RevisionParaCaratula, 'filaCaratula'> {
  id: string;
  filaCaratula: number;
}

/** Trae las revisiones EMITIDA que TODAVÍA tienen fila de carátula
 * asignada (migración 010) — nunca las expulsadas de la ventana de 5. No
 * ordena por fecha: el orden en pantalla ya no importa para nada, cada
 * una se ubica por su propia `filaCaratula`. */
async function fetchRevisionesEmitidasPrevias(
  pool: sql.ConnectionPool,
  entregableId: string,
  excluirRevisionId?: string
): Promise<RevisionEmitidaConFila[]> {
  const request = pool.request().input('entregable_id', sql.NVarChar(30), entregableId);
  let filtroExclusion = '';
  if (excluirRevisionId) {
    request.input('excluir_id', sql.NVarChar(30), excluirRevisionId);
    filtroExclusion = 'AND id <> TRY_CONVERT(BIGINT, @excluir_id)';
  }

  const result = await request.query(`
    SELECT id, codigo_revision, fecha, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, fila_caratula
    FROM nucleo.revision_entregable
    WHERE entregable_id = TRY_CONVERT(BIGINT, @entregable_id)
      AND estado = 'EMITIDA'
      AND fila_caratula IS NOT NULL
      ${filtroExclusion}
    ORDER BY fila_caratula ASC;
  `);

  return result.recordset.map((r: any) => ({
    id: String(r.id),
    codigoRevision: r.codigo_revision,
    fecha: toIsoDate(r.fecha),
    descripcion: r.descripcion,
    inicialesPor: r.iniciales_por,
    inicialesRevisado: r.iniciales_revisado,
    inicialesAprobado: r.iniciales_aprobado,
    filaCaratula: r.fila_caratula
  }));
}

interface PlanFilaCaratula {
  /** Fila que le corresponde a LA REVISIÓN QUE SE ESTÁ EMITIENDO ahora. */
  nuevaFilaActual: number;
  /** Id de la revisión que se cae de la carátula para hacerle lugar a la
   * nueva (su fila_caratula pasa a NULL), o null si todavía había lugar
   * libre y no hizo falta expulsar a nadie. */
  idExpulsado: string | null;
  /** Ids cuya fila_caratula sube +1 (se corrieron para liberar la 32). */
  idsQueSuben: string[];
}

/**
 * La primera revisión de un entregable va a la fila 36; cada revisión
 * nueva sube una fila (35, 34, 33, 32) — asignación fija para siempre,
 * nunca recalculada por posición (pedido explícito del usuario, migración
 * 010). Al llegar a una 6ª (ya no hay fila libre entre 32 y 36), la más
 * antigua de las 5 visibles (la de fila_caratula más alta, 36) se retira
 * de la carátula y las demás suben un lugar para liberar la 32.
 *
 * Función pura — no toca la base. El caller aplica el plan dentro de la
 * misma transacción que emite la revisión.
 */
function planificarFilaCaratula(
  activos: Array<{ id: string; filaCaratula: number }>
): PlanFilaCaratula {
  if (activos.length === 0) {
    return { nuevaFilaActual: 36, idExpulsado: null, idsQueSuben: [] };
  }

  const minFila = Math.min(...activos.map((a) => a.filaCaratula));
  if (minFila > 32) {
    return { nuevaFilaActual: minFila - 1, idExpulsado: null, idsQueSuben: [] };
  }

  // Las 5 filas están ocupadas: se expulsa la más antigua (fila más alta).
  const expulsado = activos.reduce((a, b) => (a.filaCaratula > b.filaCaratula ? a : b));
  const idsQueSuben = activos.filter((a) => a.id !== expulsado.id).map((a) => a.id);
  return { nuevaFilaActual: 32, idExpulsado: expulsado.id, idsQueSuben };
}

function construirMetadatosSnapshot(
  doc: Record<string, any> | undefined,
  entregable: Record<string, any>,
  revisionActual: RevisionParaCaratula,
  revisionesEmitidasPrevias: RevisionParaCaratula[]
) {
  return {
    proyectoCumbra: doc?.codigo_proyecto_cumbra ?? null,
    proyectoCliente: doc?.codigo_proyecto_cliente ?? null,
    titulo: entregable.titulo,
    etapaCodigo: doc?.etapa_codigo ?? null,
    etapaNombre: doc?.etapa_nombre ?? null,
    afe: doc?.afe ?? null,
    vp: doc?.vp ?? null,
    jefeDisciplina: doc?.jefe_disciplina ?? null,
    liderProyecto: doc?.lider_proyecto ?? null,
    gerenteIngenieriaConstruccion: doc?.gerente_ingenieria_construccion ?? null,
    numeroDocumento: entregable.numero_documento,
    // Vista de cómo se ve (o se vería) la tabla de revisiones de
    // carátula — cada una en su propia fila fija, nunca recalculada por
    // orden/posición.
    revisionesMostradasEnCaratula: [revisionActual, ...revisionesEmitidasPrevias]
  };
}

/*
 * GET /api/projects/:projectId/entregables/:entregableId/revisiones
 */
revisionesEntregableRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const entregableId = normalizeParam(req.params.entregableId);

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${REVISION_SELECT}
          FROM nucleo.revision_entregable
          WHERE entregable_id = TRY_CONVERT(BIGINT, @entregable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          ORDER BY created_at DESC;
        `);

      res.status(200).json({
        projectId,
        entregableId,
        revisiones: result.recordset.map(serializeRevision)
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * GET /api/projects/:projectId/entregables/:entregableId/revisiones/:revisionId
 */
revisionesEntregableRouter.get(
  '/:revisionId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const entregableId = normalizeParam(req.params.entregableId);
      const revisionId = normalizeParam(req.params.revisionId);

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('id', sql.NVarChar(30), revisionId)
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${REVISION_SELECT}
          FROM nucleo.revision_entregable
          WHERE id = TRY_CONVERT(BIGINT, @id)
            AND entregable_id = TRY_CONVERT(BIGINT, @entregable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'revision_not_found', message: 'Revision does not exist for this entregable.' });
        return;
      }

      const filasResult = await pool
        .request()
        .input('revision_id', sql.NVarChar(30), revisionId)
        .query(`
          SELECT item, instrumento_id, datos_snapshot
          FROM nucleo.revision_entregable_fila
          WHERE revision_id = TRY_CONVERT(BIGINT, @revision_id)
          ORDER BY item;
        `);

      res.status(200).json({
        revision: serializeRevision(row),
        metadatosSnapshot: row.metadatos_snapshot_json ? JSON.parse(row.metadatos_snapshot_json) : null,
        filas: filasResult.recordset.map((f: any) => ({
          item: f.item,
          // f.instrumento_id puede ser NULL: el instrumento original fue
          // eliminado definitivamente del Master (ver migración 011 y
          // DELETE /instruments/:id con eliminarDefinitivamente=true) —
          // el snapshot (datos_snapshot) sigue intacto, solo se pierde el
          // enlace en vivo.
          instrumentoId: f.instrumento_id === null ? undefined : String(f.instrumento_id),
          snapshot: JSON.parse(f.datos_snapshot)
        }))
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * POST /api/projects/:projectId/entregables/:entregableId/revisiones
 * Crea un BORRADOR y genera el preview de inmediato (persistido) — mismo
 * patrón de dos fases que el import P&ID (preview persiste, nunca es
 * puramente en memoria).
 */
revisionesEntregableRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const entregableId = normalizeParam(req.params.entregableId);
      const body = req.body ?? {};

      if (!entregableId || !/^\d+$/.test(entregableId)) {
        res.status(400).json({ error: 'invalid_entregable_id', message: 'entregableId must be a positive integer.' });
        return;
      }

      const { codigoRevision, fecha = null, descripcion } = body;

      if (typeof codigoRevision !== 'string' || codigoRevision.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'codigoRevision is required.' });
        return;
      }
      if (codigoRevision.trim().length > 10) {
        res.status(400).json({ error: 'validation_error', message: 'codigoRevision cannot exceed 10 characters.' });
        return;
      }
      if (typeof descripcion !== 'string' || descripcion.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion is required.' });
        return;
      }
      if (descripcion.trim().length > 400) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion cannot exceed 400 characters.' });
        return;
      }

      const pool = await getDbPool();

      const entregable = await fetchEntregable(pool, entregableId, projectId);
      if (!entregable) {
        res.status(404).json({ error: 'entregable_not_found', message: 'Entregable does not exist in this project or is inactive.' });
        return;
      }

      const borradorExistente = await pool
        .request()
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .query(`SELECT id FROM nucleo.revision_entregable WHERE entregable_id = TRY_CONVERT(BIGINT, @entregable_id) AND estado = 'BORRADOR';`);
      if (borradorExistente.recordset[0]) {
        res.status(409).json({
          error: 'borrador_ya_existe',
          message: 'Este entregable ya tiene un BORRADOR abierto — edítelo, descártelo o emítalo antes de crear uno nuevo.'
        });
        return;
      }

      const docResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`SELECT * FROM nucleo.proyecto_documentacion WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);`);
      const doc = docResult.recordset[0];

      const inicialesPor = body.inicialesPor ?? doc?.iniciales_por_default ?? null;
      const inicialesRevisado = body.inicialesRevisado ?? doc?.iniciales_revisado_default ?? null;
      const inicialesAprobado = body.inicialesAprobado ?? doc?.iniciales_aprobado_default ?? null;

      for (const [name, value] of [
        ['inicialesPor', inicialesPor],
        ['inicialesRevisado', inicialesRevisado],
        ['inicialesAprobado', inicialesAprobado]
      ] as const) {
        if (typeof value !== 'string' || value.trim().length === 0) {
          res.status(400).json({
            error: 'validation_error',
            message: `${name} is required (no default is configured in proyecto_documentacion either).`
          });
          return;
        }
      }

      const criteriosResult = await resolverCriterios(pool, projectId, String(entregable.tipo_entregable_id), body);
      if ('error' in criteriosResult) {
        res.status(400).json({ error: 'validation_error', message: criteriosResult.error });
        return;
      }

      const plantillaResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tipo_entregable_id', sql.NVarChar(30), String(entregable.tipo_entregable_id))
        .query(`
          SELECT id FROM nucleo.plantilla_entregable
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND tipo_entregable_id = TRY_CONVERT(BIGINT, @tipo_entregable_id)
            AND activo = 1;
        `);
      const plantilla = plantillaResult.recordset[0];
      if (!plantilla) {
        res.status(409).json({
          error: 'plantilla_no_configurada',
          message: 'No hay una plantilla activa configurada para este proyecto y tipo de entregable.'
        });
        return;
      }

      const instrumentos = await fetchInstrumentosOrdenables(pool, projectId);
      const ordenTipoInstrumento = await fetchOrdenTipoInstrumento(pool);
      const ordenados = ordenarInstrumentosLdi(instrumentos, criteriosResult.criterios, ordenTipoInstrumento);

      const codigo = codigoRevision.trim();
      const filas = ordenados.map((inst, idx) => ({
        item: idx + 1,
        instrumentoId: inst.id,
        snapshot: construirSnapshotFila(inst, codigo)
      }));

      // Todavía es un BORRADOR — no se persiste ninguna fila_caratula acá,
      // solo se estima cuál le tocaría si se emitiera ahora mismo (para
      // que el preview de la carátula sea representativo).
      const revisionesPrevias = await fetchRevisionesEmitidasPrevias(pool, entregableId);
      const planFilaTentativo = planificarFilaCaratula(revisionesPrevias);

      const revisionActualParaCaratula: RevisionParaCaratula = {
        codigoRevision: codigo,
        fecha: fecha ? toIsoDate(fecha) : toIsoDate(new Date()),
        descripcion: descripcion.trim(),
        inicialesPor,
        inicialesRevisado,
        inicialesAprobado,
        filaCaratula: planFilaTentativo.nuevaFilaActual
      };
      const metadatosSnapshot = construirMetadatosSnapshot(doc, entregable, revisionActualParaCaratula, revisionesPrevias);

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      const insertRevision = await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .input('codigo_revision', sql.NVarChar(10), codigo)
        .input('fecha', sql.Date, fecha ? new Date(fecha) : new Date())
        .input('descripcion', sql.NVarChar(400), descripcion.trim())
        .input('iniciales_por', sql.NVarChar(20), inicialesPor)
        .input('iniciales_revisado', sql.NVarChar(20), inicialesRevisado)
        .input('iniciales_aprobado', sql.NVarChar(20), inicialesAprobado)
        .input('configuracion_orden_id', sql.NVarChar(30), criteriosResult.configuracionOrdenId)
        .input('criterios_aplicados_json', sql.NVarChar(sql.MAX), JSON.stringify(criteriosResult.criterios))
        .input('metadatos_snapshot_json', sql.NVarChar(sql.MAX), JSON.stringify(metadatosSnapshot))
        .input('plantilla_id', sql.NVarChar(30), String(plantilla.id))
        .input('created_by', sql.NVarChar(30), userId)
        .query(`
          INSERT INTO nucleo.revision_entregable (
            proyecto_id, entregable_id, codigo_revision, fecha, descripcion,
            iniciales_por, iniciales_revisado, iniciales_aprobado, estado,
            configuracion_orden_id, criterios_aplicados_json, metadatos_snapshot_json,
            plantilla_id, created_at, created_by
          )
          OUTPUT ${toInsertedList(REVISION_SELECT)}
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @entregable_id), @codigo_revision, @fecha, @descripcion,
            @iniciales_por, @iniciales_revisado, @iniciales_aprobado, N'BORRADOR',
            TRY_CONVERT(BIGINT, @configuracion_orden_id), @criterios_aplicados_json, @metadatos_snapshot_json,
            TRY_CONVERT(BIGINT, @plantilla_id), SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const revisionRow = insertRevision.recordset[0];
      const revisionId = String(revisionRow.id);

      for (const fila of filas) {
        await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('revision_id', sql.NVarChar(30), revisionId)
          .input('instrumento_id', sql.NVarChar(30), fila.instrumentoId)
          .input('item', sql.Int, fila.item)
          .input('datos_snapshot', sql.NVarChar(sql.MAX), JSON.stringify(fila.snapshot))
          .query(`
            INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
            VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @revision_id), TRY_CONVERT(BIGINT, @instrumento_id), @item, @datos_snapshot);
          `);
      }

      await transaction.commit();

      res
        .status(201)
        .location(`/api/projects/${projectId}/entregables/${entregableId}/revisiones/${revisionId}`)
        .json({
          revision: serializeRevision(revisionRow),
          metadatosSnapshot,
          totalFilas: filas.length,
          filas
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
      if (number === 2601 || number === 2627) {
        res.status(409).json({ error: 'borrador_ya_existe', message: 'Este entregable ya tiene un BORRADOR abierto.' });
        return;
      }

      next(error);
    }
  }
);

/*
 * PATCH /api/projects/:projectId/entregables/:entregableId/revisiones/:revisionId
 * Solo mientras BORRADOR: edita campos y regenera el preview persistido
 * completo (borra y vuelve a construir revision_entregable_fila).
 */
revisionesEntregableRouter.patch(
  '/:revisionId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const entregableId = normalizeParam(req.params.entregableId);
      const revisionId = normalizeParam(req.params.revisionId);
      const body = req.body ?? {};

      const pool = await getDbPool();

      const current = await pool
        .request()
        .input('id', sql.NVarChar(30), revisionId)
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${REVISION_SELECT} FROM nucleo.revision_entregable
          WHERE id = TRY_CONVERT(BIGINT, @id) AND entregable_id = TRY_CONVERT(BIGINT, @entregable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);
      const revisionActual = current.recordset[0];
      if (!revisionActual) {
        res.status(404).json({ error: 'revision_not_found', message: 'Revision does not exist for this entregable.' });
        return;
      }
      if (revisionActual.estado !== 'BORRADOR') {
        res.status(409).json({ error: 'revision_no_editable', message: `Esta revisión está en estado ${revisionActual.estado}; solo un BORRADOR se puede editar.` });
        return;
      }

      const entregable = await fetchEntregable(pool, entregableId!, projectId);

      const codigo = (body.codigoRevision ?? revisionActual.codigo_revision).trim();
      const descripcion = (body.descripcion ?? revisionActual.descripcion).trim();

      if (codigo.length > 10) {
        res.status(400).json({ error: 'validation_error', message: 'codigoRevision cannot exceed 10 characters.' });
        return;
      }
      if (descripcion.length > 400) {
        res.status(400).json({ error: 'validation_error', message: 'descripcion cannot exceed 400 characters.' });
        return;
      }
      const fecha = body.fecha ? toIsoDate(body.fecha) : toIsoDate(revisionActual.fecha);
      const inicialesPor = body.inicialesPor ?? revisionActual.iniciales_por;
      const inicialesRevisado = body.inicialesRevisado ?? revisionActual.iniciales_revisado;
      const inicialesAprobado = body.inicialesAprobado ?? revisionActual.iniciales_aprobado;

      const criteriosResult = body.criterios !== undefined || body.configuracionOrdenId !== undefined
        ? await resolverCriterios(pool, projectId, String(entregable.tipo_entregable_id), body)
        : {
            criterios: JSON.parse(revisionActual.criterios_aplicados_json) as CriterioOrden[],
            configuracionOrdenId: revisionActual.configuracion_orden_id === null ? null : String(revisionActual.configuracion_orden_id)
          };
      if ('error' in criteriosResult) {
        res.status(400).json({ error: 'validation_error', message: criteriosResult.error });
        return;
      }

      const docResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`SELECT * FROM nucleo.proyecto_documentacion WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);`);
      const doc = docResult.recordset[0];

      const instrumentos = await fetchInstrumentosOrdenables(pool, projectId);
      const ordenTipoInstrumento = await fetchOrdenTipoInstrumento(pool);
      const ordenados = ordenarInstrumentosLdi(instrumentos, criteriosResult.criterios, ordenTipoInstrumento);

      const filas = ordenados.map((inst, idx) => ({
        item: idx + 1,
        instrumentoId: inst.id,
        snapshot: construirSnapshotFila(inst, codigo)
      }));

      // Sigue en BORRADOR — misma lógica que en el POST: solo se estima la
      // fila tentativa, nada se persiste todavía.
      const revisionesPrevias = await fetchRevisionesEmitidasPrevias(pool, entregableId!, revisionId);
      const planFilaTentativo = planificarFilaCaratula(revisionesPrevias);

      const revisionActualParaCaratula: RevisionParaCaratula = {
        codigoRevision: codigo,
        fecha,
        descripcion,
        inicialesPor,
        inicialesRevisado,
        inicialesAprobado,
        filaCaratula: planFilaTentativo.nuevaFilaActual
      };
      const metadatosSnapshot = construirMetadatosSnapshot(doc, entregable, revisionActualParaCaratula, revisionesPrevias);

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      await new sql.Request(transaction)
        .input('revision_id', sql.NVarChar(30), revisionId)
        .query(`DELETE FROM nucleo.revision_entregable_fila WHERE revision_id = TRY_CONVERT(BIGINT, @revision_id);`);

      for (const fila of filas) {
        await new sql.Request(transaction)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('revision_id', sql.NVarChar(30), revisionId)
          .input('instrumento_id', sql.NVarChar(30), fila.instrumentoId)
          .input('item', sql.Int, fila.item)
          .input('datos_snapshot', sql.NVarChar(sql.MAX), JSON.stringify(fila.snapshot))
          .query(`
            INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
            VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @revision_id), TRY_CONVERT(BIGINT, @instrumento_id), @item, @datos_snapshot);
          `);
      }

      await new sql.Request(transaction)
        .input('id', sql.NVarChar(30), revisionId)
        .input('codigo_revision', sql.NVarChar(10), codigo)
        .input('fecha', sql.Date, new Date(fecha))
        .input('descripcion', sql.NVarChar(400), descripcion)
        .input('iniciales_por', sql.NVarChar(20), inicialesPor)
        .input('iniciales_revisado', sql.NVarChar(20), inicialesRevisado)
        .input('iniciales_aprobado', sql.NVarChar(20), inicialesAprobado)
        .input('configuracion_orden_id', sql.NVarChar(30), criteriosResult.configuracionOrdenId)
        .input('criterios_aplicados_json', sql.NVarChar(sql.MAX), JSON.stringify(criteriosResult.criterios))
        .input('metadatos_snapshot_json', sql.NVarChar(sql.MAX), JSON.stringify(metadatosSnapshot))
        .query(`
          UPDATE nucleo.revision_entregable
          SET codigo_revision = @codigo_revision, fecha = @fecha, descripcion = @descripcion,
              iniciales_por = @iniciales_por, iniciales_revisado = @iniciales_revisado, iniciales_aprobado = @iniciales_aprobado,
              configuracion_orden_id = TRY_CONVERT(BIGINT, @configuracion_orden_id),
              criterios_aplicados_json = @criterios_aplicados_json,
              metadatos_snapshot_json = @metadatos_snapshot_json,
              updated_at = SYSUTCDATETIME()
          WHERE id = TRY_CONVERT(BIGINT, @id);
        `);

      await transaction.commit();

      const updatedRow = await fetchRevisionRow(pool, revisionId!);

      res.status(200).json({
        revision: serializeRevision(updatedRow),
        metadatosSnapshot,
        totalFilas: filas.length,
        filas
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
 * DELETE .../revisiones/:revisionId
 *
 * Dos comportamientos según el estado actual:
 *  - BORRADOR -> "Descartar": cambio de estado a DESCARTADA (como siempre
 *    fue). Nunca borra físicamente esta rama — el registro y su snapshot
 *    quedan, solo de lectura, y ya no se puede emitir.
 *  - EMITIDA / DESCARTADA -> "Eliminar definitivamente" (migración 009,
 *    pedido explícito del usuario tras generar varias revisiones de
 *    prueba reales): borrado físico real, incluido el archivo .xlsx.
 *    Requiere `eliminarDefinitivamente: true` en el body (si no viene,
 *    409 — nunca se borra por accidente) y permiso 'administer' del
 *    proyecto (más estricto que el 'write' del resto de este router,
 *    chequeado a mano acá porque es la única acción de este archivo que
 *    lo necesita). El bypass de los triggers de inmutabilidad vive
 *    SOLO en esta transacción (SESSION_CONTEXT se apaga antes del
 *    COMMIT, así la conexión vuelve "limpia" al pool — ver migración
 *    009).
 */
revisionesEntregableRouter.delete(
  '/:revisionId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const entregableId = normalizeParam(req.params.entregableId);
      const revisionId = normalizeParam(req.params.revisionId);
      const userId = req.authUser!.id;
      const body = req.body ?? {};

      const pool = await getDbPool();

      const current = await pool
        .request()
        .input('id', sql.NVarChar(30), revisionId)
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT id, estado FROM nucleo.revision_entregable
          WHERE id = TRY_CONVERT(BIGINT, @id)
            AND entregable_id = TRY_CONVERT(BIGINT, @entregable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);
      const revisionActual = current.recordset[0];

      if (!revisionActual) {
        res.status(404).json({ error: 'revision_not_found', message: 'Revision does not exist for this entregable.' });
        return;
      }

      if (revisionActual.estado === 'BORRADOR') {
        const result = await pool
          .request()
          .input('id', sql.NVarChar(30), revisionId)
          .input('descartada_by', sql.NVarChar(30), userId)
          .query(`
            UPDATE nucleo.revision_entregable
            SET estado = N'DESCARTADA', descartada_by = TRY_CONVERT(BIGINT, @descartada_by), descartada_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
            WHERE id = TRY_CONVERT(BIGINT, @id) AND estado = N'BORRADOR';
          `);

        const row = result.rowsAffected[0] > 0 ? await fetchRevisionRow(pool, revisionId!) : undefined;
        if (!row) {
          res.status(409).json({ error: 'revision_no_descartable', message: 'La revisión ya no está en estado BORRADOR.' });
          return;
        }

        res.status(200).json({ revision: serializeRevision(row) });
        return;
      }

      // A partir de acá: EMITIDA o DESCARTADA -> eliminación definitiva.
      if (body.eliminarDefinitivamente !== true) {
        res.status(409).json({
          error: 'confirmacion_requerida',
          message: `Esta revisión ya está ${revisionActual.estado} — eliminarla es definitivo y borra también su archivo emitido. Reenviá la solicitud con { "eliminarDefinitivamente": true } para confirmar.`
        });
        return;
      }

      if (!req.projectAccess!.permissions.administer) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Eliminar una revisión EMITIDA o DESCARTADA requiere permiso de administración en el proyecto.'
        });
        return;
      }

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      await new sql.Request(transaction).query(
        `EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 1;`
      );

      /*
       * CK_revision_entregable_emitida_completa exige archivo_id NOT NULL
       * mientras estado = 'EMITIDA' — nulearlo sin más, sobre una fila
       * todavía EMITIDA, viola ese CHECK (descubierto probando este mismo
       * endpoint contra una EMITIDA real). Como la fila entera se borra
       * dentro de esta misma transacción unas líneas más abajo, bajar
       * estado a BORRADOR acá es un estado transitorio que nadie más llega
       * a ver — solo destraba el CHECK para poder romper el vínculo
       * circular con revision_entregable_archivo antes del DELETE. No
       * afecta la respuesta: estadoAnterior ya se leyó de `revisionActual`
       * más arriba.
       */
      await new sql.Request(transaction)
        .input('id', sql.NVarChar(30), revisionId)
        .query(`UPDATE nucleo.revision_entregable SET archivo_id = NULL, estado = N'BORRADOR' WHERE id = TRY_CONVERT(BIGINT, @id);`);

      await new sql.Request(transaction)
        .input('id', sql.NVarChar(30), revisionId)
        .query(`DELETE FROM nucleo.revision_entregable_archivo WHERE revision_id = TRY_CONVERT(BIGINT, @id);`);

      await new sql.Request(transaction)
        .input('id', sql.NVarChar(30), revisionId)
        .query(`DELETE FROM nucleo.revision_entregable_fila WHERE revision_id = TRY_CONVERT(BIGINT, @id);`);

      await new sql.Request(transaction)
        .input('id', sql.NVarChar(30), revisionId)
        .query(`DELETE FROM nucleo.revision_entregable WHERE id = TRY_CONVERT(BIGINT, @id);`);

      // Apaga el bypass ANTES del commit — la conexión vuelve al pool sin
      // rastro de la marca, ninguna otra request la hereda por accidente.
      await new sql.Request(transaction).query(
        `EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 0;`
      );

      await transaction.commit();

      res.status(200).json({
        eliminado: true,
        revisionId,
        estadoAnterior: revisionActual.estado
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
 * POST .../revisiones/:revisionId/emitir — BORRADOR -> EMITIDA.
 * Genera el .xlsx real con la plantilla congelada, lo persiste con su
 * SHA-256, y fija estado=EMITIDA en la misma transacción. A partir de acá
 * los triggers de inmutabilidad entran en vigencia.
 */
revisionesEntregableRouter.post(
  '/:revisionId/emitir',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    let transaction: sql.Transaction | undefined;

    try {
      const projectId = req.projectAccess!.projectId;
      const entregableId = normalizeParam(req.params.entregableId);
      const revisionId = normalizeParam(req.params.revisionId);
      const userId = req.authUser!.id;

      const pool = await getDbPool();

      const revisionResult = await pool
        .request()
        .input('id', sql.NVarChar(30), revisionId)
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT ${REVISION_SELECT} FROM nucleo.revision_entregable
          WHERE id = TRY_CONVERT(BIGINT, @id) AND entregable_id = TRY_CONVERT(BIGINT, @entregable_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);
      const revision = revisionResult.recordset[0];
      if (!revision) {
        res.status(404).json({ error: 'revision_not_found', message: 'Revision does not exist for this entregable.' });
        return;
      }
      if (revision.estado !== 'BORRADOR') {
        res.status(409).json({ error: 'revision_no_emitible', message: `Esta revisión está en estado ${revision.estado}; solo un BORRADOR se puede emitir.` });
        return;
      }

      const entregable = await fetchEntregable(pool, entregableId!, projectId);

      const plantillaResult = await pool
        .request()
        .input('id', sql.NVarChar(30), String(revision.plantilla_id))
        .query(`SELECT id, nombre_archivo, archivo_blob FROM nucleo.plantilla_entregable WHERE id = TRY_CONVERT(BIGINT, @id);`);
      const plantilla = plantillaResult.recordset[0];
      if (!plantilla) {
        res.status(409).json({ error: 'plantilla_no_encontrada', message: 'La plantilla congelada de esta revisión ya no existe.' });
        return;
      }

      const docResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`SELECT * FROM nucleo.proyecto_documentacion WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);`);
      const doc = docResult.recordset[0];

      const filasResult = await pool
        .request()
        .input('revision_id', sql.NVarChar(30), revisionId)
        .query(`SELECT item, datos_snapshot FROM nucleo.revision_entregable_fila WHERE revision_id = TRY_CONVERT(BIGINT, @revision_id) ORDER BY item;`);

      const filas = filasResult.recordset.map((f: any) => ({ item: f.item, snapshot: JSON.parse(f.datos_snapshot) }));

      // Fila de carátula: se resuelve y se congela ACÁ, para siempre — no
      // se recalcula nunca más aunque se emitan más revisiones después
      // (pedido explícito del usuario, migración 010). `plan` decide si
      // hace falta expulsar a la más antigua de las 5 visibles y subir a
      // las demás para liberar la fila 32.
      const revisionesPrevias = await fetchRevisionesEmitidasPrevias(pool, entregableId!, revisionId);
      const planFila = planificarFilaCaratula(revisionesPrevias);

      const revisionActualParaCaratula: RevisionCaratula = {
        codigoRevision: revision.codigo_revision,
        fecha: toIsoDate(revision.fecha),
        descripcion: revision.descripcion,
        inicialesPor: revision.iniciales_por,
        inicialesRevisado: revision.iniciales_revisado,
        inicialesAprobado: revision.iniciales_aprobado,
        filaCaratula: planFila.nuevaFilaActual
      };

      // Vista para ESTE Excel: las previas que sobreviven (sin la
      // expulsada), con su fila ya corrida +1 si correspondía, más la
      // actual en su fila recién asignada.
      const revisionesCaratula: RevisionCaratula[] = [
        ...revisionesPrevias
          .filter((r) => r.id !== planFila.idExpulsado)
          .map((r) => ({
            codigoRevision: r.codigoRevision,
            fecha: r.fecha,
            descripcion: r.descripcion,
            inicialesPor: r.inicialesPor,
            inicialesRevisado: r.inicialesRevisado,
            inicialesAprobado: r.inicialesAprobado,
            filaCaratula: planFila.idsQueSuben.includes(r.id) ? r.filaCaratula! + 1 : r.filaCaratula!
          })),
        revisionActualParaCaratula
      ];
      const metadatosSnapshotFinal = construirMetadatosSnapshot(doc, entregable, revisionActualParaCaratula, revisionesCaratula.slice(0, -1));

      const meta: CaratulaMetadata = {
        proyectoCumbra: doc?.codigo_proyecto_cumbra ?? null,
        proyectoCliente: doc?.codigo_proyecto_cliente ?? null,
        titulo: entregable.titulo,
        etapaCodigo: doc?.etapa_codigo ?? null,
        etapaNombre: doc?.etapa_nombre ?? null,
        afe: doc?.afe ?? null,
        vp: doc?.vp ?? null,
        jefeDisciplina: doc?.jefe_disciplina ?? null,
        liderProyecto: doc?.lider_proyecto ?? null,
        gerenteIngenieriaConstruccion: doc?.gerente_ingenieria_construccion ?? null,
        numeroDocumento: entregable.numero_documento
      };

      const excelBuffer = await generarLdiExcel({
        plantillaBuffer: plantilla.archivo_blob,
        meta,
        revisionesCaratula,
        filas
      });

      const hash = createHash('sha256').update(excelBuffer).digest('hex');
      const nombreArchivo = `${entregable.numero_documento}_Rev${revision.codigo_revision}.xlsx`;

      transaction = new sql.Transaction(pool);
      await transaction.begin();

      const archivoInsert = await new sql.Request(transaction)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('revision_id', sql.NVarChar(30), revisionId)
        .input('nombre_archivo', sql.NVarChar(260), nombreArchivo)
        .input('archivo_blob', sql.VarBinary(sql.MAX), excelBuffer)
        .input('archivo_hash', sql.Char(64), hash)
        .input('tamanio_bytes', sql.BigInt, excelBuffer.length)
        .query(`
          INSERT INTO nucleo.revision_entregable_archivo (
            proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes, created_at
          )
          OUTPUT INSERTED.id
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @revision_id), @nombre_archivo,
            @archivo_blob, @archivo_hash, @tamanio_bytes, SYSUTCDATETIME()
          );
        `);
      const archivoId = String(archivoInsert.recordset[0].id);

      await new sql.Request(transaction)
        .input('id', sql.NVarChar(30), revisionId)
        .input('archivo_id', sql.NVarChar(30), archivoId)
        .input('fila_caratula', sql.Int, planFila.nuevaFilaActual)
        .input('metadatos_snapshot_json', sql.NVarChar(sql.MAX), JSON.stringify(metadatosSnapshotFinal))
        .input('emitida_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.revision_entregable
          SET estado = N'EMITIDA',
              archivo_id = TRY_CONVERT(BIGINT, @archivo_id),
              fila_caratula = @fila_caratula,
              metadatos_snapshot_json = @metadatos_snapshot_json,
              emitida_by = TRY_CONVERT(BIGINT, @emitida_by),
              emitida_at = SYSUTCDATETIME(),
              updated_at = SYSUTCDATETIME()
          WHERE id = TRY_CONVERT(BIGINT, @id);
        `);

      // La revisión que se está emitiendo recién ahora pasa a EMITIDA (el
      // UPDATE de arriba) — el trigger no la bloquea porque ANTES de este
      // UPDATE seguía en BORRADOR. Pero las que hay que correr/expulsar
      // más abajo YA son EMITIDA desde antes: sin el bypass, esas SÍ
      // quedarían rechazadas (ver migración 009).
      if (planFila.idExpulsado || planFila.idsQueSuben.length > 0) {
        await new sql.Request(transaction).query(
          `EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 1;`
        );

        if (planFila.idExpulsado) {
          await new sql.Request(transaction)
            .input('id', sql.NVarChar(30), planFila.idExpulsado)
            .query(`UPDATE nucleo.revision_entregable SET fila_caratula = NULL WHERE id = TRY_CONVERT(BIGINT, @id);`);
        }

        for (const idQueSube of planFila.idsQueSuben) {
          await new sql.Request(transaction)
            .input('id', sql.NVarChar(30), idQueSube)
            .query(`UPDATE nucleo.revision_entregable SET fila_caratula = fila_caratula + 1 WHERE id = TRY_CONVERT(BIGINT, @id);`);
        }

        await new sql.Request(transaction).query(
          `EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 0;`
        );
      }

      await transaction.commit();

      const emittedRow = await fetchRevisionRow(pool, revisionId!);

      res.status(200).json({
        revision: serializeRevision(emittedRow),
        archivo: { id: archivoId, nombreArchivo, archivoHash: hash, tamanioBytes: excelBuffer.length }
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
 * GET .../revisiones/:revisionId/archivo — descarga el binario REAL
 * emitido (nunca regenera). Solo tiene sentido para EMITIDA.
 */
revisionesEntregableRouter.get(
  '/:revisionId/archivo',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const entregableId = normalizeParam(req.params.entregableId);
      const revisionId = normalizeParam(req.params.revisionId);

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('revision_id', sql.NVarChar(30), revisionId)
        .input('entregable_id', sql.NVarChar(30), entregableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .query(`
          SELECT a.nombre_archivo, a.mime_type, a.archivo_blob, a.archivo_hash, a.tamanio_bytes
          FROM nucleo.revision_entregable_archivo a
          JOIN nucleo.revision_entregable r ON r.id = a.revision_id
          WHERE a.revision_id = TRY_CONVERT(BIGINT, @revision_id)
            AND r.entregable_id = TRY_CONVERT(BIGINT, @entregable_id)
            AND r.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'archivo_not_found', message: 'Esta revisión no tiene un archivo emitido (¿todavía es BORRADOR o fue DESCARTADA?).' });
        return;
      }

      res
        .status(200)
        .set('Content-Type', row.mime_type)
        .set('Content-Disposition', `attachment; filename="${row.nombre_archivo}"`)
        .set('X-Archivo-Sha256', row.archivo_hash)
        .send(row.archivo_blob);
    } catch (error) {
      next(error);
    }
  }
);
