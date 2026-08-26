import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { DEFAULT_DEV_USER, DEV_USERS } from './devUsers';
import { DevUserContext, type DevUserContextValue } from './DevUserContext';

const STORAGE_KEY = 'siei.devUserEmail';

function readStoredEmail(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_DEV_USER.email;
  } catch {
    // localStorage puede no estar disponible (modo privado, etc.)
    return DEFAULT_DEV_USER.email;
  }
}

export function DevUserProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string>(readStoredEmail);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, email);
    } catch {
      // no pasa nada si no se puede persistir; solo se pierde entre recargas.
    }
  }, [email]);

  const devUser = useMemo(
    () => DEV_USERS.find((user) => user.email === email) ?? DEFAULT_DEV_USER,
    [email]
  );

  const value = useMemo<DevUserContextValue>(
    () => ({ devUser, setDevUserEmail: setEmail }),
    [devUser]
  );

  return (
    <DevUserContext.Provider value={value}>{children}</DevUserContext.Provider>
  );
}
