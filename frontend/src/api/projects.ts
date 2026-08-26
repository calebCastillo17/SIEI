import { apiFetch } from './client';
import type { ProjectResponse, ProjectsResponse } from './types';

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
