import { apiFetch } from './client';
import type { ClientsListResponse, ClientResponse, ClientInput } from './types';

const base = '/api/clients';

interface ClientMutationResponse {
  client: { id: string };
}

/** GET abierto a cualquier usuario autenticado (ver clients.ts en backend). */
export function listClients(devUserEmail: string): Promise<ClientsListResponse> {
  return apiFetch<ClientsListResponse>(base, { devUserEmail });
}

export function getClient(clientId: string, devUserEmail: string): Promise<ClientResponse> {
  return apiFetch<ClientResponse>(`${base}/${clientId}`, { devUserEmail });
}

/** Solo es_admin_sistema (ver requireSystemAdmin en clients.ts). */
export function createClient(
  input: ClientInput,
  devUserEmail: string
): Promise<ClientMutationResponse> {
  return apiFetch<ClientMutationResponse>(base, { method: 'POST', body: input, devUserEmail });
}

export function updateClient(
  clientId: string,
  input: Partial<ClientInput>,
  devUserEmail: string
): Promise<ClientMutationResponse> {
  return apiFetch<ClientMutationResponse>(`${base}/${clientId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivateClient(
  clientId: string,
  devUserEmail: string
): Promise<ClientMutationResponse> {
  return apiFetch<ClientMutationResponse>(`${base}/${clientId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
