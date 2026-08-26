import { createContext, useContext } from 'react';

import type { ApiError } from '../api/client';
import type { MeResponse } from '../api/types';

export interface MeContextValue {
  me: MeResponse | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => void;
}

export const MeContext = createContext<MeContextValue | null>(null);

/** Identidad + esAdminSistema del usuario DEV activo (GET /api/me), en un
 * solo lugar compartido — antes solo vivía dentro de AppLayout y no se
 * podía usar desde otras pantallas (p.ej. para decidir si mostrar "Nuevo
 * proyecto" o el panel de Administración). */
export function useMe(): MeContextValue {
  const context = useContext(MeContext);

  if (!context) {
    throw new Error('useMe debe usarse dentro de <MeProvider>.');
  }

  return context;
}
