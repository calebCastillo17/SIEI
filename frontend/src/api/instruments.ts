import { apiFetch } from './client';
import type {
  InstrumentEliminacionResponse,
  InstrumentInput,
  InstrumentMutationResponse,
  InstrumentResponse,
  InstrumentsListResponse
} from './types';

const base = (projectId: string) => `/api/projects/${projectId}/instruments`;

/** GET /api/projects/:projectId/instruments */
export function listInstruments(
  projectId: string,
  devUserEmail: string
): Promise<InstrumentsListResponse> {
  return apiFetch<InstrumentsListResponse>(base(projectId), { devUserEmail });
}

/** GET /api/projects/:projectId/instruments/:instrumentId */
export function getInstrument(
  projectId: string,
  instrumentId: string,
  devUserEmail: string
): Promise<InstrumentResponse> {
  return apiFetch<InstrumentResponse>(`${base(projectId)}/${instrumentId}`, {
    devUserEmail
  });
}

/** POST /api/projects/:projectId/instruments */
export function createInstrument(
  projectId: string,
  input: InstrumentInput,
  devUserEmail: string
): Promise<InstrumentMutationResponse> {
  return apiFetch<InstrumentMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** PATCH /api/projects/:projectId/instruments/:instrumentId */
export function updateInstrument(
  projectId: string,
  instrumentId: string,
  input: Partial<InstrumentInput>,
  devUserEmail: string
): Promise<InstrumentMutationResponse> {
  return apiFetch<InstrumentMutationResponse>(`${base(projectId)}/${instrumentId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

/** DELETE /api/projects/:projectId/instruments/:instrumentId (desactivación lógica) */
export function deactivateInstrument(
  projectId: string,
  instrumentId: string,
  devUserEmail: string
): Promise<InstrumentMutationResponse> {
  return apiFetch<InstrumentMutationResponse>(`${base(projectId)}/${instrumentId}`, {
    method: 'DELETE',
    devUserEmail
  });
}

/** DELETE /api/projects/:projectId/instruments/:instrumentId con
 * `{ eliminarDefinitivamente: true }` (migración 011) — borrado físico
 * real, SOLO para un instrumento con estado P&ID = NO_EXISTE_EN_PNID.
 * Requiere permiso de administración del proyecto: 403 si el rol actual
 * no lo tiene, 409 si el instrumento no está en ese estado o si todavía
 * tiene señales/puntos de conexión/lazos/enlaces de comunicación reales. */
export function deleteInstrumentDefinitivamente(
  projectId: string,
  instrumentId: string,
  devUserEmail: string
): Promise<InstrumentEliminacionResponse> {
  return apiFetch<InstrumentEliminacionResponse>(`${base(projectId)}/${instrumentId}`, {
    method: 'DELETE',
    body: { eliminarDefinitivamente: true },
    devUserEmail
  });
}
