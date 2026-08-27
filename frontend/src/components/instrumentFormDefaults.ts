import type { InstrumentInput } from '../api/types';

export function emptyInstrumentInput(): InstrumentInput {
  return {
    tagInstrumento: '',
    descripcion: null,
    tipoInstrumento: null,
    servicio: null,
    sistema: null,
    ubicacion: null,
    nodo: null,
    tagAnterior: null,
    tecnologia: null,
    funcionamiento: null,
    cuerpoInstrumento: null,
    conexionProceso: null,
    planoPnid: null,
    lineaPnid: null,
    tipoSenalPnid: null,
    equipoAsociadoId: null,
    equipoAsociadoTag: null
  };
}
