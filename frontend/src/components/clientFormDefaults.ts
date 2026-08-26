import type { ClientInput } from '../api/types';

export function emptyClientInput(): ClientInput {
  return {
    nombre: '',
    codigoInterno: null
  };
}
