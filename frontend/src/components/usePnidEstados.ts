import { useCallback } from 'react';

import { listPnidStates } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import type { CatalogItem } from '../api/types';

export interface PnidEstadosResult {
  itemsById: Map<string, CatalogItem>;
}

const EMPTY: PnidEstadosResult = { itemsById: new Map() };

/**
 * Resuelve cat.cat_estado_pnid una sola vez: Instrument.estadoPnidId (y
 * nada más — los `resultado` de un import ya vienen como código de texto
 * directo, ver serializeResultado en pnidImports.ts) es un id crudo que
 * hay que mapear a su código para mostrarlo con PnidEstadoBadge.
 */
export function usePnidEstados(devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<PnidEstadosResult> => {
    const response = await listPnidStates(devUserEmail);
    return { itemsById: new Map(response.items.map((item) => [item.id, item])) };
  }, [devUserEmail]);

  const result = useAsyncData<PnidEstadosResult>(fetcher);
  return { ...result, itemsById: result.data?.itemsById ?? EMPTY.itemsById };
}
