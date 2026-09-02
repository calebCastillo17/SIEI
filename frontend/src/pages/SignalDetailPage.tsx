import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateSignal, getSignal, updateSignal } from '../api/signals';
import { useAsyncData } from '../lib/useAsyncData';
import { useSignalFormOptions } from '../components/useSignalFormOptions';
import type { Signal, SignalInput } from '../api/types';
import { SignalForm } from '../components/SignalForm';
import { ErrorMessage } from '../components/ErrorMessage';

function toInput(signal: Signal): SignalInput {
  return {
    tagSenal: signal.tagSenal,
    claseSenalId: signal.claseSenalId,
    instrumentoId: signal.instrumentoId,
    equipoId: signal.equipoId,
    instrumentoAgrupadorId: signal.instrumentoAgrupadorId,
    tipoIoId: signal.tipoIoId,
    direccionComId: signal.direccionComId,
    tipoInterfazId: signal.tipoInterfazId,
    canalId: signal.canalId,
    estadoRevisionId: signal.estadoRevisionId,
    prioridadAlarmaId: signal.prioridadAlarmaId,
    codigoSenal: signal.codigoSenal,
    causaAlarma: signal.causaAlarma,
    tipoDatoComId: signal.tipoDatoComId,
    esLoopPowered: signal.esLoopPowered,
    nombreCorto: signal.nombreCorto,
    descripcion: signal.descripcion,
    rangoMin: signal.rangoMin,
    rangoMax: signal.rangoMax,
    alarmaHh: signal.alarmaHh,
    alarmaH: signal.alarmaH,
    alarmaL: signal.alarmaL,
    alarmaLl: signal.alarmaLl,
    valorNormal: signal.valorNormal,
    unidadIngenieria: signal.unidadIngenieria,
    retardo: signal.retardo,
    enclavamiento: signal.enclavamiento,
    observacion: signal.observacion
  };
}

export function SignalDetailPage() {
  const { projectId, signalId } = useParams<{ projectId: string; signalId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchSignal = useCallback(() => {
    if (!projectId || !signalId) return Promise.resolve<Signal | null>(null);
    return getSignal(projectId, signalId, devUser.email).then((response) => response.signal);
  }, [projectId, signalId, devUser.email]);

  const {
    data: signal,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Signal | null>(fetchSignal);

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  const { data: options, loading: optionsLoading } = useSignalFormOptions(
    projectId ?? '',
    devUser.email
  );

  if (!projectId || !signalId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleUpdate(value: SignalInput) {
    setSubmitting(true);
    setActionError(null);

    try {
      await updateSignal(projectId!, signalId!, value, devUser.email);
      setEditing(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!signal) return;

    const confirmed = window.confirm(`¿Desactivar la señal "${signal.tagSenal ?? `#${signal.id}`}"?`);
    if (!confirmed) return;

    setDeactivating(true);
    setActionError(null);

    try {
      await deactivateSignal(projectId!, signalId!, devUser.email);
      navigate(`/projects/${projectId}/signals`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <h1>{signal ? (signal.tagSenal ?? `Señal #${signal.id}`) : 'Señal'}</h1>

        {signal && !editing && (
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

      {loading && <p>Cargando señal…</p>}

      {!loading && signal && !editing && (
        <dl className="detail-list">
          <div>
            <dt>Clase</dt>
            <dd>{signal.claseSenalCodigo}</dd>
          </div>
          <div>
            <dt>Dueño</dt>
            <dd>
              {signal.duenoAusente ? (
                <span className="badge badge--danger" title="El instrumento que era su dueño fue eliminado definitivamente.">
                  ⚠ sin dueño
                </span>
              ) : signal.instrumentoId ? (
                `Instrumento ${signal.instrumentoId}`
              ) : (
                `Equipo ${signal.equipoId}`
              )}
            </dd>
          </div>
          <div>
            <dt>Tipo de E/S</dt>
            <dd>{signal.tipoIoCodigo ?? '—'}</dd>
          </div>
          <div>
            <dt>Canal</dt>
            <dd>{signal.canalId ?? '—'}</dd>
          </div>
          <div>
            <dt>Dirección COM</dt>
            <dd>{signal.direccionComCodigo ?? '—'}</dd>
          </div>
          <div>
            <dt>Nombre corto</dt>
            <dd>{signal.nombreCorto ?? '—'}</dd>
          </div>
          <div>
            <dt>Rango</dt>
            <dd>
              {signal.rangoMin ?? '—'} / {signal.rangoMax ?? '—'}
            </dd>
          </div>
          <div>
            <dt>Alarmas (HH/H/L/LL)</dt>
            <dd>
              {signal.alarmaHh ?? '—'} / {signal.alarmaH ?? '—'} / {signal.alarmaL ?? '—'} /{' '}
              {signal.alarmaLl ?? '—'}
            </dd>
          </div>
          <div>
            <dt>Valor normal</dt>
            <dd>{signal.valorNormal ?? '—'}</dd>
          </div>
          <div>
            <dt>Unidad de ingeniería</dt>
            <dd>{signal.unidadIngenieria ?? '—'}</dd>
          </div>
          <div>
            <dt>Retardo</dt>
            <dd>{signal.retardo ?? '—'}</dd>
          </div>
          <div>
            <dt>Descripción</dt>
            <dd>{signal.descripcion ?? '—'}</dd>
          </div>
          <div>
            <dt>Enclavamiento</dt>
            <dd>{signal.enclavamiento ?? '—'}</dd>
          </div>
          <div>
            <dt>Observación</dt>
            <dd>{signal.observacion ?? '—'}</dd>
          </div>
          <div>
            <dt>Creada</dt>
            <dd>{new Date(signal.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Última actualización</dt>
            <dd>{signal.updatedAt ? new Date(signal.updatedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      )}

      {!loading && signal && editing && optionsLoading && <p>Cargando catálogos…</p>}

      {!loading && signal && editing && options && (
        <SignalForm
          initialValue={toInput(signal)}
          options={options}
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
