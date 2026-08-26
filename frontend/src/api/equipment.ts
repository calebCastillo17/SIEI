import { apiFetch } from './client';
import type { EquipmentListResponse } from './types';

/**
 * Solo lectura por ahora: Señales necesita poder elegir un equipo como
 * dueño (equipoId), pero el CRUD de Equipos todavía no tiene su propia
 * pantalla en el frontend — eso llega cuando le toque su propio módulo.
 */
export function listEquipment(
  projectId: string,
  devUserEmail: string
): Promise<EquipmentListResponse> {
  return apiFetch<EquipmentListResponse>(`/api/projects/${projectId}/equipment`, {
    devUserEmail
  });
}
