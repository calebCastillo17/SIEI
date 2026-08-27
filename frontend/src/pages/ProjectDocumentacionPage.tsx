import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getDocumentacion, updateDocumentacion } from '../api/documentacion';
import { useAsyncData } from '../lib/useAsyncData';
import type { DocumentacionInput, ProyectoDocumentacion } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

type FieldKey = keyof Omit<ProyectoDocumentacion, 'projectId' | 'createdAt' | 'updatedAt'>;

const FIELDS: Array<{ key: FieldKey; label: string; maxLength: number; wide?: boolean }> = [
  { key: 'codigoProyectoCumbra', label: 'Proyecto CUMBRA', maxLength: 50 },
  { key: 'codigoProyectoCliente', label: 'Proyecto Cliente', maxLength: 50 },
  { key: 'tituloCaratula', label: 'Título de carátula', maxLength: 400, wide: true },
  { key: 'etapaCodigo', label: 'Código etapa', maxLength: 20 },
  { key: 'etapaNombre', label: 'Etapa', maxLength: 200 },
  { key: 'afe', label: 'AFE', maxLength: 50 },
  { key: 'vp', label: 'VP', maxLength: 200 },
  { key: 'jefeDisciplina', label: 'Jefe/Senior Disciplina', maxLength: 200 },
  { key: 'liderProyecto', label: 'Líder del Proyecto', maxLength: 200 },
  { key: 'gerenteIngenieriaConstruccion', label: 'Gerente Ingeniería/Construcción', maxLength: 200 },
  { key: 'inicialesPorDefault', label: 'Iniciales Por (por defecto)', maxLength: 20 },
  { key: 'inicialesRevisadoDefault', label: 'Iniciales Revisado (por defecto)', maxLength: 20 },
  { key: 'inicialesAprobadoDefault', label: 'Iniciales Aprobado (por defecto)', maxLength: 20 }
];

type FormState = Record<FieldKey, string>;

function toFormState(doc: ProyectoDocumentacion): FormState {
  const state = {} as FormState;
  for (const { key } of FIELDS) {
    state[key] = doc[key] ?? '';
  }
  return state;
}

export function ProjectDocumentacionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canAdminister = project?.access.permissions.administer ?? false;

  const fetchDoc = useCallback(() => {
    if (!projectId) return Promise.resolve<ProyectoDocumentacion | null>(null);
    return getDocumentacion(projectId, devUser.email).then((r) => r.documentacion);
  }, [projectId, devUser.email]);

  const { data: doc, loading, error: loadError, refresh: load } =
    useAsyncData<ProyectoDocumentacion | null>(fetchDoc);

  // Sincroniza el formulario editable con el resultado de `useAsyncData`
  // (la red, un sistema externo — mismo caso que ya justifica el propio
  // hook) apenas llega; no derivable en render porque después el usuario
  // edita este mismo estado libremente.
  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (doc) setForm(toFormState(doc));
  }, [doc]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSaved(false);

    const input: DocumentacionInput = {};
    for (const { key } of FIELDS) {
      input[key] = form[key].trim().length > 0 ? form[key].trim() : null;
    }

    try {
      await updateDocumentacion(projectId!, input, devUser.email);
      setSaved(true);
      load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  const error = submitError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Documentación</h1>
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

      <p className="form__note">
        Estos datos alimentan la carátula de cualquier entregable de este proyecto (LDI y
        futuros) — cargarlos acá una vez evita tener que volver a pedirlos al crear cada
        entregable o revisión.
      </p>

      <ErrorMessage error={error} />

      {!canAdminister && (
        <p className="form__hint">
          Tu rol no tiene permiso de administración en este proyecto — podés ver estos
          datos, pero no editarlos.
        </p>
      )}

      {saved && (
        <div className="notice">
          <h3>✓ Guardado</h3>
          <p>La documentación del proyecto se actualizó correctamente.</p>
        </div>
      )}

      {loading && <p>Cargando documentación…</p>}

      {!loading && form && (
        <form className="form form--wide" onSubmit={handleSubmit}>
          <fieldset className="form__section" disabled={!canAdminister || submitting}>
            <legend>Datos de carátula</legend>
            {FIELDS.map(({ key, label, maxLength, wide }) => (
              <label key={key} className={wide ? 'form__field form__field--wide' : 'form__field'}>
                <span>{label}</span>
                <input
                  type="text"
                  maxLength={maxLength}
                  value={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                />
              </label>
            ))}
          </fieldset>

          {canAdminister && (
            <div className="form__actions">
              <button type="submit" className="button" disabled={submitting}>
                {submitting ? 'Guardando…' : 'Guardar documentación'}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
