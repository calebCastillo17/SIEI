import { apiFetch } from './client';
import type { RoutesListResponse, RouteResponse, RouteInput } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/routes`;

interface RouteMutationResponse {
  route: { id: string; projectId: string };
}

export function listRoutes(
  projectId: string,
  devUserEmail: string,
  senalId?: string
): Promise<RoutesListResponse> {
  const query = senalId ? `?senalId=${senalId}` : '';
  return apiFetch<RoutesListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

export function getRoute(
  projectId: string,
  routeId: string,
  devUserEmail: string
): Promise<RouteResponse> {
  return apiFetch<RouteResponse>(`${base(projectId)}/${routeId}`, { devUserEmail });
}

/**
 * Crea la ruta y todos sus tramos en un solo statement atómico (ver
 * connectionRoutes.ts en backend): el trigger de tramo_conexion revalida el
 * conjunto activo completo después de cada statement, así que un estado
 * intermedio terminando en una CAJA sería rechazado si se hiciera en pasos.
 */
export function createRoute(
  projectId: string,
  input: RouteInput,
  devUserEmail: string
): Promise<RouteMutationResponse> {
  return apiFetch<RouteMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function deactivateRoute(
  projectId: string,
  routeId: string,
  devUserEmail: string
): Promise<RouteMutationResponse> {
  return apiFetch<RouteMutationResponse>(`${base(projectId)}/${routeId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
