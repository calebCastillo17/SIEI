import { apiFetch } from './client';
import type { ChannelsListResponse } from './types';

/** GET /api/projects/:projectId/channels?moduloId= — SOLO LECTURA. */
export function listChannels(
  projectId: string,
  devUserEmail: string,
  moduloId?: string
): Promise<ChannelsListResponse> {
  const query = moduloId ? `?moduloId=${moduloId}` : '';
  return apiFetch<ChannelsListResponse>(`/api/projects/${projectId}/channels${query}`, {
    devUserEmail
  });
}
