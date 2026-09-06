import { apiFetch } from './client';
import type { TagProceso, TagProcesoInput } from './types';

const base = (projectId: string, instrumentId: string) => `/api/projects/${projectId}/instruments/${instrumentId}/tag-proceso`;

export function listTagProceso(projectId: string, instrumentId: string, devUserEmail: string): Promise<{ tagProceso: TagProceso[] }> {
  return apiFetch(base(projectId, instrumentId), { devUserEmail });
}

export function createTagProceso(
  projectId: string,
  instrumentId: string,
  input: Partial<TagProcesoInput>,
  devUserEmail: string
): Promise<{ tagProceso: TagProceso }> {
  return apiFetch(base(projectId, instrumentId), { method: 'POST', body: input, devUserEmail });
}

export function updateTagProceso(
  projectId: string,
  instrumentId: string,
  id: string,
  input: Partial<TagProcesoInput>,
  devUserEmail: string
): Promise<{ tagProceso: TagProceso }> {
  return apiFetch(`${base(projectId, instrumentId)}/${id}`, { method: 'PATCH', body: input, devUserEmail });
}

export function deactivateTagProceso(projectId: string, instrumentId: string, id: string, devUserEmail: string) {
  return apiFetch(`${base(projectId, instrumentId)}/${id}`, { method: 'DELETE', devUserEmail });
}
