import { apiFetch } from './client';
import type {
  EquipmentInput,
  EquipmentListResponse,
  EquipmentMutationResponse,
  EquipmentResponse
} from './types';

const base = (projectId: string) => `/api/projects/${projectId}/equipment`;

/** GET /api/projects/:projectId/equipment */
export function listEquipment(
  projectId: string,
  devUserEmail: string
): Promise<EquipmentListResponse> {
  return apiFetch<EquipmentListResponse>(base(projectId), { devUserEmail });
}

/** GET /api/projects/:projectId/equipment/:equipmentId */
export function getEquipment(
  projectId: string,
  equipmentId: string,
  devUserEmail: string
): Promise<EquipmentResponse> {
  return apiFetch<EquipmentResponse>(`${base(projectId)}/${equipmentId}`, { devUserEmail });
}

/** POST /api/projects/:projectId/equipment */
export function createEquipment(
  projectId: string,
  input: EquipmentInput,
  devUserEmail: string
): Promise<EquipmentMutationResponse> {
  return apiFetch<EquipmentMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** PATCH /api/projects/:projectId/equipment/:equipmentId */
export function updateEquipment(
  projectId: string,
  equipmentId: string,
  input: Partial<EquipmentInput>,
  devUserEmail: string
): Promise<EquipmentMutationResponse> {
  return apiFetch<EquipmentMutationResponse>(`${base(projectId)}/${equipmentId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

/** DELETE /api/projects/:projectId/equipment/:equipmentId (desactivación lógica) */
export function deactivateEquipment(
  projectId: string,
  equipmentId: string,
  devUserEmail: string
): Promise<EquipmentMutationResponse> {
  return apiFetch<EquipmentMutationResponse>(`${base(projectId)}/${equipmentId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
