import { DIFFABLE_FIELDS, type PnidField } from './headers.js';
import type { ParsedRow } from './parseExcel.js';

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
  equipoAsociadoTag: string | null;
  instrumentoAsociadoTag: string | null;
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
  resultadoCodigo: string;
  /** Diffs estructurados para DATOS_MODIFICADOS/TAG_MODIFICADO, o un texto
   * explicativo simple para REQUIERE_REVISION/TAG_DUPLICADO. */
  diferencias: FieldDiff[] | DetalleTexto | null;
  requiereRevision: boolean;
  instrumentoUpdatedAtPreview: string | null;
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

function makeEntry(
  filaIndex: number | null,
  row: ParsedRow | null,
  instrumento: InstrumentSnapshot | undefined,
  resultadoCodigo: string,
  diferencias: FieldDiff[] | DetalleTexto | null,
  requiereRevision: boolean
): ComparisonResultEntry {
  return {
    filaIndex,
    pnpid: row?.pnpid ?? instrumento?.pnpid ?? null,
    tagInstrumento: row?.tagInstrumento ?? instrumento?.tagInstrumento ?? null,
    instrumentoId: instrumento?.id ?? null,
    resultadoCodigo,
    diferencias,
    requiereRevision,
    instrumentoUpdatedAtPreview: instrumento ? (instrumento.updatedAt ?? null) : null
  };
}

/**
 * Motor de comparación PREVIEW. No toca la base — solo calcula, por cada
 * fila del archivo, qué pasaría, más las filas "virtuales" de instrumentos
 * administrados por Plant3D que desaparecieron del reporte por completo.
 */
export function buildComparisonPlan(input: ComparisonPlanInput): ComparisonResultEntry[] {
  const { rows, presentFields, existingByPnpid, existingByTag, plant3dManagedByPnpid } = input;
  const results: ComparisonResultEntry[] = [];

  const seenPnpidsInFile = new Set<string>();
  const eligibleIndexes: number[] = [];

  rows.forEach((row, idx) => {
    if (row.pnpid) seenPnpidsInFile.add(row.pnpid);
    if (row.listado && row.tagInstrumento && row.pnpid) eligibleIndexes.push(idx);
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

  rows.forEach((row, idx) => {
    if (!row.listado) {
      const existing = row.pnpid ? existingByPnpid.get(row.pnpid) : undefined;
      results.push(makeEntry(idx, row, existing, 'NO_LISTADO', null, false));
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
          { detalle: 'PnPID vacío en una fila con Listado=True y Tag presente.' },
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
        results.push(
          makeEntry(
            idx,
            row,
            undefined,
            'REQUIERE_REVISION',
            {
              detalle:
                `El TAG "${row.tagInstrumento}" ya pertenece al instrumento #${tagOwner.id} ` +
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

    if (matchByPnpid.tagInstrumento.trim() !== row.tagInstrumento) {
      const diffs = compareFields(matchByPnpid, row, presentFields);
      results.push(
        makeEntry(idx, row, matchByPnpid, 'TAG_MODIFICADO', diffs.length > 0 ? diffs : null, false)
      );
      return;
    }

    const diffs = compareFields(matchByPnpid, row, presentFields);
    if (diffs.length > 0) {
      results.push(makeEntry(idx, row, matchByPnpid, 'DATOS_MODIFICADOS', diffs, false));
    } else {
      results.push(makeEntry(idx, row, matchByPnpid, 'OK', null, false));
    }
  });

  // Instrumentos administrados por Plant3D cuyo PnPID no aparece en NINGUNA
  // fila de este archivo (con cualquier Listado) — alcance corrección C.
  for (const [pnpid, instrumento] of plant3dManagedByPnpid) {
    if (seenPnpidsInFile.has(pnpid)) continue;
    results.push(makeEntry(null, null, instrumento, 'NO_EXISTE_EN_PNID', null, false));
  }

  return results;
}
