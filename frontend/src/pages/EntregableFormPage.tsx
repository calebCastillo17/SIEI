import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createEntregable } from '../api/entregables';
import { listTiposEntregable } from '../api/tiposEntregable';
import { getDocumentacion } from '../api/documentacion';
import { useAsyncData } from '../lib/useAsyncData';
import type { ProyectoDocumentacion, TipoEntregable } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

interface FormOptions {
  tipos: TipoEntregable[];
  documentacion: ProyectoDocumentacion | null;
}

/** Réplica en el cliente de `componerNumeroDocumento` (backend/src/routes/
 * entregables.ts): componentes vacíos se omiten en vez de dejar un
 * segmento "-" colgando. Es SOLO para la vista previa antes de guardar —
 * el número real siempre lo compone y devuelve el backend en la
 * respuesta del POST, esto nunca se envía como si fuera el definitivo. */
function previsualizarNumeroDocumento(componentes: Array<string | null | undefined>): string {
  return componentes.filter((c): c is string => Boolean(c && c.trim().length > 0)).join('-');
}

export function EntregableFormPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchOptions = useCallback(async (): Promise<FormOptions> => {
    if (!projectId) return { tipos: [], documentacion: null };
    const [tiposResp, docResp] = await Promise.all([
      listTiposEntregable(devUser.email),
      getDocumentacion(projectId, devUser.email)
    ]);
    return { tipos: tiposResp.items, documentacion: docResp.documentacion };
  }, [projectId, devUser.email]);

  const { data: options, loading: optionsLoading, error: optionsError } =
    useAsyncData<FormOptions>(fetchOptions);

  const [tipoEntregableId, setTipoEntregableId] = useState('');
  const [componenteArea, setComponenteArea] = useState('');
  const [componenteDisciplina, setComponenteDisciplina] = useState('');
  const [componenteCorrelativo, setComponenteCorrelativo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);

  const tipoSeleccionado = useMemo(
    () => options?.tipos.find((t) => t.id === tipoEntregableId),
    [options, tipoEntregableId]
  );

  const doc = options?.documentacion ?? null;
  const documentacionIncompleta = !doc?.etapaCodigo || !doc?.codigoProyectoCumbra || !doc?.codigoProyectoCliente;

  const numeroDocumentoPreview = useMemo(
    () =>
      previsualizarNumeroDocumento([
        doc?.etapaCodigo,
        doc?.codigoProyectoCumbra,
        doc?.codigoProyectoCliente,
        tipoSeleccionado?.codigo,
        componenteArea,
        componenteDisciplina,
        componenteCorrelativo
      ]),
    [doc, tipoSeleccionado, componenteArea, componenteDisciplina, componenteCorrelativo]
  );

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const { entregable } = await createEntregable(
        projectId!,
        {
          tipoEntregableId,
          componenteArea: componenteArea.trim() || null,
          componenteDisciplina: componenteDisciplina.trim() || null,
          componenteCorrelativo: componenteCorrelativo.trim()
        },
        devUser.email
      );
      navigate(`/projects/${projectId}/entregables/${entregable.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <h1>Nuevo entregable</h1>
      </div>

      {!canWrite && (
        <p className="form__hint">
          Tu rol no tiene permiso de escritura en este proyecto — el backend
          rechazará el envío aunque el formulario esté visible.
        </p>
      )}

      <ErrorMessage error={submitError ?? optionsError} />

      {optionsLoading && <p>Cargando opciones del formulario…</p>}

      {documentacionIncompleta && !optionsLoading && (
        <div className="notice">
          <h3>ℹ Documentación del proyecto incompleta</h3>
          <p>
            Etapa, código de proyecto CUMBRA y/o código de proyecto cliente todavía no
            están cargados — el número de documento va a quedar con esos segmentos vacíos.{' '}
            <Link to={`/projects/${projectId}/documentacion`}>Completar documentación del proyecto</Link>.
          </p>
        </div>
      )}

      {options && (
        <form className="form" onSubmit={handleSubmit}>
          <label className="form__field">
            <span>Tipo de entregable *</span>
            <select
              required
              disabled={submitting}
              value={tipoEntregableId}
              onChange={(event) => setTipoEntregableId(event.target.value)}
            >
              <option value="" disabled>
                Elegir…
              </option>
              {options.tipos.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.codigo} — {tipo.descripcion}
                </option>
              ))}
            </select>
          </label>

          <label className="form__field">
            <span>Área</span>
            <input
              type="text"
              maxLength={20}
              placeholder="ej. 620"
              disabled={submitting}
              value={componenteArea}
              onChange={(event) => setComponenteArea(event.target.value)}
            />
          </label>

          <label className="form__field">
            <span>Disciplina documental</span>
            <input
              type="text"
              maxLength={10}
              placeholder="ej. J"
              disabled={submitting}
              value={componenteDisciplina}
              onChange={(event) => setComponenteDisciplina(event.target.value)}
            />
          </label>

          <label className="form__field">
            <span>Correlativo *</span>
            <input
              type="text"
              maxLength={20}
              required
              placeholder="ej. 0001"
              disabled={submitting}
              value={componenteCorrelativo}
              onChange={(event) => setComponenteCorrelativo(event.target.value)}
            />
          </label>

          {tipoEntregableId && (
            <div className="notice">
              <h3>Composición prevista del número de documento</h3>
              <p>
                <code>{numeroDocumentoPreview || '(faltan datos para componerlo)'}</code>
              </p>
              <p className="form__note">
                Etapa, proyecto CUMBRA, proyecto cliente y título vienen de la
                documentación del proyecto — no hace falta volver a escribirlos acá.
              </p>
            </div>
          )}

          <div className="form__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={submitting}
              onClick={() => navigate(`/projects/${projectId}/entregables`)}
            >
              Cancelar
            </button>
            <button type="submit" className="button" disabled={!canWrite || submitting}>
              {submitting ? 'Creando…' : 'Crear entregable'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
