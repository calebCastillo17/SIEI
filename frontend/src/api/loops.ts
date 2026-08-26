import { apiFetch } from './client';
import type { LoopsListResponse, LoopResponse, LoopInput } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/loops`;

interface LoopMutationResponse {
  loop: { id: string; projectId: string };
}

export function listLoops(
  projectId: string,
  devUserEmail: string,
  instrumentoId?: string
): Promise<LoopsListResponse> {
  const query = instrumentoId ? `?instrumentoId=${instrumentoId}` : '';
  return apiFetch<LoopsListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

export function getLoop(
  projectId: string,
  loopId: string,
  devUserEmail: string
): Promise<LoopResponse> {
  return apiFetch<LoopResponse>(`${base(projectId)}/${loopId}`, { devUserEmail });
}

export function createLoop(
  projectId: string,
  input: LoopInput,
  devUserEmail: string
): Promise<LoopMutationResponse> {
  return apiFetch<LoopMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** PATCH solo admite codigoDocumento — instrumentoId no es reasignable
 * (ver loops.ts en backend). */
export function updateLoop(
  projectId: string,
  loopId: string,
  codigoDocumento: string | null,
  devUserEmail: string
): Promise<LoopMutationResponse> {
  return apiFetch<LoopMutationResponse>(`${base(projectId)}/${loopId}`, {
    method: 'PATCH',
    body: { codigoDocumento },
    devUserEmail
  });
}

export function deactivateLoop(
  projectId: string,
  loopId: string,
  devUserEmail: string
): Promise<LoopMutationResponse> {
  return apiFetch<LoopMutationResponse>(`${base(projectId)}/${loopId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
