import { useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listRoutes } from '../api/connectionRoutes';
import { listSignals } from '../api/signals';
import { useAsyncData } from '../lib/useAsyncData';
import type { ConnectionRoute, Signal } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

interface RoutesData {
  routes: ConnectionRoute[];
  signals: Signal[];
}

export function RoutesListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetcher = useCallback(async (): Promise<RoutesData> => {
    if (!projectId) return { routes: [], signals: [] };
    const [routes, signals] = await Promise.all([
      listRoutes(projectId, devUser.email),
      listSignals(projectId, devUser.email)
    ]);
    return { routes: routes.routes, signals: signals.signals };
  }, [projectId, devUser.email]);

  const { data, loading, error: loadError, refresh: load } = useAsyncData<RoutesData>(fetcher);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  const routes = data?.routes ?? [];
  const signals = data?.signals ?? [];

  function signalTag(senalId: string): string {
    return signals.find((s) => s.id === senalId)?.tagSenal ?? `#${senalId}`;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Rutas de conexión</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>

        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={load}>
            Actualizar
          </button>
          <button
            type="button"
            className="button"
            disabled={!canWrite}
            title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
            onClick={() => navigate(`/projects/${projectId}/routes/new`)}
          >
            Nueva ruta
          </button>
        </div>
      </div>

      <ErrorMessage error={loadError} />

      {loading && <p>Cargando rutas…</p>}

      {!loading && routes.length === 0 && <p>Este proyecto todavía no tiene rutas activas.</p>}

      {!loading && routes.length > 0 && (
        <ul className="rio-list">
          {routes.map((route) => (
            <li key={route.id}>
              <Link to={`/projects/${projectId}/routes/${route.id}`}>
                Ruta #{route.id} — señal {signalTag(route.senalId)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
