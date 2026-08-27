import { useCallback } from 'react';

import { listEquipment } from '../api/equipment';
import { useAsyncData } from '../lib/useAsyncData';
import type { Equipment } from '../api/types';

export interface InstrumentFormOptions {
  equipment: Equipment[];
}

/** El único catálogo que necesita el formulario de Instrumentos: la lista
 * de equipos del proyecto, para el selector de "Equipo asociado" (ver
 * equipoAsociadoId en instruments.ts). */
export function useInstrumentFormOptions(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<InstrumentFormOptions> => {
    const equipment = await listEquipment(projectId, devUserEmail);
    return { equipment: equipment.equipment };
  }, [projectId, devUserEmail]);

  return useAsyncData<InstrumentFormOptions>(fetcher);
}
