import type { BoxInput } from '../api/types';

export function emptyBoxInput(): BoxInput {
  return {
    tagCaja: '',
    descripcion: null
  };
}
