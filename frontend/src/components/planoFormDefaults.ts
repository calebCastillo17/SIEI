import type { PlanoInput } from '../api/types';

export function emptyPlanoInput(): PlanoInput {
  return {
    codigoPlano: null,
    codigoAnterior: null,
    descripcion: '',
    tipoPlanoId: ''
  };
}
