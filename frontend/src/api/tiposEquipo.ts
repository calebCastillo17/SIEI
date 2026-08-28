import { apiFetch } from './client';
import type { TiposEquipoResponse } from './types';

/** GET /api/catalogs/tipos-equipo — catálogo global, solo lectura. */
export function listTiposEquipo(devUserEmail: string): Promise<TiposEquipoResponse> {
  return apiFetch<TiposEquipoResponse>('/api/catalogs/tipos-equipo', { devUserEmail });
}
