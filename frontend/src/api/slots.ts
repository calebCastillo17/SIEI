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

/** Borrado FÍSICO real (no desactivación — un slot no tiene valor
 * histórico propio, pedido explícito del usuario). Cascada a su módulo si
 * tiene uno, siempre que esté realmente vacío (sin señal activa, sin
 * punto de conexión real, sin terminación real ocupando una posición). El
 * backend renumera solo (sin huecos) los demás slots activos del mismo
 * rack cuyo numeroSlot era mayor al eliminado — `slotsRenumerados` dice
 * cuántos bajaron. `advertenciaRetagear` = el módulo de este slot tenía
 * tag/surgeProtectorTag/TB propios asignados: esos NO se renumeran solos
 * (son texto libre del usuario), así que puede hacer falta revisarlos a
 * mano después de este corrimiento. */
export interface SlotDeletionResponse extends SlotMutationResponse {
  slotsRenumerados: number;
  advertenciaRetagear: boolean;
}

export function deleteSlot(
  projectId: string,
  slotId: string,
  devUserEmail: string
): Promise<SlotDeletionResponse> {
  return apiFetch<SlotDeletionResponse>(`${base(projectId)}/${slotId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
