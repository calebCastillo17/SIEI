import { apiFetch } from './client';
import type { DocumentacionInput, DocumentacionResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/documentacion`;

/** GET /api/projects/:projectId/documentacion — nunca 404, todo NULL si
 * el proyecto todavía no cargó nada. */
export function getDocumentacion(
  projectId: string,
  devUserEmail: string
): Promise<DocumentacionResponse> {
  return apiFetch<DocumentacionResponse>(base(projectId), { devUserEmail });
}

/** PATCH /api/projects/:projectId/documentacion — upsert, requiere
 * 'administer'. */
export function updateDocumentacion(
  projectId: string,
  input: DocumentacionInput,
  devUserEmail: string
): Promise<DocumentacionResponse> {
  return apiFetch<DocumentacionResponse>(base(projectId), {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}
