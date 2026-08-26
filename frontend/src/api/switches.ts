import { apiFetch } from './client';
import type { SwitchesListResponse, SwitchInput, SwitchResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/switches`;

interface SwitchMutationResponse {
  switch: { id: string; projectId: string };
}

export function listSwitches(
  projectId: string,
  devUserEmail: string
): Promise<SwitchesListResponse> {
  return apiFetch<SwitchesListResponse>(base(projectId), { devUserEmail });
}

export function getSwitch(
  projectId: string,
  switchId: string,
  devUserEmail: string
): Promise<SwitchResponse> {
  return apiFetch<SwitchResponse>(`${base(projectId)}/${switchId}`, { devUserEmail });
}

export function createSwitch(
  projectId: string,
  input: SwitchInput,
  devUserEmail: string
): Promise<SwitchMutationResponse> {
  return apiFetch<SwitchMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updateSwitch(
  projectId: string,
  switchId: string,
  input: Partial<SwitchInput>,
  devUserEmail: string
): Promise<SwitchMutationResponse> {
  return apiFetch<SwitchMutationResponse>(`${base(projectId)}/${switchId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateSwitch(
  projectId: string,
  switchId: string,
  devUserEmail: string
): Promise<SwitchMutationResponse> {
  return apiFetch<SwitchMutationResponse>(`${base(projectId)}/${switchId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
