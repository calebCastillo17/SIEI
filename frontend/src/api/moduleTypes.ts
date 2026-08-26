import { apiFetch } from './client';
import type { ModuleTypesListResponse } from './types';

/**
 * cat.cat_modulo_io — catálogo GLOBAL (no cuelga de un proyecto). GET es
 * para cualquier usuario autenticado; POST está gateado por
 * requireSystemAdmin en el backend (es_admin_sistema), así que no lo
 * exponemos como acción de este módulo — el frontend no tiene todavía
 * ninguna pantalla de administración de catálogos de sistema.
 */
export function listModuleTypes(devUserEmail: string): Promise<ModuleTypesListResponse> {
  return apiFetch<ModuleTypesListResponse>('/api/catalogs/module-types', { devUserEmail });
}
