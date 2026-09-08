import { DIFFABLE_FIELDS, normalizeHeader, type PnidField } from './headers.js';
import type { ParsedRow } from './parseExcel.js';

/**
 * "Description" (inglés, columna reconocida pero deliberadamente NO
 * sincronizada — ver KNOWN_UNSYNCED_HEADERS en headers.ts) es, en la
 * práctica, la única forma de distinguir una fila que representa un
 * INSTRUMENTO real de una fila que en realidad es la representación de
 * una SEÑAL de un instrumento que ya existe (hallazgo real: 286 filas del
 * reporte 620 con Description="PRIMARY ACCESSIBLE DCS"/"PRIMARY
 * INACCESSIBLE DCS", Tag tipo "S620-PI-5053", Instrumento Asociado
 * apuntando siempre a un instrumento real ya existente).
 *
 * Decisión explícita del usuario: estas filas NUNCA deben crear ni
 * actualizar un nucleo.instrumento — son señales, no instrumentos, y las
 * procesa (hoy, manualmente; a futuro, un motor de señales aparte) otro
 * flujo, no este. Se leen de `datosFuente` (nunca de `fields`, porque
 * Description sigue sin ser un campo sincronizado) buscando por header
 * normalizado, no por texto exacto — mismo criterio de robustez que el
 * resto del importador.
 */
const DESCRIPTIONS_DE_SENAL = new Set(['PRIMARY ACCESSIBLE DCS', 'PRIMARY INACCESSIBLE DCS']);
const DESCRIPTION_HEADER_NORMALIZADO = normalizeHeader('Description');

function obtenerDescriptionCruda(row: ParsedRow): string | null {
  for (const [header, value] of Object.entries(row.datosFuente)) {
    if (normalizeHeader(header) !== DESCRIPTION_HEADER_NORMALIZADO) continue;
    return typeof value === 'string' ? value.trim() : null;
  }
  return null;
}

function esFilaDeSenal(row: ParsedRow): boolean {
  const desc = obtenerDescriptionCruda(row);
  return desc !== null && DESCRIPTIONS_DE_SENAL.has(desc.toUpperCase());
}

/** Señal ya vinculada a un reporte P&ID por su `codigo_senal` (= PnPID de
 * la fila ES_SENAL que la originó — ver migración 046). Un subconjunto de
 * nucleo.senal con exactamente los campos que este motor puede llegar a
 * leer o escribir: tagSenal/servicio (sincronizables, ver `SenalFieldDiff`
 * más abajo) y updatedAt (mismo chequeo de concurrencia que instrumentos,
 * vía `senalUpdatedAtPreview`). */
export interface SenalSnapshot {
  id: string;
  tagSenal: string | null;
  servicio: string | null;
  updatedAt: string | null;
}

/** Diff de un campo DE LA SEÑAL (no del instrumento — 'tagSenal'/'servicio'
 * no son PnidField). Solo estos dos campos se sincronizan por ahora: ver
 * comentario de cabecera de la migración 046 sobre por qué tipo_io_id
 * queda deliberadamente afuera. */
export interface SenalFieldDiff {
  campo: 'tagSenal' | 'servicio';
  anterior: string | null;
  nuevo: string | null;
}

/** Instrumento existente, tal como lo necesita el comparador — un
 * subconjunto de nucleo.instrumento con los campos que el import puede
 * llegar a leer o escribir. */
export interface InstrumentSnapshot {
  id: string;
  tagInstrumento: string;
  pnpid: string | null;
  fuentePnpid: string | null;
  updatedAt: string | null;
  descripcion: string | null;
  tipoInstrumento: string | null;
  servicio: string | null;
  sistema: string | null;
  ubicacion: string | null;
  nodo: string | null;
  tagAnterior: string | null;
  tecnologia: string | null;
  funcionamiento: string | null;
  cuerpoInstrumento: string | null;
  conexionProceso: string | null;
  planoPnid: string | null;
  lineaPnid: string | null;
  tipoSenalPnid: string | null;
  /** Migración 044 — dato de contenido, no de matching: refleja la
   * columna "Listado" del reporte tal cual, sin gatear si la fila se
   * procesa o no (eso cambió respecto al diseño original — ver el
   * comentario grande más abajo, en buildComparisonPlan). */
  listado: boolean;
  equipoAsociadoTag: string | null;
  instrumentoAsociadoTag: string | null;
  /** Señales CONTROL/COM activas que hoy lo tienen como dueño o como
   * instrumento agrupador — solo importa para advertir en NO_EXISTE_EN_PNID
   * (ver migración 016, nucleo.senal.dueno_ausente): si el usuario elimina
   * definitivamente este instrumento más adelante, esas señales quedarían
   * "sin dueño" (activas, pero sin instrumento). El PREVIEW nunca elimina
   * nada — es solo una advertencia informativa. */
  senalesActivas: number;
  /** Puntos de conexión, lazos y enlaces de comunicación que referencian
   * al instrumento — a diferencia de las señales, estos SÍ siguen
   * bloqueando la eliminación definitiva por completo (instruments.ts,
   * "Opción A" — sin cambio de esquema ahí). Se muestran igual en la
   * advertencia para que el usuario sepa, ANTES de intentar eliminar, que
   * ni siquiera va a poder hacerlo hasta resolver esto a mano. */
  puntosConexion: number;
  lazos: number;
  enlacesCom: number;
}

export interface FieldDiff {
  campo: PnidField;
  anterior: string | null;
  nuevo: string | null;
}

/** SQL Server's ISJSON() exige que el nivel superior sea un objeto o un
 * array — un string JSON "pelado" (ej. `"texto"`) no pasa el CHECK. Por
 * eso las explicaciones de texto libre (REQUIERE_REVISION/TAG_DUPLICADO)
 * siempre van envueltas en un objeto, nunca como string suelto. */
export interface DetalleTexto {
  detalle: string;
}

export interface ComparisonResultEntry {
  /** Índice dentro de rows[], o null para NO_EXISTE_EN_PNID sin fila fuente. */
  filaIndex: number | null;
  pnpid: string | null;
  tagInstrumento: string | null;
  instrumentoId: string | null;
  /** Valor de Listado que trae ESTA fila — null cuando no hay fila fuente
   * (NO_EXISTE_EN_PNID del barrido final): ahí no se escribe nada, el
   * instrumento conserva el listado que ya tenía. */
  listado: boolean | null;
  resultadoCodigo: string;
  /** Diffs estructurados para DATOS_MODIFICADOS/TAG_MODIFICADO, o un texto
   * explicativo simple para REQUIERE_REVISION/TAG_DUPLICADO. */
  diferencias: FieldDiff[] | SenalFieldDiff[] | DetalleTexto | null;
  requiereRevision: boolean;
  instrumentoUpdatedAtPreview: string | null;
  /** Solo poblado para resultadoCodigo = NO_EXISTE_EN_PNID cuando el
   * instrumento tiene AL MENOS UNO de estos cuatro recursos — advertencia
   * informativa (nunca elimina nada), null en cualquier otro caso.
   * senalesActivas: no bloquea la eliminación (queda dueno_ausente=1).
   * puntosConexion/lazos/enlacesCom: SÍ siguen bloqueando por completo. */
  recursosEnRiesgo: {
    senalesActivas: number;
    puntosConexion: number;
    lazos: number;
    enlacesCom: number;
  } | null;
  /** Solo poblado para resultadoCodigo = ES_SENAL (cuando el `codigo_senal`
   * de una señal existente coincide con el PnPID de esta fila) o
   * SENAL_SIN_MATCH_EN_REPORTE (barrido final, señal vinculada que ya no
   * aparece en el reporte) — ver migración 046. `cambios` viene vacío
   * cuando la señal vinculada no tiene ninguna diferencia con el reporte
   * (nada que aplicar, informativo nada más). Nunca poblado para ninguna
   * otra clasificación — ES_SENAL nunca toca nucleo.instrumento, y este
   * motor nunca toca nucleo.instrumento tampoco. */
  senalVinculada: {
    senalId: string;
    senalUpdatedAtPreview: string | null;
    cambios: SenalFieldDiff[];
  } | null;
}

export interface ComparisonPlanInput {
  rows: ParsedRow[];
  presentFields: Set<PnidField>;
  /** Instrumentos activos del proyecto, indexados por pnpid (cualquier
   * fuente_pnpid — la identidad P&ID es global al proyecto). */
  existingByPnpid: Map<string, InstrumentSnapshot>;
  /** Instrumentos activos del proyecto, indexados por tag_instrumento
   * (para detectar conflicto TAG nuevo <-> instrumento existente). */
  existingByTag: Map<string, InstrumentSnapshot>;
  /** Solo los administrados por esta fuente (fuente_pnpid = 'PLANT3D',
   * pnpid NOT NULL) — alcance de NO_EXISTE_EN_PNID (corrección C). */
  plant3dManagedByPnpid: Map<string, InstrumentSnapshot>;
  /** Señales activas del proyecto con `codigo_senal` poblado, indexadas por
   * ese código (= PnPID del reporte que las originó) — motor de
   * reimportación de señales, migración 046. Vacío en proyectos que nunca
   * corrieron la migración de datos de señales CONTROL 620; el motor
   * simplemente no encuentra match y ES_SENAL se comporta como antes
   * (puramente informativo). */
  existingSenalesByCodigo: Map<string, SenalSnapshot>;
}

function compareFields(
  existing: InstrumentSnapshot,
  row: ParsedRow,
  presentFields: Set<PnidField>
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const field of DIFFABLE_FIELDS) {
    if (!presentFields.has(field)) continue; // columna ausente en el archivo: no se compara

    const nuevo = row.fields[field] ?? null;
    const anterior = existing[field as keyof InstrumentSnapshot] as string | null;

    if ((anterior ?? null) !== (nuevo ?? null)) {
      diffs.push({ campo: field, anterior: anterior ?? null, nuevo });
    }
  }

  return diffs;
}

/** Igual que compareFields, pero además compara `listado` — que no vive en
 * `row.fields` (parseExcel.ts lo saca aparte, junto con pnpid/
 * tagInstrumento, porque dirige matching/identidad) ni en DIFFABLE_FIELDS
 * (mismo motivo). Un cambio de Listado solo, sin ningún otro campo
 * distinto, alcanza para clasificar la fila como DATOS_MODIFICADOS. */
function compareFieldsIncludingListado(
  existing: InstrumentSnapshot,
  row: ParsedRow,
  presentFields: Set<PnidField>
): FieldDiff[] {
  const diffs = compareFields(existing, row, presentFields);
  if (existing.listado !== row.listado) {
    diffs.push({ campo: 'listado', anterior: String(existing.listado), nuevo: String(row.listado) });
  }
  return diffs;
}

function makeEntry(
  filaIndex: number | null,
  row: ParsedRow | null,
  instrumento: InstrumentSnapshot | undefined,
  resultadoCodigo: string,
  diferencias: FieldDiff[] | SenalFieldDiff[] | DetalleTexto | null,
  requiereRevision: boolean,
  senalVinculada: ComparisonResultEntry['senalVinculada'] = null
): ComparisonResultEntry {
  return {
    filaIndex,
    pnpid: row?.pnpid ?? instrumento?.pnpid ?? null,
    tagInstrumento: row?.tagInstrumento ?? instrumento?.tagInstrumento ?? null,
    instrumentoId: instrumento?.id ?? null,
    listado: row?.listado ?? null,
    resultadoCodigo,
    diferencias,
    requiereRevision,
    instrumentoUpdatedAtPreview: instrumento ? (instrumento.updatedAt ?? null) : null,
    recursosEnRiesgo: (() => {
      if (resultadoCodigo !== 'NO_EXISTE_EN_PNID' || !instrumento) return null;
      const { senalesActivas, puntosConexion, lazos, enlacesCom } = instrumento;
      if (senalesActivas === 0 && puntosConexion === 0 && lazos === 0 && enlacesCom === 0) return null;
      return { senalesActivas, puntosConexion, lazos, enlacesCom };
    })(),
    senalVinculada
  };
}

/** Calcula, para una fila ES_SENAL cuyo `codigo_senal` ya coincide con una
 * señal existente, qué cambiaría en esa señal — motor de reimportación de
 * señales (migración 046). Solo tagSenal/servicio (ver comentario de
 * cabecera de esa migración sobre por qué tipoIoId queda afuera).
 * tagSenal solo se recalcula cuando el reporte trae "Type" para esta fila
 * (columna ausente/vacía => no se puede derivar el tag nuevo, no se
 * compara ni se propone cambio para ese campo puntual). */
function calcularCambiosSenal(senalExistente: SenalSnapshot, row: ParsedRow, instrumentoReal: InstrumentSnapshot): SenalFieldDiff[] {
  const cambios: SenalFieldDiff[] = [];

  const tipo = row.fields.tipoInstrumento ?? null;
  if (tipo) {
    const tagPropuesto = `${instrumentoReal.tagInstrumento}_${tipo}`;
    if ((senalExistente.tagSenal ?? null) !== tagPropuesto) {
      cambios.push({ campo: 'tagSenal', anterior: senalExistente.tagSenal ?? null, nuevo: tagPropuesto });
    }
  }

  const servicioPropuesto = row.fields.servicio ?? null;
  if ((senalExistente.servicio ?? null) !== servicioPropuesto) {
    cambios.push({ campo: 'servicio', anterior: senalExistente.servicio ?? null, nuevo: servicioPropuesto });
  }

  return cambios;
}

/**
 * Motor de comparación PREVIEW. No toca la base — solo calcula, por cada
 * fila del archivo, qué pasaría, más las filas "virtuales" de instrumentos
 * administrados por Plant3D que desaparecieron del reporte por completo.
 */
export function buildComparisonPlan(input: ComparisonPlanInput): ComparisonResultEntry[] {
  const { rows, presentFields, existingByPnpid, existingByTag, plant3dManagedByPnpid, existingSenalesByCodigo } = input;
  const results: ComparisonResultEntry[] = [];

  /** Códigos de señales ya vinculadas (existingSenalesByCodigo) vistos en
   * este archivo — el complemento, al final, son señales cuyo PnPID
   * desapareció por completo (SENAL_SIN_MATCH_EN_REPORTE). */
  const senalesVinculadasVistas = new Set<string>();

  const seenPnpidsInFile = new Set<string>();
  /** IDs de instrumentos ya resueltos por una fila del archivo — más
   * amplio que `seenPnpidsInFile`: un PNPID_ACTUALIZADO resuelve un
   * instrumento cuyo PnPID VIEJO (la clave real en `plant3dManagedByPnpid`
   * más abajo) nunca aparece en el archivo nuevo — sin este set, ese mismo
   * instrumento también caería en el barrido final de NO_EXISTE_EN_PNID,
   * generando dos resultados para el mismo instrumento (choca contra
   * UX_importacion_pnid_resultado_instrumento). */
  const resolvedInstrumentoIds = new Set<string>();
  const eligibleIndexes: number[] = [];

  /** TAG que este mismo archivo le asigna a cada PnPID — permite
   * reconocer una "cadena de renombres" (instrumento A reclama el TAG
   * que instrumento B tiene HOY, pero B también se está renombrando a
   * otra cosa en este mismo archivo, así que en realidad no hay
   * colisión real, solo dos renombres que hay que aplicar en el orden
   * correcto — ver el chequeo de `tagOwner` más abajo). */
  const newTagByPnpidInFile = new Map<string, string>();

  rows.forEach((row, idx) => {
    if (row.pnpid) seenPnpidsInFile.add(row.pnpid);
    // Una fila de señal (ver esFilaDeSenal) nunca crea/actualiza un
    // instrumento — no participa de la detección de TAG/PnPID duplicado
    // de ESTE motor (el de instrumentos). Se resuelve aparte, más abajo.
    if (esFilaDeSenal(row)) return;
    // Migración 044: Listado ya NO gatea si la fila participa — es un
    // dato de contenido más (ver comentario grande más abajo). Una fila
    // con Listado=False y tag+pnpid presentes compite en la detección de
    // TAG/PnPID duplicado exactamente igual que cualquier otra.
    if (row.tagInstrumento && row.pnpid) {
      eligibleIndexes.push(idx);
      newTagByPnpidInFile.set(row.pnpid, row.tagInstrumento);
    }
  });

  const pnpidToEligibleIdxs = new Map<string, number[]>();
  for (const idx of eligibleIndexes) {
    const pnpid = rows[idx].pnpid!;
    const list = pnpidToEligibleIdxs.get(pnpid) ?? [];
    list.push(idx);
    pnpidToEligibleIdxs.set(pnpid, list);
  }
  const duplicatedPnpids = new Set(
    [...pnpidToEligibleIdxs.entries()].filter(([, idxs]) => idxs.length > 1).map(([pnpid]) => pnpid)
  );

  /*
   * Una fila cuyo PnPID ya coincide con un instrumento existente ("sigue"
   * ese instrumento, sea con el mismo TAG o con uno modificado) NUNCA
   * participa de la detección de TAG_DUPLICADO — ese TAG es legítimamente
   * suyo. Si otra fila del archivo, con un PnPID que NO coincide con
   * ningún instrumento existente, reclama ese mismo TAG, el conflicto es
   * "PnPID nuevo usando un TAG ya asignado" (REQUIERE_REVISION vía
   * existingByTag más abajo, no TAG_DUPLICADO) — por eso se excluye acá.
   */
  const tagToEligiblePnpids = new Map<string, Set<string>>();
  for (const idx of eligibleIndexes) {
    if (duplicatedPnpids.has(rows[idx].pnpid!)) continue; // ya cubierto por el caso anterior
    if (existingByPnpid.has(rows[idx].pnpid!)) continue; // fila que continúa un instrumento existente
    const tag = rows[idx].tagInstrumento!;
    const set = tagToEligiblePnpids.get(tag) ?? new Set<string>();
    set.add(rows[idx].pnpid!);
    tagToEligiblePnpids.set(tag, set);
  }
  const duplicatedTags = new Set(
    [...tagToEligiblePnpids.entries()].filter(([, pnpids]) => pnpids.size > 1).map(([tag]) => tag)
  );

  /*
   * Decisión explícita del usuario (dos rondas de aclaración): "Listado"
   * es un dato de CONTENIDO del instrumento (como tecnología o servicio),
   * no un interruptor de "crear o no crear". Una fila con Listado=False
   * pasa por EXACTAMENTE el mismo camino que cualquier otra — se crea si
   * es nueva, se actualiza si ya existe, incluida la detección de TAG/
   * PnPID duplicado — la única diferencia es que el instrumento resultante
   * queda con listado=0. El Master y el LDI filtran por listado=1 para no
   * mostrarlo/imprimirlo, pero el dato vive completo en la base ("se
   * guarda todo, pero los no listados no se muestran").
   *
   * NO_EXISTE_EN_PNID conserva su significado original y ÚNICO: el
   * instrumento (fuente PLANT3D) desapareció del archivo POR COMPLETO —
   * ni siquiera aparece como fila con Listado=False. Ese es el único caso
   * que se marca como candidato a revisión/eliminación; un Listado=False
   * que SIGUE apareciendo en el archivo nunca cae ahí, solo se actualiza
   * como una fila más.
   */
  rows.forEach((row, idx) => {
    if (esFilaDeSenal(row)) {
      // Fila de señal, no de instrumento — decisión explícita del usuario.
      // Nunca crea ni actualiza nucleo.instrumento. Cuando el "Instrumento
      // Asociado" resuelve a un instrumento real ya existente, se informa
      // su tag/id como texto (útil para un futuro motor de señales) — pero
      // SIN pasarlo como `instrumento` a makeEntry: ese instrumento real
      // casi siempre tiene su PROPIA fila en el mismo archivo (su propio
      // OK/DATOS_MODIFICADOS) y puede tener varias filas de señal más
      // apuntándole (varios canales del mismo instrumento) — si esta fila
      // también reclamara su instrumento_id, dos o más resultados del
      // mismo import chocarían contra UX_importacion_pnid_resultado_
      // instrumento (única por (importacion_id, instrumento_id)). Si no
      // resuelve, se marca REQUIERE_REVISION en vez de dejarla flotando
      // sin explicación ni, mucho menos, crear un instrumento fantasma
      // para sostenerla.
      const asociadoTag = row.fields.instrumentoAsociadoTag ?? null;
      const instrumentoReal = asociadoTag ? existingByTag.get(asociadoTag) : undefined;
      if (instrumentoReal) {
        // Motor de reimportación de señales (migración 046): si el PnPID de
        // ESTA fila ya coincide con el codigo_senal de una señal existente
        // (vínculo persistente, independiente del dueño), se informan los
        // cambios detectados en tagSenal/servicio — sin tocar nunca
        // nucleo.instrumento, exactamente igual que antes.
        const senalExistente = row.pnpid ? existingSenalesByCodigo.get(row.pnpid) : undefined;
        let senalVinculada: ComparisonResultEntry['senalVinculada'] = null;
        // Por defecto (no vinculada, o vinculada sin cambios): texto
        // informativo nada más, no hay nada que APPLY deba escribir. Si HAY
        // cambios, `diferencias` pasa a ser el array estructurado
        // SenalFieldDiff[] — mismo criterio que DATOS_MODIFICADOS/
        // TAG_MODIFICADO para instrumentos: solo un array estructurado es
        // reconstruible en APPLY sin volver a leer el archivo.
        let diferencias: ComparisonResultEntry['diferencias'] = {
          detalle: `Señal del instrumento "${asociadoTag}" (id ${instrumentoReal.id}) — no crea ni actualiza ningún instrumento.`
        };

        if (senalExistente) {
          senalesVinculadasVistas.add(row.pnpid!);
          const cambios = calcularCambiosSenal(senalExistente, row, instrumentoReal);
          senalVinculada = { senalId: senalExistente.id, senalUpdatedAtPreview: senalExistente.updatedAt ?? null, cambios };
          diferencias =
            cambios.length > 0
              ? cambios
              : { detalle: `Señal del instrumento "${asociadoTag}" (id ${instrumentoReal.id}), vinculada a la señal ${senalExistente.id} — sin cambios.` };
        }

        results.push(makeEntry(idx, row, undefined, 'ES_SENAL', diferencias, false, senalVinculada));
      } else {
        results.push(
          makeEntry(
            idx,
            row,
            undefined,
            'REQUIERE_REVISION',
            { detalle: `Fila de señal cuyo "Instrumento Asociado" ("${asociadoTag ?? 'vacío'}") no existe como instrumento activo — no se crea ningún instrumento para sostenerla.` },
            true
          )
        );
      }
      return;
    }

    if (!row.tagInstrumento) {
      results.push(makeEntry(idx, row, undefined, 'TAG_VACIO', null, false));
      return;
    }

    if (!row.pnpid) {
      results.push(
        makeEntry(
          idx,
          row,
          undefined,
          'REQUIERE_REVISION',
          { detalle: 'PnPID vacío en una fila con Tag presente.' },
          true
        )
      );
      return;
    }

    if (duplicatedPnpids.has(row.pnpid)) {
      const otherRows = pnpidToEligibleIdxs
        .get(row.pnpid)!
        .map((i) => rows[i].numeroFila)
        .join(', ');
      results.push(
        makeEntry(
          idx,
          row,
          undefined,
          'REQUIERE_REVISION',
          { detalle: `PnPID duplicado dentro del mismo archivo (filas: ${otherRows}).` },
          true
        )
      );
      return;
    }

    if (duplicatedTags.has(row.tagInstrumento)) {
      results.push(
        makeEntry(
          idx,
          row,
          undefined,
          'TAG_DUPLICADO',
          { detalle: 'TAG repetido dentro del mismo archivo con distinto PnPID.' },
          true
        )
      );
      return;
    }

    const matchByPnpid = existingByPnpid.get(row.pnpid);

    if (!matchByPnpid) {
      const tagOwner = existingByTag.get(row.tagInstrumento);
      if (tagOwner) {
        /*
         * Mismo TAG que un instrumento ya administrado por Plant3D, pero
         * con un PnPID que no calza con NINGÚN instrumento existente — la
         * herramienta P&ID del usuario regenera el PnPID entre
         * exportaciones para el mismo objeto físico (confirmado con datos
         * reales: 67% de un reporte real caía acá). Se adopta el mismo
         * fallback que la macro VBA legacy del usuario
         * (Actualizar_Master_Desde_IMPORT: busca por PnPID, si no aparece
         * cae a TAG y re-ancla el PnPID sin pedir revisión) — a diferencia
         * de la macro, acá NUNCA se mezcla en silencio con OK: queda como
         * un resultado propio y auditable, PNPID_ACTUALIZADO, con el PnPID
         * viejo/nuevo explícito en `diferencias`.
         *
         * Solo aplica si el dueño del TAG ya es PLANT3D — si es un
         * instrumento manual (creado a mano, sin pnpid), un reporte P&ID
         * reclamándolo de golpe sigue siendo una decisión que un humano
         * debe confirmar, así que cae al REQUIERE_REVISION de siempre.
         *
         * EXCEPCIÓN — cadena de renombres (mismo criterio que
         * TAG_MODIFICADO más abajo): si el dueño actual del TAG TAMBIÉN
         * se está renombrando a otra cosa en este mismo archivo, esto NO
         * es el mismo objeto con el PnPID regenerado — es un objeto
         * NUEVO reutilizando un TAG que el dueño acaba de liberar. Cae
         * a NUEVO_EN_PNID en vez de PNPID_ACTUALIZADO o
         * REQUIERE_REVISION.
         *
         * Guard adicional: si OTRA fila de este mismo archivo ya reclamó a
         * este mismo instrumento (por PnPID directo o por este mismo
         * fallback — ej. el archivo trae tanto el PnPID viejo como el
         * nuevo del mismo objeto por error), no se genera un segundo
         * resultado para el mismo instrumento — eso violaría
         * UX_importacion_pnid_resultado_instrumento. Se marca
         * REQUIERE_REVISION en vez de reventar la importación entera.
         */
        const tagQueOwnerRecibeEnEsteArchivo = tagOwner.pnpid
          ? newTagByPnpidInFile.get(tagOwner.pnpid)
          : undefined;
        const ownerSeEstaRenombrando =
          tagOwner.fuentePnpid === 'PLANT3D' &&
          tagQueOwnerRecibeEnEsteArchivo !== undefined &&
          tagQueOwnerRecibeEnEsteArchivo !== tagOwner.tagInstrumento.trim();

        if (
          !ownerSeEstaRenombrando &&
          tagOwner.fuentePnpid === 'PLANT3D' &&
          !resolvedInstrumentoIds.has(tagOwner.id)
        ) {
          const contentDiffs = compareFieldsIncludingListado(tagOwner, row, presentFields);
          const diffs: FieldDiff[] = [
            { campo: 'pnpid', anterior: tagOwner.pnpid, nuevo: row.pnpid },
            ...contentDiffs
          ];
          results.push(makeEntry(idx, row, tagOwner, 'PNPID_ACTUALIZADO', diffs, false));
          resolvedInstrumentoIds.add(tagOwner.id);
          return;
        }

        if (ownerSeEstaRenombrando) {
          results.push(makeEntry(idx, row, undefined, 'NUEVO_EN_PNID', null, false));
          return;
        }

        results.push(
          makeEntry(
            idx,
            row,
            undefined,
            'REQUIERE_REVISION',
            {
              detalle: resolvedInstrumentoIds.has(tagOwner.id)
                ? `El TAG "${row.tagInstrumento}" (PnPID ${row.pnpid}) y otra fila de este mismo archivo ` +
                  `resuelven ambas al instrumento #${tagOwner.id}. No se aplica automáticamente.`
                : `El TAG "${row.tagInstrumento}" ya pertenece al instrumento #${tagOwner.id} ` +
                  `(PnPID ${tagOwner.pnpid ?? 'sin PnPID'}). No se aplica automáticamente.`
            },
            true
          )
        );
        return;
      }
      results.push(makeEntry(idx, row, undefined, 'NUEVO_EN_PNID', null, false));
      return;
    }

    if (resolvedInstrumentoIds.has(matchByPnpid.id)) {
      // Mismo caso de arriba, en la dirección opuesta: otra fila (por
      // fallback de TAG) ya reclamó este instrumento antes de que
      // llegáramos a su fila por PnPID directo.
      results.push(
        makeEntry(
          idx,
          row,
          undefined,
          'REQUIERE_REVISION',
          {
            detalle:
              `El PnPID "${row.pnpid}" y otra fila de este mismo archivo resuelven ambas al ` +
              `instrumento #${matchByPnpid.id}. No se aplica automáticamente.`
          },
          true
        )
      );
      return;
    }

    if (matchByPnpid.tagInstrumento.trim() !== row.tagInstrumento) {
      /*
       * El PnPID sigue calzando con `matchByPnpid`, pero el reporte le
       * puso un TAG nuevo — antes de aceptar el renombre hay que
       * verificar que ese TAG nuevo no sea YA de otro instrumento activo
       * distinto (encontrado con datos reales: un PnPID renombrado a un
       * TAG que otro instrumento, con su propio PnPID, ya tenía —
       * aplicar el UPDATE sin este chequeo revienta con un 500 crudo de
       * SQL Server, UX_instrumento_proyecto_tag, en vez de un resultado
       * manejado).
       *
       * PERO esto es una colisión REAL solo si el dueño actual del TAG
       * se queda quieto. El usuario retagea instrumentos en su
       * herramienta P&ID como flujo normal de trabajo ("cadena de
       * renombres": A reclama el TAG que B tiene hoy, pero B TAMBIÉN se
       * está renombrando a otra cosa en este mismo archivo — verificado
       * con datos reales, PnPID 2100 reclamando el TAG que PnPID 15520
       * dejaba libre en el mismo import). En ese caso no hay colisión
       * real, son dos TAG_MODIFICADO válidos — aplicarlos en el orden
       * correcto es responsabilidad de la fase de APPLY (ver
       * applyActualizarInstrumento, renombre a TAG temporal primero),
       * no de este comparador. Mismo criterio que PNPID_ACTUALIZADO más
       * arriba: solo se resuelve solo si el dueño actual es
       * PLANT3D — un instrumento manual sigue exigiendo revisión humana
       * aunque también aparezca en el archivo.
       */
      const tagOwner = existingByTag.get(row.tagInstrumento);
      if (tagOwner && tagOwner.id !== matchByPnpid.id) {
        const tagQueOwnerRecibeEnEsteArchivo = tagOwner.pnpid
          ? newTagByPnpidInFile.get(tagOwner.pnpid)
          : undefined;
        const ownerSeEstaRenombrando =
          tagOwner.fuentePnpid === 'PLANT3D' &&
          tagQueOwnerRecibeEnEsteArchivo !== undefined &&
          tagQueOwnerRecibeEnEsteArchivo !== tagOwner.tagInstrumento.trim();

        if (!ownerSeEstaRenombrando) {
          results.push(
            makeEntry(
              idx,
              row,
              matchByPnpid,
              'REQUIERE_REVISION',
              {
                detalle:
                  `El PnPID ${row.pnpid} sigue siendo del instrumento #${matchByPnpid.id} ` +
                  `(${matchByPnpid.tagInstrumento}), pero el reporte le asigna el TAG ` +
                  `"${row.tagInstrumento}", que ya pertenece a otro instrumento activo ` +
                  `distinto (#${tagOwner.id}). No se aplica automáticamente.`
              },
              true
            )
          );
          return;
        }
        // ownerSeEstaRenombrando: cadena de renombres válida, sigue como
        // TAG_MODIFICADO normal más abajo.
      }

      const diffs = compareFieldsIncludingListado(matchByPnpid, row, presentFields);
      results.push(
        makeEntry(idx, row, matchByPnpid, 'TAG_MODIFICADO', diffs.length > 0 ? diffs : null, false)
      );
      resolvedInstrumentoIds.add(matchByPnpid.id);
      return;
    }

    const diffs = compareFieldsIncludingListado(matchByPnpid, row, presentFields);
    if (diffs.length > 0) {
      results.push(makeEntry(idx, row, matchByPnpid, 'DATOS_MODIFICADOS', diffs, false));
    } else {
      results.push(makeEntry(idx, row, matchByPnpid, 'OK', null, false));
    }
    resolvedInstrumentoIds.add(matchByPnpid.id);
  });

  // Instrumentos administrados por Plant3D cuyo PnPID no aparece en NINGUNA
  // fila de este archivo (con cualquier Listado) — alcance corrección C.
  // `resolvedInstrumentoIds` cubre el caso PNPID_ACTUALIZADO: el PnPID
  // VIEJO (la clave acá) nunca aparece en el archivo nuevo, pero el
  // instrumento sí quedó resuelto — no es "no existe en P&ID".
  for (const [pnpid, instrumento] of plant3dManagedByPnpid) {
    if (seenPnpidsInFile.has(pnpid) || resolvedInstrumentoIds.has(instrumento.id)) continue;
    results.push(makeEntry(null, null, instrumento, 'NO_EXISTE_EN_PNID', null, false));
  }

  // Señales ya vinculadas (codigo_senal) cuyo PnPID desapareció por
  // completo de este reporte — motor de reimportación de señales
  // (migración 046). NUNCA se borran ni desvinculan (decisión explícita
  // del usuario), solo se informa — sin vía de eliminación asociada, a
  // diferencia de NO_EXISTE_EN_PNID para instrumentos.
  for (const [codigo, senal] of existingSenalesByCodigo) {
    if (senalesVinculadasVistas.has(codigo)) continue;
    results.push({
      filaIndex: null,
      pnpid: codigo,
      tagInstrumento: null,
      instrumentoId: null,
      listado: null,
      resultadoCodigo: 'SENAL_SIN_MATCH_EN_REPORTE',
      diferencias: { detalle: `La señal ${senal.id} (tag actual "${senal.tagSenal ?? 'sin tag'}") está vinculada al PnPID "${codigo}", que ya no aparece en este reporte — no se modifica ni desvincula.` },
      requiereRevision: false,
      instrumentoUpdatedAtPreview: null,
      recursosEnRiesgo: null,
      senalVinculada: { senalId: senal.id, senalUpdatedAtPreview: senal.updatedAt ?? null, cambios: [] }
    });
  }

  return results;
}
