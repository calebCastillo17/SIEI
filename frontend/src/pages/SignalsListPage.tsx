import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateSignal, listSignals } from '../api/signals';
import { useAsyncData } from '../lib/useAsyncData';
import type { Signal } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function SignalsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  const fetchSignals = useCallback(() => {
    if (!projectId) return Promise.resolve<Signal[]>([]);
    return listSignals(projectId, devUser.email).then((response) => response.signals);
  }, [projectId, devUser.email]);

  const {
    data: signals,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Signal[]>(fetchSignals);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleDeactivate(signal: Signal) {
    if (!projectId) return;

    const confirmed = window.confirm(`¿Desactivar la señal "${signal.tagSenal ?? `#${signal.id}`}"?`);
    if (!confirmed) return;

    setDeactivatingId(signal.id);
    setActionError(null);

    try {
      await deactivateSignal(projectId, signal.id, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;
  const error = actionError ?? loadError;
  const items = signals ?? [];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Señales</h1>
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
            onClick={() => navigate(`/projects/${projectId}/signals/new`)}
          >
            Nueva señal
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando señales…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene señales activas.</p>
      )}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>TAG</th>
              <th>Clase</th>
              <th>Tipo E/S</th>
              <th>Dirección</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((signal) => (
              <tr key={signal.id}>
                <td>
                  <Link to={`/projects/${projectId}/signals/${signal.id}`}>
                    {signal.tagSenal ?? <em>— sin tag —</em>}
                  </Link>
                </td>
                <td>
                  <span
                    className={`badge ${signal.claseSenalCodigo === 'CONTROL' ? 'badge--control' : 'badge--com'}`}
                  >
                    {signal.claseSenalCodigo}
                  </span>
                </td>
                <td>{signal.tipoIoCodigo ?? '—'}</td>
                <td>{signal.direccionComCodigo ?? '—'}</td>
                <td className="table__row-actions">
                  <button
                    type="button"
                    className="button button--danger button--small"
                    disabled={!canDeactivate || deactivatingId === signal.id}
                    title={
                      canDeactivate
                        ? undefined
                        : 'Tu rol no tiene permiso de desactivación en este proyecto.'
                    }
                    onClick={() => handleDeactivate(signal)}
                  >
                    {deactivatingId === signal.id ? 'Desactivando…' : 'Desactivar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
