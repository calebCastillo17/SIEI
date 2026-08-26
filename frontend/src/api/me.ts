import { apiFetch } from './client';
import type { MeResponse } from './types';

/** GET /api/me */
export function getMe(devUserEmail: string): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/me', { devUserEmail });
}
