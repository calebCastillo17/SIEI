import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createInstrument } from '../api/instruments';
import { ApiError } from '../api/client';
import type { InstrumentInput } from '../api/types';
import { InstrumentForm } from '../components/InstrumentForm';
import { emptyInstrumentInput } from '../components/instrumentFormDefaults';
import { ErrorMessage } from '../components/ErrorMessage';

export function InstrumentFormPage() {
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

  async function handleSubmit(value: InstrumentInput) {
    setSubmitting(true);
    setError(null);

    try {
      const { instrument } = await createInstrument(projectId!, value, devUser.email);
      navigate(`/projects/${projectId}/instruments/${instrument.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <h1>Nuevo instrumento</h1>
      </div>

      {!canWrite && (
        <p className="form__hint">
          Tu rol no tiene permiso de escritura en este proyecto — el backend
          rechazará el envío aunque el formulario esté visible.
        </p>
      )}

      <ErrorMessage error={error} />

      <InstrumentForm
        initialValue={emptyInstrumentInput()}
        submitLabel="Crear instrumento"
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/projects/${projectId}/instruments`)}
      />
    </section>
  );
}
