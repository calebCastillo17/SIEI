import { apiFetch } from './client';
import type { MembersListResponse, MemberResponse, MemberInput, ProjectRole } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/members`;

/** GET requiere solo 'read'; POST/PATCH/DELETE requieren 'administer' (ver
 * members.ts en backend). */
export function listMembers(
  projectId: string,
  devUserEmail: string
): Promise<MembersListResponse> {
  return apiFetch<MembersListResponse>(base(projectId), { devUserEmail });
}

/** Si el email no existe todavía como usuario, lo pre-registra en el mismo
 * paso (por eso `nombre` es obligatorio en el input, aunque el backend
 * solo lo usa cuando hace falta crear el usuario). */
export function addMember(
  projectId: string,
  input: MemberInput,
  devUserEmail: string
): Promise<MemberResponse> {
  return apiFetch<MemberResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** Cambiar de rol desactiva la asignación vigente y crea una nueva — no es
 * un UPDATE en el sitio (ver members.ts en backend). */
export function updateMemberRole(
  projectId: string,
  userId: string,
  rol: ProjectRole,
  devUserEmail: string
): Promise<MemberResponse> {
  return apiFetch<MemberResponse>(`${base(projectId)}/${userId}`, {
    method: 'PATCH',
    body: { rol },
    devUserEmail
  });
}

/** Revoca el acceso a ESTE proyecto únicamente — no toca el registro
 * global del usuario (para eso está deactivateUser en users.ts). */
export function removeMember(
  projectId: string,
  userId: string,
  devUserEmail: string
): Promise<{ member: { usuarioId: string; projectId: string } }> {
  return apiFetch(`${base(projectId)}/${userId}`, { method: 'DELETE', devUserEmail });
}
