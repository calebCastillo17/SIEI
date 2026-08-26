import { apiFetch } from './client';
import type { BoxesListResponse, BoxInput, BoxResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/boxes`;

interface BoxMutationResponse {
  box: { id: string; projectId: string };
}

export function listBoxes(
  projectId: string,
  devUserEmail: string
): Promise<BoxesListResponse> {
  return apiFetch<BoxesListResponse>(base(projectId), { devUserEmail });
}

export function getBox(
  projectId: string,
  boxId: string,
  devUserEmail: string
): Promise<BoxResponse> {
  return apiFetch<BoxResponse>(`${base(projectId)}/${boxId}`, { devUserEmail });
}

export function createBox(
  projectId: string,
  input: BoxInput,
  devUserEmail: string
): Promise<BoxMutationResponse> {
  return apiFetch<BoxMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updateBox(
  projectId: string,
  boxId: string,
  input: Partial<BoxInput>,
  devUserEmail: string
): Promise<BoxMutationResponse> {
  return apiFetch<BoxMutationResponse>(`${base(projectId)}/${boxId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateBox(
  projectId: string,
  boxId: string,
  devUserEmail: string
): Promise<BoxMutationResponse> {
  return apiFetch<BoxMutationResponse>(`${base(projectId)}/${boxId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
