import { useCallback } from 'react';

import { listTiposPlano } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import type { CatalogItem } from '../api/types';

export interface PlanoFormOptions {
  tiposPlano: CatalogItem[];
}

/**
 * Único catálogo que necesita el formulario de Planos — reutilizado entre
 * PlanoFormPage (crear) y PlanoDetailPage (editar), mismo motivo que
 * useSignalFormOptions.ts para varios catálogos a la vez.
 */
export function usePlanoFormOptions(devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<PlanoFormOptions> => {
    const tiposPlano = await listTiposPlano(devUserEmail);
    return { tiposPlano: tiposPlano.items };
  }, [devUserEmail]);

  return useAsyncData<PlanoFormOptions>(fetcher);
}
