import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createBox, listBoxes } from '../api/boxes';
import { useAsyncData } from '../lib/useAsyncData';
import type { Box } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function BoxesListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchBoxes = useCallback(() => {
    if (!projectId) return Promise.resolve<Box[]>([]);
    return listBoxes(projectId, devUser.email).then((response) => response.boxes);
  }, [projectId, devUser.email]);

  const { data: boxes, loading, error: loadError, refresh: load } = useAsyncData<Box[]>(
    fetchBoxes
  );

  const [tagCaja, setTagCaja] = useState('');
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
      await createBox(
        projectId!,
        { tagCaja: tagCaja.trim(), descripcion: descripcion.trim().length > 0 ? descripcion.trim() : null },
        devUser.email
      );
      setTagCaja('');
      setDescripcion('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const items = boxes ?? [];
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Cajas</h1>
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
              value={tagCaja}
              onChange={(event) => setTagCaja(event.target.value)}
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
            {creating ? 'Creando…' : '+ Nueva caja'}
          </button>
        </form>
      )}

      {loading && <p>Cargando cajas…</p>}

      {!loading && items.length === 0 && <p>Este proyecto todavía no tiene cajas activas.</p>}

      {!loading && items.length > 0 && (
        <ul className="rio-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/projects/${projectId}/boxes/${item.id}`}>{item.tagCaja}</Link>
              {item.descripcion && <span className="rio-list__desc"> — {item.descripcion}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
