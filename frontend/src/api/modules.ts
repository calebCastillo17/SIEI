import { apiFetch } from './client';
import type { ModulesListResponse, PhysicalModule } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/modules`;

interface ModuleMutationResponse {
  module: { id: string; projectId: string };
}

/** GET /api/projects/:projectId/modules?slotId= */
export function listModules(
  projectId: string,
  devUserEmail: string,
  slotId?: string
): Promise<ModulesListResponse> {
  const query = slotId ? `?slotId=${slotId}` : '';
  return apiFetch<ModulesListResponse>(`${base(projectId)}${query}`, { devUserEmail });
}

/** GET /api/projects/:projectId/modules/:moduleId — detalle completo de
 * UN módulo (incluye tag/surgeProtectorTag) sin traer el resto del rack. */
export function getModule(
  projectId: string,
  moduleId: string,
  devUserEmail: string
): Promise<{ module: PhysicalModule }> {
  return apiFetch<{ module: PhysicalModule }>(`${base(projectId)}/${moduleId}`, { devUserEmail });
}

/** tag/surgeProtectorTag opcionales — si `tag` se omite, el backend sugiere
 * uno (tipo + posición entre los del mismo tipo en el rack, migración 017). */
export function createModule(
  projectId: string,
  input: { slotId: string; catalogoModuloId: string; tag?: string | null; surgeProtectorTag?: string | null },
  devUserEmail: string
): Promise<ModuleMutationResponse> {
  return apiFetch<ModuleMutationResponse>(base(projectId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** catalogoModuloId, tag, surgeProtectorTag y planoId (migración 024) se
 * pueden editar por separado (al menos uno requerido) — tag/
 * surgeProtectorTag/planoId aceptan `null` explícito para quitarlos (ver
 * modules.ts). Asignar planoId puede devolver 409
 * module_plano_gabinete_conflict si el módulo es de un gabinete distinto
 * al de otros módulos ya asignados a ese mismo plano. */
export function updateModule(
  projectId: string,
  moduleId: string,
  input: { catalogoModuloId?: string; tag?: string | null; surgeProtectorTag?: string | null; planoId?: string | null },
  devUserEmail: string
): Promise<ModuleMutationResponse> {
  return apiFetch<ModuleMutationResponse>(`${base(projectId)}/${moduleId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

/** Borrado FÍSICO real (no desactivación — pedido explícito del usuario),
 * solo si el módulo está realmente vacío (sin señal activa, sin punto de
 * conexión real, sin terminación real ocupando una posición). El slot
 * queda vacío, no se toca — para borrarlo también, ver deleteSlot. */
export function deleteModule(
  projectId: string,
  moduleId: string,
  devUserEmail: string
): Promise<ModuleMutationResponse> {
  return apiFetch<ModuleMutationResponse>(`${base(projectId)}/${moduleId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
