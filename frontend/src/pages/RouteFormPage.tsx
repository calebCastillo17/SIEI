import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createRoute } from '../api/connectionRoutes';
import { useRouteFormOptions } from '../components/useRouteFormOptions';
import { connectionPointFullLabel } from '../components/connectionPointLabel';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';
import type { RouteSegmentInput } from '../api/types';

function emptySegment(): RouteSegmentInput {
  return { parConductorId: '', puntoOrigenId: '', puntoDestinoId: '' };
}

export function RouteFormPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const { data: options, loading: optionsLoading, error: optionsError } = useRouteFormOptions(
    projectId ?? '',
    devUser.email
  );

  const [senalId, setSenalId] = useState<string | null>(null);
  const [segments, setSegments] = useState<RouteSegmentInput[]>([emptySegment()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  function setSegment(index: number, patch: Partial<RouteSegmentInput>) {
    setSegments((prev) => prev.map((seg, i) => (i === index ? { ...seg, ...patch } : seg)));
  }

  function addSegment() {
    setSegments((prev) => [...prev, emptySegment()]);
  }

  function removeSegment(index: number) {
    setSegments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!senalId || segments.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { route } = await createRoute(projectId!, { senalId, segments }, devUser.email);
      navigate(`/projects/${projectId}/routes/${route.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  const signalOptions = (options?.signals ?? []).map((s) => ({ id: s.id, label: s.tagSenal }));

  const pairOptions = (options?.conductorPairs ?? []).map((pair) => {
    const cable = options?.cables.find((c) => c.id === pair.cableId);
    const cableLabel = cable?.tagCable ?? `#${pair.cableId}`;
    return {
      id: pair.id,
      label: `${cableLabel} · Par ${pair.numeroPar}${pair.inUse ? ' (en uso)' : ''}`
    };
  });

  const pointOptions = options
    ? (options.connectionPoints ?? []).map((point) => ({
        id: point.id,
        label: connectionPointFullLabel(point, options)
      }))
    : [];

  const allValid =
    senalId !== null &&
    segments.length > 0 &&
    segments.every((seg) => seg.parConductorId && seg.puntoOrigenId && seg.puntoDestinoId);

  return (
    <section>
      <div className="page-header">
        <h1>Nueva ruta de conexión</h1>
      </div>

      {!canWrite && (
        <p className="form__hint">
          Tu rol no tiene permiso de escritura en este proyecto — el backend
          rechazará el envío aunque el formulario esté visible.
        </p>
      )}

      <ErrorMessage error={submitError ?? optionsError} />

      {optionsLoading && <p>Cargando datos del formulario…</p>}

      {!optionsLoading && options && (
        <form className="form form--wide" onSubmit={handleSubmit}>
          <fieldset className="form__section">
            <legend>Señal *</legend>
            <CatalogSelect
              required
              disabled={!canWrite || submitting}
              value={senalId}
              onChange={setSenalId}
              options={signalOptions}
              emptyLabel="— elegir señal —"
            />
          </fieldset>

          <fieldset className="form__section">
            <legend>Tramos, en orden — TRAMO 1 empieza en el origen de la ruta</legend>

            {segments.map((segment, index) => (
              <div key={index} className="form form--inline form--inline--compact">
                <label className="form__field">
                  <span>Tramo {index + 1} — Par conductor *</span>
                  <CatalogSelect
                    required
                    disabled={!canWrite || submitting}
                    value={segment.parConductorId || null}
                    onChange={(next) => setSegment(index, { parConductorId: next ?? '' })}
                    options={pairOptions}
                    emptyLabel="— elegir par —"
                  />
                </label>
                <label className="form__field">
                  <span>Punto origen *</span>
                  <CatalogSelect
                    required
                    disabled={!canWrite || submitting}
                    value={segment.puntoOrigenId || null}
                    onChange={(next) => setSegment(index, { puntoOrigenId: next ?? '' })}
                    options={pointOptions}
                    emptyLabel="— elegir punto —"
                  />
                </label>
                <label className="form__field">
                  <span>Punto destino *</span>
                  <CatalogSelect
                    required
                    disabled={!canWrite || submitting}
                    value={segment.puntoDestinoId || null}
                    onChange={(next) => setSegment(index, { puntoDestinoId: next ?? '' })}
                    options={pointOptions}
                    emptyLabel="— elegir punto —"
                  />
                </label>
                <button
                  type="button"
                  className="button button--danger button--small"
                  disabled={submitting || segments.length === 1}
                  onClick={() => removeSegment(index)}
                >
                  Quitar tramo
                </button>
              </div>
            ))}

            <button
              type="button"
              className="button button--secondary button--small"
              disabled={submitting}
              onClick={addSegment}
            >
              + Agregar tramo
            </button>
          </fieldset>

          <div className="form__actions">
            <button type="submit" className="button" disabled={!canWrite || submitting || !allValid}>
              {submitting ? 'Creando…' : 'Crear ruta'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={submitting}
              onClick={() => navigate(`/projects/${projectId}/routes`)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
