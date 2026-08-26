import { apiFetch } from './client';
import type {
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
