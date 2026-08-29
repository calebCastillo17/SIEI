import type { SwitchInput } from '../api/types';

export function emptySwitchInput(): SwitchInput {
  return {
    tagSwitch: '',
    descripcion: null,
    marcaModelo: null,
    gabineteId: null
  };
}
