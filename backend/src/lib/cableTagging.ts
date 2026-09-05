/*
 * Tageado automático de cables — pedido explícito del usuario, confirmado
 * campo por campo mientras pulíamos el export de SENALES_CONTROL:
 *
 *   TAG_CABLE = "{tag del destino sin guiones}-{T|X}{correlativo 01,02,...}"
 *
 * "Destino", por prioridad (mayor a menor):
 *   1. INSTRUMENTO — resuelto hasta su PADRE (instrumento_asociado_id),
 *      nunca el hijo directo (ej. un cable a 620-HYO-5084/620-HS-5084/etc.
 *      se tagea con el padre 620-HV-5084 — mismo criterio que tag_senal).
 *   2. EQUIPO (si ningún extremo es instrumento).
 *   3. CAJA (si ningún extremo es instrumento ni equipo).
 *   GABINETE/MODULO nunca son "destino" de tageado.
 *   Empate de prioridad (ej. equipo<->equipo, caso panel eléctrico) ->
 *   gana el DESTINO del tramo (punto_destino), no el origen — confirmado
 *   con datos reales (620-PPS-5005 (origen) -> 620-AFM-5005 (destino) se
 *   tagea con AFM, no con PPS).
 *
 *   Letra: T = señal discreta (DI/DO), X = analógica/resistencia
 *   (AI/AO/RTD). COM queda SIN letra definida todavía (el usuario no la
 *   confirmó) — un cable que solo transporta señales COM nunca se
 *   renombra acá.
 *
 * Confirmado explícitamente por el usuario que el renombrado/renumerado
 * automático es seguro MIENTRAS EL PROYECTO ESTÉ EN INGENIERÍA (cables
 * todavía no instalados/etiquetados en campo — "ahora estamos en
 * ingeniería, quiere decir que si podemos renombrarlo por ahora, luego
 * ya no se va a poder"). SIEI no tiene todavía un concepto de "fase de
 * proyecto" para detectar sola la transición a construcción — cuando eso
 * pase, quien lo sepa debe desactivar estas dos funciones a mano (o
 * dejar de llamarlas desde las rutas que las invocan).
 */

import sql from 'mssql';

export interface CandidatoDestino {
  prioridad: 1 | 2 | 3;
  tag: string;
}

type Ejecutable = sql.ConnectionPool | sql.Transaction;

/** Sube por instrumento_asociado_id hasta el padre real (el que tiene
 * instrumento_asociado_id NULL) — nunca usa el tag del hijo directo. */
async function resolverTagPadreInstrumento(
  db: Ejecutable,
  projectId: string,
  instrumentoId: string
): Promise<string | null> {
  let actualId = instrumentoId;
  let actualTag: string | null = null;
  const visitados = new Set<string>();

  for (let i = 0; i < 10; i++) {
    if (visitados.has(actualId)) break; // salvaguarda ante un ciclo mal cargado
    visitados.add(actualId);

    const r = await db.request()
      .input('id', sql.NVarChar(30), actualId)
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .query(`
        SELECT tag_instrumento, instrumento_asociado_id
        FROM nucleo.instrumento
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;
      `);
    const row = r.recordset[0];
    if (!row) break;
    actualTag = row.tag_instrumento;
    if (!row.instrumento_asociado_id) break;
    actualId = String(row.instrumento_asociado_id);
  }
  return actualTag;
}

/** Resuelve el candidato a "destino" de UN extremo (instrumento_id /
 * equipo_id / caja_id / gabinete_id / modulo_id ya viven en punto_conexion,
 * mutuamente excluyentes por CK_punto_conexion_pertenencia_xor). */
export async function resolverCandidatoPunto(
  db: Ejecutable,
  projectId: string,
  puntoConexionId: string
): Promise<CandidatoDestino | null> {
  const r = await db.request()
    .input('id', sql.NVarChar(30), puntoConexionId)
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .query(`
      SELECT p.instrumento_id, p.equipo_id, p.caja_id,
             eq.tag_equipo, cj.tag_caja
      FROM nucleo.punto_conexion p
      LEFT JOIN nucleo.equipo eq ON eq.id = p.equipo_id
      LEFT JOIN nucleo.caja cj ON cj.id = p.caja_id
      WHERE p.id = TRY_CONVERT(BIGINT, @id) AND p.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
    `);
  const row = r.recordset[0];
  if (!row) return null;

  if (row.instrumento_id) {
    const tagPadre = await resolverTagPadreInstrumento(db, projectId, String(row.instrumento_id));
    if (tagPadre) return { prioridad: 1, tag: tagPadre };
  }
  if (row.equipo_id && row.tag_equipo) return { prioridad: 2, tag: row.tag_equipo };
  if (row.caja_id && row.tag_caja) return { prioridad: 3, tag: row.tag_caja };
  return null; // gabinete o módulo puro — nunca es destino de tageado
}

/** Empate de prioridad -> gana el destino del tramo (pd); si no hay
 * empate, gana el de menor número de prioridad (instrumento > equipo >
 * caja). */
export function elegirDestino(cPo: CandidatoDestino | null, cPd: CandidatoDestino | null): CandidatoDestino | null {
  if (cPo && cPd) {
    if (cPo.prioridad === cPd.prioridad) return cPd;
    return cPo.prioridad < cPd.prioridad ? cPo : cPd;
  }
  return cPo ?? cPd;
}

/** T = discreta, X = analógica/resistencia. COM: null (sin letra
 * definida todavía, no se adivina). */
export function letraPorTipoIo(tiposIo: Iterable<string>): 'T' | 'X' | null {
  const set = new Set([...tiposIo].map((t) => t.toUpperCase()));
  if (set.has('DI') || set.has('DO')) return 'T';
  if (set.has('AI') || set.has('AO') || set.has('RTD')) return 'X';
  return null;
}

export function generarTagCable(destinoTag: string, letra: 'T' | 'X', correlativo: number): string {
  const prefijo = destinoTag.replace(/-/g, '').toUpperCase();
  return `${prefijo}-${letra}${String(correlativo).padStart(2, '0')}`;
}

interface TramoDeCable { puntoOrigenId: string; puntoDestinoId: string; tipoIoCodigo: string | null; claseSenalCodigo: string }

/** Todos los tramos activos que usa ALGÚN conductor activo de este cable
 * (normalmente todos comparten el mismo par origen/destino — es el mismo
 * objeto físico — pero se resuelve por tramo, no se asume). */
async function tramosDelCable(db: Ejecutable, projectId: string, cableId: string): Promise<TramoDeCable[]> {
  const r = await db.request()
    .input('cable_id', sql.NVarChar(30), cableId)
    .input('proyecto_id', sql.NVarChar(30), projectId)
    .query(`
      SELECT DISTINCT tc.punto_origen_id, tc.punto_destino_id, tio.codigo AS tipo_io_codigo, cs.codigo AS clase_senal_codigo
      FROM nucleo.conductor cond
      JOIN nucleo.tramo_conductor td ON td.conductor_id = cond.id AND td.activo = 1
      JOIN nucleo.tramo_conexion tc ON tc.id = td.tramo_conexion_id AND tc.activo = 1
      JOIN nucleo.ruta_conexion rc ON rc.id = tc.ruta_conexion_id
      JOIN nucleo.senal s ON s.id = rc.senal_id
      JOIN cat.cat_clase_senal cs ON cs.id = s.clase_senal_id
      LEFT JOIN cat.cat_tipo_io tio ON tio.id = s.tipo_io_id
      WHERE cond.cable_id = TRY_CONVERT(BIGINT, @cable_id) AND cond.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND cond.activo = 1;
    `);
  return r.recordset.map((row) => ({
    puntoOrigenId: String(row.punto_origen_id),
    puntoDestinoId: String(row.punto_destino_id),
    tipoIoCodigo: row.tipo_io_codigo,
    claseSenalCodigo: row.clase_senal_codigo
  }));
}

const PATRON_TAG_CABLE = /^([A-Z0-9]+)-([TX])(\d{2,})$/;

/**
 * Recalcula el TAG_CABLE de UN cable según su topología real actual, y lo
 * actualiza si cambió — se llama después de crear/modificar un
 * tramo_conductor (cuando se sabe recién a qué señal/tipo_io queda
 * asociado el cable). Nunca renombra si:
 *   - el destino es ambiguo (más de un destino distinto entre sus tramos),
 *   - solo transporta señales COM (letra sin definir),
 *   - no se pudo resolver ningún destino (ambos extremos gabinete/módulo).
 * "Best effort": los errores se registran pero nunca revientan la
 * petición que disparó esto (la operación principal ya se hizo).
 */
export async function sincronizarTagCable(db: Ejecutable, projectId: string, cableId: string, updatedBy: string): Promise<void> {
  try {
    const tramos = await tramosDelCable(db, projectId, cableId);
    if (tramos.length === 0) return; // sin conductores activos, nada que resolver

    const destinos = new Set<string>();
    const tiposIo = new Set<string>();
    const clases = new Set<string>();
    for (const t of tramos) {
      const cPo = await resolverCandidatoPunto(db, projectId, t.puntoOrigenId);
      const cPd = await resolverCandidatoPunto(db, projectId, t.puntoDestinoId);
      const elegido = elegirDestino(cPo, cPd);
      if (elegido) destinos.add(elegido.tag);
      if (t.tipoIoCodigo) tiposIo.add(t.tipoIoCodigo);
      clases.add(t.claseSenalCodigo);
    }

    if (destinos.size !== 1) return; // sin destino claro, o ambiguo -> no se toca
    const soloCom = clases.size > 0 && [...clases].every((c) => c === 'COM');
    if (soloCom) return; // COM sin letra definida todavía

    const letra = letraPorTipoIo(tiposIo);
    if (!letra) return;

    const destino = [...destinos][0];

    const actual = await db.request()
      .input('id', sql.NVarChar(30), cableId)
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .query(`SELECT tag_cable FROM nucleo.cable WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;`);
    const tagActual: string | null = actual.recordset[0]?.tag_cable ?? null;
    if (tagActual === null) return; // cable inactivo, no tocar

    const prefijoDestino = destino.replace(/-/g, '').toUpperCase();
    const matchActual = tagActual.match(PATRON_TAG_CABLE);
    const yaEsDeEsteGrupo = matchActual !== null && matchActual[1] === prefijoDestino && matchActual[2] === letra;

    // Números ya usados por OTROS cables activos del mismo destino+letra.
    const hermanos = await db.request()
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .input('id', sql.NVarChar(30), cableId)
      .query(`SELECT id, tag_cable FROM nucleo.cable WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1 AND id <> TRY_CONVERT(BIGINT, @id);`);
    const numerosUsados = new Set<number>();
    for (const h of hermanos.recordset) {
      const m = String(h.tag_cable).match(PATRON_TAG_CABLE);
      if (m && m[1] === prefijoDestino && m[2] === letra) numerosUsados.add(Number(m[3]));
    }

    let correlativo: number;
    if (yaEsDeEsteGrupo && !numerosUsados.has(Number(matchActual![3]))) {
      correlativo = Number(matchActual![3]); // conserva su propio número si sigue libre
    } else {
      correlativo = 1;
      while (numerosUsados.has(correlativo)) correlativo++;
    }

    const tagNuevo = generarTagCable(destino, letra, correlativo);
    if (tagNuevo !== tagActual) {
      await db.request()
        .input('id', sql.NVarChar(30), cableId)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tag_cable', sql.NVarChar(50), tagNuevo)
        .input('updated_by', sql.NVarChar(30), updatedBy)
        .query(`
          UPDATE nucleo.cable
          SET tag_cable = @tag_cable, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);
      console.log(`[cableTagging] ${tagActual} -> ${tagNuevo}`);
    }
  } catch (error) {
    console.error('[cableTagging] sincronizarTagCable falló (no se interrumpe la petición principal):', error);
  }
}

/**
 * Si el cable se quedó sin ningún conductor en uso (0 tramo_conductor
 * activos en cualquiera de sus conductores), lo desactiva y RENUMERA a
 * sus hermanos del mismo destino+letra para cerrar el hueco — pedido
 * explícito del usuario: "si elimino todos los hilos que usa ese cable
 * ahí debería el que tiene mayor número reemplazarlo". Se agrupa por el
 * PROPIO tag del cable (ya no hay topología activa de la cual resolverlo
 * de nuevo una vez que quedó vacío).
 */
export async function desactivarYRecompactarSiVacio(db: Ejecutable, projectId: string, cableId: string, updatedBy: string): Promise<void> {
  try {
    const info = await db.request()
      .input('id', sql.NVarChar(30), cableId)
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .query(`
        SELECT c.tag_cable,
          (SELECT COUNT(*) FROM nucleo.conductor cd
           JOIN nucleo.tramo_conductor td ON td.conductor_id = cd.id AND td.activo = 1
           WHERE cd.cable_id = c.id AND cd.activo = 1) AS en_uso
        FROM nucleo.cable c
        WHERE c.id = TRY_CONVERT(BIGINT, @id) AND c.proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND c.activo = 1;
      `);
    const row = info.recordset[0];
    if (!row || Number(row.en_uso) > 0) return; // sigue en uso, o ya estaba inactivo

    const match = String(row.tag_cable).match(PATRON_TAG_CABLE);

    await db.request()
      .input('id', sql.NVarChar(30), cableId)
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .input('updated_by', sql.NVarChar(30), updatedBy)
      .query(`
        UPDATE nucleo.cable
        SET activo = 0, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
        WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
      `);
    console.log(`[cableTagging] ${row.tag_cable} desactivado (0 conductores en uso).`);

    if (!match) return; // no sigue el patrón, no hay grupo que recompactar
    const [, prefijo, letra] = match;

    const hermanos = await db.request()
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .query(`SELECT id, tag_cable FROM nucleo.cable WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1;`);

    const grupo = hermanos.recordset
      .map((h: any) => ({ id: String(h.id), tag: String(h.tag_cable), match: String(h.tag_cable).match(PATRON_TAG_CABLE) }))
      .filter((h: any) => h.match && h.match[1] === prefijo && h.match[2] === letra)
      .sort((a: any, b: any) => Number(a.match![3]) - Number(b.match![3]));

    for (let i = 0; i < grupo.length; i++) {
      const correlativo = i + 1;
      const tagNuevo = generarTagCable(prefijo, letra as 'T' | 'X', correlativo);
      if (tagNuevo !== grupo[i].tag) {
        await db.request()
          .input('id', sql.NVarChar(30), grupo[i].id)
          .input('proyecto_id', sql.NVarChar(30), projectId)
          .input('tag_cable', sql.NVarChar(50), tagNuevo)
          .input('updated_by', sql.NVarChar(30), updatedBy)
          .query(`
            UPDATE nucleo.cable
            SET tag_cable = @tag_cable, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
            WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
          `);
        console.log(`[cableTagging] recompactado: ${grupo[i].tag} -> ${tagNuevo}`);
      }
    }
  } catch (error) {
    console.error('[cableTagging] desactivarYRecompactarSiVacio falló (no se interrumpe la petición principal):', error);
  }
}

/**
 * Tercera forma de automatización, pedido explícito del usuario: además
 * de auto-generar el tag al crear/editar conexiones (sincronizarTagCable)
 * y recompactar al vaciarse (desactivarYRecompactarSiVacio), el usuario
 * puede editar un TAG_CABLE a mano (PATCH /cables/:id) — cuando lo hace,
 * "de ahí para abajo" el resto del grupo (mismo destino+letra) se
 * reacomoda solo, para nunca terminar con dos cables con el mismo tag ni
 * huecos.
 *
 * OJO: se llama ANTES de guardar la edición manual, no después —
 * PATCH /cables/:id ya rechaza de entrada (THROW 55101) un tag que
 * colisiona con uno activo existente, así que si el reacomodo corriera
 * después de intentar guardar, la petición nunca llegaría a esta
 * función. Acá se le "hace lugar" al tag que el usuario está por poner
 * ANTES de que el propio PATCH intente guardarlo — nunca hay dos cables
 * con el mismo tag ni siquiera transitoriamente.
 *
 * El cable editado (todavía no actualizado en este punto, `cableIdEditado`
 * solo se usa para EXCLUIRLO de la búsqueda de hermanos) va a CONSERVAR
 * el número que el usuario eligió a mano — a los demás hermanos del
 * grupo se les reasignan los números que quedan libres, respetando su
 * orden relativo anterior.
 */
export async function hacerEspacioParaTagManual(db: Ejecutable, projectId: string, cableIdEditado: string, tagPropuesto: string, updatedBy: string): Promise<void> {
  try {
    const match = tagPropuesto.match(PATRON_TAG_CABLE);
    if (!match) return; // el usuario le puso algo que no sigue el patrón -> se respeta tal cual, sin recompactar nada
    const [, prefijo, letra, numStr] = match;
    const numeroElegido = Number(numStr);

    const hermanos = await db.request()
      .input('proyecto_id', sql.NVarChar(30), projectId)
      .input('id', sql.NVarChar(30), cableIdEditado)
      .query(`SELECT id, tag_cable FROM nucleo.cable WHERE proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id) AND activo = 1 AND id <> TRY_CONVERT(BIGINT, @id);`);

    const grupo = hermanos.recordset
      .map((h: any) => ({ id: String(h.id), tag: String(h.tag_cable), match: String(h.tag_cable).match(PATRON_TAG_CABLE) }))
      .filter((h: any) => h.match && h.match[1] === prefijo && h.match[2] === letra)
      .sort((a: any, b: any) => Number(a.match![3]) - Number(b.match![3])); // orden relativo anterior

    if (grupo.length === 0) return; // el editado es el único del grupo, nada que reacomodar

    // Fase 1 (solo cálculo, sin tocar la base): reparte los números
    // libres (1,2,3... salteando `numeroElegido`, que queda reservado
    // para el cable editado) entre los hermanos, en su mismo orden
    // relativo de antes.
    const asignaciones: Array<{ id: string; tagViejo: string; tagNuevo: string; numeroNuevo: number }> = [];
    let siguiente = 1;
    for (const hermano of grupo) {
      if (siguiente === numeroElegido) siguiente++; // ese número es del editado, saltarlo
      const tagNuevo = generarTagCable(prefijo, letra as 'T' | 'X', siguiente);
      asignaciones.push({ id: hermano.id, tagViejo: hermano.tag, tagNuevo, numeroNuevo: siguiente });
      siguiente++;
    }

    // Fase 2 (escritura): SIEMPRE de mayor a menor número nuevo. Al
    // insertar, los hermanos se corren hacia arriba — si se escribiera en
    // el orden original (ascendente), un hermano podría intentar tomar el
    // número que otro hermano TODAVÍA no liberó (colisión transitoria con
    // el índice único de tag_cable). De mayor a menor, cuando le toca a
    // un hermano, el que ocupaba su número nuevo ya se corrió antes.
    const porEscribir = asignaciones
      .filter((a) => a.tagNuevo !== a.tagViejo)
      .sort((a, b) => b.numeroNuevo - a.numeroNuevo);

    for (const a of porEscribir) {
      await db.request()
        .input('id', sql.NVarChar(30), a.id)
        .input('proyecto_id', sql.NVarChar(30), projectId)
        .input('tag_cable', sql.NVarChar(50), a.tagNuevo)
        .input('updated_by', sql.NVarChar(30), updatedBy)
        .query(`
          UPDATE nucleo.cable
          SET tag_cable = @tag_cable, updated_at = SYSUTCDATETIME(), updated_by = TRY_CONVERT(BIGINT, @updated_by)
          WHERE id = TRY_CONVERT(BIGINT, @id) AND proyecto_id = TRY_CONVERT(BIGINT, @proyecto_id);
        `);
      console.log(`[cableTagging] reacomodado para hacer lugar a edición manual: ${a.tagViejo} -> ${a.tagNuevo}`);
    }
  } catch (error) {
    console.error('[cableTagging] hacerEspacioParaTagManual falló (no se interrumpe la petición principal):', error);
  }
}
