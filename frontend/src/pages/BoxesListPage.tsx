import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createBox } from '../api/boxes';
import { getControlCajas } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlCajasResponse, ControlPanelUnificado } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const FILTROS_TIPO = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'CAJA', label: 'Cajas' },
  { value: 'EQUIPO', label: 'Paneles eléctricos' }
] as const;

/**
 * Lista simple de PANELES (pedido explícito del usuario: "en la sección
 * Panel solo se muestra la lista, así como se mostraba la lista de
 * cajas" — el detalle de hardware con bloques/terminales/bornes se
 * reserva para Control -> Hardware, esta pantalla es deliberadamente
 * plana). Reemplaza la vieja lista de solo `nucleo.caja` — ahora lista
 * los mismos paneles unificados que Control (CAJA + EQUIPO/panel
 * eléctrico) vía GET /control/cajas, con los mismos 3 filtros, pero sin
 * el árbol expandible: un click va directo al detalle real de la entidad
 * (una CAJA a su propia página, un EQUIPO a la página de Equipos).
 *
 * Crear una caja nueva sigue siendo posible acá (mismo formulario de
 * antes) — un panel eléctrico no se crea desde acá, es un `nucleo.equipo`
 * ya existente, se gestiona desde Equipos.
 */
export function BoxesListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchPaneles = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlCajasResponse>({ projectId: '', paneles: [] });
    return getControlCajas(projectId, devUser.email);
  }, [projectId, devUser.email]);

  const { data, loading, error: loadError, refresh: load } = useAsyncData<ControlCajasResponse>(fetchPaneles);
  const paneles = data?.paneles ?? [];

  const [filtroTipo, setFiltroTipo] = useState<(typeof FILTROS_TIPO)[number]['value']>('TODOS');
  const [filtroGabinete, setFiltroGabinete] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');

  const [tagCaja, setTagCaja] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  const gabinetesDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const p of paneles) for (const g of p.gabinetesTags) set.add(g);
    return [...set].sort();
  }, [paneles]);

  const panelesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return paneles.filter((p) => {
      if (filtroTipo !== 'TODOS' && p.tipo !== filtroTipo) return false;
      if (filtroGabinete !== 'TODOS' && !p.gabinetesTags.includes(filtroGabinete)) return false;
      if (q && !p.tag.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [paneles, filtroTipo, filtroGabinete, busqueda]);

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

  const error = createError ?? loadError;

  const detailHref = (p: ControlPanelUnificado) =>
    p.tipo === 'CAJA' ? `/projects/${projectId}/boxes/${p.id}` : `/projects/${projectId}/equipment/${p.id}`;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Paneles</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <Link to={`/projects/${projectId}/control/cajas`} className="button button--secondary">
            Ver hardware (bornes/TB)
          </Link>
          <button type="button" className="button button--secondary" onClick={load}>
            Actualizar
          </button>
        </div>
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

      <div className="filter-bar">
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)}>
          {FILTROS_TIPO.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <select value={filtroGabinete} onChange={(e) => setFiltroGabinete(e.target.value)}>
          <option value="TODOS">Todos los gabinetes</option>
          {gabinetesDisponibles.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Buscar por tag…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {loading && <p>Cargando paneles…</p>}

      {!loading && paneles.length === 0 && <p>Este proyecto todavía no tiene paneles activos.</p>}
      {!loading && paneles.length > 0 && panelesFiltrados.length === 0 && <p>Ningún panel coincide con los filtros.</p>}

      {!loading && panelesFiltrados.length > 0 && (
        <ul className="rio-list">
          {panelesFiltrados.map((p) => (
            <li key={p.id}>
              <Link to={detailHref(p)}>{p.tag}</Link>
              <span className={`badge ${p.tipo === 'CAJA' ? 'badge--caja' : 'badge--panel'}`} style={{ marginLeft: 8 }}>
                {p.tipo === 'CAJA' ? 'Caja' : 'Panel eléctrico'}
              </span>
              <span className="rio-list__desc">
                {' '}— {p.cantidadSenales} señal(es), {p.cantidadCables} cable(s)
                {p.gabinetesTags.length > 0 ? `, hacia ${p.gabinetesTags.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
