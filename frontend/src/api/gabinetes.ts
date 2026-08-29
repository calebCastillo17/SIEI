import { apiFetch } from './client';
import type { GabineteInput, GabineteResponse, GabinetesListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/gabinetes`;

/**
 * POST/PATCH/DELETE devuelven una forma más chica que GET (ver
 * gabinetes.ts) — igual que en instrumentos/equipos/señales, solo se usa
 * `id`/`projectId` de la respuesta y se vuelve a pedir el detalle
 * completo con GET.
 */
interface GabineteMutationResponse {
  gabinete: { id: string; projectId: string };
}

export function listGabinetes(projectId: string, devUserEmail: string): Promise<GabinetesListResponse> {
  return apiFetch<GabinetesListResponse>(base(projectId), { devUserEmail });
}

export function getGabinete(
  projectId: string,
  gabineteId: string,
  devUserEmail: string
): Promise<GabineteResponse> {
  return apiFetch<GabineteResponse>(`${base(projectId)}/${gabineteId}`, { devUserEmail });
}

export function createGabinete(
  projectId: string,
  input: GabineteInput,
  devUserEmail: string
): Promise<GabineteMutationResponse> {
  return apiFetch<GabineteMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updateGabinete(
  projectId: string,
  gabineteId: string,
  input: Partial<GabineteInput>,
  devUserEmail: string
): Promise<GabineteMutationResponse> {
  return apiFetch<GabineteMutationResponse>(`${base(projectId)}/${gabineteId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateGabinete(
  projectId: string,
  gabineteId: string,
  devUserEmail: string
): Promise<GabineteMutationResponse> {
  return apiFetch<GabineteMutationResponse>(`${base(projectId)}/${gabineteId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
