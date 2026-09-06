import { apiFetch } from './client';
import type { TuberiasListResponse, TuberiaResponse, TuberiaInput } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/tuberias`;

export function listTuberias(projectId: string, devUserEmail: string): Promise<TuberiasListResponse> {
  return apiFetch<TuberiasListResponse>(base(projectId), { devUserEmail });
}

export function getTuberia(projectId: string, tuberiaId: string, devUserEmail: string): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(`${base(projectId)}/${tuberiaId}`, { devUserEmail });
}

export function createTuberia(projectId: string, input: Partial<TuberiaInput>, devUserEmail: string): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(base(projectId), { method: 'POST', body: input, devUserEmail });
}

export function updateTuberia(
  projectId: string,
  tuberiaId: string,
  input: Partial<TuberiaInput>,
  devUserEmail: string
): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(`${base(projectId)}/${tuberiaId}`, { method: 'PATCH', body: input, devUserEmail });
}

export function deactivateTuberia(projectId: string, tuberiaId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${tuberiaId}`, { method: 'DELETE', devUserEmail });
}
