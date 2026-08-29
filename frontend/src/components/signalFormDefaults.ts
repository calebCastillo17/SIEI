import type { SignalInput } from '../api/types';

export function emptySignalInput(): SignalInput {
  return {
    tagSenal: null,
    claseSenalId: '',
    instrumentoId: null,
    equipoId: null,
    instrumentoAgrupadorId: null,
    tipoIoId: null,
    direccionComId: null,
    tipoInterfazId: null,
    canalId: null,
    estadoRevisionId: null,
    prioridadAlarmaId: null,
    codigoSenal: null,
    causaAlarma: null,
    tipoDatoComId: null,
    esLoopPowered: null,
    nombreCorto: null,
    descripcion: null,
    rangoMin: null,
    rangoMax: null,
    alarmaHh: null,
    alarmaH: null,
    alarmaL: null,
    alarmaLl: null,
    valorNormal: null,
    unidadIngenieria: null,
    retardo: null,
    enclavamiento: null,
    observacion: null
  };
}
