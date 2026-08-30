import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateBox, getBox, updateBox } from '../api/boxes';
import { useAsyncData } from '../lib/useAsyncData';
import type { Box, BoxInput } from '../api/types';
import { BoxForm } from '../components/BoxForm';
import { BornerasSection } from '../components/BornerasSection';
import { ErrorMessage } from '../components/ErrorMessage';

function toInput(box: Box): BoxInput {
  return { tagCaja: box.tagCaja, descripcion: box.descripcion };
}

export function BoxDetailPage() {
  const { projectId, boxId } = useParams<{ projectId: string; boxId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchBox = useCallback(() => {
    if (!projectId || !boxId) return Promise.resolve<Box | null>(null);
    return getBox(projectId, boxId, devUser.email).then((response) => response.box);
  }, [projectId, boxId, devUser.email]);

  const { data: box, loading, error: loadError, refresh: load } = useAsyncData<Box | null>(
    fetchBox
  );

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId || !boxId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleUpdate(value: BoxInput) {
    setSubmitting(true);
    setActionError(null);
    try {
      await updateBox(projectId!, boxId!, value, devUser.email);
      setEditing(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!box) return;
    if (!window.confirm(`¿Desactivar la caja "${box.tagCaja}"?`)) return;
    setDeactivating(true);
    setActionError(null);
    try {
      await deactivateBox(projectId!, boxId!, devUser.email);
      navigate(`/projects/${projectId}/boxes`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <h1>{box ? box.tagCaja : 'Caja'}</h1>

        {box && !editing && (
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

      {loading && <p>Cargando caja…</p>}

      {!loading && box && !editing && (
        <dl className="detail-list">
          <div>
            <dt>Descripción</dt>
            <dd>{box.descripcion ?? '—'}</dd>
          </div>
          <div>
            <dt>Creado</dt>
            <dd>{new Date(box.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Última actualización</dt>
            <dd>{box.updatedAt ? new Date(box.updatedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      )}

      {!loading && box && editing && (
        <BoxForm
          initialValue={toInput(box)}
          submitLabel="Guardar cambios"
          submitting={submitting}
          disabled={!canWrite}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      )}

      {!loading && box && (
        <BornerasSection
          projectId={projectId}
          devUserEmail={devUser.email}
          ownerType="caja"
          ownerId={box.id}
          canWrite={canWrite}
          canDeactivate={canDeactivate}
        />
      )}
    </section>
  );
}
