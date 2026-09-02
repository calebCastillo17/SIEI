import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  deleteRevisionDefinitivamente,
  discardRevision,
  downloadRevisionArchivo,
  emitirRevision,
  getRevision,
  updateRevision
} from '../api/revisionesEntregable';
import { useAsyncData } from '../lib/useAsyncData';
import type { CriterioOrden, RevisionDetailResponse } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';
import { RevisionEstadoBadge } from '../components/RevisionEstadoBadge';
import { OrderCriteriaEditor } from '../components/OrderCriteriaEditor';
import { ordenCampoLabel } from '../components/orderCriteriaLabels';

const PREVIEW_ROW_LIMIT = 100;

interface Draft {
  codigoRevision: string;
  fecha: string;
  descripcion: string;
  inicialesPor: string;
  inicialesRevisado: string;
  inicialesAprobado: string;
  criterios: CriterioOrden[];
}

function toDraft(detail: RevisionDetailResponse): Draft {
  return {
    codigoRevision: detail.revision.codigoRevision,
    fecha: detail.revision.fecha.slice(0, 10),
    descripcion: detail.revision.descripcion,
    inicialesPor: detail.revision.inicialesPor,
    inicialesRevisado: detail.revision.inicialesRevisado,
    inicialesAprobado: detail.revision.inicialesAprobado,
    criterios: detail.revision.criteriosAplicados ?? []
  };
}

export function RevisionDetailPage() {
  const { projectId, entregableId, revisionId } = useParams<{
    projectId: string;
    entregableId: string;
    revisionId: string;
  }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canAdminister = project?.access.permissions.administer ?? false;

  const fetchDetail = useCallback(async (): Promise<RevisionDetailResponse | null> => {
    if (!projectId || !entregableId || !revisionId) return null;
    return getRevision(projectId, entregableId, revisionId, devUser.email);
  }, [projectId, entregableId, revisionId, devUser.email]);

  const { data: initial, loading, error: loadError, refresh: reload } =
    useAsyncData<RevisionDetailResponse | null>(fetchDetail);

  // `current` es la fuente de verdad para lo que se muestra: arranca desde
  // el primer GET, y después de "Generar vista previa" se actualiza
  // directamente con la respuesta del PATCH (sin round-trip extra) — solo
  // emitir/descartar vuelven a pedir el detalle completo con reload().
  // Sincroniza estado local con el resultado de `useAsyncData` (un sistema
  // externo — la red — igual que el propio hook ya justifica en su
  // comentario) apenas llega; no es derivable en render porque después se
  // actualiza también desde eventos (el PATCH de "Generar vista previa").
  const [current, setCurrent] = useState<RevisionDetailResponse | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (initial) setCurrent(initial);
  }, [initial]);

  // Mismo motivo: el borrador editable arranca desde el valor recién
  // llegado de `current` y después el usuario lo edita libremente — no se
  // puede derivar en cada render sin pisar lo que el usuario está tipeando.
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (current) setDraft(toDraft(current));
  }, [current]);

  const [previewSubmitting, setPreviewSubmitting] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deletingDefinitivamente, setDeletingDefinitivamente] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId || !entregableId || !revisionId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleGeneratePreview() {
    if (!draft || previewSubmitting) return;
    setPreviewSubmitting(true);
    setActionError(null);
    try {
      const response = await updateRevision(
        projectId!,
        entregableId!,
        revisionId!,
        {
          codigoRevision: draft.codigoRevision.trim(),
          fecha: draft.fecha,
          descripcion: draft.descripcion.trim(),
          inicialesPor: draft.inicialesPor.trim(),
          inicialesRevisado: draft.inicialesRevisado.trim(),
          inicialesAprobado: draft.inicialesAprobado.trim(),
          criterios: draft.criterios
        },
        devUser.email
      );
      setCurrent({
        revision: response.revision,
        metadatosSnapshot: response.metadatosSnapshot,
        filas: response.filas
      });
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setPreviewSubmitting(false);
    }
  }

  async function handleEmitir() {
    if (emitting) return;
    const confirmed = window.confirm(
      'Una revisión emitida quedará congelada y no podrá modificarse. ¿Confirmás la emisión?'
    );
    if (!confirmed) return;

    setEmitting(true);
    setActionError(null);
    try {
      await emitirRevision(projectId!, entregableId!, revisionId!, devUser.email);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setEmitting(false);
    }
  }

  async function handleDiscard() {
    if (discarding) return;
    const confirmed = window.confirm(
      '¿Descartar este borrador? Pasará a DESCARTADA, quedará de solo lectura como historial, y ya no se podrá emitir.'
    );
    if (!confirmed) return;

    setDiscarding(true);
    setActionError(null);
    try {
      await discardRevision(projectId!, entregableId!, revisionId!, devUser.email);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDiscarding(false);
    }
  }

  async function handleDeleteDefinitivamente() {
    if (deletingDefinitivamente || !revision) return;
    const confirmed = window.confirm(
      `¿Eliminar DEFINITIVAMENTE la revisión "${revision.codigoRevision}"? ` +
        'Esto borra el registro, su snapshot y el archivo .xlsx emitido de forma permanente — no hay forma de deshacerlo. ' +
        'Escribí "eliminar" y confirmá para continuar.'
    );
    if (!confirmed) return;

    setDeletingDefinitivamente(true);
    setActionError(null);
    try {
      await deleteRevisionDefinitivamente(projectId!, entregableId!, revisionId!, devUser.email);
      navigate(`/projects/${projectId}/entregables/${entregableId}`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeletingDefinitivamente(false);
    }
  }

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    setActionError(null);
    try {
      await downloadRevisionArchivo(projectId!, entregableId!, revisionId!, devUser.email);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDownloading(false);
    }
  }

  const error = actionError ?? loadError;
  const revision = current?.revision;
  const filas = current?.filas ?? [];
  const esBorrador = revision?.estado === 'BORRADOR';
  const esEmitida = revision?.estado === 'EMITIDA';
  const esDescartada = revision?.estado === 'DESCARTADA';

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{revision ? `Rev ${revision.codigoRevision}` : 'Revisión'}</h1>
          {revision && <RevisionEstadoBadge estado={revision.estado} />}
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => navigate(`/projects/${projectId}/entregables/${entregableId}`)}
          >
            Volver al entregable
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando revisión…</p>}

      {esEmitida && (
        <div className="notice">
          <h3>✓ Revisión emitida</h3>
          <p>Esta revisión está congelada y es de solo lectura. El archivo oficial ya fue generado.</p>
        </div>
      )}

      {esDescartada && (
        <div className="notice">
          <h3>Revisión descartada</h3>
          <p>Esta revisión es de solo lectura y ya no se puede emitir. Queda como historial.</p>
          <div className="form__actions">
            <button
              type="button"
              className="button button--danger"
              disabled={!canAdminister || deletingDefinitivamente}
              title={
                canAdminister
                  ? 'Borra permanentemente esta revisión.'
                  : 'Eliminar una revisión descartada requiere permiso de administración en el proyecto.'
              }
              onClick={handleDeleteDefinitivamente}
            >
              {deletingDefinitivamente ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          </div>
        </div>
      )}

      {revision && !esBorrador && (
        <dl className="detail-list">
          <div>
            <dt>Fecha</dt>
            <dd>{new Date(revision.fecha).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt>Descripción</dt>
            <dd>{revision.descripcion}</dd>
          </div>
          <div>
            <dt>Por</dt>
            <dd>{revision.inicialesPor}</dd>
          </div>
          <div>
            <dt>Revisado</dt>
            <dd>{revision.inicialesRevisado}</dd>
          </div>
          <div>
            <dt>Aprobado</dt>
            <dd>{revision.inicialesAprobado}</dd>
          </div>
          <div>
            <dt>Criterios de orden aplicados</dt>
            <dd>
              {revision.criteriosAplicados
                ?.map((c, i) => `${i + 1}. ${ordenCampoLabel(c.campo)} (${c.direccion})`)
                .join(' · ') ?? '—'}
            </dd>
          </div>
          {esEmitida && (
            <div>
              <dt>Emitida</dt>
              <dd>{revision.emitidaAt ? new Date(revision.emitidaAt).toLocaleString() : '—'}</dd>
            </div>
          )}
          {esEmitida && (
            <div>
              <dt>Fila en carátula</dt>
              <dd>
                {revision.filaCaratula ?? 'Ya no aparece (expulsada por revisiones más nuevas)'}
              </dd>
            </div>
          )}
        </dl>
      )}

      {esEmitida && (
        <div className="form__actions">
          <button type="button" className="button" disabled={downloading} onClick={handleDownload}>
            {downloading ? 'Descargando…' : 'Descargar Excel'}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={!canAdminister || deletingDefinitivamente}
            title={
              canAdminister
                ? 'Borra permanentemente esta revisión y su archivo emitido.'
                : 'Eliminar una revisión emitida requiere permiso de administración en el proyecto.'
            }
            onClick={handleDeleteDefinitivamente}
          >
            {deletingDefinitivamente ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
        </div>
      )}

      {esBorrador && draft && (
        <>
          <fieldset className="form__section" disabled={!canWrite}>
            <legend>Datos de la revisión</legend>

            <label className="form__field">
              <span>Revisión *</span>
              <input
                type="text"
                maxLength={10}
                required
                value={draft.codigoRevision}
                onChange={(event) => setDraft({ ...draft, codigoRevision: event.target.value })}
              />
            </label>

            <label className="form__field">
              <span>Fecha *</span>
              <input
                type="date"
                required
                value={draft.fecha}
                onChange={(event) => setDraft({ ...draft, fecha: event.target.value })}
              />
            </label>

            <label className="form__field form__field--wide">
              <span>Descripción *</span>
              <textarea
                maxLength={400}
                required
                value={draft.descripcion}
                onChange={(event) => setDraft({ ...draft, descripcion: event.target.value })}
              />
            </label>

            <label className="form__field">
              <span>Por *</span>
              <input
                type="text"
                maxLength={20}
                required
                value={draft.inicialesPor}
                onChange={(event) => setDraft({ ...draft, inicialesPor: event.target.value })}
              />
            </label>

            <label className="form__field">
              <span>Revisado *</span>
              <input
                type="text"
                maxLength={20}
                required
                value={draft.inicialesRevisado}
                onChange={(event) => setDraft({ ...draft, inicialesRevisado: event.target.value })}
              />
            </label>

            <label className="form__field">
              <span>Aprobado *</span>
              <input
                type="text"
                maxLength={20}
                required
                value={draft.inicialesAprobado}
                onChange={(event) => setDraft({ ...draft, inicialesAprobado: event.target.value })}
              />
            </label>
          </fieldset>

          <fieldset className="form__section" disabled={!canWrite}>
            <legend>Configuración del orden</legend>
            <div className="form__field--wide">
              <OrderCriteriaEditor
                value={draft.criterios}
                onChange={(criterios) => setDraft({ ...draft, criterios })}
                disabled={!canWrite}
              />
            </div>
          </fieldset>

          <div className="form__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!canWrite || previewSubmitting}
              title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
              onClick={handleGeneratePreview}
            >
              {previewSubmitting ? 'Generando…' : 'Generar vista previa'}
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={!canWrite || discarding || emitting}
              title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
              onClick={handleDiscard}
            >
              {discarding ? 'Descartando…' : 'Descartar borrador'}
            </button>
            <button
              type="button"
              className="button"
              disabled={!canWrite || emitting || discarding}
              title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
              onClick={handleEmitir}
            >
              {emitting ? 'Emitiendo…' : 'Emitir revisión'}
            </button>
          </div>
        </>
      )}

      {current && (
        <>
          <div className="section-header">
            <h2>Vista previa del listado</h2>
          </div>

          {filas.length === 0 && (
            <div className="notice">
              <h3>⚠ Sin instrumentos</h3>
              <p>
                No hay instrumentos activos en el proyecto — el listado quedaría vacío si
                se emite en este estado.
              </p>
            </div>
          )}

          {filas.length > 0 && (
            <>
              <p className="page-subtitle">
                {filas.length} instrumento(s) en total. Mostrando las primeras{' '}
                {Math.min(PREVIEW_ROW_LIMIT, filas.length)}.
              </p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ítem</th>
                      <th>TAG</th>
                      <th>Descripción</th>
                      <th>Instrumento Asociado</th>
                      <th>Locación</th>
                      <th>Servicio</th>
                      <th>Rev</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.slice(0, PREVIEW_ROW_LIMIT).map((fila) => (
                      <tr key={fila.item}>
                        <td>{fila.item}</td>
                        <td>{fila.snapshot.tag}</td>
                        <td>{fila.snapshot.descripcion || '—'}</td>
                        <td>{fila.snapshot.instrumentoAsociado || '—'}</td>
                        <td>{fila.snapshot.locacion || '—'}</td>
                        <td>{fila.snapshot.servicio || '—'}</td>
                        <td>{fila.snapshot.rev}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="form__note">
                Las 19 columnas completas (incluida la agrupación visual por LOCACIÓN) solo
                se ven en el Excel generado.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
