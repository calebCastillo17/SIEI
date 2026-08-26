import { apiFetch } from './client';
import type { SlotsListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/slots`;

interface SlotMutationResponse {
  slot: { id: string; projectId: string };
}

/** GET /api/projects/:projectId/slots?rackId= */
export function listSlots(
  projectId: string,
  devUserEmail: string,
  rackId?: string
): Promise<SlotsListResponse> {
  const query = rackId ? `?rackId=${rackId}` : '';
  return apiFetch<SlotsListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

export function createSlot(
  projectId: string,
  input: { rackId: string; numeroSlot: number },
  devUserEmail: string
): Promise<SlotMutationResponse> {
  return apiFetch<SlotMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function deactivateSlot(
  projectId: string,
  slotId: string,
  devUserEmail: string
): Promise<SlotMutationResponse> {
  return apiFetch<SlotMutationResponse>(`${base(projectId)}/${slotId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
