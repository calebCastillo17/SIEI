import { apiFetch } from './client';
import type {
  DocumentosListResponse,
  DocumentoResponse,
  DocumentoInput,
  NotasListResponse,
  Nota
} from './types';

const base = (projectId: string) => `/api/projects/${projectId}/documentos`;

export function listDocumentos(projectId: string, devUserEmail: string): Promise<DocumentosListResponse> {
  return apiFetch<DocumentosListResponse>(base(projectId), { devUserEmail });
}

export function getDocumento(projectId: string, documentoId: string, devUserEmail: string): Promise<DocumentoResponse> {
  return apiFetch<DocumentoResponse>(`${base(projectId)}/${documentoId}`, { devUserEmail });
}

export function createDocumento(projectId: string, input: DocumentoInput, devUserEmail: string): Promise<DocumentoResponse> {
  return apiFetch<DocumentoResponse>(base(projectId), { method: 'POST', body: input, devUserEmail });
}

export function updateDocumento(
  projectId: string,
  documentoId: string,
  input: Partial<DocumentoInput>,
  devUserEmail: string
): Promise<DocumentoResponse> {
  return apiFetch<DocumentoResponse>(`${base(projectId)}/${documentoId}`, { method: 'PATCH', body: input, devUserEmail });
}

export function deactivateDocumento(projectId: string, documentoId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${documentoId}`, { method: 'DELETE', devUserEmail });
}

export function listNotas(projectId: string, documentoId: string, devUserEmail: string): Promise<NotasListResponse> {
  return apiFetch<NotasListResponse>(`${base(projectId)}/${documentoId}/notas`, { devUserEmail });
}

export function createNota(
  projectId: string,
  documentoId: string,
  input: { numero: number; texto: string },
  devUserEmail: string
): Promise<{ nota: Nota }> {
  return apiFetch(`${base(projectId)}/${documentoId}/notas`, { method: 'POST', body: input, devUserEmail });
}

export function deactivateNota(projectId: string, documentoId: string, notaId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${documentoId}/notas/${notaId}`, { method: 'DELETE', devUserEmail });
}

export function associarInstrumento(projectId: string, documentoId: string, instrumentoId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${documentoId}/instrumentos/${instrumentoId}`, { method: 'POST', devUserEmail });
}

export function desasociarInstrumento(projectId: string, documentoId: string, instrumentoId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${documentoId}/instrumentos/${instrumentoId}`, { method: 'DELETE', devUserEmail });
}
