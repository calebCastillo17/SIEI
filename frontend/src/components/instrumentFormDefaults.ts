import type { InstrumentInput } from '../api/types';

export function emptyInstrumentInput(): InstrumentInput {
  return {
    tagInstrumento: '',
    pnpid: null,
    fuentePnpid: null,
    descripcion: null,
    tipoInstrumento: null,
    servicio: null,
    sistema: null,
    ubicacion: null,
    nodo: null
  };
}
