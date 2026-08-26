import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateEquipment, listEquipment } from '../api/equipment';
import { useAsyncData } from '../lib/useAsyncData';
import type { Equipment } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function EquipmentListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  const fetchEquipment = useCallback(() => {
    if (!projectId) return Promise.resolve<Equipment[]>([]);
    return listEquipment(projectId, devUser.email).then((response) => response.equipment);
  }, [projectId, devUser.email]);

  const {
    data: equipment,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Equipment[]>(fetchEquipment);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleDeactivate(item: Equipment) {
    if (!projectId) return;

    const confirmed = window.confirm(`¿Desactivar el equipo "${item.tagEquipo}"?`);
    if (!confirmed) return;

    setDeactivatingId(item.id);
    setActionError(null);

    try {
      await deactivateEquipment(projectId, item.id, devUser.email);
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
  const items = equipment ?? [];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Equipos</h1>
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
            onClick={() => navigate(`/projects/${projectId}/equipment/new`)}
          >
            Nuevo equipo
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando equipos…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene equipos activos.</p>
      )}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>TAG</th>
              <th>Sistema</th>
              <th>Nodo</th>
              <th>Panel</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link to={`/projects/${projectId}/equipment/${item.id}`}>{item.tagEquipo}</Link>
                </td>
                <td>{item.sistema ?? '—'}</td>
                <td>{item.nodo ?? '—'}</td>
                <td>{item.panel ?? '—'}</td>
                <td className="table__row-actions">
                  <button
                    type="button"
                    className="button button--danger button--small"
                    disabled={!canDeactivate || deactivatingId === item.id}
                    title={
                      canDeactivate
                        ? undefined
                        : 'Tu rol no tiene permiso de desactivación en este proyecto.'
                    }
                    onClick={() => handleDeactivate(item)}
                  >
                    {deactivatingId === item.id ? 'Desactivando…' : 'Desactivar'}
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
