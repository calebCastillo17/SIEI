import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createPlano } from '../api/planos';
import { ApiError } from '../api/client';
import type { PlanoInput } from '../api/types';
import { PlanoForm } from '../components/PlanoForm';
import { emptyPlanoInput } from '../components/planoFormDefaults';
import { usePlanoFormOptions } from '../components/usePlanoFormOptions';
import { ErrorMessage } from '../components/ErrorMessage';

export function PlanoFormPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const { data: options, loading: optionsLoading, error: optionsError } = usePlanoFormOptions(
    devUser.email
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleSubmit(value: PlanoInput) {
    setSubmitting(true);
    setError(null);

    try {
      const { plano } = await createPlano(projectId!, value, devUser.email);
      navigate(`/projects/${projectId}/planos/${plano.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <h1>Nuevo plano</h1>
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
        <PlanoForm
          initialValue={emptyPlanoInput()}
          options={options}
          submitLabel="Crear plano"
          submitting={submitting}
          disabled={!canWrite}
          onSubmit={handleSubmit}
          onCancel={() => navigate(`/projects/${projectId}/planos`)}
        />
      )}
    </section>
  );
}
