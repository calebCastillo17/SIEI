import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { useDevUser } from './DevUserContext';
import { getMe } from '../api/me';
import { useAsyncData } from '../lib/useAsyncData';
import type { MeResponse } from '../api/types';
import { MeContext, type MeContextValue } from './MeContext';

export function MeProvider({ children }: { children: ReactNode }) {
  const { devUser } = useDevUser();

  const fetchMe = useCallback(() => getMe(devUser.email), [devUser.email]);
  const { data: me, loading, error, refresh } = useAsyncData<MeResponse>(fetchMe);

  const value: MeContextValue = { me, loading, error, refresh };

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
