import { apiFetch } from './client';
import type { CablesListResponse, CableInput, CableResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/cables`;

interface CableMutationResponse {
  cable: { id: string; projectId: string };
}

export function listCables(
  projectId: string,
  devUserEmail: string
): Promise<CablesListResponse> {
  return apiFetch<CablesListResponse>(base(projectId), { devUserEmail });
}

export function getCable(
  projectId: string,
  cableId: string,
  devUserEmail: string
): Promise<CableResponse> {
  return apiFetch<CableResponse>(`${base(projectId)}/${cableId}`, { devUserEmail });
}

export function createCable(
  projectId: string,
  input: CableInput,
  devUserEmail: string
): Promise<CableMutationResponse> {
  return apiFetch<CableMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updateCable(
  projectId: string,
  cableId: string,
  input: Partial<CableInput>,
  devUserEmail: string
): Promise<CableMutationResponse> {
  return apiFetch<CableMutationResponse>(`${base(projectId)}/${cableId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateCable(
  projectId: string,
  cableId: string,
  devUserEmail: string
): Promise<CableMutationResponse> {
  return apiFetch<CableMutationResponse>(`${base(projectId)}/${cableId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
