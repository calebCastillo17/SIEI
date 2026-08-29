import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createGabinete, listGabinetes } from '../api/gabinetes';
import { listTiposGabinete } from '../api/tiposGabinete';
import { useAsyncData } from '../lib/useAsyncData';
import type { Gabinete, TipoGabinete } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function GabinetesListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchGabinetes = useCallback(() => {
    if (!projectId) return Promise.resolve<Gabinete[]>([]);
    return listGabinetes(projectId, devUser.email).then((response) => response.gabinetes);
  }, [projectId, devUser.email]);

  const { data: gabinetes, loading, error: loadError, refresh: load } = useAsyncData<Gabinete[]>(
    fetchGabinetes
  );

  const [tiposGabinete, setTiposGabinete] = useState<TipoGabinete[]>([]);
  useEffect(() => {
    listTiposGabinete(devUser.email)
      .then((response) => setTiposGabinete(response.items))
      .catch(() => setTiposGabinete([]));
  }, [devUser.email]);

  const [tagGabinete, setTagGabinete] = useState('');
  const [tagAnterior, setTagAnterior] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipoGabineteId, setTipoGabineteId] = useState('');
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
      await createGabinete(
        projectId!,
        {
          tagGabinete: tagGabinete.trim(),
          tagAnterior: tagAnterior.trim().length > 0 ? tagAnterior.trim() : null,
          descripcion: descripcion.trim().length > 0 ? descripcion.trim() : null,
          tipoGabineteId
        },
        devUser.email
      );
      setTagGabinete('');
      setTagAnterior('');
      setDescripcion('');
      setTipoGabineteId('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const items = gabinetes ?? [];
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Gabinetes</h1>
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
              value={tagGabinete}
              onChange={(event) => setTagGabinete(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Tipo *</span>
            <select
              required
              disabled={creating}
              value={tipoGabineteId}
              onChange={(event) => setTipoGabineteId(event.target.value)}
            >
              <option value="">— elegir tipo —</option>
              {tiposGabinete.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.nombre}
                </option>
              ))}
            </select>
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
          <label className="form__field">
            <span>Tag anterior</span>
            <input
              type="text"
              maxLength={50}
              disabled={creating}
              value={tagAnterior}
              onChange={(event) => setTagAnterior(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={creating}>
            {creating ? 'Creando…' : '+ Nuevo gabinete'}
          </button>
        </form>
      )}

      {loading && <p>Cargando gabinetes…</p>}

      {!loading && items.length === 0 && <p>Este proyecto todavía no tiene gabinetes activos.</p>}

      {!loading && items.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>TAG</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th>Tag anterior</th>
              </tr>
            </thead>
            <tbody>
              {items.map((gabinete) => (
                <tr key={gabinete.id}>
                  <td>
                    <Link to={`/projects/${projectId}/gabinetes/${gabinete.id}`}>
                      {gabinete.tagGabinete}
                    </Link>
                  </td>
                  <td>{gabinete.tipoGabineteNombre ?? '—'}</td>
                  <td>{gabinete.descripcion ?? '—'}</td>
                  <td>{gabinete.tagAnterior ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
