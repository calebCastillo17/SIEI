import { apiFetch } from './client';
import type { ConductorPairsListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/conductor-pairs`;

interface ConductorPairMutationResponse {
  conductorPair: { id: string; projectId: string };
}

export function listConductorPairs(
  projectId: string,
  devUserEmail: string,
  cableId?: string
): Promise<ConductorPairsListResponse> {
  const query = cableId ? `?cableId=${cableId}` : '';
  return apiFetch<ConductorPairsListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

/** No hay PATCH/DELETE: nucleo.par_conductor no tiene columna activo (ver conductorPairs.ts). */
export function createConductorPair(
  projectId: string,
  input: { cableId: string; numeroPar: number },
  devUserEmail: string
): Promise<ConductorPairMutationResponse> {
  return apiFetch<ConductorPairMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}
