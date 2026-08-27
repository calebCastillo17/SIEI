import { useCallback } from 'react';

import { listMembers } from '../api/members';
import { useAsyncData } from '../lib/useAsyncData';

export interface ProjectUserDirectoryEntry {
  email: string;
  nombre: string;
}

/**
 * Resuelve `createdBy`/`updatedBy` (solo ids numéricos en las respuestas de
 * GET, ver instruments.ts) a nombre/email usando GET /members — a
 * diferencia de /api/users, este endpoint solo pide permiso 'read' sobre
 * el proyecto, no es_admin_sistema. Con esto alcanza para cualquier
 * usuario con una asignación de rol vigente en el proyecto; un
 * es_admin_sistema que nunca tuvo asignación explícita no aparece acá (su
 * acceso es implícito, ver CLAUDE.md "Security model") y su id queda sin
 * resolver — quien llame debe mostrar el id crudo como respaldo.
 */
export function useProjectUserDirectory(projectId: string, devUserEmail: string) {
  const fetcher = useCallback(async (): Promise<Map<string, ProjectUserDirectoryEntry>> => {
    const response = await listMembers(projectId, devUserEmail);
    return new Map(
      response.members.map((member) => [member.usuarioId, { email: member.email, nombre: member.nombre }])
    );
  }, [projectId, devUserEmail]);

  const result = useAsyncData<Map<string, ProjectUserDirectoryEntry>>(fetcher);
  return result.data ?? new Map<string, ProjectUserDirectoryEntry>();
}
