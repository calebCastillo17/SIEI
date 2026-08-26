import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createCable, listCables } from '../api/cables';
import { useAsyncData } from '../lib/useAsyncData';
import type { Cable } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function CablesListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchCables = useCallback(() => {
    if (!projectId) return Promise.resolve<Cable[]>([]);
    return listCables(projectId, devUser.email).then((response) => response.cables);
  }, [projectId, devUser.email]);

  const { data: cables, loading, error: loadError, refresh: load } = useAsyncData<Cable[]>(
    fetchCables
  );

  const [tagCable, setTagCable] = useState('');
  const [tipoCable, setTipoCable] = useState('');
  const [capacidadConductores, setCapacidadConductores] = useState('1');
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
      await createCable(
        projectId!,
        {
          tagCable: tagCable.trim(),
          tipoCable: tipoCable.trim().length > 0 ? tipoCable.trim() : null,
          capacidadConductores: Number(capacidadConductores)
        },
        devUser.email
      );
      setTagCable('');
      setTipoCable('');
      setCapacidadConductores('1');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const items = cables ?? [];
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Cables</h1>
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
              value={tagCable}
              onChange={(event) => setTagCable(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Tipo de cable</span>
            <input
              type="text"
              maxLength={100}
              disabled={creating}
              value={tipoCable}
              onChange={(event) => setTipoCable(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Capacidad de conductores</span>
            <input
              type="number"
              min={1}
              max={32767}
              required
              disabled={creating}
              value={capacidadConductores}
              onChange={(event) => setCapacidadConductores(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={creating}>
            {creating ? 'Creando…' : '+ Nuevo cable'}
          </button>
        </form>
      )}

      {loading && <p>Cargando cables…</p>}

      {!loading && items.length === 0 && <p>Este proyecto todavía no tiene cables activos.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>TAG</th>
              <th>Tipo</th>
              <th>Capacidad</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link to={`/projects/${projectId}/cables/${item.id}`}>{item.tagCable}</Link>
                </td>
                <td>{item.tipoCable ?? '—'}</td>
                <td>{item.capacidadConductores}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
