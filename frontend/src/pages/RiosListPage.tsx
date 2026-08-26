import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createRio, listRios } from '../api/rios';
import { useAsyncData } from '../lib/useAsyncData';
import type { Rio } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function RiosListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchRios = useCallback(() => {
    if (!projectId) return Promise.resolve<Rio[]>([]);
    return listRios(projectId, devUser.email).then((response) => response.rios);
  }, [projectId, devUser.email]);

  const { data: rios, loading, error: loadError, refresh: load } = useAsyncData<Rio[]>(
    fetchRios
  );

  const [tagRio, setTagRio] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);

    try {
      await createRio(
        projectId!,
        { tagRio: tagRio.trim(), descripcion: descripcion.trim().length > 0 ? descripcion.trim() : null },
        devUser.email
      );
      setTagRio('');
      setDescripcion('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const items = rios ?? [];
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>RIOs</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <button type="button" className="button button--secondary" onClick={load}>
          Actualizar
        </button>
      </div>

      <ErrorMessage error={error} />

      {canWrite && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>TAG</span>
            <input
              type="text"
              maxLength={50}
              required
              disabled={creating}
              value={tagRio}
              onChange={(event) => setTagRio(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Descripción</span>
            <input
              type="text"
              maxLength={300}
              disabled={creating}
              value={descripcion}
              onChange={(event) => setDescripcion(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={creating}>
            {creating ? 'Creando…' : '+ Nuevo RIO'}
          </button>
        </form>
      )}

      {loading && <p>Cargando RIOs…</p>}

      {!loading && items.length === 0 && <p>Este proyecto todavía no tiene RIOs activos.</p>}

      {!loading && items.length > 0 && (
        <ul className="rio-list">
          {items.map((rio) => (
            <li key={rio.id}>
              <Link to={`/projects/${projectId}/rios/${rio.id}`}>{rio.tagRio}</Link>
              {rio.descripcion && <span className="rio-list__desc"> — {rio.descripcion}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
