import { apiFetch } from './client';
import type { RacksListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/racks`;

interface RackMutationResponse {
  rack: { id: string; projectId: string };
}

/** GET /api/projects/:projectId/racks?rioId= */
export function listRacks(
  projectId: string,
  devUserEmail: string,
  rioId?: string
): Promise<RacksListResponse> {
  const query = rioId ? `?rioId=${rioId}` : '';
  return apiFetch<RacksListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

export function createRack(
  projectId: string,
  input: { rioId: string; numeroRack: number },
  devUserEmail: string
): Promise<RackMutationResponse> {
  return apiFetch<RackMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function deactivateRack(
  projectId: string,
  rackId: string,
  devUserEmail: string
): Promise<RackMutationResponse> {
  return apiFetch<RackMutationResponse>(`${base(projectId)}/${rackId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
