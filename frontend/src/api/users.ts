import { apiFetch } from './client';
import type { UsersListResponse, UserResponse, UserInput } from './types';

const base = '/api/users';

interface UserMutationResponse {
  user: { id: string };
}

/** Todo este router requiere es_admin_sistema, incluso GET (ver users.ts
 * en backend) — a diferencia de /api/clients. */
export function listUsers(devUserEmail: string): Promise<UsersListResponse> {
  return apiFetch<UsersListResponse>(base, { devUserEmail });
}

export function getUser(userId: string, devUserEmail: string): Promise<UserResponse> {
  return apiFetch<UserResponse>(`${base}/${userId}`, { devUserEmail });
}

/** Crea un usuario "pre-registrado" (sin auth_issuer/auth_subject, los
 * completa su primer login OIDC) — nunca esAdminSistema, el backend lo
 * rechaza si el body lo incluye. */
export function createUser(
  input: UserInput,
  devUserEmail: string
): Promise<UserMutationResponse> {
  return apiFetch<UserMutationResponse>(base, { method: 'POST', body: input, devUserEmail });
}

export function updateUser(
  userId: string,
  input: Partial<UserInput>,
  devUserEmail: string
): Promise<UserMutationResponse> {
  return apiFetch<UserMutationResponse>(`${base}/${userId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

/** Desactivación GLOBAL: el usuario pierde acceso a TODOS sus proyectos
 * (distinto de removeMember, que solo revoca uno). */
export function deactivateUser(
  userId: string,
  devUserEmail: string
): Promise<UserMutationResponse> {
  return apiFetch<UserMutationResponse>(`${base}/${userId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
