import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  deactivateEquipment,
  getEquipment,
  updateEquipment
} from '../api/equipment';
import { useAsyncData } from '../lib/useAsyncData';
import type { Equipment, EquipmentInput } from '../api/types';
import { EquipmentForm } from '../components/EquipmentForm';
import { ErrorMessage } from '../components/ErrorMessage';

function toInput(equipment: Equipment): EquipmentInput {
  return {
    tagEquipo: equipment.tagEquipo,
    descripcion: equipment.descripcion,
    sistema: equipment.sistema,
    nodo: equipment.nodo,
    panel: equipment.panel
  };
}

export function EquipmentDetailPage() {
  const { projectId, equipmentId } = useParams<{
    projectId: string;
    equipmentId: string;
  }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchEquipment = useCallback(() => {
    if (!projectId || !equipmentId) return Promise.resolve<Equipment | null>(null);
    return getEquipment(projectId, equipmentId, devUser.email).then(
      (response) => response.equipment
    );
  }, [projectId, equipmentId, devUser.email]);

  const {
    data: equipment,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Equipment | null>(fetchEquipment);

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId || !equipmentId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleUpdate(value: EquipmentInput) {
    setSubmitting(true);
    setActionError(null);

    try {
      await updateEquipment(projectId!, equipmentId!, value, devUser.email);
      setEditing(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!equipment) return;

    const confirmed = window.confirm(`¿Desactivar el equipo "${equipment.tagEquipo}"?`);
    if (!confirmed) return;

    setDeactivating(true);
    setActionError(null);

    try {
      await deactivateEquipment(projectId!, equipmentId!, devUser.email);
      navigate(`/projects/${projectId}/equipment`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <h1>{equipment ? equipment.tagEquipo : 'Equipo'}</h1>

        {equipment && !editing && (
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

      {loading && <p>Cargando equipo…</p>}

      {!loading && equipment && !editing && (
        <dl className="detail-list">
          <div>
            <dt>Sistema</dt>
            <dd>{equipment.sistema ?? '—'}</dd>
          </div>
          <div>
            <dt>Nodo</dt>
            <dd>{equipment.nodo ?? '—'}</dd>
          </div>
          <div>
            <dt>Panel</dt>
            <dd>{equipment.panel ?? '—'}</dd>
          </div>
          <div>
            <dt>Descripción</dt>
            <dd>{equipment.descripcion ?? '—'}</dd>
          </div>
          <div>
            <dt>Creado</dt>
            <dd>{new Date(equipment.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Última actualización</dt>
            <dd>
              {equipment.updatedAt ? new Date(equipment.updatedAt).toLocaleString() : '—'}
            </dd>
          </div>
        </dl>
      )}

      {!loading && equipment && editing && (
        <EquipmentForm
          initialValue={toInput(equipment)}
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
