import { apiFetch } from './client';
import type {
  ConnectionPointsListResponse,
  ConnectionPointInput,
  ConnectionPointOwnerField
} from './types';

const base = (projectId: string) => `/api/projects/${projectId}/connection-points`;

interface ConnectionPointMutationResponse {
  connectionPoint: { id: string; projectId: string };
}

export function listConnectionPoints(
  projectId: string,
  devUserEmail: string,
  owner?: { field: ConnectionPointOwnerField; id: string }
): Promise<ConnectionPointsListResponse> {
  const query = owner ? `?${owner.field}=${owner.id}` : '';
  return apiFetch<ConnectionPointsListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

/** Exactamente uno de los 5 campos de dueño en `input` debe tener valor (XOR, ver connectionPoints.ts). */
export function createConnectionPoint(
  projectId: string,
  input: ConnectionPointInput,
  devUserEmail: string
): Promise<ConnectionPointMutationResponse> {
  return apiFetch<ConnectionPointMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** PATCH solo permite los campos descriptivos, nunca reasignar el dueño (ver connectionPoints.ts). */
export type ConnectionPointEditableInput = Pick<
  ConnectionPointInput,
  'regleta' | 'bornera' | 'borne' | 'lado' | 'circuito' | 'hilo' | 'descripcion'
>;

export function updateConnectionPoint(
  projectId: string,
  pointId: string,
  input: Partial<ConnectionPointEditableInput>,
  devUserEmail: string
): Promise<ConnectionPointMutationResponse> {
  return apiFetch<ConnectionPointMutationResponse>(`${base(projectId)}/${pointId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateConnectionPoint(
  projectId: string,
  pointId: string,
  devUserEmail: string
): Promise<ConnectionPointMutationResponse> {
  return apiFetch<ConnectionPointMutationResponse>(`${base(projectId)}/${pointId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
