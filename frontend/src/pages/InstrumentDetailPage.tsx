import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  deactivateInstrument,
  getInstrument,
  updateInstrument
} from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import type { Instrument, InstrumentInput } from '../api/types';
import { InstrumentForm } from '../components/InstrumentForm';
import { ErrorMessage } from '../components/ErrorMessage';

function toInput(instrument: Instrument): InstrumentInput {
  return {
    tagInstrumento: instrument.tagInstrumento,
    pnpid: instrument.pnpid,
    fuentePnpid: instrument.fuentePnpid,
    descripcion: instrument.descripcion,
    tipoInstrumento: instrument.tipoInstrumento,
    servicio: instrument.servicio,
    sistema: instrument.sistema,
    ubicacion: instrument.ubicacion,
    nodo: instrument.nodo
  };
}

export function InstrumentDetailPage() {
  const { projectId, instrumentId } = useParams<{
    projectId: string;
    instrumentId: string;
  }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchInstrument = useCallback(() => {
    if (!projectId || !instrumentId) return Promise.resolve<Instrument | null>(null);
    return getInstrument(projectId, instrumentId, devUser.email).then(
      (response) => response.instrument
    );
  }, [projectId, instrumentId, devUser.email]);

  const {
    data: instrument,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Instrument | null>(fetchInstrument);

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId || !instrumentId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleUpdate(value: InstrumentInput) {
    setSubmitting(true);
    setActionError(null);

    try {
      await updateInstrument(projectId!, instrumentId!, value, devUser.email);
      setEditing(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!instrument) return;

    const confirmed = window.confirm(
      `¿Desactivar el instrumento "${instrument.tagInstrumento}"?`
    );
    if (!confirmed) return;

    setDeactivating(true);
    setActionError(null);

    try {
      await deactivateInstrument(projectId!, instrumentId!, devUser.email);
      navigate(`/projects/${projectId}/instruments`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <h1>{instrument ? instrument.tagInstrumento : 'Instrumento'}</h1>

        {instrument && !editing && (
          <div className="page-header__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!canWrite}
              title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
              onClick={() => setEditing(true)}
            >
              Editar
            </button>
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
              {deactivating ? 'Desactivando…' : 'Desactivar'}
            </button>
          </div>
        )}
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando instrumento…</p>}

      {!loading && instrument && !editing && (
        <dl className="detail-list">
          <div>
            <dt>PNPID</dt>
            <dd>{instrument.pnpid ?? '—'}</dd>
          </div>
          <div>
            <dt>Fuente PNPID</dt>
            <dd>{instrument.fuentePnpid ?? '—'}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{instrument.tipoInstrumento ?? '—'}</dd>
          </div>
          <div>
            <dt>Servicio</dt>
            <dd>{instrument.servicio ?? '—'}</dd>
          </div>
          <div>
            <dt>Sistema</dt>
            <dd>{instrument.sistema ?? '—'}</dd>
          </div>
          <div>
            <dt>Ubicación</dt>
            <dd>{instrument.ubicacion ?? '—'}</dd>
          </div>
          <div>
            <dt>Nodo</dt>
            <dd>{instrument.nodo ?? '—'}</dd>
          </div>
          <div>
            <dt>Descripción</dt>
            <dd>{instrument.descripcion ?? '—'}</dd>
          </div>
          <div>
            <dt>Creado</dt>
            <dd>{new Date(instrument.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Última actualización</dt>
            <dd>
              {instrument.updatedAt
                ? new Date(instrument.updatedAt).toLocaleString()
                : '—'}
            </dd>
          </div>
        </dl>
      )}

      {!loading && instrument && editing && (
        <InstrumentForm
          initialValue={toInput(instrument)}
          submitLabel="Guardar cambios"
          submitting={submitting}
          disabled={!canWrite}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      )}
    </section>
  );
}
