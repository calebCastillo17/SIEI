import type { EquipmentInput } from '../api/types';

export function emptyEquipmentInput(): EquipmentInput {
  return {
    tagEquipo: '',
    descripcion: null,
    sistema: null,
    nodo: null,
    panel: null,
    planoPnid: null,
    tipoEquipoId: null
  };
}
