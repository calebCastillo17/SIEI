import { createContext, useContext } from 'react';

import type { ApiError } from '../api/client';
import type { Project } from '../api/types';

export interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => void;
  /** Busca un proyecto ya cargado por id (para leer permisos sin otro fetch). */
  findProject: (projectId: string | undefined) => Project | undefined;
}

export const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function useProjects(): ProjectsContextValue {
  const context = useContext(ProjectsContext);

  if (!context) {
    throw new Error('useProjects debe usarse dentro de <ProjectsProvider>.');
  }

  return context;
}
