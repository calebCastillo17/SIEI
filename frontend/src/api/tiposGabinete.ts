import { apiFetch } from './client';
import type { TiposGabineteResponse } from './types';

/** GET /api/catalogs/tipos-gabinete — catálogo global, solo lectura. */
export function listTiposGabinete(devUserEmail: string): Promise<TiposGabineteResponse> {
  return apiFetch<TiposGabineteResponse>('/api/catalogs/tipos-gabinete', { devUserEmail });
}
