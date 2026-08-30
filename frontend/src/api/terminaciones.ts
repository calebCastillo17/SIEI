import { apiFetch } from './client';
import type {
  ConductorInput,
  ConductorResponse,
  ConductorsListResponse,
  BloqueTerminalInput,
  BloqueTerminalResponse,
  BloquesTerminalListResponse,
  ModuloTerminalesResponse,
  TramoConductorResponse,
  TerminacionExtremo,
  RouteConexionadoResponse
} from './types';

/* ---- Conductor (nucleo.conductor) --------------------------------- */

const conductorsBase = (projectId: string) => `/api/projects/${projectId}/conductors`;

export function listConductors(
  projectId: string,
  devUserEmail: string,
  cableId?: string
): Promise<ConductorsListResponse> {
  const query = cableId ? `?cableId=${cableId}` : '';
  return apiFetch<ConductorsListResponse>(`${conductorsBase(projectId)}${query}`, { devUserEmail });
}

export function createConductor(
  projectId: string,
  input: ConductorInput,
  devUserEmail: string
): Promise<ConductorResponse> {
  return apiFetch<ConductorResponse>(conductorsBase(projectId), { method: 'POST', body: input, devUserEmail });
}

export function deactivateConductor(
  projectId: string,
  conductorId: string,
  devUserEmail: string
): Promise<{ conductor: { id: string; active: boolean } }> {
  return apiFetch(`${conductorsBase(projectId)}/${conductorId}`, { method: 'DELETE', devUserEmail });
}


/* ---- bloque_terminal / terminal / posicion_terminal ---------------- */

const bloquesBase = (projectId: string) => `/api/projects/${projectId}/bloques-terminal`;

export interface BloquesTerminalFilters {
  cajaId?: string;
  gabineteId?: string;
  moduloId?: string;
}

export function listBloquesTerminal(
  projectId: string,
  devUserEmail: string,
  filters: BloquesTerminalFilters = {}
): Promise<BloquesTerminalListResponse> {
  const params = new URLSearchParams();
  if (filters.cajaId) params.set('cajaId', filters.cajaId);
  if (filters.gabineteId) params.set('gabineteId', filters.gabineteId);
  if (filters.moduloId) params.set('moduloId', filters.moduloId);
  const query = params.toString();
  return apiFetch<BloquesTerminalListResponse>(`${bloquesBase(projectId)}${query ? `?${query}` : ''}`, { devUserEmail });
}

export function getBloqueTerminal(
  projectId: string,
  bloqueId: string,
  devUserEmail: string
): Promise<BloqueTerminalResponse> {
  return apiFetch<BloqueTerminalResponse>(`${bloquesBase(projectId)}/${bloqueId}`, { devUserEmail });
}

export function createBloqueTerminal(
  projectId: string,
  input: BloqueTerminalInput,
  devUserEmail: string
): Promise<BloqueTerminalResponse> {
  return apiFetch<BloqueTerminalResponse>(bloquesBase(projectId), { method: 'POST', body: input, devUserEmail });
}

export function deactivateBloqueTerminal(
  projectId: string,
  bloqueId: string,
  devUserEmail: string
): Promise<{ bloqueTerminal: { id: string; codigo: string; active: boolean } }> {
  return apiFetch(`${bloquesBase(projectId)}/${bloqueId}`, { method: 'DELETE', devUserEmail });
}

export function createTerminal(
  projectId: string,
  bloqueId: string,
  numero: string,
  devUserEmail: string
): Promise<{ terminal: { id: string; numero: string } }> {
  return apiFetch(`${bloquesBase(projectId)}/${bloqueId}/terminales`, { method: 'POST', body: { numero }, devUserEmail });
}

export function deactivateTerminal(
  projectId: string,
  bloqueId: string,
  terminalId: string,
  devUserEmail: string
): Promise<{ terminal: { id: string; numero: string; active: boolean } }> {
  return apiFetch(`${bloquesBase(projectId)}/${bloqueId}/terminales/${terminalId}`, { method: 'DELETE', devUserEmail });
}

export function createPosicionTerminal(
  projectId: string,
  bloqueId: string,
  terminalId: string,
  codigo: string,
  devUserEmail: string
): Promise<{ posicionTerminal: { id: string; codigo: string } }> {
  return apiFetch(`${bloquesBase(projectId)}/${bloqueId}/terminales/${terminalId}/posiciones`, {
    method: 'POST',
    body: { codigo },
    devUserEmail
  });
}

export function deactivatePosicionTerminal(
  projectId: string,
  bloqueId: string,
  terminalId: string,
  posicionId: string,
  devUserEmail: string
): Promise<{ posicionTerminal: { id: string; codigo: string; active: boolean } }> {
  return apiFetch(`${bloquesBase(projectId)}/${bloqueId}/terminales/${terminalId}/posiciones/${posicionId}`, {
    method: 'DELETE',
    devUserEmail
  });
}


/* ---- Módulo -> Terminales (materialización desde catálogo) -------- */

export function getModuloTerminales(
  projectId: string,
  moduleId: string,
  devUserEmail: string
): Promise<ModuloTerminalesResponse> {
  return apiFetch<ModuloTerminalesResponse>(`/api/projects/${projectId}/modules/${moduleId}/terminales`, { devUserEmail });
}

/** Necesario cuando se agregan filas nuevas a cat.cat_modulo_io_terminal
 * DESPUÉS de instalar el módulo — ver modules.ts. Idempotente. */
export function syncModuloTerminales(
  projectId: string,
  moduleId: string,
  devUserEmail: string
): Promise<{ synced: true }> {
  return apiFetch(`/api/projects/${projectId}/modules/${moduleId}/sync-terminales`, { method: 'POST', devUserEmail });
}


/* ---- tramo_conductor / terminacion ---------------------------------- */

const tramoConductoresBase = (projectId: string) => `/api/projects/${projectId}/tramo-conductores`;

export function createTramoConductor(
  projectId: string,
  tramoConexionId: string,
  conductorId: string,
  devUserEmail: string
): Promise<TramoConductorResponse> {
  return apiFetch<TramoConductorResponse>(tramoConductoresBase(projectId), {
    method: 'POST',
    body: { tramoConexionId, conductorId },
    devUserEmail
  });
}

export function deactivateTramoConductor(
  projectId: string,
  tramoConductorId: string,
  devUserEmail: string
): Promise<{ tramoConductor: { id: string; active: boolean } }> {
  return apiFetch(`${tramoConductoresBase(projectId)}/${tramoConductorId}`, { method: 'DELETE', devUserEmail });
}

export function createTerminacion(
  projectId: string,
  tramoConductorId: string,
  extremo: TerminacionExtremo,
  posicionTerminalId: string,
  devUserEmail: string
): Promise<{ terminacion: { id: string; extremo: TerminacionExtremo } }> {
  return apiFetch(`${tramoConductoresBase(projectId)}/${tramoConductorId}/terminaciones`, {
    method: 'POST',
    body: { extremo, posicionTerminalId },
    devUserEmail
  });
}

export function deactivateTerminacion(
  projectId: string,
  tramoConductorId: string,
  terminacionId: string,
  devUserEmail: string
): Promise<{ terminacion: { id: string; extremo: TerminacionExtremo; active: boolean } }> {
  return apiFetch(`${tramoConductoresBase(projectId)}/${tramoConductorId}/terminaciones/${terminacionId}`, {
    method: 'DELETE',
    devUserEmail
  });
}


/* ---- Señal/ruta -> Conexionado detallado (solo lectura) ------------ */

export function getRouteConexionado(
  projectId: string,
  routeId: string,
  devUserEmail: string
): Promise<RouteConexionadoResponse> {
  return apiFetch<RouteConexionadoResponse>(`/api/projects/${projectId}/routes/${routeId}/conexionado`, { devUserEmail });
}
