import { useCallback } from 'react';

import { listRacks } from '../api/racks';
import { listSlots } from '../api/slots';
import { listModules } from '../api/modules';
import { listModuleTypes } from '../api/moduleTypes';
import { useAsyncData } from '../lib/useAsyncData';
import type { PhysicalModule, Rack, Slot, ModuleType } from '../api/types';

export interface PhysicalTreeData {
  racks: Rack[];
  slots: Slot[];
  modules: PhysicalModule[];
  moduleTypes: ModuleType[];
}

/**
 * Los 4 endpoints (racks/slots/modules) admiten filtrar por su padre
 * directo, pero para armar el árbol completo de un RIO hace falta cruzar
 * 3 niveles — es más simple traer todo lo del proyecto de una vez (el
 * dataset de esta jerarquía es chico) y agrupar en el cliente, que ir
 * pidiendo nivel por nivel a medida que se expande cada rack/slot.
 */
export function usePhysicalTree(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<PhysicalTreeData> => {
    const [racks, slots, modules, moduleTypes] = await Promise.all([
      listRacks(projectId, devUserEmail),
      listSlots(projectId, devUserEmail),
      listModules(projectId, devUserEmail),
      listModuleTypes(devUserEmail)
    ]);

    return {
      racks: racks.racks,
      slots: slots.slots,
      modules: modules.modules,
      moduleTypes: moduleTypes.moduleTypes
    };
  }, [projectId, devUserEmail]);

  return useAsyncData<PhysicalTreeData>(fetcher);
}
