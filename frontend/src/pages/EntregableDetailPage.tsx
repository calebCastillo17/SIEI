import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getEntregable } from '../api/entregables';
import { listTiposEntregable } from '../api/tiposEntregable';
import { listRevisiones, downloadRevisionArchivo } from '../api/revisionesEntregable';
import { useAsyncData } from '../lib/useAsyncData';
import type { Entregable, RevisionEntregable, TipoEntregable } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';
import { RevisionEstadoBadge } from '../components/RevisionEstadoBadge';

interface DetailData {
  entregable: Entregable;
  tipo: TipoEntregable | null;
  revisiones: RevisionEntregable[];
}

export function EntregableDetailPage() {
  const { projectId, entregableId } = useParams<{ projectId: string; entregableId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchDetail = useCallback(async (): Promise<DetailData | null> => {
    if (!projectId || !entregableId) return null;
    const [entregableResp, tiposResp, revisionesResp] = await Promise.all([
      getEntregable(projectId, entregableId, devUser.email),
      listTiposEntregable(devUser.email),
      listRevisiones(projectId, entregableId, devUser.email)
    ]);
    return {
      entregable: entregableResp.entregable,
      tipo: tiposResp.items.find((t) => t.id === entregableResp.entregable.tipoEntregableId) ?? null,
      revisiones: revisionesResp.revisiones
    };
  }, [projectId, entregableId, devUser.email]);

  const { data, loading, error: loadError, refresh: load } = useAsyncData<DetailData | null>(fetchDetail);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<Error | null>(null);

  if (!projectId || !entregableId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleDownload(revisionId: string) {
    setDownloadingId(revisionId);
    setDownloadError(null);
    try {
      await downloadRevisionArchivo(projectId!, entregableId!, revisionId, devUser.email);
    } catch (err) {
      setDownloadError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDownloadingId(null);
    }
  }

  const error = downloadError ?? loadError;
  const revisiones = data?.revisiones ?? [];
  const borradorAbierto = revisiones.find((r) => r.estado === 'BORRADOR');

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{data?.tipo?.descripcion.toUpperCase() ?? 'Entregable'}</h1>
          {data?.entregable && (
            <p className="page-subtitle">
              <code>{data.entregable.numeroDocumento}</code>
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={load}>
            Actualizar
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => navigate(`/projects/${projectId}/entregables`)}
          >
            Volver a Entregables
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando entregable…</p>}

      {!loading && data && (
        <>
          <dl className="detail-list">
            <div>
              <dt>Tipo</dt>
              <dd>{data.tipo ? `${data.tipo.codigo} — ${data.tipo.descripcion}` : data.entregable.componenteTipo}</dd>
            </div>
            <div>
              <dt>Área</dt>
              <dd>{data.entregable.componenteArea ?? '—'}</dd>
            </div>
            <div>
              <dt>Disciplina</dt>
              <dd>{data.entregable.componenteDisciplina ?? '—'}</dd>
            </div>
            <div>
              <dt>Título</dt>
              <dd>{data.entregable.titulo ?? '—'}</dd>
            </div>
          </dl>

          <div className="section-header">
            <h2>Revisiones</h2>
            {borradorAbierto ? (
              <Link
                to={`/projects/${projectId}/entregables/${entregableId}/revisiones/${borradorAbierto.id}`}
                className="button"
              >
                Continuar borrador abierto
              </Link>
            ) : (
              <button
                type="button"
                className="button"
                disabled={!canWrite}
                title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
                onClick={() =>
                  navigate(`/projects/${projectId}/entregables/${entregableId}/revisiones/new`)
                }
              >
                + Nueva revisión
              </button>
            )}
          </div>

          {borradorAbierto && (
            <p className="form__note">
              Ya existe un BORRADOR abierto (Rev {borradorAbierto.codigoRevision}) — hay que
              emitirlo o descartarlo antes de poder crear una revisión nueva.
            </p>
          )}

          {revisiones.length === 0 && <p>Este entregable todavía no tiene revisiones.</p>}

          {revisiones.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rev</th>
                    <th>Fecha</th>
                    <th>Descripción</th>
                    <th>Estado</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {revisiones.map((revision) => (
                    <tr key={revision.id}>
                      <td>
                        <Link
                          to={`/projects/${projectId}/entregables/${entregableId}/revisiones/${revision.id}`}
                        >
                          Rev {revision.codigoRevision}
                        </Link>
                      </td>
                      <td>{new Date(revision.fecha).toLocaleDateString()}</td>
                      <td>{revision.descripcion}</td>
                      <td>
                        <RevisionEstadoBadge estado={revision.estado} />
                      </td>
                      <td className="table__row-actions">
                        {revision.estado === 'EMITIDA' && (
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            disabled={downloadingId === revision.id}
                            onClick={() => handleDownload(revision.id)}
                          >
                            {downloadingId === revision.id ? 'Descargando…' : 'Descargar Excel'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
