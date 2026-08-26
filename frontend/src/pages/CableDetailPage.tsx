import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateCable, getCable, updateCable } from '../api/cables';
import { createConductorPair, listConductorPairs } from '../api/conductorPairs';
import { useAsyncData } from '../lib/useAsyncData';
import type { Cable, CableInput, ConductorPair } from '../api/types';
import { CableForm } from '../components/CableForm';
import { ErrorMessage } from '../components/ErrorMessage';

function toInput(cable: Cable): CableInput {
  return {
    tagCable: cable.tagCable,
    tipoCable: cable.tipoCable,
    capacidadConductores: cable.capacidadConductores
  };
}

export function CableDetailPage() {
  const { projectId, cableId } = useParams<{ projectId: string; cableId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchCable = useCallback(() => {
    if (!projectId || !cableId) return Promise.resolve<Cable | null>(null);
    return getCable(projectId, cableId, devUser.email).then((response) => response.cable);
  }, [projectId, cableId, devUser.email]);

  const { data: cable, loading, error: loadError, refresh: load } = useAsyncData<Cable | null>(
    fetchCable
  );

  const fetchPairs = useCallback(() => {
    if (!projectId || !cableId) return Promise.resolve<ConductorPair[]>([]);
    return listConductorPairs(projectId, devUser.email, cableId).then(
      (response) => response.conductorPairs
    );
  }, [projectId, cableId, devUser.email]);

  const {
    data: pairs,
    loading: pairsLoading,
    error: pairsError,
    refresh: refreshPairs
  } = useAsyncData<ConductorPair[]>(fetchPairs);

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  const [numeroPar, setNumeroPar] = useState('');
  const [addingPair, setAddingPair] = useState(false);
  const [addPairError, setAddPairError] = useState<Error | null>(null);

  if (!projectId || !cableId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleUpdate(value: CableInput) {
    setSubmitting(true);
    setActionError(null);
    try {
      await updateCable(projectId!, cableId!, value, devUser.email);
      setEditing(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!cable) return;
    if (!window.confirm(`¿Desactivar el cable "${cable.tagCable}"?`)) return;
    setDeactivating(true);
    setActionError(null);
    try {
      await deactivateCable(projectId!, cableId!, devUser.email);
      navigate(`/projects/${projectId}/cables`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  async function handleAddPair(event: FormEvent) {
    event.preventDefault();
    setAddingPair(true);
    setAddPairError(null);
    try {
      await createConductorPair(
        projectId!,
        { cableId: cableId!, numeroPar: Number(numeroPar) },
        devUser.email
      );
      setNumeroPar('');
      refreshPairs();
    } catch (err) {
      setAddPairError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setAddingPair(false);
    }
  }

  const error = actionError ?? loadError;
  const sortedPairs = [...(pairs ?? [])].sort((a, b) => a.numeroPar - b.numeroPar);

  return (
    <section>
      <div className="page-header">
        <h1>{cable ? cable.tagCable : 'Cable'}</h1>

        {cable && !editing && (
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

      {loading && <p>Cargando cable…</p>}

      {!loading && cable && !editing && (
        <dl className="detail-list">
          <div>
            <dt>Tipo</dt>
            <dd>{cable.tipoCable ?? '—'}</dd>
          </div>
          <div>
            <dt>Capacidad de conductores</dt>
            <dd>{cable.capacidadConductores}</dd>
          </div>
          <div>
            <dt>Creado</dt>
            <dd>{new Date(cable.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Última actualización</dt>
            <dd>{cable.updatedAt ? new Date(cable.updatedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      )}

      {!loading && cable && editing && (
        <CableForm
          initialValue={toInput(cable)}
          submitLabel="Guardar cambios"
          submitting={submitting}
          disabled={!canWrite}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      )}

      {!loading && cable && !editing && (
        <>
          <h2>Pares de conductores</h2>

          <ErrorMessage error={addPairError ?? pairsError} />

          {canWrite && (
            <form className="form form--inline" onSubmit={handleAddPair}>
              <label className="form__field">
                <span>N.º de par</span>
                <input
                  type="number"
                  min={1}
                  max={cable.capacidadConductores}
                  required
                  disabled={addingPair}
                  value={numeroPar}
                  onChange={(event) => setNumeroPar(event.target.value)}
                />
              </label>
              <button type="submit" className="button button--small" disabled={addingPair}>
                {addingPair ? 'Creando…' : '+ Agregar par'}
              </button>
            </form>
          )}

          {pairsLoading && <p>Cargando pares…</p>}

          {!pairsLoading && sortedPairs.length === 0 && (
            <p className="physical-hint">Este cable todavía no tiene pares registrados.</p>
          )}

          {!pairsLoading && sortedPairs.length > 0 && (
            <div className="physical-channels">
              {sortedPairs.map((pair) => (
                <span
                  key={pair.id}
                  className={`badge ${pair.inUse ? 'badge--admin' : 'badge--control'}`}
                  title={pair.inUse ? 'En uso por un tramo de ruta activo' : 'Libre'}
                >
                  Par {pair.numeroPar}
                  {pair.inUse ? ' · en uso' : ''}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
