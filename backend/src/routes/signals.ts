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

export const signalsRouter = Router({ mergeParams: true });

signalsRouter.use(authenticate);


function normalizeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}


function isPositiveIntString(value: string | undefined): value is string {
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


function sqlErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}


/*
 * Traduce violaciones de CHECK/FOREIGN KEY (error 547) y de índices únicos
 * (2601/2627) de nucleo.senal a una respuesta HTTP clara, a partir del
 * nombre de la restricción incluido en el mensaje de SQL Server.
 *
 * No reimplementa ninguna regla: solo nombra, en HTTP, la regla que la
 * base ya aplicó.
 */
const FK_FIELD_BY_CONSTRAINT: Record<string, string> = {
  FK_senal_instrumento: 'instrumentoId',
  FK_senal_equipo: 'equipoId',
  FK_senal_instrumento_agrupador: 'instrumentoAgrupadorId',
  FK_senal_canal: 'canalId',
  FK_senal_clase_senal: 'claseSenalId',
  FK_senal_tipo_io: 'tipoIoId',
  FK_senal_direccion_com: 'direccionComId',
  FK_senal_tipo_interfaz: 'tipoInterfazId',
  FK_senal_estado_revision: 'estadoRevisionId',
  FK_senal_prioridad_alarma: 'prioridadAlarmaId',
  FK_senal_tipo_dato_com: 'tipoDatoComId'
};

function mapSignalSqlError(
  error: unknown
): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  // Conflicto de TAG duplicado (pre-check propio + índice único como respaldo).
  if (number === 54101 || message.includes('UX_senal_proyecto_tag')) {
    return {
      status: 409,
      body: {
        error: 'signal_tag_conflict',
        message: 'Ya existe una señal activa con ese TAG en el proyecto.'
      }
    };
  }

  // Señal no encontrada (pre-check propio para UPDATE/DELETE).
  if (number === 54102) {
    return {
      status: 404,
      body: {
        error: 'signal_not_found',
        message: 'La señal no existe en este proyecto o está inactiva.'
      }
    };
  }

  // Canal ya asignado a otra señal activa (índice único filtrado).
  if (message.includes('UX_senal_canal_id')) {
    return {
      status: 409,
      body: {
        error: 'signal_channel_conflict',
        message: 'Ese canal ya está asignado a otra señal activa.'
      }
    };
  }

  // CK_senal_origen_xor: instrumento_id XOR equipo_id.
  if (message.includes('CK_senal_origen_xor')) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: 'La señal debe pertenecer a exactamente un dueño: instrumentoId o equipoId.'
      }
    };
  }

  // CK_senal_tipo_io_direccion_excl: tipo_io_id y direccion_com_id son excluyentes.
  if (message.includes('CK_senal_tipo_io_direccion_excl')) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: 'tipoIoId y direccionComId no pueden coexistir en la misma señal.'
      }
    };
  }

  // CK_senal_tipo_dato_com_loop_excl: tipo_dato_com_id y es_loop_powered son
  // excluyentes a nivel de fila (defensa simple, la exclusividad real por
  // clase la decide TR_senal_validar_clase, ver 51008/51009 abajo).
  if (message.includes('CK_senal_tipo_dato_com_loop_excl')) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: 'tipoDatoComId y esLoopPowered no pueden coexistir en la misma señal.'
      }
    };
  }

  // TR_senal_validar_clase: reglas CONTROL/COM segun el codigo real del catalogo.
  if (number === 51008) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: 'Una señal COM no puede tener tipoIoId, canalId ni esLoopPowered.'
      }
    };
  }

  if (number === 51009) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: 'Una señal CONTROL no puede tener direccionComId ni tipoDatoComId.'
      }
    };
  }

  if (number === 51013) {
    return {
      status: 409,
      body: {
        error: 'signal_com_route_conflict',
        message: 'No se puede clasificar como COM una señal con una ruta de conexión activa.'
      }
    };
  }

  // TR_senal_validar_canal_ruta: canal/modulo inactivo.
  if (number === 51014) {
    return {
      status: 409,
      body: {
        error: 'signal_channel_inactive',
        message: 'Una señal activa no puede usar un canal o módulo inactivo.'
      }
    };
  }

  // FOREIGN KEY (547): referencia a un catálogo/entidad inexistente o de otro proyecto.
  if (number === 547) {
    for (const [constraint, field] of Object.entries(FK_FIELD_BY_CONSTRAINT)) {
      if (message.includes(constraint)) {
        return {
          status: 400,
          body: {
            error: 'invalid_reference',
            message: `${field} no existe, está inactivo, o no pertenece a este proyecto.`
          }
        };
      }
    }
  }

  return null;
}


const SIGNAL_SELECT_COLUMNS = `
  s.id,
  s.proyecto_id,
  s.instrumento_id,
  s.equipo_id,
  s.instrumento_agrupador_id,
  s.clase_senal_id,
  cs.codigo AS clase_senal_codigo,
  s.tipo_io_id,
  tio.codigo AS tipo_io_codigo,
  s.direccion_com_id,
  dc.codigo AS direccion_com_codigo,
  s.tipo_interfaz_id,
  s.canal_id,
  s.estado_revision_id,
  s.prioridad_alarma_id,
  s.tag_senal,
  s.codigo_senal,
  s.causa_alarma,
  s.tipo_dato_com_id,
  tdc.codigo AS tipo_dato_com_codigo,
  s.es_loop_powered,
  s.nombre_corto,
  s.descripcion,
  s.rango_min,
  s.rango_max,
  s.alarma_hh,
  s.alarma_h,
  s.alarma_l,
  s.alarma_ll,
  s.valor_normal,
  s.unidad_ingenieria,
  s.retardo,
  s.enclavamiento,
  s.observacion,
  s.activo,
  s.created_at,
  s.updated_at,
  s.created_by,
  s.updated_by
`;

const SIGNAL_FROM_CLAUSE = `
  FROM nucleo.senal s
  JOIN cat.cat_clase_senal cs ON cs.id = s.clase_senal_id
  LEFT JOIN cat.cat_tipo_io tio ON tio.id = s.tipo_io_id
  LEFT JOIN cat.cat_direccion_com dc ON dc.id = s.direccion_com_id
  LEFT JOIN cat.cat_tipo_dato_com tdc ON tdc.id = s.tipo_dato_com_id
`;


function serializeSignal(row: Record<string, any>) {
  const nullableId = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);

  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),

    instrumentoId: nullableId(row.instrumento_id),
    equipoId: nullableId(row.equipo_id),
    instrumentoAgrupadorId: nullableId(row.instrumento_agrupador_id),

    claseSenalId: String(row.clase_senal_id),
    claseSenalCodigo: row.clase_senal_codigo,

    tipoIoId: nullableId(row.tipo_io_id),
    tipoIoCodigo: row.tipo_io_codigo ?? null,

    direccionComId: nullableId(row.direccion_com_id),
    direccionComCodigo: row.direccion_com_codigo ?? null,

    tipoInterfazId: nullableId(row.tipo_interfaz_id),
    canalId: nullableId(row.canal_id),
    estadoRevisionId: nullableId(row.estado_revision_id),
    prioridadAlarmaId: nullableId(row.prioridad_alarma_id),

    tagSenal: row.tag_senal,
    codigoSenal: row.codigo_senal,
    causaAlarma: row.causa_alarma === null ? null : Boolean(row.causa_alarma),

    tipoDatoComId: nullableId(row.tipo_dato_com_id),
    tipoDatoComCodigo: row.tipo_dato_com_codigo ?? null,
    esLoopPowered: row.es_loop_powered === null ? null : Boolean(row.es_loop_powered),

    nombreCorto: row.nombre_corto,
    descripcion: row.descripcion,

    rangoMin: row.rango_min,
    rangoMax: row.rango_max,
    alarmaHh: row.alarma_hh,
    alarmaH: row.alarma_h,
    alarmaL: row.alarma_l,
    alarmaLl: row.alarma_ll,

    valorNormal: row.valor_normal,
    unidadIngenieria: row.unidad_ingenieria,
    retardo: row.retardo,
    enclavamiento: row.enclavamiento,
    observacion: row.observacion,

    active: Boolean(row.activo),

    createdAt: row.created_at,
    updatedAt: row.updated_at,

    createdBy: nullableId(row.created_by),
    updatedBy: nullableId(row.updated_by)
  };
}


/*
 * Campos aceptados en el body de POST/PATCH, con su columna, tipo SQL y
 * validacion. La clasificacion CONTROL/COM en si (que combinaciones son
 * validas) la decide la base via TR_senal_validar_clase + los CHECK — aqui
 * solo se validan forma/tipo/tamaño para poder devolver 400 claros.
 */
type FieldKind = 'string' | 'bigintId' | 'float' | 'boolean';

interface FieldSpec {
  column: string;
  kind: FieldKind;
  max?: number;
  sqlType: sql.ISqlType | (() => sql.ISqlType);
}

const SIGNAL_FIELDS: Record<string, FieldSpec> = {
  instrumentoId: { column: 'instrumento_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  equipoId: { column: 'equipo_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  instrumentoAgrupadorId: { column: 'instrumento_agrupador_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  claseSenalId: { column: 'clase_senal_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  tipoIoId: { column: 'tipo_io_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  direccionComId: { column: 'direccion_com_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  tipoInterfazId: { column: 'tipo_interfaz_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  canalId: { column: 'canal_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  estadoRevisionId: { column: 'estado_revision_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  prioridadAlarmaId: { column: 'prioridad_alarma_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },

  tagSenal: { column: 'tag_senal', kind: 'string', max: 80, sqlType: sql.NVarChar(80) },
  codigoSenal: { column: 'codigo_senal', kind: 'string', max: 20, sqlType: sql.NVarChar(20) },
  causaAlarma: { column: 'causa_alarma', kind: 'boolean', sqlType: sql.Bit },
  tipoDatoComId: { column: 'tipo_dato_com_id', kind: 'bigintId', sqlType: sql.NVarChar(30) },
  esLoopPowered: { column: 'es_loop_powered', kind: 'boolean', sqlType: sql.Bit },
  nombreCorto: { column: 'nombre_corto', kind: 'string', max: 30, sqlType: sql.NVarChar(30) },
  descripcion: { column: 'descripcion', kind: 'string', max: 300, sqlType: sql.NVarChar(300) },

  rangoMin: { column: 'rango_min', kind: 'float', sqlType: sql.Float },
  rangoMax: { column: 'rango_max', kind: 'float', sqlType: sql.Float },
  alarmaHh: { column: 'alarma_hh', kind: 'float', sqlType: sql.Float },
  alarmaH: { column: 'alarma_h', kind: 'float', sqlType: sql.Float },
  alarmaL: { column: 'alarma_l', kind: 'float', sqlType: sql.Float },
  alarmaLl: { column: 'alarma_ll', kind: 'float', sqlType: sql.Float },

  valorNormal: { column: 'valor_normal', kind: 'string', max: 50, sqlType: sql.NVarChar(50) },
  unidadIngenieria: { column: 'unidad_ingenieria', kind: 'string', max: 20, sqlType: sql.NVarChar(20) },
  retardo: { column: 'retardo', kind: 'string', max: 50, sqlType: sql.NVarChar(50) },
  enclavamiento: { column: 'enclavamiento', kind: 'string', max: 300, sqlType: sql.NVarChar(300) },
  observacion: { column: 'observacion', kind: 'string', max: 500, sqlType: sql.NVarChar(500) }
};

/*
 * tagSenal ya NO es obligatorio (migracion 013) — el analisis del Excel de
 * referencia mostro que la mayoria de las señales COM no tienen un TAG de
 * ingenieria real (registros PLC identificados solo por su dueño +
 * descripcion). claseSenalId sigue siendo el unico campo verdaderamente
 * obligatorio al crear.
 */
const REQUIRED_ON_CREATE = ['claseSenalId'] as const;

/*
 * Valida un unico campo segun su FieldSpec. `allowNull` permite explicitamente
 * `null` para poder limpiar un campo opcional en PATCH.
 */
function validateField(
  key: string,
  spec: FieldSpec,
  value: unknown,
  allowNull: boolean
): string | null {
  if (value === null) {
    return allowNull ? null : `${key} no puede ser null.`;
  }

  if (value === undefined) return null;

  if (spec.kind === 'string') {
    if (typeof value !== 'string') return `${key} debe ser una cadena de texto o null.`;
    if (spec.max !== undefined && value.length > spec.max) {
      return `${key} no puede exceder ${spec.max} caracteres.`;
    }
    return null;
  }

  if (spec.kind === 'bigintId') {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      return `${key} debe ser un identificador numérico (string) o null.`;
    }
    return null;
  }

  if (spec.kind === 'float') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return `${key} debe ser un número o null.`;
    }
    return null;
  }

  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      return `${key} debe ser true, false o null.`;
    }
    return null;
  }

  return null;
}


/*
 * GET /api/projects/:projectId/signals
 */
signalsRouter.get(
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
          SELECT ${SIGNAL_SELECT_COLUMNS}
          ${SIGNAL_FROM_CLAUSE}
          WHERE s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND s.activo = 1
          ORDER BY s.tag_senal;
        `);

      res.status(200).json({
        projectId,
        signals: result.recordset.map(serializeSignal)
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/signals/:signalId
 */
signalsRouter.get(
  '/:signalId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const signalId = normalizeParam(req.params.signalId);

      if (!isPositiveIntString(signalId)) {
        res.status(400).json({
          error: 'invalid_signal_id',
          message: 'signalId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();

      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('senal_id', sql.NVarChar(30), signalId)
        .query(`
          SELECT ${SIGNAL_SELECT_COLUMNS}
          ${SIGNAL_FROM_CLAUSE}
          WHERE s.id = TRY_CONVERT(BIGINT, @senal_id)
            AND s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND s.activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({
          error: 'signal_not_found',
          message: 'La señal no existe en este proyecto o está inactiva.'
        });
        return;
      }

      res.status(200).json({ signal: serializeSignal(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/signals
 *
 * Requiere permiso WRITE (ADMIN/EDITOR).
 */
signalsRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const body = req.body ?? {};

      for (const key of REQUIRED_ON_CREATE) {
        if (body[key] === undefined || body[key] === null) {
          res.status(400).json({
            error: 'validation_error',
            message: `${key} is required.`
          });
          return;
        }
      }

      if (typeof body.tagSenal === 'string') {
        body.tagSenal = body.tagSenal.trim();

        if (body.tagSenal.length === 0) {
          res.status(400).json({
            error: 'validation_error',
            message: 'tagSenal cannot be empty.'
          });
          return;
        }
      }

      /*
       * Dueño exigido en la creacion: exactamente uno de instrumentoId /
       * equipoId. La base lo exige siempre (CK_senal_origen_xor); se
       * valida aqui tambien para devolver un 400 legible en vez de un
       * error crudo de constraint.
       */
      const hasInstrumento = body.instrumentoId !== undefined && body.instrumentoId !== null;
      const hasEquipo = body.equipoId !== undefined && body.equipoId !== null;

      if (hasInstrumento === hasEquipo) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Debe indicarse exactamente uno de instrumentoId o equipoId.'
        });
        return;
      }

      const keys = Object.keys(body).filter((key) => key in SIGNAL_FIELDS);

      for (const key of keys) {
        const spec = SIGNAL_FIELDS[key]!;
        const isRequiredField = (REQUIRED_ON_CREATE as readonly string[]).includes(key);
        const error = validateField(key, spec, body[key], !isRequiredField);

        if (error) {
          res.status(400).json({ error: 'validation_error', message: error });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('tag_senal', sql.NVarChar(80), body.tagSenal === undefined ? null : body.tagSenal);

      const columns = ['proyecto_id', 'tag_senal'];
      const paramNames = ['@proyecto_id', '@tag_senal'];

      for (const key of keys) {
        if (key === 'tagSenal') continue;

        const spec = SIGNAL_FIELDS[key]!;
        const paramName = `f_${spec.column}`;
        const value = body[key] === undefined ? null : body[key];

        request.input(paramName, spec.sqlType as sql.ISqlType, value);
        columns.push(spec.column);
        paramNames.push(`@${paramName}`);
      }

      columns.push('activo', 'created_at', 'created_by');
      paramNames.push('1', 'SYSUTCDATETIME()', 'TRY_CONVERT(BIGINT, @created_by)');

      /*
       * nucleo.senal tiene triggers AFTER INSERT/UPDATE (validacion de
       * clase, canal/ruta). SQL Server no permite OUTPUT INSERTED.* sin
       * INTO en una tabla con triggers habilitados (error 334) — se
       * captura el id insertado en una tabla variable en su lugar.
       */
      const insertResult = await request.query(`
        IF EXISTS (
          SELECT 1
          FROM nucleo.senal
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND tag_senal = @tag_senal
            AND activo = 1
        )
        BEGIN
          THROW 54101, 'Ya existe una señal activa con ese TAG en el proyecto.', 1;
        END;

        DECLARE @nuevos_ids TABLE (id BIGINT);

        INSERT INTO nucleo.senal (${columns.join(', ')})
        OUTPUT INSERTED.id INTO @nuevos_ids
        VALUES (${paramNames.join(', ')});

        SELECT id FROM @nuevos_ids;
      `);

      const newId = String(insertResult.recordset[0].id);

      const finalResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('senal_id', sql.NVarChar(30), newId)
        .query(`
          SELECT ${SIGNAL_SELECT_COLUMNS}
          ${SIGNAL_FROM_CLAUSE}
          WHERE s.id = TRY_CONVERT(BIGINT, @senal_id)
            AND s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      res
        .status(201)
        .location(`/api/projects/${projectId}/signals/${newId}`)
        .json({ signal: serializeSignal(finalResult.recordset[0]) });

    } catch (error) {
      const mapped = mapSignalSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }

      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/signals/:signalId
 *
 * Requiere permiso WRITE (ADMIN/EDITOR).
 */
signalsRouter.patch(
  '/:signalId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const signalId = normalizeParam(req.params.signalId);

      if (!isPositiveIntString(signalId)) {
        res.status(400).json({
          error: 'invalid_signal_id',
          message: 'signalId must be a positive integer.'
        });
        return;
      }

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in SIGNAL_FIELDS);

      if (keys.length === 0) {
        res.status(400).json({
          error: 'validation_error',
          message: 'No editable fields were provided.'
        });
        return;
      }

      /*
       * tagSenal ya es opcional (migracion 013) — a diferencia de antes,
       * `null` es un valor valido en PATCH (limpia el tag). Una cadena
       * vacia se trata igual que null (limpiar), no como error.
       */
      if ('tagSenal' in body) {
        if (typeof body.tagSenal === 'string') {
          body.tagSenal = body.tagSenal.trim();

          if (body.tagSenal.length === 0) {
            body.tagSenal = null;
          }
        } else if (body.tagSenal !== null) {
          res.status(400).json({
            error: 'validation_error',
            message: 'tagSenal debe ser una cadena de texto o null.'
          });
          return;
        }
      }

      if ('claseSenalId' in body && body.claseSenalId === null) {
        res.status(400).json({
          error: 'validation_error',
          message: 'claseSenalId cannot be null.'
        });
        return;
      }

      for (const key of keys) {
        const spec = SIGNAL_FIELDS[key]!;
        const isRequiredField = (REQUIRED_ON_CREATE as readonly string[]).includes(key);
        const error = validateField(key, spec, body[key], !isRequiredField);

        if (error) {
          res.status(400).json({ error: 'validation_error', message: error });
          return;
        }
      }

      /*
       * Si el body toca instrumentoId o equipoId, el estado FINAL debe
       * seguir cumpliendo la XOR. No conocemos aqui el otro lado sin leer
       * la fila, y la base ya lo garantiza con CK_senal_origen_xor — pero
       * el caso mas comun de error de cliente (mandar ambos a la vez en el
       * mismo PATCH) se puede rechazar aqui con un mensaje claro.
       */
      if (
        'instrumentoId' in body &&
        'equipoId' in body &&
        body.instrumentoId !== null &&
        body.equipoId !== null
      ) {
        res.status(400).json({
          error: 'validation_error',
          message: 'No pueden enviarse instrumentoId y equipoId simultáneamente con valor.'
        });
        return;
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('senal_id', sql.NVarChar(30), signalId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];

      keys.forEach((key, index) => {
        const spec = SIGNAL_FIELDS[key]!;
        const paramName = `field_${index}`;
        const value = body[key] === undefined ? null : body[key];

        request.input(paramName, spec.sqlType as sql.ISqlType, value);
        assignments.push(`${spec.column} = @${paramName}`);
      });

      if ('tagSenal' in body) {
        request.input('nuevo_tag', sql.NVarChar(80), body.tagSenal);
      }

      const tagCheck = 'tagSenal' in body
        ? `
          IF EXISTS (
            SELECT 1
            FROM nucleo.senal
            WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
              AND tag_senal = @nuevo_tag
              AND activo = 1
              AND id <> TRY_CONVERT(BIGINT, @senal_id)
          )
          BEGIN
            THROW 54101, 'Ya existe una señal activa con ese TAG en el proyecto.', 1;
          END;
        `
        : '';

      await request.query(`
        IF NOT EXISTS (
          SELECT 1
          FROM nucleo.senal
          WHERE id = TRY_CONVERT(BIGINT, @senal_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54102, 'La señal no existe en este proyecto o está inactiva.', 1;
        END;

        ${tagCheck}

        UPDATE nucleo.senal
        SET
          ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        WHERE id = TRY_CONVERT(BIGINT, @senal_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      const finalResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('senal_id', sql.NVarChar(30), signalId)
        .query(`
          SELECT ${SIGNAL_SELECT_COLUMNS}
          ${SIGNAL_FROM_CLAUSE}
          WHERE s.id = TRY_CONVERT(BIGINT, @senal_id)
            AND s.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);

      res.status(200).json({ signal: serializeSignal(finalResult.recordset[0]) });

    } catch (error) {
      const mapped = mapSignalSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }

      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/signals/:signalId
 *
 * Desactivacion logica (activo = 0). TR_senal_desactivar_ruta se encarga
 * de desactivar en cascada cualquier RUTA_CONEXION activa asociada — el
 * backend no lo reimplementa.
 *
 * Requiere permiso DEACTIVATE (solo ADMIN).
 */
signalsRouter.delete(
  '/:signalId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const signalId = normalizeParam(req.params.signalId);

      if (!isPositiveIntString(signalId)) {
        res.status(400).json({
          error: 'invalid_signal_id',
          message: 'signalId must be a positive integer.'
        });
        return;
      }

      const pool = await getDbPool();

      /*
       * Igual que en POST: nucleo.senal tiene triggers AFTER UPDATE, asi
       * que el OUTPUT de este UPDATE tiene que ir a una tabla variable
       * (error 334 si no).
       */
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('senal_id', sql.NVarChar(30), signalId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivados TABLE (
            id BIGINT,
            proyecto_id BIGINT,
            tag_senal NVARCHAR(80),
            activo BIT,
            updated_at DATETIME2,
            updated_by BIGINT
          );

          UPDATE nucleo.senal
          SET
            activo = 0,
            updated_at = SYSUTCDATETIME(),
            updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT
            INSERTED.id,
            INSERTED.proyecto_id,
            INSERTED.tag_senal,
            INSERTED.activo,
            INSERTED.updated_at,
            INSERTED.updated_by
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @senal_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({
          error: 'signal_not_found',
          message: 'La señal no existe en este proyecto o ya está inactiva.'
        });
        return;
      }

      res.status(200).json({
        signal: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          tagSenal: row.tag_senal,
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      const mapped = mapSignalSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }

      next(error);
    }
  }
);
