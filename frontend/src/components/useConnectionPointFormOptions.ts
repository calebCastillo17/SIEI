import { useCallback } from 'react';

import { listInstruments } from '../api/instruments';
import { listEquipment } from '../api/equipment';
import { listBoxes } from '../api/boxes';
import { listGabinetes } from '../api/gabinetes';
import { listModules } from '../api/modules';
import { useAsyncData } from '../lib/useAsyncData';
import type { Box, Equipment, Gabinete, Instrument, PhysicalModule } from '../api/types';

export interface ConnectionPointFormOptions {
  instruments: Instrument[];
  equipment: Equipment[];
  boxes: Box[];
  gabinetes: Gabinete[];
  modules: PhysicalModule[];
}

/** Las 5 listas de posibles dueños de un punto de conexión, en un solo
 * fetch combinado (ver useSignalFormOptions, mismo patrón). */
export function useConnectionPointFormOptions(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<ConnectionPointFormOptions> => {
    const [instruments, equipment, boxes, gabinetes, modules] = await Promise.all([
      listInstruments(projectId, devUserEmail),
      listEquipment(projectId, devUserEmail),
      listBoxes(projectId, devUserEmail),
      listGabinetes(projectId, devUserEmail),
      listModules(projectId, devUserEmail)
    ]);

    return {
      instruments: instruments.instruments,
      equipment: equipment.equipment,
      boxes: boxes.boxes,
      gabinetes: gabinetes.gabinetes,
      modules: modules.modules
    };
  }, [projectId, devUserEmail]);

  return useAsyncData<ConnectionPointFormOptions>(fetcher);
}
