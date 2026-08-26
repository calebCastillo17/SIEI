import type { CableInput } from '../api/types';

export function emptyCableInput(): CableInput {
  return {
    tagCable: '',
    tipoCable: null,
    capacidadConductores: 1
  };
}
