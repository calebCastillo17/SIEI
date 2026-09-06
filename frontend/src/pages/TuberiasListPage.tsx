import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listTuberias, createTuberia } from '../api/tuberias';
import { useAsyncData } from '../lib/useAsyncData';
import type { Tuberia } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/** nucleo.tuberia (migración 030). tag_linea sin unique a propósito
 * (mismo criterio que plano.codigo_plano) — se resuelve por texto contra
 * instrumento.linea_pnid, ya poblado por el importador P&ID. */
export function TuberiasListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchTuberias = useCallback(() => {
    if (!projectId) return Promise.resolve<Tuberia[]>([]);
    return listTuberias(projectId, devUser.email).then((r) => r.tuberias);
  }, [projectId, devUser.email]);
  const { data: tuberias, loading, error: loadError, refresh: load } = useAsyncData<Tuberia[]>(fetchTuberias);

  const [busqueda, setBusqueda] = useState('');
  const [tagLinea, setTagLinea] = useState('');
  const [tamanoDiametro, setTamanoDiametro] = useState('');
  const [materialTuberia, setMaterialTuberia] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createTuberia(
        projectId!,
        {
          tagLinea: tagLinea.trim() || null,
          tamanoDiametro: tamanoDiametro.trim() || null,
          materialTuberia: materialTuberia.trim() || null,
          materialRevestimiento: null,
          espesorRevestimiento: null,
          schedule: null,
          normaBridas: null,
          caraBridas: null,
          conexionInstrumento: null
        },
        devUser.email
      );
      setTagLinea('');
      setTamanoDiametro('');
      setMaterialTuberia('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const allItems = tuberias ?? [];
  const items = busqueda.trim().length === 0
    ? allItems
    : allItems.filter((t) => (t.tagLinea ?? '').toLowerCase().includes(busqueda.trim().toLowerCase()));
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Tuberías</h1>
          {project && <p className="page-subtitle">Proyecto {project.code} — {project.name} · líneas de proceso (Hojas de Datos)</p>}
        </div>
        <button type="button" className="button button--secondary" onClick={load}>Actualizar</button>
      </div>

      <ErrorMessage error={error} />

      <div className="filter-bar">
        <input type="search" placeholder="Buscar por tag de línea…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      </div>

      {canWrite && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>Tag de línea</span>
            <input type="text" maxLength={100} disabled={creating} value={tagLinea} onChange={(e) => setTagLinea(e.target.value)} placeholder='ej. 620-TL-24"-L1E0U-26807' />
          </label>
          <label className="form__field">
            <span>Tamaño / diámetro</span>
            <input type="text" maxLength={20} disabled={creating} value={tamanoDiametro} onChange={(e) => setTamanoDiametro(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Material</span>
            <input type="text" maxLength={200} disabled={creating} value={materialTuberia} onChange={(e) => setMaterialTuberia(e.target.value)} />
          </label>
          <button type="submit" className="button" disabled={creating}>{creating ? 'Creando…' : '+ Nueva tubería'}</button>
        </form>
      )}

      {loading && <p>Cargando tuberías…</p>}
      {!loading && allItems.length === 0 && <p>Este proyecto todavía no tiene tuberías cargadas.</p>}
      {!loading && allItems.length > 0 && items.length === 0 && <p>Ninguna coincide con la búsqueda.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Tag de línea</th>
              <th>Tamaño</th>
              <th>Material</th>
              <th>Norma bridas</th>
              <th>Conexión instrumento</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.tagLinea ?? '—'}</td>
                <td>{t.tamanoDiametro ?? '—'}</td>
                <td>{t.materialTuberia ?? '—'}</td>
                <td>{t.normaBridas ?? '—'}</td>
                <td>{t.conexionInstrumento ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
