import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getDocumentacion } from '../api/documentacion';
import { createRevision } from '../api/revisionesEntregable';
import { useAsyncData } from '../lib/useAsyncData';
import type { CriterioOrden, ProyectoDocumentacion } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';
import { ApiError } from '../api/client';
import { OrderCriteriaEditor } from '../components/OrderCriteriaEditor';
import { DEFAULT_ORDER_CRITERIA } from '../components/orderCriteriaLabels';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RevisionFormPage() {
  const { projectId, entregableId } = useParams<{ projectId: string; entregableId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchDoc = useCallback(async (): Promise<ProyectoDocumentacion | null> => {
    if (!projectId) return null;
    const { documentacion } = await getDocumentacion(projectId, devUser.email);
    return documentacion;
  }, [projectId, devUser.email]);

  const { data: doc, loading: docLoading, error: docError } = useAsyncData<ProyectoDocumentacion | null>(fetchDoc);

  const [codigoRevision, setCodigoRevision] = useState('');
  const [fecha, setFecha] = useState(today());
  const [descripcion, setDescripcion] = useState('');
  const [inicialesPor, setInicialesPor] = useState('');
  const [inicialesRevisado, setInicialesRevisado] = useState('');
  const [inicialesAprobado, setInicialesAprobado] = useState('');
  const [criterios, setCriterios] = useState<CriterioOrden[]>(DEFAULT_ORDER_CRITERIA);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [conflictBorradorId, setConflictBorradorId] = useState<string | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Precarga las iniciales default de proyecto_documentacion UNA sola vez,
  // apenas llegan — sincroniza estado local con un dato externo que recién
  // está disponible de forma asíncrona (el caso legítimo que React
  // documenta para un efecto), y no vuelve a pisar lo que el usuario haya
  // tipeado después (`defaultsApplied` corta el efecto a un solo disparo).
  useEffect(() => {
    if (!doc || defaultsApplied) return;
    // oxlint-disable-next-line react/set-state-in-effect
    setInicialesPor(doc.inicialesPorDefault ?? '');
    // oxlint-disable-next-line react/set-state-in-effect
    setInicialesRevisado(doc.inicialesRevisadoDefault ?? '');
    // oxlint-disable-next-line react/set-state-in-effect
    setInicialesAprobado(doc.inicialesAprobadoDefault ?? '');
    // oxlint-disable-next-line react/set-state-in-effect
    setDefaultsApplied(true);
  }, [doc, defaultsApplied]);

  if (!projectId || !entregableId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setConflictBorradorId(null);

    try {
      const { revision } = await createRevision(
        projectId!,
        entregableId!,
        {
          codigoRevision: codigoRevision.trim(),
          fecha,
          descripcion: descripcion.trim(),
          inicialesPor: inicialesPor.trim(),
          inicialesRevisado: inicialesRevisado.trim(),
          inicialesAprobado: inicialesAprobado.trim(),
          criterios
        },
        devUser.email
      );
      navigate(`/projects/${projectId}/entregables/${entregableId}/revisiones/${revision.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === 'borrador_ya_existe') {
        setConflictBorradorId('existe');
      }
      setSubmitError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <h1>Nueva revisión</h1>
      </div>

      {!canWrite && (
        <p className="form__hint">
          Tu rol no tiene permiso de escritura en este proyecto — el backend
          rechazará el envío aunque el formulario esté visible.
        </p>
      )}

      <ErrorMessage error={submitError ?? docError} />

      {conflictBorradorId && (
        <div className="notice">
          <h3>⚠ Ya existe un BORRADOR abierto</h3>
          <p>
            Este entregable ya tiene una revisión en BORRADOR — hay que emitirla o
            descartarla antes de crear una nueva. Volvé al detalle del entregable para
            continuarla.
          </p>
        </div>
      )}

      {docLoading && <p>Cargando valores por defecto…</p>}

      {!docLoading && (
        <form className="form form--wide" onSubmit={handleSubmit}>
          <fieldset className="form__section">
            <legend>Datos de la revisión</legend>

            <label className="form__field">
              <span>Revisión *</span>
              <input
                type="text"
                maxLength={10}
                required
                placeholder="ej. A"
                disabled={submitting}
                value={codigoRevision}
                onChange={(event) => setCodigoRevision(event.target.value)}
              />
            </label>

            <label className="form__field">
              <span>Fecha *</span>
              <input
                type="date"
                required
                disabled={submitting}
                value={fecha}
                onChange={(event) => setFecha(event.target.value)}
              />
            </label>

            <label className="form__field form__field--wide">
              <span>Descripción *</span>
              <textarea
                maxLength={400}
                required
                disabled={submitting}
                value={descripcion}
                onChange={(event) => setDescripcion(event.target.value)}
              />
            </label>

            <label className="form__field">
              <span>Por *</span>
              <input
                type="text"
                maxLength={20}
                required
                disabled={submitting}
                value={inicialesPor}
                onChange={(event) => setInicialesPor(event.target.value)}
              />
            </label>

            <label className="form__field">
              <span>Revisado *</span>
              <input
                type="text"
                maxLength={20}
                required
                disabled={submitting}
                value={inicialesRevisado}
                onChange={(event) => setInicialesRevisado(event.target.value)}
              />
            </label>

            <label className="form__field">
              <span>Aprobado *</span>
              <input
                type="text"
                maxLength={20}
                required
                disabled={submitting}
                value={inicialesAprobado}
                onChange={(event) => setInicialesAprobado(event.target.value)}
              />
            </label>
          </fieldset>

          <fieldset className="form__section">
            <legend>Configuración del orden</legend>
            <div className="form__field--wide">
              <p className="form__note">
                LOCACIÓN sigue siendo la agrupación visual principal del Excel — eso lo
                hace el generador, no hace falta reproducirlo acá. Este orden es el punto
                de partida de la revisión, se puede regenerar la vista previa las veces
                que haga falta mientras siga en BORRADOR.
              </p>
              <OrderCriteriaEditor value={criterios} onChange={setCriterios} disabled={submitting} />
            </div>
          </fieldset>

          <div className="form__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={submitting}
              onClick={() => navigate(`/projects/${projectId}/entregables/${entregableId}`)}
            >
              Cancelar
            </button>
            <button type="submit" className="button" disabled={!canWrite || submitting}>
              {submitting ? 'Creando…' : 'Crear revisión (BORRADOR)'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
