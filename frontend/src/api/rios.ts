import { apiFetch } from './client';
import type { RioInput, RioResponse, RiosListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/rios`;

/**
 * POST/PATCH/DELETE devuelven una forma más chica que GET (ver rios.ts) —
 * igual que en instrumentos/equipos/señales, solo se usa `id`/`projectId`
 * de la respuesta y se vuelve a pedir el detalle completo con GET.
 */
interface RioMutationResponse {
  rio: { id: string; projectId: string };
}

export function listRios(projectId: string, devUserEmail: string): Promise<RiosListResponse> {
  return apiFetch<RiosListResponse>(base(projectId), { devUserEmail });
}

export function getRio(
  projectId: string,
  rioId: string,
  devUserEmail: string
): Promise<RioResponse> {
  return apiFetch<RioResponse>(`${base(projectId)}/${rioId}`, { devUserEmail });
}

export function createRio(
  projectId: string,
  input: RioInput,
  devUserEmail: string
): Promise<RioMutationResponse> {
  return apiFetch<RioMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updateRio(
  projectId: string,
  rioId: string,
  input: Partial<RioInput>,
  devUserEmail: string
): Promise<RioMutationResponse> {
  return apiFetch<RioMutationResponse>(`${base(projectId)}/${rioId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateRio(
  projectId: string,
  rioId: string,
  devUserEmail: string
): Promise<RioMutationResponse> {
  return apiFetch<RioMutationResponse>(`${base(projectId)}/${rioId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
