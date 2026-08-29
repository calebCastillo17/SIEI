import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createSwitch, listSwitches } from '../api/switches';
import { useAsyncData } from '../lib/useAsyncData';
import type { SwitchEntity } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function SwitchesListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchSwitches = useCallback(() => {
    if (!projectId) return Promise.resolve<SwitchEntity[]>([]);
    return listSwitches(projectId, devUser.email).then((response) => response.switches);
  }, [projectId, devUser.email]);

  const { data: switches, loading, error: loadError, refresh: load } = useAsyncData<
    SwitchEntity[]
  >(fetchSwitches);

  const [tagSwitch, setTagSwitch] = useState('');
  const [marcaModelo, setMarcaModelo] = useState('');
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
      await createSwitch(
        projectId!,
        {
          tagSwitch: tagSwitch.trim(),
          marcaModelo: marcaModelo.trim().length > 0 ? marcaModelo.trim() : null,
          descripcion: descripcion.trim().length > 0 ? descripcion.trim() : null,
          gabineteId: null
        },
        devUser.email
      );
      setTagSwitch('');
      setMarcaModelo('');
      setDescripcion('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const items = switches ?? [];
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Switches</h1>
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
              value={tagSwitch}
              onChange={(event) => setTagSwitch(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Marca / modelo</span>
            <input
              type="text"
              maxLength={100}
              disabled={creating}
              value={marcaModelo}
              onChange={(event) => setMarcaModelo(event.target.value)}
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
            {creating ? 'Creando…' : '+ Nuevo switch'}
          </button>
        </form>
      )}

      {loading && <p>Cargando switches…</p>}

      {!loading && items.length === 0 && <p>Este proyecto todavía no tiene switches activos.</p>}

      {!loading && items.length > 0 && (
        <ul className="rio-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/projects/${projectId}/switches/${item.id}`}>{item.tagSwitch}</Link>
              {item.marcaModelo && <span className="rio-list__desc"> — {item.marcaModelo}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
