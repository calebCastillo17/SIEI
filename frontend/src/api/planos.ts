import { apiFetch } from './client';
import type { PlanoInput, PlanoResponse, PlanoMutationResponse, PlanosListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/planos`;

export interface PlanosListFilters {
  tipoPlanoId?: string;
  gabineteId?: string;
  cajaId?: string;
}

export function listPlanos(
  projectId: string,
  devUserEmail: string,
  filters: PlanosListFilters = {}
): Promise<PlanosListResponse> {
  const params = new URLSearchParams();
  if (filters.tipoPlanoId) params.set('tipoPlanoId', filters.tipoPlanoId);
  if (filters.gabineteId) params.set('gabineteId', filters.gabineteId);
  if (filters.cajaId) params.set('cajaId', filters.cajaId);

  const query = params.toString();
  return apiFetch<PlanosListResponse>(`${base(projectId)}${query ? `?${query}` : ''}`, { devUserEmail });
}

export function getPlano(
  projectId: string,
  planoId: string,
  devUserEmail: string
): Promise<PlanoResponse> {
  return apiFetch<PlanoResponse>(`${base(projectId)}/${planoId}`, { devUserEmail });
}

/** POST/PATCH devuelven el detalle completo (incluye gabinetes/cajas
 * asociados), no una forma reducida — ver fetchPlanoDetail en el backend. */
export function createPlano(
  projectId: string,
  input: PlanoInput,
  devUserEmail: string
): Promise<PlanoResponse> {
  return apiFetch<PlanoResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export function updatePlano(
  projectId: string,
  planoId: string,
  input: Partial<PlanoInput>,
  devUserEmail: string
): Promise<PlanoResponse> {
  return apiFetch<PlanoResponse>(`${base(projectId)}/${planoId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

export function deactivatePlano(
  projectId: string,
  planoId: string,
  devUserEmail: string
): Promise<PlanoMutationResponse> {
  return apiFetch<PlanoMutationResponse>(`${base(projectId)}/${planoId}`, {
    method: 'DELETE',
    devUserEmail
  });
}

/** Asociaciones N:M — si ya existía la misma pareja inactiva, el backend
 * la reactiva en vez de crear una fila nueva (mismo `plano` de detalle
 * devuelto en ambos casos, 200 o 201 según corresponda). */
export function associateGabinete(
  projectId: string,
  planoId: string,
  gabineteId: string,
  devUserEmail: string
): Promise<PlanoResponse> {
  return apiFetch<PlanoResponse>(`${base(projectId)}/${planoId}/gabinetes`, {
    method: 'POST',
    body: { gabineteId },
    devUserEmail
  });
}

export function disassociateGabinete(
  projectId: string,
  planoId: string,
  gabineteId: string,
  devUserEmail: string
): Promise<PlanoResponse> {
  return apiFetch<PlanoResponse>(`${base(projectId)}/${planoId}/gabinetes/${gabineteId}`, {
    method: 'DELETE',
    devUserEmail
  });
}

export function associateCaja(
  projectId: string,
  planoId: string,
  cajaId: string,
  devUserEmail: string
): Promise<PlanoResponse> {
  return apiFetch<PlanoResponse>(`${base(projectId)}/${planoId}/cajas`, {
    method: 'POST',
    body: { cajaId },
    devUserEmail
  });
}

export function disassociateCaja(
  projectId: string,
  planoId: string,
  cajaId: string,
  devUserEmail: string
): Promise<PlanoResponse> {
  return apiFetch<PlanoResponse>(`${base(projectId)}/${planoId}/cajas/${cajaId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
