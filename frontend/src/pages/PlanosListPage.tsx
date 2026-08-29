import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivatePlano, listPlanos } from '../api/planos';
import { useAsyncData } from '../lib/useAsyncData';
import type { Plano } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function PlanosListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  const fetchPlanos = useCallback(() => {
    if (!projectId) return Promise.resolve<Plano[]>([]);
    return listPlanos(projectId, devUser.email).then((response) => response.planos);
  }, [projectId, devUser.email]);

  const {
    data: planos,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Plano[]>(fetchPlanos);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleDeactivate(plano: Plano) {
    if (!projectId) return;

    const confirmed = window.confirm(`¿Desactivar el plano "${plano.codigoPlano ?? `#${plano.id}`}"?`);
    if (!confirmed) return;

    setDeactivatingId(plano.id);
    setActionError(null);

    try {
      await deactivatePlano(projectId, plano.id, devUser.email);
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
  const items = planos ?? [];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Planos</h1>
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
            onClick={() => navigate(`/projects/${projectId}/planos/new`)}
          >
            Nuevo plano
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando planos…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene planos activos.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Tipo</th>
                <th>Código anterior</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((plano) => (
                <tr key={plano.id}>
                  <td>
                    <Link to={`/projects/${projectId}/planos/${plano.id}`}>
                      {plano.codigoPlano ?? <em>— sin código —</em>}
                    </Link>
                  </td>
                  <td>{plano.descripcion}</td>
                  <td>{plano.tipoPlanoCodigo ?? '—'}</td>
                  <td>{plano.codigoAnterior ?? '—'}</td>
                  <td className="table__row-actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      disabled={!canDeactivate || deactivatingId === plano.id}
                      title={
                        canDeactivate
                          ? undefined
                          : 'Tu rol no tiene permiso de desactivación en este proyecto.'
                      }
                      onClick={() => handleDeactivate(plano)}
                    >
                      {deactivatingId === plano.id ? 'Desactivando…' : 'Desactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
