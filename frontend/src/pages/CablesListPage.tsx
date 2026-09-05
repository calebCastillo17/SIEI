import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createCable, listCables } from '../api/cables';
import { listTiposConstruccionCable } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import type { Cable, CatalogItem } from '../api/types';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';

const SIN_CLASIFICAR = '__sin_clasificar__';

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

  const fetchTiposConstruccion = useCallback(
    () => listTiposConstruccionCable(devUser.email).then((response) => response.items),
    [devUser.email]
  );
  const { data: tiposConstruccion } = useAsyncData<CatalogItem[]>(fetchTiposConstruccion);
  const tipoConstruccionPorId = useMemo(
    () => new Map((tiposConstruccion ?? []).map((t) => [t.id, t.descripcion ?? t.codigo])),
    [tiposConstruccion]
  );

  const [filtroTipoConstruccion, setFiltroTipoConstruccion] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');

  const [tagCable, setTagCable] = useState('');
  const [tipoCable, setTipoCable] = useState('');
  const [capacidadConductores, setCapacidadConductores] = useState('1');
  const [tipoConstruccionId, setTipoConstruccionId] = useState<string | null>(null);
  const [cantidadUnidades, setCantidadUnidades] = useState('');
  const [calibre, setCalibre] = useState('');
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
          capacidadConductores: Number(capacidadConductores),
          tipoConstruccionId,
          cantidadUnidades: cantidadUnidades.trim().length > 0 ? Number(cantidadUnidades) : null,
          calibre: calibre.trim().length > 0 ? calibre.trim() : null,
          apantallado: null
        },
        devUser.email
      );
      setTagCable('');
      setTipoCable('');
      setCapacidadConductores('1');
      setTipoConstruccionId(null);
      setCantidadUnidades('');
      setCalibre('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const allItems = cables ?? [];
  const items = allItems.filter((item) => {
    if (filtroTipoConstruccion === SIN_CLASIFICAR && item.tipoConstruccionId !== null) return false;
    if (
      filtroTipoConstruccion !== 'TODOS' &&
      filtroTipoConstruccion !== SIN_CLASIFICAR &&
      item.tipoConstruccionId !== filtroTipoConstruccion
    ) {
      return false;
    }
    if (busqueda.trim().length > 0 && !item.tagCable.toLowerCase().includes(busqueda.trim().toLowerCase())) {
      return false;
    }
    return true;
  });
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

      <div className="filter-bar">
        <select
          value={filtroTipoConstruccion}
          onChange={(event) => setFiltroTipoConstruccion(event.target.value)}
        >
          <option value="TODOS">Todos los tipos de construcción</option>
          <option value={SIN_CLASIFICAR}>Sin clasificar</option>
          {(tiposConstruccion ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.descripcion ?? t.codigo}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Buscar por TAG…"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
      </div>

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
          <label className="form__field">
            <span>Tipo de construcción</span>
            <CatalogSelect
              disabled={creating}
              value={tipoConstruccionId}
              onChange={setTipoConstruccionId}
              options={(tiposConstruccion ?? []).map((t) => ({ id: t.id, label: t.descripcion ?? t.codigo }))}
            />
          </label>
          <label className="form__field">
            <span>Cantidad de unidades</span>
            <input
              type="number"
              min={1}
              max={32767}
              disabled={creating}
              value={cantidadUnidades}
              onChange={(event) => setCantidadUnidades(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Calibre</span>
            <input
              type="text"
              maxLength={20}
              disabled={creating}
              value={calibre}
              onChange={(event) => setCalibre(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={creating}>
            {creating ? 'Creando…' : '+ Nuevo cable'}
          </button>
        </form>
      )}

      {loading && <p>Cargando cables…</p>}

      {!loading && allItems.length === 0 && <p>Este proyecto todavía no tiene cables activos.</p>}

      {!loading && allItems.length > 0 && items.length === 0 && (
        <p>Ningún cable coincide con los filtros.</p>
      )}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>TAG</th>
              <th>Tipo (texto original)</th>
              <th>Capacidad</th>
              <th>Libres</th>
              <th>Construcción</th>
              <th>Cantidad</th>
              <th>Calibre</th>
              <th>Apantallado</th>
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
                <td>
                  {item.conductoresEnUso === undefined ? (
                    '—'
                  ) : (
                    <span
                      className={item.capacidadConductores - item.conductoresEnUso <= 0 ? 'cables-libres cables-libres--baja' : 'cables-libres'}
                      title={`${item.conductoresEnUso} en uso de ${item.capacidadConductores}`}
                    >
                      {item.capacidadConductores - item.conductoresEnUso}
                    </span>
                  )}
                </td>
                <td>{item.tipoConstruccionId ? tipoConstruccionPorId.get(item.tipoConstruccionId) ?? '—' : '—'}</td>
                <td>{item.cantidadUnidades ?? '—'}</td>
                <td>{item.calibre ?? '—'}</td>
                <td>{item.apantallado === null ? '—' : item.apantallado ? 'Sí' : 'No'}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
