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
 * nucleo.enlace_com — el enlace de comunicaciones de un EQUIPO o
 * INSTRUMENTO (XOR, CK_enlace_com_origen_xor) hacia un PUERTO. Sin
 * triggers propios (a diferencia de nucleo.senal): solo CHECK + FK +
 * índices únicos filtrados —
 *   UX_enlace_com_puerto:      un puerto admite un solo enlace activo.
 *   UX_enlace_com_equipo:      un equipo admite un solo enlace activo.
 *   UX_enlace_com_instrumento: un instrumento admite un solo enlace activo.
 * Mismo enfoque de mapeo de errores que signals.ts, pero sin la
 * complicación de OUTPUT/triggers — esta tabla no tiene, así que OUTPUT
 * INSERTED.* directo es válido (como en instruments.ts/equipment.ts).
 */
export const commLinksRouter = Router({ mergeParams: true });

commLinksRouter.use(authenticate);


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

function sqlErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const FK_FIELD_BY_CONSTRAINT: Record<string, string> = {
  FK_enlace_com_equipo: 'equipoId',
  FK_enlace_com_instrumento: 'instrumentoId',
  FK_enlace_com_puerto: 'puertoId',
  FK_enlace_com_tipo_com: 'tipoComId',
  FK_enlace_com_tipo_medio: 'tipoMedioId'
};

function mapCommLinkSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);

  if (number === undefined) return null;

  if (number === 54901 || message.includes('UX_enlace_com_puerto')) {
    return { status: 409, body: { error: 'comm_link_port_conflict', message: 'Ese puerto ya tiene un enlace de comunicaciones activo.' } };
  }

  if (number === 54902) {
    return { status: 404, body: { error: 'comm_link_not_found', message: 'El enlace no existe en este proyecto o está inactivo.' } };
  }

  if (message.includes('UX_enlace_com_equipo')) {
    return { status: 409, body: { error: 'comm_link_equipment_conflict', message: 'Ese equipo ya tiene un enlace de comunicaciones activo.' } };
  }

  if (message.includes('UX_enlace_com_instrumento')) {
    return { status: 409, body: { error: 'comm_link_instrument_conflict', message: 'Ese instrumento ya tiene un enlace de comunicaciones activo.' } };
  }

  if (message.includes('CK_enlace_com_origen_xor')) {
    return { status: 400, body: { error: 'validation_error', message: 'El enlace debe pertenecer a exactamente un dueño: equipoId o instrumentoId.' } };
  }

  if (number === 547) {
    for (const [constraint, field] of Object.entries(FK_FIELD_BY_CONSTRAINT)) {
      if (message.includes(constraint)) {
        return { status: 400, body: { error: 'invalid_reference', message: `${field} no existe, está inactivo, o no pertenece a este proyecto.` } };
      }
    }
  }

  return null;
}

function serialize(row: Record<string, any>) {
  const nullableId = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    equipoId: nullableId(row.equipo_id),
    instrumentoId: nullableId(row.instrumento_id),
    puertoId: String(row.puerto_id),
    tipoComId: nullableId(row.tipo_com_id),
    tipoMedioId: nullableId(row.tipo_medio_id),
    tagMedio: row.tag_medio,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

const COLUMNS = [
  'id', 'proyecto_id', 'equipo_id', 'instrumento_id', 'puerto_id',
  'tipo_com_id', 'tipo_medio_id', 'tag_medio', 'activo',
  'created_at', 'updated_at', 'created_by', 'updated_by'
].join(', ');


/*
 * GET /api/projects/:projectId/comm-links
 */
commLinksRouter.get(
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
          SELECT ${COLUMNS}
          FROM nucleo.enlace_com
          WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
          ORDER BY id;
        `);

      res.status(200).json({ projectId, commLinks: result.recordset.map(serialize) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/comm-links/:commLinkId
 */
commLinksRouter.get(
  '/:commLinkId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const commLinkId = normalizeParam(req.params.commLinkId);

      if (!isPositiveIntString(commLinkId)) {
        res.status(400).json({ error: 'invalid_comm_link_id', message: 'commLinkId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('enlace_id', sql.NVarChar(30), commLinkId)
        .query(`
          SELECT ${COLUMNS}
          FROM nucleo.enlace_com
          WHERE id = TRY_CONVERT(BIGINT, @enlace_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'comm_link_not_found', message: 'Comm link does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ commLink: serialize(row) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/comm-links
 */
commLinksRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;

      const {
        equipoId = null,
        instrumentoId = null,
        puertoId,
        tipoComId = null,
        tipoMedioId = null,
        tagMedio = null
      } = req.body ?? {};

      if (!isPositiveIntString(puertoId)) {
        res.status(400).json({ error: 'validation_error', message: 'puertoId is required and must be a numeric id.' });
        return;
      }

      const hasEquipo = equipoId !== null && equipoId !== undefined;
      const hasInstrumento = instrumentoId !== null && instrumentoId !== undefined;

      if (hasEquipo === hasInstrumento) {
        res.status(400).json({ error: 'validation_error', message: 'Debe indicarse exactamente uno de equipoId o instrumentoId.' });
        return;
      }

      if (hasEquipo && !isPositiveIntString(equipoId)) {
        res.status(400).json({ error: 'validation_error', message: 'equipoId must be a numeric id.' });
        return;
      }
      if (hasInstrumento && !isPositiveIntString(instrumentoId)) {
        res.status(400).json({ error: 'validation_error', message: 'instrumentoId must be a numeric id.' });
        return;
      }
      if (tipoComId !== null && !isPositiveIntString(tipoComId)) {
        res.status(400).json({ error: 'validation_error', message: 'tipoComId must be a numeric id or null.' });
        return;
      }
      if (tipoMedioId !== null && !isPositiveIntString(tipoMedioId)) {
        res.status(400).json({ error: 'validation_error', message: 'tipoMedioId must be a numeric id or null.' });
        return;
      }
      if (tagMedio !== null && (typeof tagMedio !== 'string' || tagMedio.length > 50)) {
        res.status(400).json({ error: 'validation_error', message: 'tagMedio must be a string of at most 50 characters, or null.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('equipo_id', sql.NVarChar(30), equipoId)
        .input('instrumento_id', sql.NVarChar(30), instrumentoId)
        .input('puerto_id', sql.NVarChar(30), puertoId)
        .input('tipo_com_id', sql.NVarChar(30), tipoComId)
        .input('tipo_medio_id', sql.NVarChar(30), tipoMedioId)
        .input('tag_medio', sql.NVarChar(50), tagMedio)
        .query(`
          INSERT INTO nucleo.enlace_com (
            proyecto_id, equipo_id, instrumento_id, puerto_id,
            tipo_com_id, tipo_medio_id, tag_medio, activo, created_at, created_by
          )
          OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id),
            TRY_CONVERT(BIGINT, @equipo_id),
            TRY_CONVERT(BIGINT, @instrumento_id),
            TRY_CONVERT(BIGINT, @puerto_id),
            TRY_CONVERT(BIGINT, @tipo_com_id),
            TRY_CONVERT(BIGINT, @tipo_medio_id),
            @tag_medio,
            1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const row = result.recordset[0];

      res
        .status(201)
        .location(`/api/projects/${projectId}/comm-links/${String(row.id)}`)
        .json({ commLink: serialize(row) });

    } catch (error) {
      const mapped = mapCommLinkSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/comm-links/:commLinkId
 *
 * No permite mover el enlace a otro puerto (equivalente a "mover un rack
 * de RIO"): puertoId no es editable aquí. Sí permite cambiar tipoComId,
 * tipoMedioId, tagMedio, y — con la misma exigencia XOR de la creación —
 * el dueño (equipoId/instrumentoId).
 */
commLinksRouter.patch(
  '/:commLinkId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const commLinkId = normalizeParam(req.params.commLinkId);

      if (!isPositiveIntString(commLinkId)) {
        res.status(400).json({ error: 'invalid_comm_link_id', message: 'commLinkId must be a positive integer.' });
        return;
      }

      const allowedFields = {
        equipoId: { column: 'equipo_id', sqlType: sql.NVarChar(30) },
        instrumentoId: { column: 'instrumento_id', sqlType: sql.NVarChar(30) },
        tipoComId: { column: 'tipo_com_id', sqlType: sql.NVarChar(30) },
        tipoMedioId: { column: 'tipo_medio_id', sqlType: sql.NVarChar(30) },
        tagMedio: { column: 'tag_medio', sqlType: sql.NVarChar(50) }
      } as const;

      const body = req.body ?? {};
      const keys = Object.keys(body).filter((key) => key in allowedFields) as Array<keyof typeof allowedFields>;

      if (keys.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      if (
        'equipoId' in body &&
        'instrumentoId' in body &&
        body.equipoId !== null &&
        body.instrumentoId !== null
      ) {
        res.status(400).json({ error: 'validation_error', message: 'No pueden enviarse equipoId e instrumentoId simultáneamente con valor.' });
        return;
      }

      for (const key of keys) {
        const value = body[key];

        if (key === 'tagMedio') {
          if (value !== null && (typeof value !== 'string' || value.length > 50)) {
            res.status(400).json({ error: 'validation_error', message: 'tagMedio must be a string of at most 50 characters, or null.' });
            return;
          }
          continue;
        }

        if (value !== null && !isPositiveIntString(value)) {
          res.status(400).json({ error: 'validation_error', message: `${key} must be a numeric id or null.` });
          return;
        }
      }

      const pool = await getDbPool();
      const request = pool.request();

      request
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('enlace_id', sql.NVarChar(30), commLinkId)
        .input('updated_by', sql.NVarChar(30), userId);

      const assignments: string[] = [];
      keys.forEach((key, index) => {
        const config = allowedFields[key];
        const parameter = `field_${index}`;
        request.input(parameter, config.sqlType, body[key]);
        assignments.push(
          key === 'tagMedio'
            ? `${config.column} = @${parameter}`
            : `${config.column} = TRY_CONVERT(BIGINT, @${parameter})`
        );
      });

      const result = await request.query(`
        IF NOT EXISTS (
          SELECT 1 FROM nucleo.enlace_com
          WHERE id = TRY_CONVERT(BIGINT, @enlace_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1
        )
        BEGIN
          THROW 54902, 'El enlace no existe en este proyecto o está inactivo.', 1;
        END;

        UPDATE nucleo.enlace_com
        SET ${assignments.join(',\n          ')},
          updated_at = SYSUTCDATETIME(),
          updated_by = TRY_CONVERT(BIGINT, @updated_by)
        OUTPUT ${COLUMNS.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        WHERE id = TRY_CONVERT(BIGINT, @enlace_id)
          AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
          AND activo = 1;
      `);

      res.status(200).json({ commLink: serialize(result.recordset[0]) });

    } catch (error) {
      const mapped = mapCommLinkSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/comm-links/:commLinkId
 */
commLinksRouter.delete(
  '/:commLinkId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const commLinkId = normalizeParam(req.params.commLinkId);

      if (!isPositiveIntString(commLinkId)) {
        res.status(400).json({ error: 'invalid_comm_link_id', message: 'commLinkId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('enlace_id', sql.NVarChar(30), commLinkId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          UPDATE nucleo.enlace_com
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.puerto_id, INSERTED.activo,
                 INSERTED.updated_at, INSERTED.updated_by
          WHERE id = TRY_CONVERT(BIGINT, @enlace_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
            AND activo = 1;
        `);

      const row = result.recordset[0];

      if (!row) {
        res.status(404).json({ error: 'comm_link_not_found', message: 'Comm link does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({
        commLink: {
          id: String(row.id),
          projectId: String(row.proyecto_id),
          puertoId: String(row.puerto_id),
          active: Boolean(row.activo),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === null ? null : String(row.updated_by)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);
