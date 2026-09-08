import { apiFetch } from './client';
import type { TuberiasListResponse, TuberiaResponse, TuberiaInput, PendientesTuberiaResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/tuberias`;

export function listTuberias(projectId: string, devUserEmail: string): Promise<TuberiasListResponse> {
  return apiFetch<TuberiasListResponse>(base(projectId), { devUserEmail });
}

export function getTuberia(projectId: string, tuberiaId: string, devUserEmail: string): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(`${base(projectId)}/${tuberiaId}`, { devUserEmail });
}

export function createTuberia(projectId: string, input: Partial<TuberiaInput>, devUserEmail: string): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(base(projectId), { method: 'POST', body: input, devUserEmail });
}

/** Solo acepta las propiedades editables (tamaño/material/etc.) — tagLinea/
 * tagAnterior los rechaza el backend: la línea la define el P&ID. */
export function updateTuberia(
  projectId: string,
  tuberiaId: string,
  input: Partial<Omit<TuberiaInput, 'tagLinea' | 'tagAnterior'>>,
  devUserEmail: string
): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(`${base(projectId)}/${tuberiaId}`, { method: 'PATCH', body: input, devUserEmail });
}

export function deactivateTuberia(projectId: string, tuberiaId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${tuberiaId}`, { method: 'DELETE', devUserEmail });
}

/** Borrado físico real — solo permitido si ningún instrumento activo usa
 * esta tubería (el backend lo valida igual). */
export function deleteTuberiaDefinitivamente(projectId: string, tuberiaId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${tuberiaId}`, { method: 'DELETE', body: { eliminarDefinitivamente: true }, devUserEmail });
}

/** Instrumentos cuya línea de P&ID no coincide con su tubería en HD (o que
 * nunca tuvieron tubería vinculada). */
export function listPendientesTuberias(projectId: string, devUserEmail: string): Promise<PendientesTuberiaResponse> {
  return apiFetch<PendientesTuberiaResponse>(`${base(projectId)}/pendientes`, { devUserEmail });
}

/** Resuelve un pendiente tipo CAMBIO actualizando la MISMA tubería (el P&ID
 * solo corrigió/renombró el rótulo). */
export function actualizarTagDesdePnid(
  projectId: string,
  tuberiaId: string,
  instrumentId: string,
  devUserEmail: string
): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(`${base(projectId)}/${tuberiaId}/actualizar-tag-desde-pnid`, {
    method: 'POST',
    body: { instrumentId },
    devUserEmail
  });
}

/** Resuelve un pendiente (CAMBIO o FALTANTE) creando una tubería NUEVA para
 * ese instrumento puntual, clonando propiedades si ya tenía una. */
export function crearTuberiaDesdePnid(projectId: string, instrumentId: string, devUserEmail: string): Promise<TuberiaResponse> {
  return apiFetch<TuberiaResponse>(`${base(projectId)}/crear-desde-pnid`, {
    method: 'POST',
    body: { instrumentId },
    devUserEmail
  });
}
