import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listControlGroups } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlGroupsResponse, EstadoConexionado } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const ESTADO_LABEL: Record<EstadoConexionado, string> = {
  IO_PENDIENTE: 'IO pendiente',
  RUTA_PENDIENTE: 'Ruta pendiente',
  RUTA_CARGADA: 'Ruta cargada'
};

const ESTADO_BADGE: Record<EstadoConexionado, string> = {
  IO_PENDIENTE: 'badge--danger',
  RUTA_PENDIENTE: 'badge--warning',
  RUTA_CARGADA: 'badge--success'
};

/**
 * Agrupación funcional de señales CONTROL — no un módulo de datos nuevo,
 * es una re-agrupación de GET .../control/signals por instrumento
 * agrupador (p. ej. las 5 señales de 620-HV-5084) o, cuando no hay
 * agrupador formal, por el propio dueño (p. ej. las 6 señales de
 * 620-PPS-5005). Pensada para responder "cómo se agrupan estas señales",
 * complementaria a la tabla plana y a la vista de hardware.
 */
export function ControlGroupsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);

  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchGroups = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlGroupsResponse>({ projectId: '', grupos: [] });
    return listControlGroups(projectId, q || undefined, devUser.email);
  }, [projectId, q, devUser.email]);

  const { data, loading, error, refresh } = useAsyncData<ControlGroupsResponse>(fetchGroups);
  const grupos = data?.grupos ?? [];

  const toggle = (clave: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control — Agrupaciones</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={refresh}>
            Actualizar
          </button>
          <Link className="button button--secondary" to={`/projects/${projectId}/control`}>
            Ver señales
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}/control/hardware`}>
            Ver hardware
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}/control/planos`}>
            Ver planos
          </Link>
        </div>
      </div>

      <p className="page-subtitle">
        Cada grupo es un instrumento agrupador (p. ej. una válvula con varias señales) o un
        dueño (instrumento/equipo) con varias señales propias — no un concepto nuevo, solo otra
        forma de mirar las mismas 269 señales.
      </p>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Buscar por TAG del grupo o de una señal…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando agrupaciones…</p>}

      {!loading && !error && grupos.length === 0 && <p>No hay grupos que coincidan.</p>}

      {!loading &&
        grupos.map((g) => (
          <div key={g.clave} className="control-group">
            <button type="button" className="control-group__header" onClick={() => toggle(g.clave)}>
              <span className={`badge ${g.tipo === 'agrupador' ? 'badge--control' : 'badge--com'}`}>
                {g.tipo === 'agrupador' ? 'grupo' : 'individual'}
              </span>
              <strong>{g.clave}</strong>
              <span className="page-subtitle">
                {g.nMiembros} señal(es) · {g.gabinetes.join(', ') || 'sin gabinete'}
              </span>
            </button>

            {expanded.has(g.clave) && (
              <table className="table">
                <thead>
                  <tr>
                    <th>TAG señal</th>
                    <th>Señal</th>
                    <th>Dueño</th>
                    <th>Gabinete</th>
                    <th>Rack</th>
                    <th>Slot</th>
                    <th>Canal</th>
                    <th>Caja</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {g.miembros.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link to={`/projects/${projectId}/control/signals/${m.id}`}>
                          {m.tagSenal ?? m.codigoSenal ?? '—'}
                        </Link>
                      </td>
                      <td>{m.nombreCorto ?? '—'}</td>
                      <td>
                        {m.dueno ? `${m.dueno.tag} (${m.dueno.tipo})` : '—'}
                      </td>
                      <td>{m.io?.tagGabinete ?? '—'}</td>
                      <td>{m.io?.numeroRack ?? '—'}</td>
                      <td>{m.io?.numeroSlot ?? '—'}</td>
                      <td>{m.io?.numeroCanal ?? '—'}</td>
                      <td>{m.cajaTag ?? '—'}</td>
                      <td>
                        <span className={`badge ${ESTADO_BADGE[m.estadoConexionado]}`}>
                          {ESTADO_LABEL[m.estadoConexionado]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
    </section>
  );
}
