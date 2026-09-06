import { apiFetch } from './client';
import type { Sitio, SitioInput } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/sitios`;

export function getSitio(projectId: string, devUserEmail: string): Promise<{ sitio: Sitio | null }> {
  return apiFetch(base(projectId), { devUserEmail });
}

export function createSitio(projectId: string, input: Partial<SitioInput>, devUserEmail: string): Promise<{ sitio: Sitio }> {
  return apiFetch(base(projectId), { method: 'POST', body: input, devUserEmail });
}

export function updateSitio(projectId: string, input: Partial<SitioInput>, devUserEmail: string): Promise<{ sitio: Sitio }> {
  return apiFetch(base(projectId), { method: 'PATCH', body: input, devUserEmail });
}
