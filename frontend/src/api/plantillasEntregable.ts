import { apiFetch } from './client';
import type { PlantillaMutationResponse, PlantillasListResponse } from './types';

const base = (projectId: string) => `/api/projects/${projectId}/plantillas-entregable`;

/** GET /api/projects/:projectId/plantillas-entregable — trae también las
 * históricas (activo=false), no solo la vigente. */
export function listPlantillas(
  projectId: string,
  devUserEmail: string
): Promise<PlantillasListResponse> {
  return apiFetch<PlantillasListResponse>(base(projectId), { devUserEmail });
}

/** POST /api/projects/:projectId/plantillas-entregable (multipart) —
 * "reemplazar" desde el punto de vista de la API: desactiva la vigente
 * para ese tipo e inserta esta como la nueva activa. Requiere
 * 'administer'. */
export function uploadPlantilla(
  projectId: string,
  file: File,
  tipoEntregableId: string,
  devUserEmail: string
): Promise<PlantillaMutationResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tipoEntregableId', tipoEntregableId);

  return apiFetch<PlantillaMutationResponse>(base(projectId), {
    method: 'POST',
    body: formData,
    devUserEmail
  });
}
