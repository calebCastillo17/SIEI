import type { LdiOrderableInstrumento } from './order.js';

/**
 * Forma de `revision_entregable_fila.datos_snapshot` para el LDI — las 20
 * columnas de este entregable (sin `tagAnterior`, ver columns.ts), ya
 * resueltas. Los 5 campos sin fuente van como "" explícito (nunca
 * ausentes, nunca null) para que el snapshot sea autocontenido: una
 * revisión histórica nunca necesita volver a consultar qué campos estaban
 * disponibles en ese momento.
 *
 * `instrumento.tag_anterior` sigue existiendo íntegro en
 * `LdiOrderableInstrumento` — no deja de estar disponible para el motor
 * de orden (`tag_anterior` sigue siendo un campo de orden válido),
 * simplemente no se congela en el snapshot de ESTE entregable (la
 * plantilla oficial vigente ya no tiene columna para ese dato).
 */
export interface LdiSnapshotRow {
  tag: string;
  descripcion: string;
  tipo: string;
  tecnologia: string;
  conexionProceso: string;
  instrumentoAsociado: string;
  linea: string;
  equipoAsociado: string;
  servicio: string;
  locacion: string;
  sistema: string;
  hojaDeDatos: string;
  pnid: string;
  diagramaDeLazo: string;
  planoDeUbicacion: string;
  marcaModelo: string;
  comentarios: string;
  nodo: string;
  rev: string;
}

export function construirSnapshotFila(
  instrumento: LdiOrderableInstrumento,
  codigoRevision: string
): LdiSnapshotRow {
  return {
    tag: instrumento.tagInstrumento,
    descripcion: instrumento.descripcion ?? '',
    tipo: instrumento.tipoInstrumento ?? '',
    tecnologia: instrumento.tecnologia ?? '',
    conexionProceso: instrumento.conexionProceso ?? '',
    /*
     * Columna INSTRUMENTO ASOCIADO (G): imprime los HIJOS de este
     * instrumento, no su propio instrumentoAsociadoTag — desde que el LDI
     * solo lista padres (fetchInstrumentosOrdenables excluye hijos), ese
     * campo siempre es null en la fila que llega acá (un padre nunca
     * apunta a otro instrumento), así que imprimirlo dejaba la columna
     * siempre vacía. Pedido explícito del usuario tras verlo en el
     * archivo real generado.
     */
    instrumentoAsociado: instrumento.hijosTags ?? '',
    linea: instrumento.lineaPnid ?? '',
    equipoAsociado: instrumento.equipoAsociadoTag ?? '',
    servicio: instrumento.servicio ?? '',
    locacion: instrumento.ubicacion ?? '',
    sistema: instrumento.sistema ?? '',
    hojaDeDatos: '',
    pnid: instrumento.planoPnid ?? '',
    diagramaDeLazo: '',
    planoDeUbicacion: '',
    marcaModelo: '',
    comentarios: '',
    nodo: instrumento.nodo ?? '',
    rev: codigoRevision
  };
}
