import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listControlSignals, type ControlSignalFilters } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlSignalsResponse, EstadoConexionado } from '../api/types';
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
 * Sección CONTROL — tabla principal de señales con dueño/IO/conexionado
 * ya resueltos (ver backend/src/routes/controlOverview.ts). Es una vista
 * de solo lectura sobre nucleo.senal/instrumento/equipo/canal/gabinete —
 * no un módulo de datos paralelo. Las terminaciones finas quedan fuera
 * de esta tabla a propósito: "estadoConexionado" solo distingue
 * IO_PENDIENTE / RUTA_PENDIENTE / RUTA_CARGADA (ver CLAUDE.md).
 */
export function ControlSignalsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);

  const [filters, setFilters] = useState<ControlSignalFilters>({});

  const fetchSignals = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlSignalsResponse>({ projectId: '', signals: [] });
    return listControlSignals(projectId, filters, devUser.email);
  }, [projectId, filters, devUser.email]);

  const { data, loading, error, refresh } = useAsyncData<ControlSignalsResponse>(fetchSignals);
  const signals = useMemo(() => data?.signals ?? [], [data]);

  const gabinetesDisponibles = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of signals) if (s.io?.gabineteId && s.io.tagGabinete) map.set(s.io.gabineteId, s.io.tagGabinete);
    return [...map.entries()];
  }, [signals]);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control</h1>
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
          <Link className="button button--secondary" to={`/projects/${projectId}/control/hardware`}>
            Ver hardware
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}/control/groups`}>
            Ver agrupaciones
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}/control/planos`}>
            Ver planos
          </Link>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Buscar por TAG, código o dueño…"
          value={filters.q ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <select
          value={filters.gabineteId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, gabineteId: e.target.value || undefined }))}
        >
          <option value="">Todos los gabinetes</option>
          {gabinetesDisponibles.map(([id, tag]) => (
            <option key={id} value={id}>
              {tag}
            </option>
          ))}
        </select>
        <select
          value={filters.tipoIoCodigo ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, tipoIoCodigo: e.target.value || undefined }))}
        >
          <option value="">Todos los tipos de E/S</option>
          <option value="AI">AI</option>
          <option value="AO">AO</option>
          <option value="DI">DI</option>
          <option value="DO">DO</option>
          <option value="RTD">RTD</option>
        </select>
        <select
          value={filters.duenoTipo ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, duenoTipo: (e.target.value || undefined) as 'instrumento' | 'equipo' | undefined }))}
        >
          <option value="">Instrumento o equipo</option>
          <option value="instrumento">Instrumento</option>
          <option value="equipo">Equipo</option>
        </select>
        <select
          value={filters.estado ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, estado: (e.target.value || undefined) as EstadoConexionado | undefined }))}
        >
          <option value="">Todos los estados</option>
          <option value="IO_PENDIENTE">IO pendiente</option>
          <option value="RUTA_PENDIENTE">Ruta pendiente</option>
          <option value="RUTA_CARGADA">Ruta cargada</option>
        </select>
        {(filters.q || filters.gabineteId || filters.tipoIoCodigo || filters.duenoTipo || filters.estado) && (
          <button type="button" className="button button--small button--secondary" onClick={() => setFilters({})}>
            Limpiar filtros
          </button>
        )}
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando señales CONTROL…</p>}

      {!loading && !error && signals.length === 0 && (
        <p>No hay señales CONTROL que coincidan con el filtro.</p>
      )}

      {!loading && signals.length > 0 && (
        <>
          <p className="page-subtitle">{signals.length} señal(es)</p>
          <table className="table">
            <thead>
              <tr>
                <th>TAG señal</th>
                <th>Señal</th>
                <th>Dueño</th>
                <th>Tipo E/S</th>
                <th>Gabinete</th>
                <th>Rack</th>
                <th>Slot</th>
                <th>Módulo</th>
                <th>Canal</th>
                <th>Caja</th>
                <th>Conexionado</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/projects/${projectId}/control/signals/${s.id}`}>
                      {s.tagSenal ?? <em>{s.codigoSenal ?? '—'}</em>}
                    </Link>
                  </td>
                  <td>{s.nombreCorto ?? '—'}</td>
                  <td>
                    {s.duenoAusente ? (
                      <span className="badge badge--danger" title="El instrumento que era su dueño fue eliminado definitivamente.">
                        ⚠ sin dueño
                      </span>
                    ) : s.dueno ? (
                      <>
                        <span className={`badge ${s.dueno.tipo === 'instrumento' ? 'badge--control' : 'badge--com'}`}>
                          {s.dueno.tipo}
                        </span>{' '}
                        {s.dueno.tag}
                        {s.agrupador && (
                          <>
                            {' '}
                            <span className="page-subtitle">(grupo {s.agrupador.tag})</span>
                          </>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{s.tipoIoCodigo ?? '—'}</td>
                  <td>{s.io?.tagGabinete ?? '—'}</td>
                  <td>{s.io?.numeroRack ?? '—'}</td>
                  <td>{s.io?.numeroSlot ?? '—'}</td>
                  <td>{s.io?.modelo ?? '—'}</td>
                  <td>{s.io?.numeroCanal ?? '—'}</td>
                  <td>{s.cajaTag ?? '—'}</td>
                  <td>
                    <span className={`badge ${ESTADO_BADGE[s.estadoConexionado]}`}>
                      {ESTADO_LABEL[s.estadoConexionado]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
