import type { ConnectionPointInput } from '../api/types';

export function emptyConnectionPointInput(): ConnectionPointInput {
  return {
    instrumentoId: null,
    equipoId: null,
    cajaId: null,
    rioId: null,
    moduloId: null,
    regleta: null,
    bornera: null,
    borne: null,
    lado: null,
    circuito: null,
    hilo: null,
    descripcion: null
  };
}
