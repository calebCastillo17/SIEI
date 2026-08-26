import { useCallback } from 'react';

import { listComTypes, listComMediaTypes } from '../api/catalogs';
import { listInstruments } from '../api/instruments';
import { listEquipment } from '../api/equipment';
import { useAsyncData } from '../lib/useAsyncData';
import type { CatalogItem, Equipment, Instrument } from '../api/types';

export interface CommLinkFormOptions {
  comTypes: CatalogItem[];
  comMediaTypes: CatalogItem[];
  instruments: Instrument[];
  equipment: Equipment[];
}

/** Todas las listas que necesita el formulario de Enlace de comunicación,
 * en un solo fetch combinado (ver useSignalFormOptions, mismo patrón). */
export function useCommLinkFormOptions(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<CommLinkFormOptions> => {
    const [comTypes, comMediaTypes, instruments, equipment] = await Promise.all([
      listComTypes(devUserEmail),
      listComMediaTypes(devUserEmail),
      listInstruments(projectId, devUserEmail),
      listEquipment(projectId, devUserEmail)
    ]);

    return {
      comTypes: comTypes.items,
      comMediaTypes: comMediaTypes.items,
      instruments: instruments.instruments,
      equipment: equipment.equipment
    };
  }, [projectId, devUserEmail]);

  return useAsyncData<CommLinkFormOptions>(fetcher);
}
