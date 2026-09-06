import { apiFetch } from './client';
import type { ComponentesListResponse, ComponenteResponse } from './types';

/*
 * Fetcher genérico para las 17 tablas de componente del módulo Hojas de
 * Datos — mismo criterio que el factory createComponentRouter del
 * backend: un solo módulo parametrizado por `slug` en vez de 17 casi
 * idénticos. Los campos reales de cada tipo viven en
 * lib/componentSpecs.ts, no acá.
 */
const base = (projectId: string, fichaId: string, slug: string) =>
  `/api/projects/${projectId}/fichas-tecnicas/${fichaId}/componentes/${slug}`;

export function listComponentes(
  projectId: string,
  fichaId: string,
  slug: string,
  devUserEmail: string
): Promise<ComponentesListResponse> {
  return apiFetch<ComponentesListResponse>(base(projectId, fichaId, slug), { devUserEmail });
}

export function createComponente(
  projectId: string,
  fichaId: string,
  slug: string,
  input: Record<string, unknown>,
  devUserEmail: string
): Promise<ComponenteResponse> {
  return apiFetch<ComponenteResponse>(base(projectId, fichaId, slug), { method: 'POST', body: input, devUserEmail });
}

export function updateComponente(
  projectId: string,
  fichaId: string,
  slug: string,
  itemId: string,
  input: Record<string, unknown>,
  devUserEmail: string
): Promise<ComponenteResponse> {
  return apiFetch<ComponenteResponse>(`${base(projectId, fichaId, slug)}/${itemId}`, { method: 'PATCH', body: input, devUserEmail });
}

export function deactivateComponente(
  projectId: string,
  fichaId: string,
  slug: string,
  itemId: string,
  devUserEmail: string
) {
  return apiFetch(`${base(projectId, fichaId, slug)}/${itemId}`, { method: 'DELETE', devUserEmail });
}
