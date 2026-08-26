import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createSignal } from '../api/signals';
import { ApiError } from '../api/client';
import type { SignalInput } from '../api/types';
import { SignalForm } from '../components/SignalForm';
import { emptySignalInput } from '../components/signalFormDefaults';
import { useSignalFormOptions } from '../components/useSignalFormOptions';
import { ErrorMessage } from '../components/ErrorMessage';

export function SignalFormPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const { data: options, loading: optionsLoading, error: optionsError } = useSignalFormOptions(
    projectId ?? '',
    devUser.email
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleSubmit(value: SignalInput) {
    setSubmitting(true);
    setError(null);

    try {
      const { signal } = await createSignal(projectId!, value, devUser.email);
      navigate(`/projects/${projectId}/signals/${signal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <h1>Nueva señal</h1>
      </div>

      {!canWrite && (
        <p className="form__hint">
          Tu rol no tiene permiso de escritura en este proyecto — el backend
          rechazará el envío aunque el formulario esté visible.
        </p>
      )}

      <ErrorMessage error={error ?? optionsError} />

      {optionsLoading && <p>Cargando catálogos…</p>}

      {options && (
        <SignalForm
          initialValue={emptySignalInput()}
          options={options}
          submitLabel="Crear señal"
          submitting={submitting}
          disabled={!canWrite}
          onSubmit={handleSubmit}
          onCancel={() => navigate(`/projects/${projectId}/signals`)}
        />
      )}
    </section>
  );
}
