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
 * nucleo.bloque_terminal + nucleo.terminal + nucleo.posicion_terminal
 * (migración 015) — jerarquía física de terminales de CAJA/GABINETE/
 * MODULO. Ver docs/DIAGNOSTICO_SENALES_GABINETES.md secciones 36-39.
 *
 * bloque_terminal es dueño XOR de 3 vías, pero este router SOLO acepta
 * cajaId/gabineteId en creación manual — un bloque de MODULO se
 * materializa exclusivamente por TR_modulo_generar_terminales / el
 * endpoint de sincronización de modules.ts (GET/POST .../modules/:id/
 * terminales), nunca a mano. GET sí lista/lee bloques de cualquier
 * dueño (incluidos los de módulo), para que "Módulo -> Terminales" y
 * este router compartan la misma forma de datos.
 *
 * terminal.numero NUNCA persiste listas ("1,2,3", "F1-2") — cada borne
 * físico es su propia fila (ver seedeo de BORNERA en el diagnóstico).
 * Un terminal manual solo puede crearse en un bloque de caja/gabinete
 * (los de módulo son catalogo_modulo_io_terminal_id-derivados).
 */
export const bloquesTerminalRouter = Router({ mergeParams: true });

bloquesTerminalRouter.use(authenticate);


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

function mapSqlError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const number = sqlErrorNumber(error);
  const message = sqlErrorMessage(error);
  if (number === undefined) return null;

  if (message.includes('CK_bloque_terminal_pertenencia_xor')) {
    return { status: 400, body: { error: 'validation_error', message: 'bloque_terminal debe tener exactamente un dueño (caja o gabinete).' } };
  }
  if (message.includes('UX_bloque_terminal_caja_codigo') || message.includes('UX_bloque_terminal_gabinete_codigo') || message.includes('UX_bloque_terminal_modulo_codigo')) {
    return { status: 409, body: { error: 'bloque_terminal_conflict', message: 'Ya existe un bloque de terminales activo con ese código para este dueño.' } };
  }
  if (message.includes('UX_terminal_bloque_numero')) {
    return { status: 409, body: { error: 'terminal_conflict', message: 'Ya existe un terminal activo con ese número en este bloque.' } };
  }
  if (message.includes('UX_posicion_terminal_terminal_codigo')) {
    return { status: 409, body: { error: 'posicion_conflict', message: 'Ya existe una posición activa con ese código en este terminal.' } };
  }
  if (number === 547) {
    return { status: 400, body: { error: 'invalid_reference', message: 'Referencia inválida o de otro proyecto.' } };
  }
  if (number === 51031) {
    return { status: 409, body: { error: 'bloque_terminal_in_use', message: 'No se puede desactivar un bloque de terminales con un terminal ocupado.' } };
  }
  if (number === 51030) {
    return { status: 409, body: { error: 'terminal_in_use', message: 'No se puede desactivar un terminal con una posición ocupada.' } };
  }
  if (number === 51029) {
    return { status: 409, body: { error: 'posicion_in_use', message: 'No se puede desactivar una posición de terminal con una terminación activa.' } };
  }

  return null;
}

function serializeBloque(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    cajaId: row.caja_id === null ? null : String(row.caja_id),
    gabineteId: row.gabinete_id === null ? null : String(row.gabinete_id),
    moduloId: row.modulo_id === null ? null : String(row.modulo_id),
    codigo: row.codigo,
    descripcion: row.descripcion,
    active: Boolean(row.activo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === null ? null : String(row.created_by),
    updatedBy: row.updated_by === null ? null : String(row.updated_by)
  };
}

function serializeTerminal(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    bloqueTerminalId: String(row.bloque_terminal_id),
    numero: row.numero,
    catalogoModuloIoTerminalId: row.catalogo_modulo_io_terminal_id === null ? null : String(row.catalogo_modulo_io_terminal_id),
    active: Boolean(row.activo)
  };
}

function serializePosicion(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.proyecto_id),
    terminalId: String(row.terminal_id),
    codigo: row.codigo,
    active: Boolean(row.activo),
    inUse: Boolean(row.in_use)
  };
}

const SELECT_BLOQUE = `
  bt.id, bt.proyecto_id, bt.caja_id, bt.gabinete_id, bt.modulo_id, bt.codigo, bt.descripcion, bt.activo,
  bt.created_at, bt.updated_at, bt.created_by, bt.updated_by
`;

async function fetchBloqueDetail(pool: Awaited<ReturnType<typeof getDbPool>>, projectId: string, bloqueId: string) {
  const bloqueResult = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('bloque_id', sql.NVarChar(30), bloqueId)
    .query(`
      SELECT ${SELECT_BLOQUE}
      FROM nucleo.bloque_terminal bt
      WHERE bt.id = TRY_CONVERT(BIGINT, @bloque_id)
        AND bt.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND bt.activo = 1;
    `);

  const row = bloqueResult.recordset[0];
  if (!row) return null;

  const terminalesResult = await pool
    .request()
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .input('bloque_id', sql.NVarChar(30), bloqueId)
    .query(`
      SELECT t.id, t.proyecto_id, t.bloque_terminal_id, t.numero, t.catalogo_modulo_io_terminal_id, t.activo
      FROM nucleo.terminal t
      WHERE t.bloque_terminal_id = TRY_CONVERT(BIGINT, @bloque_id)
        AND t.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)
        AND t.activo = 1
      ORDER BY t.numero;
    `);

  const terminales = [];
  for (const t of terminalesResult.recordset) {
    const posicionesResult = await pool
      .request()
      .input('terminal_id', sql.NVarChar(30), String(t.id))
      .query(`
        SELECT pt.id, pt.proyecto_id, pt.terminal_id, pt.codigo, pt.activo,
               CASE WHEN te.id IS NOT NULL THEN 1 ELSE 0 END AS in_use
        FROM nucleo.posicion_terminal pt
        LEFT JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
        WHERE pt.terminal_id = TRY_CONVERT(BIGINT, @terminal_id) AND pt.activo = 1
        ORDER BY pt.codigo;
      `);
    terminales.push({ ...serializeTerminal(t), posiciones: posicionesResult.recordset.map(serializePosicion) });
  }

  return { ...serializeBloque(row), terminales };
}


/*
 * GET /api/projects/:projectId/bloques-terminal?cajaId=&gabineteId=&moduloId=
 */
bloquesTerminalRouter.get(
  '/',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const { cajaId, gabineteId, moduloId } = req.query;

      const pool = await getDbPool();
      const request = pool.request().input('proyecto_id', sql.NVarChar(30), projectId);
      const conditions = ['bt.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id)', 'bt.activo = 1'];

      for (const [param, col, value] of [
        ['caja_id', 'caja_id', cajaId],
        ['gabinete_id', 'gabinete_id', gabineteId],
        ['modulo_id', 'modulo_id', moduloId]
      ] as const) {
        if (value !== undefined) {
          if (!isPositiveIntString(value)) {
            res.status(400).json({ error: 'validation_error', message: `${param} filter must be a positive integer.` });
            return;
          }
          request.input(param, sql.NVarChar(30), value);
          conditions.push(`bt.${col} = TRY_CONVERT(BIGINT, @${param})`);
        }
      }

      const result = await request.query(`
        SELECT ${SELECT_BLOQUE}
        FROM nucleo.bloque_terminal bt
        WHERE ${conditions.join(' AND ')}
        ORDER BY bt.codigo;
      `);

      res.status(200).json({ projectId, bloquesTerminal: result.recordset.map(serializeBloque) });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * GET /api/projects/:projectId/bloques-terminal/:bloqueId
 */
bloquesTerminalRouter.get(
  '/:bloqueId',
  requireProjectPermission('read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const bloqueId = normalizeParam(req.params.bloqueId);
      if (!isPositiveIntString(bloqueId)) {
        res.status(400).json({ error: 'invalid_bloque_id', message: 'bloqueId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const detail = await fetchBloqueDetail(pool, projectId, bloqueId);
      if (!detail) {
        res.status(404).json({ error: 'bloque_terminal_not_found', message: 'Bloque de terminales does not exist in this project or is inactive.' });
        return;
      }

      res.status(200).json({ bloqueTerminal: detail });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/bloques-terminal
 *
 * Solo cajaId XOR gabineteId — moduloId se rechaza explícitamente (los
 * bloques de módulo se materializan solos, ver cabecera).
 */
bloquesTerminalRouter.post(
  '/',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const { cajaId = null, gabineteId = null, moduloId = null, codigo, descripcion = null } = req.body ?? {};

      if (moduloId !== null && moduloId !== undefined) {
        res.status(400).json({ error: 'validation_error', message: 'Un bloque de terminales de módulo se materializa automáticamente; no se crea manualmente.' });
        return;
      }

      const owners = [cajaId, gabineteId].filter((v) => v !== null && v !== undefined);
      if (owners.length !== 1) {
        res.status(400).json({ error: 'validation_error', message: 'Debe indicarse exactamente uno de cajaId o gabineteId.' });
        return;
      }
      if (typeof codigo !== 'string' || codigo.trim().length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'codigo is required.' });
        return;
      }
      if (codigo.length > 20) {
        res.status(400).json({ error: 'validation_error', message: 'codigo cannot exceed 20 characters.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('caja_id', sql.NVarChar(30), cajaId)
        .input('gabinete_id', sql.NVarChar(30), gabineteId)
        .input('codigo', sql.NVarChar(20), codigo.trim())
        .input('descripcion', sql.NVarChar(200), descripcion)
        .query(`
          INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, gabinete_id, codigo, descripcion, activo, created_at, created_by)
          OUTPUT INSERTED.id
          VALUES (
            TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @caja_id), TRY_CONVERT(BIGINT, @gabinete_id),
            @codigo, @descripcion, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by)
          );
        `);

      const newId = String(insertResult.recordset[0].id);
      const detail = await fetchBloqueDetail(pool, projectId, newId);

      res
        .status(201)
        .location(`/api/projects/${projectId}/bloques-terminal/${newId}`)
        .json({ bloqueTerminal: detail });

    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * PATCH /api/projects/:projectId/bloques-terminal/:bloqueId
 */
bloquesTerminalRouter.patch(
  '/:bloqueId',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const bloqueId = normalizeParam(req.params.bloqueId);
      if (!isPositiveIntString(bloqueId)) {
        res.status(400).json({ error: 'invalid_bloque_id', message: 'bloqueId must be a positive integer.' });
        return;
      }

      const { codigo, descripcion } = req.body ?? {};
      const assignments: string[] = [];
      const pool = await getDbPool();
      const request = pool.request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('bloque_id', sql.NVarChar(30), bloqueId)
        .input('updated_by', sql.NVarChar(30), userId);

      if (codigo !== undefined) {
        if (typeof codigo !== 'string' || codigo.trim().length === 0 || codigo.length > 20) {
          res.status(400).json({ error: 'validation_error', message: 'codigo must be a non-empty string of at most 20 characters.' });
          return;
        }
        request.input('codigo', sql.NVarChar(20), codigo.trim());
        assignments.push('codigo = @codigo');
      }
      if (descripcion !== undefined) {
        if (descripcion !== null && typeof descripcion !== 'string') {
          res.status(400).json({ error: 'validation_error', message: 'descripcion must be a string or null.' });
          return;
        }
        request.input('descripcion', sql.NVarChar(200), descripcion);
        assignments.push('descripcion = @descripcion');
      }
      if (assignments.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'No editable fields were provided.' });
        return;
      }

      await request.query(`
        IF NOT EXISTS (SELECT 1 FROM nucleo.bloque_terminal WHERE id = TRY_CONVERT(BIGINT, @bloque_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1)
        BEGIN
          THROW 54801, 'El bloque de terminales no existe en este proyecto o está inactivo.', 1;
        END;

        UPDATE nucleo.bloque_terminal
        SET ${assignments.join(', ')}, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        WHERE id = TRY_CONVERT(BIGINT, @bloque_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);

      const detail = await fetchBloqueDetail(pool, projectId, bloqueId);
      res.status(200).json({ bloqueTerminal: detail });

    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 54801) {
        res.status(404).json({ error: 'bloque_terminal_not_found', message: 'Bloque de terminales does not exist in this project or is inactive.' });
        return;
      }
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/bloques-terminal/:bloqueId
 *
 * Desactivación lógica. TR_bloque_terminal_validar_desactivacion
 * rechaza (51031) si algún terminal del bloque tiene una posición ocupada.
 */
bloquesTerminalRouter.delete(
  '/:bloqueId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const bloqueId = normalizeParam(req.params.bloqueId);
      if (!isPositiveIntString(bloqueId)) {
        res.status(400).json({ error: 'invalid_bloque_id', message: 'bloqueId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('bloque_id', sql.NVarChar(30), bloqueId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          -- TR_bloque_terminal_validar_desactivacion es AFTER UPDATE:
          -- OUTPUT sin INTO en esa tabla es el error 334 de SQL Server.
          DECLARE @desactivados TABLE (id BIGINT, codigo NVARCHAR(20), activo BIT);

          UPDATE nucleo.bloque_terminal
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.codigo, INSERTED.activo
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @bloque_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'bloque_terminal_not_found', message: 'Bloque de terminales does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ bloqueTerminal: { id: String(row.id), codigo: row.codigo, active: Boolean(row.activo) } });

    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/bloques-terminal/:bloqueId/terminales
 *
 * Solo para bloques manuales (caja/gabinete) — un bloque de módulo
 * rechaza la creación manual (sus terminales vienen de catálogo).
 */
bloquesTerminalRouter.post(
  '/:bloqueId/terminales',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const bloqueId = normalizeParam(req.params.bloqueId);
      const { numero } = req.body ?? {};

      if (!isPositiveIntString(bloqueId)) {
        res.status(400).json({ error: 'invalid_bloque_id', message: 'bloqueId must be a positive integer.' });
        return;
      }
      if (typeof numero !== 'string' || numero.trim().length === 0 || numero.length > 20) {
        res.status(400).json({ error: 'validation_error', message: 'numero is required and must be at most 20 characters.' });
        return;
      }

      const pool = await getDbPool();

      const bloqueResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('bloque_id', sql.NVarChar(30), bloqueId)
        .query(`SELECT modulo_id FROM nucleo.bloque_terminal WHERE id = TRY_CONVERT(BIGINT, @bloque_id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;`);

      const bloque = bloqueResult.recordset[0];
      if (!bloque) {
        res.status(404).json({ error: 'bloque_terminal_not_found', message: 'Bloque de terminales does not exist in this project or is inactive.' });
        return;
      }
      if (bloque.modulo_id !== null) {
        res.status(409).json({ error: 'bloque_terminal_es_de_modulo', message: 'Los terminales de un bloque de módulo se materializan desde catálogo; no se crean manualmente.' });
        return;
      }

      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('bloque_id', sql.NVarChar(30), bloqueId)
        .input('numero', sql.NVarChar(20), numero.trim())
        .query(`
          -- nucleo.terminal tiene TR_terminal_validar_catalogo_modulo
          -- (AFTER INSERT, UPDATE): OUTPUT sin INTO es el error 334.
          DECLARE @nuevos TABLE (id BIGINT, proyecto_id BIGINT, bloque_terminal_id BIGINT, numero NVARCHAR(20), catalogo_modulo_io_terminal_id BIGINT, activo BIT);

          INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.bloque_terminal_id, INSERTED.numero, INSERTED.catalogo_modulo_io_terminal_id, INSERTED.activo
          INTO @nuevos
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @bloque_id), @numero, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));

          SELECT * FROM @nuevos;
        `);

      res
        .status(201)
        .json({ terminal: serializeTerminal(insertResult.recordset[0]) });

    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/bloques-terminal/:bloqueId/terminales/:terminalId
 */
bloquesTerminalRouter.delete(
  '/:bloqueId/terminales/:terminalId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const bloqueId = normalizeParam(req.params.bloqueId);
      const terminalId = normalizeParam(req.params.terminalId);
      if (!isPositiveIntString(bloqueId)) {
        res.status(400).json({ error: 'invalid_bloque_id', message: 'bloqueId must be a positive integer.' });
        return;
      }
      if (!isPositiveIntString(terminalId)) {
        res.status(400).json({ error: 'invalid_terminal_id', message: 'terminalId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('bloque_id', sql.NVarChar(30), bloqueId)
        .input('terminal_id', sql.NVarChar(30), terminalId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivados TABLE (id BIGINT, numero NVARCHAR(20), activo BIT);

          -- bloque_terminal_id se valida explícitamente además de
          -- proyecto_id: el path anidado (.../bloques-terminal/:bloqueId/
          -- terminales/:terminalId) debe operar solo sobre un terminal
          -- que realmente pertenezca a ese bloque, no cualquiera del
          -- mismo proyecto.
          UPDATE nucleo.terminal
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.numero, INSERTED.activo
          INTO @desactivados
          WHERE id = TRY_CONVERT(BIGINT, @terminal_id)
            AND bloque_terminal_id = TRY_CONVERT(BIGINT, @bloque_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;

          SELECT * FROM @desactivados;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'terminal_not_found', message: 'Terminal does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ terminal: { id: String(row.id), numero: row.numero, active: Boolean(row.activo) } });

    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * POST /api/projects/:projectId/bloques-terminal/:bloqueId/terminales/:terminalId/posiciones
 *
 * codigo es libre (NO se asume A/B universalmente).
 */
bloquesTerminalRouter.post(
  '/:bloqueId/terminales/:terminalId/posiciones',
  requireProjectPermission('write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const bloqueId = normalizeParam(req.params.bloqueId);
      const terminalId = normalizeParam(req.params.terminalId);
      const { codigo } = req.body ?? {};

      if (!isPositiveIntString(bloqueId)) {
        res.status(400).json({ error: 'invalid_bloque_id', message: 'bloqueId must be a positive integer.' });
        return;
      }
      if (!isPositiveIntString(terminalId)) {
        res.status(400).json({ error: 'invalid_terminal_id', message: 'terminalId must be a positive integer.' });
        return;
      }
      if (typeof codigo !== 'string' || codigo.trim().length === 0 || codigo.length > 10) {
        res.status(400).json({ error: 'validation_error', message: 'codigo is required and must be at most 10 characters.' });
        return;
      }

      const pool = await getDbPool();
      const insertResult = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('created_by', sql.NVarChar(30), userId)
        .input('bloque_id', sql.NVarChar(30), bloqueId)
        .input('terminal_id', sql.NVarChar(30), terminalId)
        .input('codigo', sql.NVarChar(10), codigo.trim())
        .query(`
          -- bloque_terminal_id se valida ademas del proyecto: el path
          -- anidado debe operar solo sobre un terminal que realmente
          -- pertenezca a ese bloque.
          IF NOT EXISTS (
            SELECT 1 FROM nucleo.terminal
            WHERE id = TRY_CONVERT(BIGINT, @terminal_id)
              AND bloque_terminal_id = TRY_CONVERT(BIGINT, @bloque_id)
              AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1
          )
          BEGIN
            THROW 54802, 'El terminal no existe en este proyecto/bloque o está inactivo.', 1;
          END;

          INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo, activo, created_at, created_by)
          OUTPUT INSERTED.id, INSERTED.proyecto_id, INSERTED.terminal_id, INSERTED.codigo, INSERTED.activo,
                 CAST(0 AS BIT) AS in_use
          VALUES (TRY_CONVERT(BIGINT, @proyecto_id), TRY_CONVERT(BIGINT, @terminal_id), @codigo, 1, SYSUTCDATETIME(), TRY_CONVERT(BIGINT, @created_by));
        `);

      res.status(201).json({ posicionTerminal: serializePosicion(insertResult.recordset[0]) });

    } catch (error) {
      const number = sqlErrorNumber(error);
      if (number === 54802) {
        res.status(404).json({ error: 'terminal_not_found', message: 'Terminal does not exist in this project or is inactive.' });
        return;
      }
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);


/*
 * DELETE /api/projects/:projectId/bloques-terminal/:bloqueId/terminales/:terminalId/posiciones/:posicionId
 */
bloquesTerminalRouter.delete(
  '/:bloqueId/terminales/:terminalId/posiciones/:posicionId',
  requireProjectPermission('deactivate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.projectAccess!.projectId;
      const userId = req.authUser!.id;
      const terminalId = normalizeParam(req.params.terminalId);
      const posicionId = normalizeParam(req.params.posicionId);
      if (!isPositiveIntString(terminalId)) {
        res.status(400).json({ error: 'invalid_terminal_id', message: 'terminalId must be a positive integer.' });
        return;
      }
      if (!isPositiveIntString(posicionId)) {
        res.status(400).json({ error: 'invalid_posicion_id', message: 'posicionId must be a positive integer.' });
        return;
      }

      const pool = await getDbPool();
      const result = await pool
        .request()
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('terminal_id', sql.NVarChar(30), terminalId)
        .input('posicion_id', sql.NVarChar(30), posicionId)
        .input('updated_by', sql.NVarChar(30), userId)
        .query(`
          DECLARE @desactivadas TABLE (id BIGINT, codigo NVARCHAR(10), activo BIT);

          -- terminal_id se valida ademas del proyecto: el path anidado
          -- debe operar solo sobre una posicion que realmente pertenezca
          -- a ese terminal.
          UPDATE nucleo.posicion_terminal
          SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          OUTPUT INSERTED.id, INSERTED.codigo, INSERTED.activo
          INTO @desactivadas
          WHERE id = TRY_CONVERT(BIGINT, @posicion_id)
            AND terminal_id = TRY_CONVERT(BIGINT, @terminal_id)
            AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;

          SELECT * FROM @desactivadas;
        `);

      const row = result.recordset[0];
      if (!row) {
        res.status(404).json({ error: 'posicion_not_found', message: 'Posición de terminal does not exist in this project or is already inactive.' });
        return;
      }

      res.status(200).json({ posicionTerminal: { id: String(row.id), codigo: row.codigo, active: Boolean(row.activo) } });

    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  }
);
