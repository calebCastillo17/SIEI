import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import { useDevUser } from '../auth/DevUserContext';
import { listProjects } from '../api/projects';
import { useAsyncData } from '../lib/useAsyncData';
import type { Project } from '../api/types';
import { ProjectsContext, type ProjectsContextValue } from './ProjectsContext';

/**
 * Referencia estable para "todavía no hay datos" — si en su lugar se
 * escribiera `data ?? []`, ese `[]` sería un array nuevo en cada render
 * mientras `data` es null, y entonces `findProject`/`value` de abajo
 * nunca se memoizarían de verdad aunque `useCallback`/`useMemo` los
 * declaren dependientes de `projects`.
 */
const EMPTY_PROJECTS: Project[] = [];

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { devUser } = useDevUser();

  const fetchProjects = useCallback(
    () => listProjects(devUser.email).then((response) => response.projects),
    [devUser.email]
  );

  const { data, loading, error, refresh } = useAsyncData<Project[]>(fetchProjects);

  const projects = data ?? EMPTY_PROJECTS;

  const findProject = useCallback(
    (projectId: string | undefined) =>
      projectId ? projects.find((project) => project.id === projectId) : undefined,
    [projects]
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({ projects, loading, error, refresh, findProject }),
    [projects, loading, error, refresh, findProject]
  );

  return (
    <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
  );
}
