import { apiFetch, ApiError, API_BASE_URL } from './client';
import type {
  RevisionCreateInput,
  RevisionDetailResponse,
  RevisionEliminacionResponse,
  RevisionEmitirResponse,
  RevisionesListResponse,
  RevisionMutationResponse,
  RevisionUpdateInput
} from './types';

const base = (projectId: string, entregableId: string) =>
  `/api/projects/${projectId}/entregables/${entregableId}/revisiones`;

/** GET .../revisiones */
export function listRevisiones(
  projectId: string,
  entregableId: string,
  devUserEmail: string
): Promise<RevisionesListResponse> {
  return apiFetch<RevisionesListResponse>(base(projectId, entregableId), { devUserEmail });
}

/** GET .../revisiones/:revisionId — trae metadatosSnapshot + TODAS las
 * filas del preview persistido (no pagina). */
export function getRevision(
  projectId: string,
  entregableId: string,
  revisionId: string,
  devUserEmail: string
): Promise<RevisionDetailResponse> {
  return apiFetch<RevisionDetailResponse>(`${base(projectId, entregableId)}/${revisionId}`, {
    devUserEmail
  });
}

/** POST .../revisiones — crea el BORRADOR y genera+persiste el preview en
 * el mismo llamado (no hay un endpoint de "preview" separado, ver
 * revisionesEntregable.ts). */
export function createRevision(
  projectId: string,
  entregableId: string,
  input: RevisionCreateInput,
  devUserEmail: string
): Promise<RevisionMutationResponse> {
  return apiFetch<RevisionMutationResponse>(base(projectId, entregableId), {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

/** PATCH .../revisiones/:revisionId — solo mientras BORRADOR: edita
 * campos y/o criterios de orden y regenera el preview persistido
 * completo. Esta es la operación detrás de "Generar vista previa": nunca
 * emite ni toca el archivo oficial. 409 si la revisión ya no es
 * BORRADOR. */
export function updateRevision(
  projectId: string,
  entregableId: string,
  revisionId: string,
  input: RevisionUpdateInput,
  devUserEmail: string
): Promise<RevisionMutationResponse> {
  return apiFetch<RevisionMutationResponse>(`${base(projectId, entregableId)}/${revisionId}`, {
    method: 'PATCH',
    body: input,
    devUserEmail
  });
}

/** DELETE .../revisiones/:revisionId — "Descartar": BORRADOR -> DESCARTADA.
 * Nunca es un borrado físico. */
export function discardRevision(
  projectId: string,
  entregableId: string,
  revisionId: string,
  devUserEmail: string
): Promise<RevisionMutationResponse> {
  return apiFetch<RevisionMutationResponse>(`${base(projectId, entregableId)}/${revisionId}`, {
    method: 'DELETE',
    devUserEmail
  });
}

/** POST .../revisiones/:revisionId/emitir — BORRADOR -> EMITIDA,
 * definitivo (los triggers de inmutabilidad entran en vigencia desde
 * acá). */
export function emitirRevision(
  projectId: string,
  entregableId: string,
  revisionId: string,
  devUserEmail: string
): Promise<RevisionEmitirResponse> {
  return apiFetch<RevisionEmitirResponse>(`${base(projectId, entregableId)}/${revisionId}/emitir`, {
    method: 'POST',
    devUserEmail
  });
}

/** DELETE .../revisiones/:revisionId con `{ eliminarDefinitivamente:
 * true }` — SOLO para una revisión ya EMITIDA o DESCARTADA (migración
 * 009). Borrado físico real (revisión + snapshot + archivo emitido),
 * irreversible. Requiere permiso de administración del proyecto: 403 si
 * el rol actual no lo tiene, 409 si se llama sin el flag de confirmación
 * (ver `discardRevision` para el caso BORRADOR -> DESCARTADA, que es
 * distinto y reversible en el sentido de que no borra nada). */
export function deleteRevisionDefinitivamente(
  projectId: string,
  entregableId: string,
  revisionId: string,
  devUserEmail: string
): Promise<RevisionEliminacionResponse> {
  return apiFetch<RevisionEliminacionResponse>(`${base(projectId, entregableId)}/${revisionId}`, {
    method: 'DELETE',
    body: { eliminarDefinitivamente: true },
    devUserEmail
  });
}

/**
 * GET .../revisiones/:revisionId/archivo — descarga el binario REAL
 * emitido (nunca lo regenera ni crea otra copia). No puede pasar por
 * `apiFetch` (que siempre intenta parsear JSON): se hace un fetch crudo,
 * se arma un blob, y se dispara la descarga del navegador con el nombre
 * real que manda el backend (Content-Disposition).
 */
export async function downloadRevisionArchivo(
  projectId: string,
  entregableId: string,
  revisionId: string,
  devUserEmail: string
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${base(projectId, entregableId)}/${revisionId}/archivo`, {
    headers: { 'X-Dev-User-Email': devUserEmail }
  });

  if (!response.ok) {
    let message = `La descarga falló con estado ${response.status}.`;
    try {
      const body = (await response.json()) as Partial<{ message: string }>;
      message = body.message ?? message;
    } catch {
      // sin cuerpo JSON
    }
    throw new ApiError(response.status, 'download_error', message);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const filename = filenameMatch?.[1] ?? 'documento.xlsx';

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
