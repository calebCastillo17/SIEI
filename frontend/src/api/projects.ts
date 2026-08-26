import { apiFetch } from './client';
import type { ProjectCreateInput, ProjectResponse, ProjectsResponse, ProjectUpdateInput } from './types';

interface ProjectMutationResponse {
  project: { id: string };
}

/** GET /api/projects */
export function listProjects(devUserEmail: string): Promise<ProjectsResponse> {
  return apiFetch<ProjectsResponse>('/api/projects', { devUserEmail });
}

/** GET /api/projects/:projectId */
export function getProject(
  projectId: string,
  devUserEmail: string
): Promise<ProjectResponse> {
  return apiFetch<ProjectResponse>(`/api/projects/${projectId}`, { devUserEmail });
}

/** Solo es_admin_sistema — un proyecto nuevo no tiene todavía filas en
 * usuario_proyecto_rol, así que no hay otra autoridad posible (ver
 * projects.ts en backend). */
export function createProject(
  input: ProjectCreateInput,
  devUserEmail: string
): Promise<ProjectMutationResponse> {
  return apiFetch<ProjectMutationResponse>('/api/projects', {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** Requiere permiso 'administer' en ESE proyecto (ADMIN del proyecto, o
 * es_admin_sistema). Solo code/name — mover de cliente no está soportado. */
export function updateProject(
  projectId: string,
  input: ProjectUpdateInput,
  devUserEmail: string
): Promise<ProjectMutationResponse> {
  return apiFetch<ProjectMutationResponse>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

/** Archiva el proyecto (activo=0) — no lo borra, y no toca su información
 * de ingeniería (ver CLAUDE.md, "Security model"). */
export function archiveProject(
  projectId: string,
  devUserEmail: string
): Promise<ProjectMutationResponse> {
  return apiFetch<ProjectMutationResponse>(`/api/projects/${projectId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
