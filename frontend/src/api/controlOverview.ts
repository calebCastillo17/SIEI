/**
 * Cliente para la sección CONTROL (ver backend/src/routes/controlOverview.ts)
 * — vistas de solo lectura sobre nucleo.senal/instrumento/equipo/canal/
 * modulo/slot/rack/gabinete/caja/ruta_conexion, ya resueltas para no
 * obligar al frontend a hacer N+1 llamadas por señal.
 */
import { apiFetch } from './client';
import type {
  ControlGroupsResponse,
  ControlHardwareResponse,
  ControlPlanosResponse,
  ControlSignal,
  ControlSignalDetail,
  ControlSignalsResponse
} from './types';

export interface ControlSignalFilters {
  q?: string;
  gabineteId?: string;
  tipoIoCodigo?: string;
  numeroRack?: string;
  numeroSlot?: string;
  duenoTipo?: 'instrumento' | 'equipo';
  estado?: ControlSignal['estadoConexionado'];
}

function buildQuery(filters: ControlSignalFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function listControlSignals(
  projectId: string,
  filters: ControlSignalFilters,
  devUserEmail: string
): Promise<ControlSignalsResponse> {
  return apiFetch<ControlSignalsResponse>(
    `/api/projects/${projectId}/control/signals${buildQuery(filters)}`,
    { devUserEmail }
  );
}

export function getControlSignal(
  projectId: string,
  signalId: string,
  devUserEmail: string
): Promise<{ signal: ControlSignalDetail }> {
  return apiFetch<{ signal: ControlSignalDetail }>(
    `/api/projects/${projectId}/control/signals/${signalId}`,
    { devUserEmail }
  );
}

export function getControlHardware(
  projectId: string,
  devUserEmail: string
): Promise<ControlHardwareResponse> {
  return apiFetch<ControlHardwareResponse>(
    `/api/projects/${projectId}/control/hardware`,
    { devUserEmail }
  );
}

export function listControlPlanos(
  projectId: string,
  devUserEmail: string
): Promise<ControlPlanosResponse> {
  return apiFetch<ControlPlanosResponse>(
    `/api/projects/${projectId}/control/planos`,
    { devUserEmail }
  );
}

export function listControlGroups(
  projectId: string,
  q: string | undefined,
  devUserEmail: string
): Promise<ControlGroupsResponse> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiFetch<ControlGroupsResponse>(
    `/api/projects/${projectId}/control/groups${qs}`,
    { devUserEmail }
  );
}
