import { apiFetch } from './client';
import type { EntregableInput, EntregableResponse, EntregablesListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/entregables`;

/** GET /api/projects/:projectId/entregables */
export function listEntregables(
  projectId: string,
  devUserEmail: string
): Promise<EntregablesListResponse> {
  return apiFetch<EntregablesListResponse>(base(projectId), { devUserEmail });
}

/** GET /api/projects/:projectId/entregables/:entregableId */
export function getEntregable(
  projectId: string,
  entregableId: string,
  devUserEmail: string
): Promise<EntregableResponse> {
  return apiFetch<EntregableResponse>(`${base(projectId)}/${entregableId}`, { devUserEmail });
}

/** POST /api/projects/:projectId/entregables — congela etapa/proyecto/
 * cliente desde proyecto_documentacion en el momento de creación (ver
 * backend/src/routes/entregables.ts), no hace falta enviarlos. */
export function createEntregable(
  projectId: string,
  input: EntregableInput,
  devUserEmail: string
): Promise<EntregableResponse> {
  return apiFetch<EntregableResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}
