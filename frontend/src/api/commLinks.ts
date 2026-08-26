import { apiFetch } from './client';
import type { CommLinksListResponse, CommLinkInput } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/comm-links`;

interface CommLinkMutationResponse {
  commLink: { id: string; projectId: string };
}

/** GET no admite filtrar por puertoId (ver commLinks.ts en backend) — trae
 * todos los enlaces activos del proyecto; filtrar por puerto se hace en
 * el cliente, igual que con la jerarquía física de RIOs. */
export function listCommLinks(
  projectId: string,
  devUserEmail: string
): Promise<CommLinksListResponse> {
  return apiFetch<CommLinksListResponse>(base(projectId), { devUserEmail });
}

/** POST tolera null explícito en los campos opcionales (ver commLinks.ts en backend). */
export function createCommLink(
  projectId: string,
  input: CommLinkInput,
  devUserEmail: string
): Promise<CommLinkMutationResponse> {
  return apiFetch<CommLinkMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updateCommLink(
  projectId: string,
  commLinkId: string,
  input: Partial<Omit<CommLinkInput, 'puertoId'>>,
  devUserEmail: string
): Promise<CommLinkMutationResponse> {
  return apiFetch<CommLinkMutationResponse>(`${base(projectId)}/${commLinkId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateCommLink(
  projectId: string,
  commLinkId: string,
  devUserEmail: string
): Promise<CommLinkMutationResponse> {
  return apiFetch<CommLinkMutationResponse>(`${base(projectId)}/${commLinkId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
