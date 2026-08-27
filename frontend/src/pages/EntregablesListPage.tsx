import { useCallback, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listEntregables } from '../api/entregables';
import { listTiposEntregable } from '../api/tiposEntregable';
import { listRevisiones } from '../api/revisionesEntregable';
import { useAsyncData } from '../lib/useAsyncData';
import type { Entregable, RevisionEntregable, TipoEntregable } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';
import { RevisionEstadoBadge } from '../components/RevisionEstadoBadge';

interface EntregablesListData {
  entregables: Entregable[];
  tipos: TipoEntregable[];
  revisionesPorEntregable: Map<string, RevisionEntregable[]>;
}

export function EntregablesListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  /* Un GET por entregable para traer su historial de revisiones (además
   * de la lista y los tipos) — a la escala real de un proyecto (unos
   * pocos entregables, no cientos) esto es más simple que inventar un
   * endpoint agregado que el backend no tiene hoy. */
  const fetchData = useCallback(async (): Promise<EntregablesListData> => {
    if (!projectId) return { entregables: [], tipos: [], revisionesPorEntregable: new Map() };

    const [entregablesResp, tiposResp] = await Promise.all([
      listEntregables(projectId, devUser.email),
      listTiposEntregable(devUser.email)
    ]);

    const revisionesPorEntregable = new Map<string, RevisionEntregable[]>();
    await Promise.all(
      entregablesResp.entregables.map(async (entregable) => {
        const revisionesResp = await listRevisiones(projectId, entregable.id, devUser.email);
        revisionesPorEntregable.set(entregable.id, revisionesResp.revisiones);
      })
    );

    return { entregables: entregablesResp.entregables, tipos: tiposResp.items, revisionesPorEntregable };
  }, [projectId, devUser.email]);

  const { data, loading, error, refresh: load } = useAsyncData<EntregablesListData>(fetchData);

  const tiposById = useMemo(() => new Map((data?.tipos ?? []).map((t) => [t.id, t])), [data]);
  const items = data?.entregables ?? [];

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Entregables</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={load}>
            Actualizar
          </button>
          <button
            type="button"
            className="button"
            disabled={!canWrite}
            title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
            onClick={() => navigate(`/projects/${projectId}/entregables/new`)}
          >
            + Nuevo entregable
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando entregables…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene entregables. Empezá creando el primero.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>N° Documento</th>
                <th>Área</th>
                <th>Disciplina</th>
                <th>Última revisión emitida</th>
                <th>Estado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((entregable) => {
                const tipo = tiposById.get(entregable.tipoEntregableId);
                const revisiones = data?.revisionesPorEntregable.get(entregable.id) ?? [];
                // Ya vienen ordenadas por created_at DESC (ver GET .../revisiones)
                // — la primera EMITIDA de esa lista es la más reciente.
                const ultimaEmitida = revisiones.find((r) => r.estado === 'EMITIDA');
                const estadoActual = revisiones[0]?.estado ?? null;

                return (
                  <tr key={entregable.id}>
                    <td>{tipo?.descripcion ?? entregable.componenteTipo ?? '—'}</td>
                    <td>
                      <Link to={`/projects/${projectId}/entregables/${entregable.id}`}>
                        {entregable.numeroDocumento}
                      </Link>
                    </td>
                    <td>{entregable.componenteArea ?? '—'}</td>
                    <td>{entregable.componenteDisciplina ?? '—'}</td>
                    <td>
                      {ultimaEmitida
                        ? `Rev ${ultimaEmitida.codigoRevision} (${new Date(ultimaEmitida.fecha).toLocaleDateString()})`
                        : '—'}
                    </td>
                    <td>
                      {estadoActual ? <RevisionEstadoBadge estado={estadoActual} /> : <span className="badge badge--com">Sin revisiones</span>}
                    </td>
                    <td className="table__row-actions">
                      <Link
                        to={`/projects/${projectId}/entregables/${entregable.id}`}
                        className="button button--secondary button--small"
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
