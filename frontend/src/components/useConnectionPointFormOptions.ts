import { useCallback } from 'react';

import { listInstruments } from '../api/instruments';
import { listEquipment } from '../api/equipment';
import { listBoxes } from '../api/boxes';
import { listRios } from '../api/rios';
import { listModules } from '../api/modules';
import { useAsyncData } from '../lib/useAsyncData';
import type { Box, Equipment, Instrument, PhysicalModule, Rio } from '../api/types';

export interface ConnectionPointFormOptions {
  instruments: Instrument[];
  equipment: Equipment[];
  boxes: Box[];
  rios: Rio[];
  modules: PhysicalModule[];
}

/** Las 5 listas de posibles dueños de un punto de conexión, en un solo
 * fetch combinado (ver useSignalFormOptions, mismo patrón). */
export function useConnectionPointFormOptions(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<ConnectionPointFormOptions> => {
    const [instruments, equipment, boxes, rios, modules] = await Promise.all([
      listInstruments(projectId, devUserEmail),
      listEquipment(projectId, devUserEmail),
      listBoxes(projectId, devUserEmail),
      listRios(projectId, devUserEmail),
      listModules(projectId, devUserEmail)
    ]);

    return {
      instruments: instruments.instruments,
      equipment: equipment.equipment,
      boxes: boxes.boxes,
      rios: rios.rios,
      modules: modules.modules
    };
  }, [projectId, devUserEmail]);

  return useAsyncData<ConnectionPointFormOptions>(fetcher);
}
