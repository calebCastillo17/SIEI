import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateInstrument, listInstruments } from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import type { Instrument } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function InstrumentsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  const fetchInstruments = useCallback(() => {
    if (!projectId) return Promise.resolve<Instrument[]>([]);
    return listInstruments(projectId, devUser.email).then((response) => response.instruments);
  }, [projectId, devUser.email]);

  const {
    data: instruments,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Instrument[]>(fetchInstruments);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleDeactivate(instrument: Instrument) {
    if (!projectId) return;

    const confirmed = window.confirm(
      `¿Desactivar el instrumento "${instrument.tagInstrumento}"? Esta acción es reversible solo reactivándolo desde la base (no hay endpoint de reactivación todavía).`
    );
    if (!confirmed) return;

    setDeactivatingId(instrument.id);
    setActionError(null);

    try {
      await deactivateInstrument(projectId, instrument.id, devUser.email);
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
  const items = instruments ?? [];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Instrumentos</h1>
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
          {/*
            El botón refleja el permiso para no ofrecer una acción que el
            backend igual va a rechazar — pero la autorización real la
            aplica requireProjectPermission('write') en el servidor, esto
            es solo una guía visual.
          */}
          <button
            type="button"
            className="button"
            disabled={!canWrite}
            title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
            onClick={() => navigate(`/projects/${projectId}/instruments/new`)}
          >
            Nuevo instrumento
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando instrumentos…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene instrumentos activos.</p>
      )}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>TAG</th>
              <th>Tipo</th>
              <th>Servicio</th>
              <th>Sistema</th>
              <th>Ubicación</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((instrument) => (
              <tr key={instrument.id}>
                <td>
                  <Link to={`/projects/${projectId}/instruments/${instrument.id}`}>
                    {instrument.tagInstrumento}
                  </Link>
                </td>
                <td>{instrument.tipoInstrumento ?? '—'}</td>
                <td>{instrument.servicio ?? '—'}</td>
                <td>{instrument.sistema ?? '—'}</td>
                <td>{instrument.ubicacion ?? '—'}</td>
                <td className="table__row-actions">
                  <button
                    type="button"
                    className="button button--danger button--small"
                    disabled={!canDeactivate || deactivatingId === instrument.id}
                    title={
                      canDeactivate
                        ? undefined
                        : 'Tu rol no tiene permiso de desactivación en este proyecto.'
                    }
                    onClick={() => handleDeactivate(instrument)}
                  >
                    {deactivatingId === instrument.id ? 'Desactivando…' : 'Desactivar'}
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
