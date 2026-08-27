import { apiFetch } from './client';
import type {
  PnidApplyResponse,
  PnidDiscardResponse,
  PnidImportDetailResponse,
  PnidImportsListResponse,
  PnidPreviewResponse
} from './types';

const base = (projectId: string) => `/api/projects/${projectId}/pnid-imports`;

/** GET /api/projects/:projectId/pnid-imports */
export function listPnidImports(
  projectId: string,
  devUserEmail: string
): Promise<PnidImportsListResponse> {
  return apiFetch<PnidImportsListResponse>(base(projectId), { devUserEmail });
}

/** GET /api/projects/:projectId/pnid-imports/:importId — cabecera +
 * TODOS sus resultados (el backend no pagina ni filtra esta respuesta,
 * ver comentario en pnidImports.ts: "el volumen esperado es chico"). */
export function getPnidImport(
  projectId: string,
  importId: string,
  devUserEmail: string
): Promise<PnidImportDetailResponse> {
  return apiFetch<PnidImportDetailResponse>(`${base(projectId)}/${importId}`, {
    devUserEmail
  });
}

/** POST /api/projects/:projectId/pnid-imports/preview (multipart, campo
 * "file"). Nunca toca nucleo.instrumento — solo persiste el snapshot y la
 * comparación (ver pnidImportsRouter). */
export function previewPnidImport(
  projectId: string,
  file: File,
  devUserEmail: string
): Promise<PnidPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);

  return apiFetch<PnidPreviewResponse>(`${base(projectId)}/preview`, {
    method: 'POST',
    body: formData,
    devUserEmail
  });
}

/** POST /api/projects/:projectId/pnid-imports/:importId/apply — respuesta
 * angosta (sin conteos): quien llama debe volver a pedir el detalle con
 * getPnidImport() para mostrar un resumen posterior a aplicar. */
export function applyPnidImport(
  projectId: string,
  importId: string,
  devUserEmail: string
): Promise<PnidApplyResponse> {
  return apiFetch<PnidApplyResponse>(`${base(projectId)}/${importId}/apply`, {
    method: 'POST',
    devUserEmail
  });
}

/** DELETE /api/projects/:projectId/pnid-imports/:importId — descarta un
 * import todavía en PREVISUALIZADO (409 import_not_discardable si no). */
export function discardPnidImport(
  projectId: string,
  importId: string,
  devUserEmail: string
): Promise<PnidDiscardResponse> {
  return apiFetch<PnidDiscardResponse>(`${base(projectId)}/${importId}`, {
    method: 'DELETE',
    devUserEmail
  });
}
