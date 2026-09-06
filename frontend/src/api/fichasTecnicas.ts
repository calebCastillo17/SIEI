import { apiFetch } from './client';
import type {
  FichasTecnicasListResponse,
  FichaTecnicaResponse,
  FichaTecnicaInput,
  FichaTecnicaRequisito,
  MarcaAceptable,
  ValorRequisito
} from './types';

const base = (projectId: string) => `/api/projects/${projectId}/fichas-tecnicas`;

export function listFichasTecnicas(projectId: string, devUserEmail: string): Promise<FichasTecnicasListResponse> {
  return apiFetch<FichasTecnicasListResponse>(base(projectId), { devUserEmail });
}

export function getFichaTecnica(projectId: string, fichaId: string, devUserEmail: string): Promise<FichaTecnicaResponse> {
  return apiFetch<FichaTecnicaResponse>(`${base(projectId)}/${fichaId}`, { devUserEmail });
}

export function createFichaTecnica(projectId: string, input: Partial<FichaTecnicaInput>, devUserEmail: string): Promise<FichaTecnicaResponse> {
  return apiFetch<FichaTecnicaResponse>(base(projectId), { method: 'POST', body: input, devUserEmail });
}

export function updateFichaTecnica(
  projectId: string,
  fichaId: string,
  input: Partial<FichaTecnicaInput>,
  devUserEmail: string
): Promise<FichaTecnicaResponse> {
  return apiFetch<FichaTecnicaResponse>(`${base(projectId)}/${fichaId}`, { method: 'PATCH', body: input, devUserEmail });
}

export function deactivateFichaTecnica(projectId: string, fichaId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${fichaId}`, { method: 'DELETE', devUserEmail });
}

export function listRequisitosDeFicha(
  projectId: string,
  fichaId: string,
  devUserEmail: string
): Promise<{ requisitos: FichaTecnicaRequisito[] }> {
  return apiFetch(`${base(projectId)}/${fichaId}/requisitos`, { devUserEmail });
}

export function addRequisitoAFicha(
  projectId: string,
  fichaId: string,
  input: { requisitoId: string; valor: ValorRequisito; detalle: string | null },
  devUserEmail: string
): Promise<{ requisito: FichaTecnicaRequisito }> {
  return apiFetch(`${base(projectId)}/${fichaId}/requisitos`, { method: 'POST', body: input, devUserEmail });
}

export function quitarRequisitoDeFicha(projectId: string, fichaId: string, requisitoRowId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${fichaId}/requisitos/${requisitoRowId}`, { method: 'DELETE', devUserEmail });
}

export function listMarcasDeFicha(
  projectId: string,
  fichaId: string,
  devUserEmail: string
): Promise<{ marcasAceptables: MarcaAceptable[] }> {
  return apiFetch(`${base(projectId)}/${fichaId}/marcas-aceptables`, { devUserEmail });
}

export function addMarcaAFicha(
  projectId: string,
  fichaId: string,
  input: { componente: string; fabricanteId: string; preferente?: boolean | null; notasRef?: string | null },
  devUserEmail: string
): Promise<{ marcaAceptable: MarcaAceptable }> {
  return apiFetch(`${base(projectId)}/${fichaId}/marcas-aceptables`, { method: 'POST', body: input, devUserEmail });
}

export function quitarMarcaDeFicha(projectId: string, fichaId: string, marcaId: string, devUserEmail: string) {
  return apiFetch(`${base(projectId)}/${fichaId}/marcas-aceptables/${marcaId}`, { method: 'DELETE', devUserEmail });
}
