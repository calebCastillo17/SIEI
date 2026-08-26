import { createContext, useContext } from 'react';

import type { DevUser } from './devUsers';

export interface DevUserContextValue {
  devUser: DevUser;
  setDevUserEmail: (email: string) => void;
}

export const DevUserContext = createContext<DevUserContextValue | null>(null);

export function useDevUser(): DevUserContextValue {
  const context = useContext(DevUserContext);

  if (!context) {
    throw new Error('useDevUser debe usarse dentro de <DevUserProvider>.');
  }

  return context;
}
