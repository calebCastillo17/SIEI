import { useCallback } from 'react';

import {
  listAlarmPriorities,
  listComDirections,
  listInterfaceTypes,
  listIoTypes,
  listRevisionStates,
  listSignalClasses
} from '../api/catalogs';
import { listInstruments } from '../api/instruments';
import { listEquipment } from '../api/equipment';
import { useAsyncData } from '../lib/useAsyncData';
import type { CatalogItem, Equipment, Instrument } from '../api/types';

export interface SignalFormOptions {
  signalClasses: CatalogItem[];
  ioTypes: CatalogItem[];
  comDirections: CatalogItem[];
  revisionStates: CatalogItem[];
  alarmPriorities: CatalogItem[];
  interfaceTypes: CatalogItem[];
  instruments: Instrument[];
  equipment: Equipment[];
}

/**
 * Todas las listas que necesita el formulario de Señales, en un solo
 * fetch combinado — evita 8 llamadas a useAsyncData (8 loading/error por
 * separado) para una sola pantalla.
 */
export function useSignalFormOptions(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<SignalFormOptions> => {
    const [
      signalClasses,
      ioTypes,
      comDirections,
      revisionStates,
      alarmPriorities,
      interfaceTypes,
      instruments,
      equipment
    ] = await Promise.all([
      listSignalClasses(devUserEmail),
      listIoTypes(devUserEmail),
      listComDirections(devUserEmail),
      listRevisionStates(devUserEmail),
      listAlarmPriorities(devUserEmail),
      listInterfaceTypes(devUserEmail),
      listInstruments(projectId, devUserEmail),
      listEquipment(projectId, devUserEmail)
    ]);

    return {
      signalClasses: signalClasses.items,
      ioTypes: ioTypes.items,
      comDirections: comDirections.items,
      revisionStates: revisionStates.items,
      alarmPriorities: alarmPriorities.items,
      interfaceTypes: interfaceTypes.items,
      instruments: instruments.instruments,
      equipment: equipment.equipment
    };
  }, [projectId, devUserEmail]);

  return useAsyncData<SignalFormOptions>(fetcher);
}
