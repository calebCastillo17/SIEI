import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateRoute, getRoute } from '../api/connectionRoutes';
import { useAsyncData } from '../lib/useAsyncData';
import { useRouteFormOptions } from '../components/useRouteFormOptions';
import { connectionPointFullLabel } from '../components/connectionPointLabel';
import type { ConnectionRouteWithSegments } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function RouteDetailPage() {
  const { projectId, routeId } = useParams<{ projectId: string; routeId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchRoute = useCallback(() => {
    if (!projectId || !routeId) return Promise.resolve<ConnectionRouteWithSegments | null>(null);
    return getRoute(projectId, routeId, devUser.email).then((r) => r.route);
  }, [projectId, routeId, devUser.email]);

  const { data: route, loading, error: loadError } = useAsyncData<
    ConnectionRouteWithSegments | null
  >(fetchRoute);

  const { data: options, loading: optionsLoading, error: optionsError } = useRouteFormOptions(
    projectId ?? '',
    devUser.email
  );

  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId || !routeId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleDeactivate() {
    if (!route) return;
    if (
      !window.confirm(
        `¿Desactivar la ruta #${route.id}? Esto también desactiva en cascada sus tramos.`
      )
    )
      return;
    setDeactivating(true);
    setActionError(null);
    try {
      await deactivateRoute(projectId!, routeId!, devUser.email);
      navigate(`/projects/${projectId}/routes`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const signalTag = options?.signals.find((s) => s.id === route?.senalId)?.tagSenal;

  function pairLabel(parConductorId: string): string {
    const pair = options?.conductorPairs.find((p) => p.id === parConductorId);
    if (!pair) return `#${parConductorId}`;
    const cable = options?.cables.find((c) => c.id === pair.cableId);
    return `${cable?.tagCable ?? `#${pair.cableId}`} · Par ${pair.numeroPar}`;
  }

  function pointLabel(pointId: string): string {
    const point = options?.connectionPoints.find((p) => p.id === pointId);
    if (!point || !options) return `#${pointId}`;
    return connectionPointFullLabel(point, options);
  }

  const error = actionError ?? loadError ?? optionsError;
  const isLoading = loading || optionsLoading;

  return (
    <section>
      <div className="page-header">
        <h1>{route ? `Ruta #${route.id}` : 'Ruta de conexión'}</h1>

        {route && (
          <button
            type="button"
            className="button button--danger"
            disabled={!canDeactivate || deactivating}
            title={
              canDeactivate
                ? undefined
                : 'Tu rol no tiene permiso de desactivación en este proyecto.'
            }
            onClick={handleDeactivate}
          >
            {deactivating ? 'Desactivando…' : 'Desactivar ruta'}
          </button>
        )}
      </div>

      {route && <p className="page-subtitle">Señal: {signalTag ?? `#${route.senalId}`}</p>}

      <ErrorMessage error={error} />

      {isLoading && <p>Cargando ruta…</p>}

      {!isLoading && route && (
        <table className="table">
          <thead>
            <tr>
              <th>Tramo</th>
              <th>Par conductor</th>
              <th>Origen</th>
              <th>Destino</th>
            </tr>
          </thead>
          <tbody>
            {[...route.segments]
              .sort((a, b) => a.numeroOrden - b.numeroOrden)
              .map((segment) => (
                <tr key={segment.id}>
                  <td>{segment.numeroOrden}</td>
                  <td>{pairLabel(segment.parConductorId)}</td>
                  <td>{pointLabel(segment.puntoOrigenId)}</td>
                  <td>{pointLabel(segment.puntoDestinoId)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
