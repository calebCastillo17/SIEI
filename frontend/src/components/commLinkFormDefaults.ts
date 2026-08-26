import type { CommLinkInput } from '../api/types';

export function emptyCommLinkInput(puertoId: string): CommLinkInput {
  return {
    equipoId: null,
    instrumentoId: null,
    puertoId,
    tipoComId: null,
    tipoMedioId: null,
    tagMedio: null
  };
}
