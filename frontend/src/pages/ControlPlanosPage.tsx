import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listControlPlanos } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlPlanosResponse } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const TIPO_BADGE: Record<string, string> = {
  CONEXIONADO: 'badge--control',
  INTERIOR_GABINETE: 'badge--warning',
  LAYOUT: 'badge--com',
  UNIFILAR: 'badge--success'
};

/**
 * Tabla que relaciona el hardware de CONTROL (gabinetes y cajas) con los
 * planos que los documentan (nucleo.gabinete_plano / caja_plano, ya
 * cargados desde la hoja PLANOS) — no es un dato nuevo, es la vista
 * consolidada "qué planos cubren mi conexionado" que responde a la
 * pregunta de cómo se relacionan los CONEXIONADO/LAYOUT/UNIFILAR/
 * INTERIOR_GABINETE con cada tablero. Cada fila es una asociación real.
 */
export function ControlPlanosPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);

  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('');
  const [entidadTipo, setEntidadTipo] = useState('');

  const fetchPlanos = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlPlanosResponse>({ projectId: '', planos: [] });
    return listControlPlanos(projectId, devUser.email);
  }, [projectId, devUser.email]);

  const { data, loading, error, refresh } = useAsyncData<ControlPlanosResponse>(fetchPlanos);
  const todas = useMemo(() => data?.planos ?? [], [data]);

  const filtradas = useMemo(() => {
    return todas.filter((p) => {
      if (tipo && p.tipoPlanoCodigo !== tipo) return false;
      if (entidadTipo && p.entidadTipo !== entidadTipo) return false;
      if (q) {
        const needle = q.toLowerCase();
        const haystack = `${p.entidadTag} ${p.codigoPlano ?? ''} ${p.descripcion}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [todas, tipo, entidadTipo, q]);

  const agrupadasPorTablero = useMemo(() => {
    const map = new Map<string, { entidadTipo: string; entidadTag: string; entidadId: string; planos: typeof filtradas }>();
    for (const p of filtradas) {
      const key = `${p.entidadTipo}:${p.entidadId}`;
      if (!map.has(key)) map.set(key, { entidadTipo: p.entidadTipo, entidadTag: p.entidadTag, entidadId: p.entidadId, planos: [] });
      map.get(key)!.planos.push(p);
    }
    return [...map.values()].sort((a, b) => a.entidadTag.localeCompare(b.entidadTag));
  }, [filtradas]);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control — Planos</h1>
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
          <Link className="button button--secondary" to={`/projects/${projectId}/planos`}>
            Administrar planos
          </Link>
        </div>
      </div>

      <p className="page-subtitle">
        Qué plano documenta cada gabinete/caja del conexionado de Control — {filtradas.length} asociación(es)
        {todas.length !== filtradas.length ? ` de ${todas.length}` : ''}.
      </p>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Buscar por tablero, código o descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={entidadTipo} onChange={(e) => setEntidadTipo(e.target.value)}>
          <option value="">Gabinete o caja</option>
          <option value="gabinete">Gabinete</option>
          <option value="caja">Caja</option>
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los tipos de plano</option>
          <option value="CONEXIONADO">Conexionado</option>
          <option value="INTERIOR_GABINETE">Interior de gabinete</option>
          <option value="LAYOUT">Layout</option>
          <option value="UNIFILAR">Unifilar</option>
        </select>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando planos…</p>}

      {!loading && !error && filtradas.length === 0 && (
        <p>No hay asociaciones de plano que coincidan.</p>
      )}

      {!loading &&
        agrupadasPorTablero.map((grupo) => (
          <div key={`${grupo.entidadTipo}:${grupo.entidadId}`} className="control-group">
            <div className="control-group__header" style={{ cursor: 'default' }}>
              <span className={`badge ${grupo.entidadTipo === 'gabinete' ? 'badge--control' : 'badge--com'}`}>
                {grupo.entidadTipo}
              </span>
              <strong>{grupo.entidadTag}</strong>
              <span className="page-subtitle">{grupo.planos.length} plano(s)</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Código</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {grupo.planos.map((p) => (
                  <tr key={p.planoId}>
                    <td>
                      <span className={`badge ${TIPO_BADGE[p.tipoPlanoCodigo] ?? 'badge--control'}`}>
                        {p.tipoPlanoCodigo}
                      </span>
                    </td>
                    <td>
                      <Link to={`/projects/${projectId}/planos/${p.planoId}`}>{p.codigoPlano ?? `#${p.planoId}`}</Link>
                    </td>
                    <td>{p.descripcion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
