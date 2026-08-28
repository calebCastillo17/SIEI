import ExcelJS from 'exceljs';

import { LDI_COLUMNS, normalizeHeaderText, type LdiFieldKey } from './columns.js';
import type { LdiSnapshotRow } from './snapshot.js';
import { limpiarVinculosExternosYNombres, restaurarDibujosOriginales } from './templateSanitize.js';

export class LdiTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LdiTemplateError';
  }
}

export interface CaratulaMetadata {
  proyectoCumbra: string | null;
  proyectoCliente: string | null;
  titulo: string | null;
  etapaCodigo: string | null;
  etapaNombre: string | null;
  afe: string | null;
  vp: string | null;
  jefeDisciplina: string | null;
  liderProyecto: string | null;
  gerenteIngenieriaConstruccion: string | null;
  numeroDocumento: string;
}

export interface RevisionCaratula {
  codigoRevision: string;
  fecha: string; // 'YYYY-MM-DD'
  descripcion: string;
  inicialesPor: string;
  inicialesRevisado: string;
  inicialesAprobado: string;
  /** Fila física de la carátula (32-36) — asignada UNA VEZ, la primera
   * vez que la revisión se emite, y nunca recalculada después (migración
   * 010: revision_entregable.fila_caratula). El caller (revisionesEntregable.ts)
   * decide la asignación/desplazamiento; este generador solo escribe
   * donde se le indica. */
  filaCaratula: number;
}

export interface GenerarLdiExcelInput {
  plantillaBuffer: Buffer;
  meta: CaratulaMetadata;
  /** Revisiones EMITIDA todavía visibles en la carátula (capacidad real
   * de la plantilla: 5 filas, 32-36 — ver docs/MODELO_FISICO_SIEI.md),
   * cada una con su propia fila ya resuelta. BORRADOR/DESCARTADA nunca
   * llegan acá. */
  revisionesCaratula: RevisionCaratula[];
  /**
   * Ya ordenadas por el motor de orden (`order.ts`) según los criterios
   * congelados de la revisión. `item` es la posición GLOBAL persistida en
   * revision_entregable_fila (1..N, única, sin huecos) — el ITEM que
   * efectivamente se imprime en el Excel se recalcula acá mismo,
   * reiniciado en 1 cada vez que cambia `snapshot.locacion`, para no
   * necesitar ninguna columna nueva en el esquema (ver punto 9 del pedido
   * del usuario: "no tocar la migración 006 innecesariamente").
   */
  filas: Array<{ item: number; snapshot: LdiSnapshotRow }>;
}

/**
 * Nombres de hoja candidatos, en orden de preferencia. La plantilla
 * oficial vigente (reference_excel/Lista_instrumentos_plantilla.xlsx) usa
 * "Carátula" / "Lista" (renombrada por el usuario desde "Hoja1" en una
 * limpieza posterior de la plantilla); "Hoja1"/"LIST_INST" quedan como
 * candidatos de compatibilidad por si se carga una versión anterior de la
 * plantilla, pero NO se asumen — `findSheet` prueba cada nombre y usa el
 * primero que exista.
 */
const CARATULA_SHEET_NAMES = ['Carátula', 'Caratula'];
const DATOS_SHEET_NAMES = ['Lista', 'Hoja1', 'LIST_INST'];

/**
 * Cuántas filas de la hoja de datos ya vienen formateadas en la plantilla
 * antes de necesitar duplicar filas nuevas — geometría re-verificada
 * directamente contra la plantilla oficial vigente (fila de encabezado 9,
 * filas de datos 10-19, fila 20 en blanco de transición, NOTAS desde la
 * 21). Es una asunción de ESTA plantilla, no auto-detectada — si una
 * plantilla futura trae otra cantidad de filas base, este valor pasa a
 * ser configurable por plantilla en vez de una constante (no se
 * generaliza ahora).
 */
const FILAS_BASE_PLANTILLA = 10;

/** Altura real medida de una fila de datos de la plantilla (no una
 * estimación aproximada — se verificó con openpyxl contra el archivo
 * real de la plantilla oficial vigente: filas 10-19 = 25.2pt cada una,
 * igual que la plantilla anterior — coincidencia confirmada de forma
 * independiente, no reutilizada por asunción). Es la altura mínima para
 * una sola línea de texto; filas con texto más largo crecen desde acá,
 * nunca se reduce por debajo de este valor. */
const ALTURA_FILA_BASE = 25.2;
/** Alto adicional por cada línea de texto envuelta más allá de la
 * primera — valor conservador (más generoso que el mínimo teórico de un
 * renglón a 10pt) para priorizar "nunca cortar texto" sobre "altura
 * mínima exacta", que es lo que pidió el usuario. No hay forma de
 * verificar el resultado pixel a pixel sin abrir Excel de verdad — esto
 * es una estimación razonada, a confirmar visualmente. */
const ALTURA_POR_LINEA_ADICIONAL = 15;
/** Caracteres por unidad de ancho de columna de Excel para Arial Narrow
 * 10pt — subestimado a propósito (más líneas de las que probablemente
 * hagan falta) para el mismo motivo: preferir una fila más alta de lo
 * necesario antes que una con texto cortado. */
const CARACTERES_POR_UNIDAD_ANCHO = 1.3;

const LOCACION_SIN_VALOR = '(SIN LOCACIÓN)';

/** Filas de la tabla de revisiones en Carátula: B32:J36 (5 filas), la más
 * reciente siempre en la 36; en la plantilla oficial vigente el
 * encabezado fijo de esa tabla ("Rev." / "Fecha" / "Descripción" / "Por" /
 * "Revisado" / "Aprobado") está en la fila 37, DEBAJO de los datos, no
 * arriba — confirmado leyendo la fórmula real
 * =LOOKUP(2,1/(NOT(ISBLANK(Carátula!B32:B36))),Carátula!B32:B36) en
 * Hoja1!R3 ("Revisión:" del bloque de encabezado), y re-verificado
 * independientemente contra esta plantilla (no reutilizado de la
 * anterior). */
const CARATULA_REVISIONES_FILA_MIN = 32;
const CARATULA_REVISIONES_FILA_MAX = 36;

function findSheet(wb: ExcelJS.Workbook, candidates: string[]): ExcelJS.Worksheet {
  for (const name of candidates) {
    const ws = wb.getWorksheet(name);
    if (ws) return ws;
  }
  throw new LdiTemplateError(`La plantilla no tiene ninguna hoja llamada: ${candidates.join(' / ')}`);
}

/** Ubica la fila de encabezado de la hoja de datos buscando la celda
 * "Ítem" en las primeras 20 filas — no asume ninguna fila fija (en la
 * plantilla oficial vigente resuelve a la fila 9, distinta de la fila 11
 * de la plantilla anterior; el detector no cambió, solo el resultado). */
function findHeaderRow(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= 20; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 60; c++) {
      if (normalizeHeaderText(row.getCell(c).value) === 'ITEM') {
        return r;
      }
    }
  }
  throw new LdiTemplateError('No se encontró la fila de encabezado (columna "Ítem") en la hoja de datos.');
}

/** Ubica cada una de las 19 columnas de este entregable por texto de
 * encabezado (tolerante a que otra plantilla las reordene) y reescribe el
 * encabezado si la columna trae `newHeaderLabel`. En la plantilla oficial
 * vigente las 19 caen exactamente en A:S, sin columnas intermedias
 * ajenas al LDI — no hay ningún "N° TAG WSP"/"SISTEMA" huérfano que
 * ocultar como en la plantilla anterior, pero la función no lo asume: si
 * una plantilla futura vuelve a intercalar columnas ajenas,
 * `ocultarColumnasHuerfanas` las sigue resolviendo igual. */
function locateColumns(ws: ExcelJS.Worksheet, headerRow: number): Map<LdiFieldKey, number> {
  const row = ws.getRow(headerRow);
  const indexByNormalizedText = new Map<string, number>();

  for (let c = 1; c <= 60; c++) {
    const text = normalizeHeaderText(row.getCell(c).value);
    if (text) indexByNormalizedText.set(text, c);
  }

  const result = new Map<LdiFieldKey, number>();

  for (const col of LDI_COLUMNS) {
    let found: number | undefined;
    for (const alias of col.headerAliases) {
      const idx = indexByNormalizedText.get(normalizeHeaderText(alias));
      if (idx !== undefined) {
        found = idx;
        break;
      }
    }

    if (found === undefined) {
      throw new LdiTemplateError(
        `No se encontró en la hoja de datos ninguna columna con encabezado: ${col.headerAliases.join(' / ')}`
      );
    }

    result.set(col.key, found);

    if (col.newHeaderLabel) {
      row.getCell(found).value = col.newHeaderLabel;
    }
  }

  return result;
}

/**
 * Columnas de la plantilla que quedaron entre el rango de este LDI pero
 * ya no forman parte de él — se ocultan y se les blanquea el encabezado
 * en vez de borrarlas físicamente de la plantilla: evita el riesgo de
 * tener que recalcular merges/anchors de imágenes que dependan de
 * posiciones de columna en otras zonas de la hoja. En la plantilla
 * oficial vigente esto es un no-op (las 19 columnas A:S son exactamente
 * las de este LDI, sin ninguna intermedia ajena como el "N° TAG WSP" de
 * la plantilla anterior) — se conserva para no depender de que eso siga
 * siendo cierto en una plantilla futura.
 */
function ocultarColumnasHuerfanas(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  colIndexByKey: Map<LdiFieldKey, number>,
  minCol: number,
  maxCol: number
): void {
  const reclamadas = new Set(colIndexByKey.values());
  for (let c = minCol; c <= maxCol; c++) {
    if (!reclamadas.has(c)) {
      ws.getColumn(c).hidden = true;
      ws.getCell(headerRow, c).value = null;
    }
  }
}

function fillCaratula(
  ws: ExcelJS.Worksheet,
  meta: CaratulaMetadata,
  revisiones: RevisionCaratula[]
): void {
  // Campos compuestos: se escribe el string completo (verificado que estas
  // celdas no tienen rich-text de múltiples estilos dentro, ver diseño).
  ws.getCell('A9').value = `PROYECTO: ${meta.proyectoCumbra ?? ''}`;
  ws.getCell('B11').value = meta.titulo ?? '';
  ws.getCell('A14').value = `ETAPA: ${meta.etapaNombre ?? ''} - ${meta.etapaCodigo ?? ''}`;
  ws.getCell('B17').value = meta.proyectoCliente ?? '';
  ws.getCell('B21').value = meta.numeroDocumento;
  ws.getCell('G24').value = meta.jefeDisciplina ?? '';
  ws.getCell('G25').value = meta.liderProyecto ?? '';
  ws.getCell('G26').value = meta.gerenteIngenieriaConstruccion ?? '';
  ws.getCell('B30').value = `VP: ${meta.vp ?? ''}`;
  ws.getCell('B31').value = `AFE: ${meta.afe ?? ''}`;

  // A18/A19/A20, logos y notas: NO se tocan — se conservan tal como están
  // en la plantilla (SIEI no los administra todavía).

  // Tabla de revisiones: solo EMITIDA llega acá (filtrado por el caller),
  // cada una a su propia fila_caratula ya resuelta (32-36) — fija desde
  // que se asignó por primera vez, nunca recalculada por posición/orden.
  for (const rev of revisiones) {
    if (rev.filaCaratula < CARATULA_REVISIONES_FILA_MIN || rev.filaCaratula > CARATULA_REVISIONES_FILA_MAX) {
      throw new LdiTemplateError(`filaCaratula fuera de rango (${CARATULA_REVISIONES_FILA_MIN}-${CARATULA_REVISIONES_FILA_MAX}): ${rev.filaCaratula}`);
    }
    const fila = rev.filaCaratula;
    ws.getCell(`B${fila}`).value = rev.codigoRevision;
    ws.getCell(`C${fila}`).value = new Date(`${rev.fecha}T00:00:00Z`);
    ws.getCell(`D${fila}`).value = rev.descripcion;
    ws.getCell(`H${fila}`).value = rev.inicialesPor;
    ws.getCell(`I${fila}`).value = rev.inicialesRevisado;
    ws.getCell(`J${fila}`).value = rev.inicialesAprobado;
  }
}

/** Busca, en las primeras `maxRow` filas de `ws`, una celda cuyo texto
 * normalizado sea uno de `labelTexts` y escribe `value` en la celda
 * inmediatamente a su derecha. Devuelve si encontró el label. Defensivo
 * por diseño (igual filosofía que el resto del generador): si una
 * plantilla futura no trae ese bloque, simplemente no escribe nada, no
 * es un campo crítico que deba abortar la generación. */
function writeValueNextToLabel(
  ws: ExcelJS.Worksheet,
  labelTexts: string[],
  value: ExcelJS.CellValue,
  maxRow = 10,
  maxCol = 30
): boolean {
  const normalizedLabels = new Set(labelTexts.map(normalizeHeaderText));
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      if (normalizedLabels.has(normalizeHeaderText(row.getCell(c).value))) {
        row.getCell(c + 1).value = value;
        return true;
      }
    }
  }
  return false;
}

/**
 * Bloque de encabezado superior de la hoja de datos (fila 3 a 6 en la
 * plantilla oficial vigente: Q3 "Revisión:" / Q4 "Proyecto:" / Q5
 * "Fecha:" / Q6 "Página"). Re-detectado desde cero contra esta plantilla
 * — coordenadas distintas de las V5/W5 de la plantilla anterior:
 *
 * - "Revisión:" (R3) YA es una fórmula propia de la plantilla
 *   (`=LOOKUP(2,1/(NOT(ISBLANK(Carátula!B32:B36))),Carátula!B32:B36)`)
 *   que lee directo de la tabla de revisiones de Carátula — se calcula
 *   sola en cuanto `fillCaratula` escribe esa tabla; NO se toca acá para
 *   no pisar la fórmula.
 * - "Proyecto:" (R4) y "Fecha:" (R5) son celdas de VALOR LITERAL en la
 *   plantilla (la plantilla trae ahí un ejemplo escrito a mano: 22043 /
 *   30-jun-2026) — por instrucción explícita del usuario, un valor de
 *   ejemplo en la plantilla nunca se conserva: se sobrescriben siempre
 *   con el dato vigente de SIEI (`meta.proyectoCumbra` / la fecha de la
 *   revisión que se está emitiendo, la misma que se escribe en la fila
 *   36 de la tabla de Carátula).
 * - "Página" (Q6) no tiene campo de valor asociado en la plantilla — no
 *   se inventa ninguno.
 */
function fillHoja1Encabezado(ws: ExcelJS.Worksheet, meta: CaratulaMetadata, revisionActual?: RevisionCaratula): void {
  writeValueNextToLabel(ws, ['PROYECTO:', 'PROYECTO'], meta.proyectoCumbra ?? '');
  if (revisionActual) {
    writeValueNextToLabel(ws, ['FECHA:', 'FECHA'], new Date(`${revisionActual.fecha}T00:00:00Z`));
  }
}

/** Cuántas líneas envueltas necesita `texto` para caber en una columna de
 * `anchoColumna` unidades de Excel — estimación conservadora (ver
 * constantes de arriba), respeta saltos de línea explícitos. */
function estimarLineas(texto: string, anchoColumna: number): number {
  if (!texto) return 1;
  const caracteresPorLinea = Math.max(1, Math.floor(anchoColumna * CARACTERES_POR_UNIDAD_ANCHO));
  return texto
    .split('\n')
    .reduce((total, segmento) => total + Math.max(1, Math.ceil(segmento.length / caracteresPorLinea)), 0);
}

/** Altura necesaria para esta fila: la mayor cantidad de líneas que exige
 * cualquiera de sus columnas de texto, aplicada sobre la altura base real
 * de la plantilla. Una fila sin texto largo se queda en la altura base —
 * no se agranda todo indiscriminadamente. */
function calcularAlturaFila(
  ws: ExcelJS.Worksheet,
  snapshot: LdiSnapshotRow,
  colIndexByKey: Map<LdiFieldKey, number>
): number {
  let maxLineas = 1;

  for (const col of LDI_COLUMNS) {
    if (col.key === 'item' || col.key === 'rev') continue; // siempre cortos, no aportan
    const valor = (snapshot as unknown as Record<string, string>)[col.key];
    if (!valor) continue;

    const colIdx = colIndexByKey.get(col.key)!;
    const ancho = ws.getColumn(colIdx).width ?? 10;
    maxLineas = Math.max(maxLineas, estimarLineas(valor, ancho));
  }

  if (maxLineas <= 1) return ALTURA_FILA_BASE;
  return ALTURA_FILA_BASE + (maxLineas - 1) * ALTURA_POR_LINEA_ADICIONAL;
}

/** Clona el estilo (fuente/relleno/borde/alineación) de la fila de
 * encabezado real de la plantilla sobre la fila de sección de LOCACIÓN —
 * no hay una fila "separadora" propia en la plantilla base para copiar,
 * así que se reutiliza la del encabezado (ya tiene el aspecto de
 * "cabecera": negrita, fondo sombreado, bordes, centrado) en vez de
 * inventar un estilo nuevo de cero.
 *
 * IMPORTANTE — orden de operaciones: hay que combinar (`mergeCells`)
 * PRIMERO y recién después asignar estilo a la celda ancla. Probado
 * empíricamente: si se asigna estilo a cada celda del rango y DESPUÉS se
 * combina (o incluso si se estila cada celda del rango ya combinado), el
 * round-trip de escritura de exceljs pierde `font`/`fill` silenciosamente
 * (el border sí sobrevive) — solo estilar la celda ancla después de
 * combinar serializa correctamente. Las demás celdas del rango no
 * necesitan estilo propio: una vez combinadas, Excel solo renderiza el
 * de la celda ancla.
 */
function escribirFilaDeSeccion(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  filaExcel: number,
  minCol: number,
  maxCol: number,
  locacion: string
): void {
  ws.mergeCells(filaExcel, minCol, filaExcel, maxCol);

  const anchor = ws.getRow(filaExcel).getCell(minCol);
  const srcAnchor = ws.getRow(headerRow).getCell(minCol);
  anchor.font = JSON.parse(JSON.stringify(srcAnchor.font));
  anchor.fill = JSON.parse(JSON.stringify(srcAnchor.fill));
  anchor.border = JSON.parse(JSON.stringify(srcAnchor.border));
  anchor.alignment = JSON.parse(JSON.stringify(srcAnchor.alignment));
  anchor.value = locacion || LOCACION_SIN_VALOR;

  ws.getRow(filaExcel).height = ALTURA_FILA_BASE;
}

export async function generarLdiExcel(input: GenerarLdiExcelInput): Promise<Buffer> {
  const plantillaSaneada = await limpiarVinculosExternosYNombres(input.plantillaBuffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(plantillaSaneada as unknown as ExcelJS.Buffer);

  const caratula = findSheet(workbook, CARATULA_SHEET_NAMES);
  const hojaDatos = findSheet(workbook, DATOS_SHEET_NAMES);

  fillCaratula(caratula, input.meta, input.revisionesCaratula);
  fillHoja1Encabezado(hojaDatos, input.meta, input.revisionesCaratula[0]);

  const headerRow = findHeaderRow(hojaDatos);
  const colIndexByKey = locateColumns(hojaDatos, headerRow);
  const columnasUsadas = [...colIndexByKey.values()];
  const minCol = Math.min(...columnasUsadas);
  const maxCol = Math.max(...columnasUsadas);

  ocultarColumnasHuerfanas(hojaDatos, headerRow, colIndexByKey, minCol, maxCol);

  const filaInicio = headerRow + 1;
  const filaModelo = filaInicio + FILAS_BASE_PLANTILLA - 1;

  // Agrupa por LOCACIÓN preservando el orden ya aplicado (el motor de
  // orden, no este generador, decide qué campo agrupa primero) — detecta
  // límites de grupo por cambio de valor en filas contiguas, sin asumir
  // ninguna secuencia de criterios fija.
  const grupos: Array<{ locacion: string; filas: typeof input.filas }> = [];
  for (const fila of input.filas) {
    const locacion = fila.snapshot.locacion || LOCACION_SIN_VALOR;
    const grupoActual = grupos[grupos.length - 1];
    if (grupoActual && grupoActual.locacion === locacion) {
      grupoActual.filas.push(fila);
    } else {
      grupos.push({ locacion, filas: [fila] });
    }
  }

  const totalFilasFisicas = input.filas.length + grupos.length; // +1 fila de sección por grupo
  if (totalFilasFisicas > FILAS_BASE_PLANTILLA) {
    hojaDatos.duplicateRow(filaModelo, totalFilasFisicas - FILAS_BASE_PLANTILLA, true);
  }

  let filaExcel = filaInicio;
  for (const grupo of grupos) {
    escribirFilaDeSeccion(hojaDatos, headerRow, filaExcel, minCol, maxCol, grupo.locacion);
    filaExcel += 1;

    grupo.filas.forEach((fila, idxEnGrupo) => {
      const itemEnGrupo = String(idxEnGrupo + 1).padStart(3, '0');

      for (const col of LDI_COLUMNS) {
        const colIdx = colIndexByKey.get(col.key)!;
        const cell = hojaDatos.getCell(filaExcel, colIdx);
        cell.value = col.key === 'item' ? itemEnGrupo : ((fila.snapshot as unknown as Record<string, string>)[col.key] ?? '');
      }

      hojaDatos.getRow(filaExcel).height = calcularAlturaFila(hojaDatos, fila.snapshot, colIndexByKey);
      filaExcel += 1;
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const generado = Buffer.from(arrayBuffer);

  return restaurarDibujosOriginales(generado, input.plantillaBuffer);
}
