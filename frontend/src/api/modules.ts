import { apiFetch } from './client';
import type { ModulesListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/modules`;

interface ModuleMutationResponse {
  module: { id: string; projectId: string };
}

/** GET /api/projects/:projectId/modules?slotId= */
export function listModules(
  projectId: string,
  devUserEmail: string,
  slotId?: string
): Promise<ModulesListResponse> {
  const query = slotId ? `?slotId=${slotId}` : '';
  return apiFetch<ModulesListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

export function createModule(
  projectId: string,
  input: { slotId: string; catalogoModuloId: string },
  devUserEmail: string
): Promise<ModuleMutationResponse> {
  return apiFetch<ModuleMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** PATCH solo permite reasignar catalogoModuloId (ver modules.ts). */
export function updateModule(
  projectId: string,
  moduleId: string,
  catalogoModuloId: string,
  devUserEmail: string
): Promise<ModuleMutationResponse> {
  return apiFetch<ModuleMutationResponse>(`${base(projectId)}/${moduleId}`, {
    method: 'PATCH',
    body: { catalogoModuloId },
    devUserEmail
  });
}

export function deactivateModule(
  projectId: string,
  moduleId: string,
  devUserEmail: string
): Promise<ModuleMutationResponse> {
  return apiFetch<ModuleMutationResponse>(`${base(projectId)}/${moduleId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
