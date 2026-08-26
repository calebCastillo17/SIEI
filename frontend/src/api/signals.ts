import { apiFetch } from './client';
import type {
  SignalInput,
  SignalMutationResponse,
  SignalResponse,
  SignalsListResponse
} from './types';

const base = (projectId: string) => `/api/projects/${projectId}/signals`;

/** GET /api/projects/:projectId/signals */
export function listSignals(
  projectId: string,
  devUserEmail: string
): Promise<SignalsListResponse> {
  return apiFetch<SignalsListResponse>(base(projectId), { devUserEmail });
}

/** GET /api/projects/:projectId/signals/:signalId */
export function getSignal(
  projectId: string,
  signalId: string,
  devUserEmail: string
): Promise<SignalResponse> {
  return apiFetch<SignalResponse>(`${base(projectId)}/${signalId}`, { devUserEmail });
}

/**
 * En POST, backend/src/routes/signals.ts valida cada campo presente en el
 * body con `allowNull = false` (a diferencia de PATCH, donde sí se permite
 * `null` para poder limpiar un campo) — un campo opcional se deja afuera
 * del body en vez de mandarlo en `null`. SignalInput siempre trae todas
 * las claves (para que el formulario tenga un estado controlado
 * completo), así que hay que filtrar los `null` antes de crear.
 */
function omitNulls(input: SignalInput): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null)
  );
}

/** POST /api/projects/:projectId/signals */
export function createSignal(
  projectId: string,
  input: SignalInput,
  devUserEmail: string
): Promise<SignalMutationResponse> {
  return apiFetch<SignalMutationResponse>(base(projectId), {
    method: 'POST',
    body: omitNulls(input),
    devUserEmail
  });
}

/** PATCH /api/projects/:projectId/signals/:signalId */
export function updateSignal(
  projectId: string,
  signalId: string,
  input: Partial<SignalInput>,
  devUserEmail: string
): Promise<SignalMutationResponse> {
  return apiFetch<SignalMutationResponse>(`${base(projectId)}/${signalId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

/** DELETE /api/projects/:projectId/signals/:signalId (desactivación lógica) */
export function deactivateSignal(
  projectId: string,
  signalId: string,
  devUserEmail: string
): Promise<SignalMutationResponse> {
  return apiFetch<SignalMutationResponse>(`${base(projectId)}/${signalId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
