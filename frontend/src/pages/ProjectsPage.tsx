import { useNavigate } from 'react-router-dom';

import { useProjects } from '../projects/ProjectsContext';
import { ErrorMessage } from '../components/ErrorMessage';

export function ProjectsPage() {
  const { projects, loading, error, refresh } = useProjects();
  const navigate = useNavigate();

  return (
    <section>
      <div className="page-header">
        <h1>Proyectos</h1>
        <button type="button" className="button button--secondary" onClick={refresh}>
          Actualizar
        </button>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando proyectos…</p>}

      {!loading && !error && projects.length === 0 && (
        <p>No tenés acceso a ningún proyecto activo con este usuario.</p>
      )}

      {!loading && projects.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Tu rol</th>
              <th>Permisos</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr
                key={project.id}
                className="table__row--clickable"
                onClick={() => navigate(`/projects/${project.id}/instruments`)}
              >
                <td>{project.code}</td>
                <td>{project.name}</td>
                <td>{project.access.role}</td>
                <td className="table__permissions">
                  {project.access.permissions.write && <span className="badge">escribir</span>}
                  {project.access.permissions.deactivate && (
                    <span className="badge">desactivar</span>
                  )}
                  {project.access.permissions.administer && (
                    <span className="badge">administrar</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
