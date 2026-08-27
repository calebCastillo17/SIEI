import { apiFetch } from './client';
import type { TiposEntregableResponse } from './types';

/** GET /api/catalogs/tipos-entregable — catálogo global, solo lectura. */
export function listTiposEntregable(devUserEmail: string): Promise<TiposEntregableResponse> {
  return apiFetch<TiposEntregableResponse>('/api/catalogs/tipos-entregable', { devUserEmail });
}
