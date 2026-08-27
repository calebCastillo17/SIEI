import { useCallback } from 'react';

import { listEquipment } from '../api/equipment';
import { listInstruments } from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import type { Equipment, Instrument } from '../api/types';

export interface InstrumentFormOptions {
  equipment: Equipment[];
  /** Para el selector de "Instrumento asociado" (ver instrumento_asociado_id,
   * database/migrations/005_instrumento_asociado.sql) — un instrumento no
   * puede asociarse a sí mismo, así que las páginas que usan esta lista
   * deben excluir su propio id al armar las opciones. */
  instruments: Instrument[];
}

/** Catálogos que necesita el formulario de Instrumentos: la lista de
 * equipos del proyecto (para "Equipo asociado") y la de otros instrumentos
 * (para "Instrumento asociado"). */
export function useInstrumentFormOptions(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<InstrumentFormOptions> => {
    const [equipment, instruments] = await Promise.all([
      listEquipment(projectId, devUserEmail),
      listInstruments(projectId, devUserEmail)
    ]);
    return { equipment: equipment.equipment, instruments: instruments.instruments };
  }, [projectId, devUserEmail]);

  return useAsyncData<InstrumentFormOptions>(fetcher);
}
