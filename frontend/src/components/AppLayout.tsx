import { NavLink, Outlet, useParams } from 'react-router-dom';

import { useMe } from '../auth/MeContext';
import { useProjects } from '../projects/ProjectsContext';
import { DevUserSwitcher } from './DevUserSwitcher';
import { ErrorMessage } from './ErrorMessage';

/**
 * Shell de toda la aplicación: cabecera con identidad + selector DEV,
 * navegación, y el contenido de la ruta activa. El proyecto "actual" se
 * lee de la URL (:projectId), no de un estado aparte — así recargar la
 * página o usar "atrás" del navegador funciona sin lógica extra.
 */
export function AppLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const { findProject } = useProjects();
  const { me, error: meError } = useMe();

  const currentProject = findProject(projectId);
  const isSystemAdmin = me?.user.esAdminSistema ?? false;

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
              <NavLink to={`/projects/${currentProject.id}/control`} className="app-nav__link">
                Control
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/gabinetes`} className="app-nav__link">
                Gabinetes
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/planos`} className="app-nav__link">
                Planos
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
              <NavLink to={`/projects/${currentProject.id}/loops`} className="app-nav__link">
                Lazos
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/entregables`} className="app-nav__link">
                Entregables
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/members`} className="app-nav__link">
                Miembros
              </NavLink>
              <NavLink
                to={`/projects/${currentProject.id}/documentacion`}
                className="app-nav__link"
              >
                Documentación
              </NavLink>
              <NavLink to={`/projects/${currentProject.id}/plantillas`} className="app-nav__link">
                Plantillas
              </NavLink>
            </>
          )}

          {isSystemAdmin && (
            <>
              <div className="app-nav__current-project">
                <span className="app-nav__project-code">Administración</span>
                <span className="app-nav__project-role">admin de sistema</span>
              </div>
              <NavLink to="/admin/clients" className="app-nav__link">
                Clientes
              </NavLink>
              <NavLink to="/admin/users" className="app-nav__link">
                Usuarios
              </NavLink>
              <NavLink to="/admin/catalogs" className="app-nav__link">
                Catálogos
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
