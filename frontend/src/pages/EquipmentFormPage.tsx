import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createEquipment } from '../api/equipment';
import { ApiError } from '../api/client';
import type { EquipmentInput } from '../api/types';
import { EquipmentForm } from '../components/EquipmentForm';
import { emptyEquipmentInput } from '../components/equipmentFormDefaults';
import { ErrorMessage } from '../components/ErrorMessage';

export function EquipmentFormPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleSubmit(value: EquipmentInput) {
    setSubmitting(true);
    setError(null);

    try {
      const { equipment } = await createEquipment(projectId!, value, devUser.email);
      navigate(`/projects/${projectId}/equipment/${equipment.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <h1>Nuevo equipo</h1>
      </div>

      {!canWrite && (
        <p className="form__hint">
          Tu rol no tiene permiso de escritura en este proyecto — el backend
          rechazará el envío aunque el formulario esté visible.
        </p>
      )}

      <ErrorMessage error={error} />

      <EquipmentForm
        initialValue={emptyEquipmentInput()}
        submitLabel="Crear equipo"
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/projects/${projectId}/equipment`)}
      />
    </section>
  );
}
