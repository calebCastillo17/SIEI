import { useCallback } from 'react';

import { listSignals } from '../api/signals';
import { listCables } from '../api/cables';
import { listConductorPairs } from '../api/conductorPairs';
import { listConnectionPoints } from '../api/connectionPoints';
import { listInstruments } from '../api/instruments';
import { listEquipment } from '../api/equipment';
import { listBoxes } from '../api/boxes';
import { listRios } from '../api/rios';
import { listModules } from '../api/modules';
import { useAsyncData } from '../lib/useAsyncData';
import type {
  Box,
  Cable,
  ConductorPair,
  ConnectionPoint,
  Equipment,
  Instrument,
  PhysicalModule,
  Rio,
  Signal
} from '../api/types';

export interface RouteFormOptions {
  signals: Signal[];
  cables: Cable[];
  conductorPairs: ConductorPair[];
  connectionPoints: ConnectionPoint[];
  instruments: Instrument[];
  equipment: Equipment[];
  boxes: Box[];
  rios: Rio[];
  modules: PhysicalModule[];
}

/**
 * Todo lo que necesita el armador de rutas de conexión, en un solo fetch
 * combinado: la señal a enrutar, los pares de conductor disponibles (todo
 * el proyecto — conductorPairs.ts admite filtrar por cableId pero acá hace
 * falta elegir entre todos), los puntos de conexión disponibles, y las 5
 * listas de dueños para poder mostrar una etiqueta legible de cada punto
 * (igual que useConnectionPointFormOptions).
 */
export function useRouteFormOptions(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<RouteFormOptions> => {
    const [
      signals,
      cables,
      conductorPairs,
      connectionPoints,
      instruments,
      equipment,
      boxes,
      rios,
      modules
    ] = await Promise.all([
      listSignals(projectId, devUserEmail),
      listCables(projectId, devUserEmail),
      listConductorPairs(projectId, devUserEmail),
      listConnectionPoints(projectId, devUserEmail),
      listInstruments(projectId, devUserEmail),
      listEquipment(projectId, devUserEmail),
      listBoxes(projectId, devUserEmail),
      listRios(projectId, devUserEmail),
      listModules(projectId, devUserEmail)
    ]);

    return {
      signals: signals.signals,
      cables: cables.cables,
      conductorPairs: conductorPairs.conductorPairs,
      connectionPoints: connectionPoints.connectionPoints,
      instruments: instruments.instruments,
      equipment: equipment.equipment,
      boxes: boxes.boxes,
      rios: rios.rios,
      modules: modules.modules
    };
  }, [projectId, devUserEmail]);

  return useAsyncData<RouteFormOptions>(fetcher);
}
