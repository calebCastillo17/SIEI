import { useCallback } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getMe } from '../api/me';
import { useAsyncData } from '../lib/useAsyncData';
import type { MeResponse } from '../api/types';
import { DevUserSwitcher } from './DevUserSwitcher';
import { ErrorMessage } from './ErrorMessage';

/**
 * Shell de toda la aplicación: cabecera con identidad + selector DEV,
 * navegación, y el contenido de la ruta activa. El proyecto "actual" se
 * lee de la URL (:projectId), no de un estado aparte — así recargar la
 * página o usar "atrás" del navegador funciona sin lógica extra.
 */
export function AppLayout() {
  const { devUser } = useDevUser();
  const { projectId } = useParams<{ projectId: string }>();
  const { findProject } = useProjects();

  const fetchMe = useCallback(() => getMe(devUser.email), [devUser.email]);
  const { data: me, error: meError } = useAsyncData<MeResponse>(fetchMe);

  const currentProject = findProject(projectId);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__title">SIEI</span>
          <span className="app-header__subtitle">
            Sistema Integrado de Entregables de Ingeniería
          </span>
        </div>

        <div className="app-header__identity">
          {me && (
            <span className="app-header__user">
              {me.user.nombre}
              {me.user.esAdminSistema && (
                <span className="badge badge--admin">admin de sistema</span>
              )}
            </span>
          )}
          <DevUserSwitcher />
        </div>
      </header>

      {meError && (
        <div className="app-shell__banner">
          <ErrorMessage error={meError} />
        </div>
      )}

      <div className="app-body">
        <nav className="app-nav">
          <NavLink to="/projects" className="app-nav__link">
            Proyectos
          </NavLink>

          {currentProject && (
            <>
              <div className="app-nav__current-project">
                <span className="app-nav__project-code">{currentProject.code}</span>
                <span className="app-nav__project-role">{currentProject.access.role}</span>
              </div>
              <NavLink
                to={`/projects/${currentProject.id}/instruments`}
                className="app-nav__link"
              >
                Instrumentos
              </NavLink>
              <NavLink
                to={`/projects/${currentProject.id}/equipment`}
                className="app-nav__link"
              >
                Equipos
              </NavLink>
              <NavLink
                to={`/projects/${currentProject.id}/signals`}
                className="app-nav__link"
              >
                Señales
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/rios`} className="app-nav__link">
                RIOs
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/switches`} className="app-nav__link">
                Switches
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/boxes`} className="app-nav__link">
                Cajas
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/cables`} className="app-nav__link">
                Cables
              </NavLink>
              <NavLink
                to={`/projects/${currentProject.id}/connection-points`}
                className="app-nav__link"
              >
                Puntos de conexión
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/routes`} className="app-nav__link">
                Rutas
              </NavLink>
            </>
          )}
        </nav>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
