import { apiFetch } from './client';
import type { PortsListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/ports`;

interface PortMutationResponse {
  port: { id: string; projectId: string };
}

export function listPorts(
  projectId: string,
  devUserEmail: string,
  switchId?: string
): Promise<PortsListResponse> {
  const query = switchId ? `?switchId=${switchId}` : '';
  return apiFetch<PortsListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

export function createPort(
  projectId: string,
  input: { switchId: string; numeroPuerto: number },
  devUserEmail: string
): Promise<PortMutationResponse> {
  return apiFetch<PortMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updatePort(
  projectId: string,
  portId: string,
  numeroPuerto: number,
  devUserEmail: string
): Promise<PortMutationResponse> {
  return apiFetch<PortMutationResponse>(`${base(projectId)}/${portId}`, {
    method: 'PATCH',
    body: { numeroPuerto },
    devUserEmail
  });
}

export function deactivatePort(
  projectId: string,
  portId: string,
  devUserEmail: string
): Promise<PortMutationResponse> {
  return apiFetch<PortMutationResponse>(`${base(projectId)}/${portId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
