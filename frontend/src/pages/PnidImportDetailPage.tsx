import { Fragment, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { applyPnidImport, discardPnidImport, getPnidImport } from '../api/pnidImports';
import { ApiError } from '../api/client';
import { useAsyncData } from '../lib/useAsyncData';
import type { PnidDetailResultado, PnidImportDetailResponse } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';
import { PnidEstadoBadge } from '../components/PnidEstadoBadge';
import { PNID_ESTADO_LABELS, pnidFieldLabel } from '../components/pnidLabels';

const ESTADO_LABELS: Record<string, string> = {
  PREVISUALIZADO: 'Previsualizado',
  APLICADO: 'Aplicado',
  DESCARTADO: 'Descartado',
  ERROR: 'Error'
};

const COUNT_LABELS: Array<{ key: keyof PnidImportDetailResponse['import']['conteos']; label: string }> = [
  { key: 'sinCambios', label: 'Sin cambios' },
  { key: 'nuevos', label: 'Nuevos' },
  { key: 'tagModificado', label: 'TAG modificados' },
  { key: 'datosModificados', label: 'Datos modificados' },
  { key: 'pnpidActualizado', label: 'PnPID actualizado' },
  { key: 'excluidosListado', label: 'No listados' },
  { key: 'noExisteReporte', label: 'No existen en P&ID' },
  { key: 'requiereRevision', label: 'Requieren revisión' }
];

/**
 * Muestra dos cosas, no una sola: (1) TODOS los campos que trae la fila del
 * reporte para esta fila — no solo los que cambiaron — porque una fila
 * NUEVO_EN_PNID nunca tiene `diferencias` (no hay nada previo contra qué
 * comparar) y sin esto ningún dato del reporte era visible antes de
 * aplicar; y (2) las diferencias contra el instrumento existente, cuando
 * las hay. Todo viene de `datosPropuestos`/`diferencias` del backend —
 * nunca se recalcula acá.
 */
function ResultRowDetail({ resultado }: { resultado: PnidDetailResultado }) {
  const proposedEntries = resultado.datosPropuestos
    ? Object.entries(resultado.datosPropuestos).filter(
        ([, valor]) => valor !== null && valor !== ''
      )
    : [];

  return (
    <>
      {resultado.datosPropuestos === null && resultado.resultado === 'NO_EXISTE_EN_PNID' && (
        <p>
          Este instrumento existía en SIEI como objeto proveniente de Plant
          3D, pero su PnPID ya no aparece en el reporte actual.
        </p>
      )}

      {resultado.datosPropuestos !== null && (
        <>
          <h4>Datos del reporte</h4>
          {proposedEntries.length === 0 ? (
            <p>El reporte no trae ningún campo de contenido poblado para esta fila.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {proposedEntries.map(([campo, valor]) => (
                  <tr key={campo}>
                    <td>{pnidFieldLabel(campo)}</td>
                    <td>{valor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {resultado.diferencias !== null && !Array.isArray(resultado.diferencias) && (
        <>
          <h4>Motivo</h4>
          <p>{resultado.diferencias.detalle}</p>
        </>
      )}

      {Array.isArray(resultado.diferencias) && resultado.diferencias.length > 0 && (
        <>
          <h4>Diferencias respecto a SIEI</h4>
          <table className="table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Anterior</th>
                <th>Reporte</th>
              </tr>
            </thead>
            <tbody>
              {resultado.diferencias.map((diff) => (
                <tr key={diff.campo}>
                  <td>{pnidFieldLabel(diff.campo)}</td>
                  <td>{diff.anterior ?? '—'}</td>
                  <td>{diff.nuevo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

export function PnidImportDetailPage() {
  const { projectId, importId } = useParams<{ projectId: string; importId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchDetail = useCallback(() => {
    if (!projectId || !importId) return Promise.resolve<PnidImportDetailResponse | null>(null);
    return getPnidImport(projectId, importId, devUser.email);
  }, [projectId, importId, devUser.email]);

  const { data: detail, loading, error: loadError, refresh: load } =
    useAsyncData<PnidImportDetailResponse | null>(fetchDetail);

  const [resultadoFilter, setResultadoFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [pnpidFilter, setPnpidFilter] = useState('');
  // NO_LISTADO son filas del reporte marcadas para excluir del proyecto —
  // en la enorme mayoría de los casos no interesan al revisar un import,
  // así que arrancan ocultas. Elegir "No listados" en el filtro de más
  // abajo las muestra igual (el filtro explícito siempre gana).
  const [showNoListado, setShowNoListado] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [applying, setApplying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  const resultados = useMemo(() => detail?.resultados ?? [], [detail]);

  const filteredResultados = useMemo(() => {
    return resultados.filter((r) => {
      if (resultadoFilter) {
        if (r.resultado !== resultadoFilter) return false;
      } else if (!showNoListado && r.resultado === 'NO_LISTADO') {
        return false;
      }
      if (tagFilter && !(r.tagInstrumento ?? '').toLowerCase().includes(tagFilter.toLowerCase())) {
        return false;
      }
      if (pnpidFilter && !(r.pnpid ?? '').toLowerCase().includes(pnpidFilter.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [resultados, resultadoFilter, tagFilter, pnpidFilter, showNoListado]);

  const hiddenNoListadoCount = useMemo(
    () => (showNoListado || resultadoFilter ? 0 : resultados.filter((r) => r.resultado === 'NO_LISTADO').length),
    [resultados, showNoListado, resultadoFilter]
  );

  if (!projectId || !importId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleApply() {
    if (!detail || applying) return;

    const confirmed = window.confirm(
      `¿Aplicar esta importación? Se van a crear/actualizar instrumentos en el proyecto según el preview: ` +
        `${detail.import.conteos.nuevos} nuevos, ${detail.import.conteos.tagModificado} con TAG modificado, ` +
        `${detail.import.conteos.datosModificados} con datos modificados, ${detail.import.conteos.pnpidActualizado} con PnPID actualizado, ` +
        `${detail.import.conteos.excluidosListado} marcados no listados, ` +
        `${detail.import.conteos.noExisteReporte} marcados como no existentes en el reporte. ` +
        `Los ${detail.import.conteos.requiereRevision} que requieren revisión NO se van a aplicar. Esta acción no se puede deshacer desde acá.`
    );
    if (!confirmed) return;

    setApplying(true);
    setActionError(null);
    setStaleError(null);
    setApplySuccess(false);

    try {
      await applyPnidImport(projectId!, importId!, devUser.email);
      setApplySuccess(true);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === 'stale_pnid_preview') {
        setStaleError(
          'El proyecto cambió después de generar este preview. Debes generar uno nuevo antes de aplicar.'
        );
      } else {
        setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      }
    } finally {
      setApplying(false);
    }
  }

  async function handleDiscard() {
    if (discarding) return;

    const confirmed = window.confirm('¿Descartar este preview? El snapshot queda guardado, pero el import pasa a estado DESCARTADO y no se puede aplicar.');
    if (!confirmed) return;

    setDiscarding(true);
    setActionError(null);

    try {
      await discardPnidImport(projectId!, importId!, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDiscarding(false);
    }
  }

  const error = actionError ?? loadError;
  const isPrevisualizado = detail?.import.estado === 'PREVISUALIZADO';

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{detail ? detail.import.nombreArchivo : 'Importación P&ID'}</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => navigate(`/projects/${projectId}/instruments/pnid-imports`)}
          >
            Volver al historial
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando importación…</p>}

      {!loading && detail && (
        <>
          <dl className="detail-list">
            <div>
              <dt>Estado</dt>
              <dd>{ESTADO_LABELS[detail.import.estado] ?? detail.import.estado}</dd>
            </div>
            <div>
              <dt>Fecha de carga</dt>
              <dd>{new Date(detail.import.fechaCarga).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Fecha de aplicación</dt>
              <dd>
                {detail.import.fechaAplicacion
                  ? new Date(detail.import.fechaAplicacion).toLocaleString()
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Usuario que cargó</dt>
              <dd>{detail.import.createdBy ? `Usuario #${detail.import.createdBy}` : '—'}</dd>
            </div>
            <div>
              <dt>Usuario que aplicó</dt>
              <dd>{detail.import.appliedBy ? `Usuario #${detail.import.appliedBy}` : '—'}</dd>
            </div>
            <div>
              <dt>Total filas</dt>
              <dd>{detail.import.totalFilas}</dd>
            </div>
            <div>
              <dt>Listado = True</dt>
              <dd>{detail.import.totalListadoTrue}</dd>
            </div>
            {COUNT_LABELS.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{detail.import.conteos[key]}</dd>
              </div>
            ))}
          </dl>

          {(detail.import.advertencias.missingKnownColumns.length > 0 ||
            detail.import.advertencias.unknownColumns.length > 0 ||
            detail.import.advertencias.archivoYaImportadoAntes) && (
            <>
              {detail.import.advertencias.missingKnownColumns.length > 0 && (
                <div className="notice">
                  <h3>⚠ Campos conocidos ausentes</h3>
                  <p>El reporte no contiene:</p>
                  <ul>
                    {detail.import.advertencias.missingKnownColumns.map((col) => (
                      <li key={col}>{col}</li>
                    ))}
                  </ul>
                  <p>Estos campos no serán modificados.</p>
                </div>
              )}

              {detail.import.advertencias.unknownColumns.length > 0 && (
                <div className="notice">
                  <h3>⚠ Campos nuevos/no reconocidos</h3>
                  <p>Se detectaron campos no mapeados:</p>
                  <ul>
                    {detail.import.advertencias.unknownColumns.map((col) => (
                      <li key={col}>{col}</li>
                    ))}
                  </ul>
                  <p>Se conservarán en el snapshot, pero no se sincronizarán.</p>
                </div>
              )}

              {detail.import.advertencias.archivoYaImportadoAntes && (
                <div className="notice">
                  <h3>ℹ Este archivo ya se había importado antes</h3>
                  <p>
                    <Link
                      to={`/projects/${projectId}/instruments/pnid-imports/${detail.import.advertencias.archivoYaImportadoAntes.importacionId}`}
                    >
                      Ver importación anterior
                    </Link>{' '}
                    ({new Date(detail.import.advertencias.archivoYaImportadoAntes.fechaCarga).toLocaleString()},{' '}
                    {ESTADO_LABELS[detail.import.advertencias.archivoYaImportadoAntes.estado] ??
                      detail.import.advertencias.archivoYaImportadoAntes.estado}
                    )
                  </p>
                </div>
              )}
            </>
          )}

          {staleError && (
            <div className="notice">
              <h3>⚠ Preview desactualizado</h3>
              <p>{staleError}</p>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => navigate(`/projects/${projectId}/instruments/pnid-imports`)}
              >
                Generar nuevo preview
              </button>
            </div>
          )}

          {applySuccess && (
            <div className="notice">
              <h3>✓ Importación aplicada</h3>
              <p>
                Los cambios ya se reflejan en el Master de Instrumentos.{' '}
                <Link to={`/projects/${projectId}/instruments`}>Volver al Master de Instrumentos</Link>
              </p>
            </div>
          )}

          {isPrevisualizado && (
            <div className="form__actions">
              <button
                type="button"
                className="button button--danger"
                disabled={!canWrite || applying || discarding}
                title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
                onClick={handleDiscard}
              >
                {discarding ? 'Descartando…' : 'Descartar'}
              </button>
              <button
                type="button"
                className="button"
                disabled={!canWrite || applying || discarding}
                title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
                onClick={handleApply}
              >
                {applying ? 'Aplicando…' : 'Aplicar importación'}
              </button>
            </div>
          )}

          <h2>Resultados ({filteredResultados.length} de {resultados.length})</h2>

          <div className="form form--inline">
            <label className="form__field">
              <span>Resultado</span>
              <select
                value={resultadoFilter}
                onChange={(event) => setResultadoFilter(event.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(PNID_ESTADO_LABELS).map(([codigo, label]) => (
                  <option key={codigo} value={codigo}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form__field">
              <span>TAG contiene</span>
              <input
                type="text"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
              />
            </label>
            <label className="form__field">
              <span>PnPID contiene</span>
              <input
                type="text"
                value={pnpidFilter}
                onChange={(event) => setPnpidFilter(event.target.value)}
              />
            </label>
            <label className="form__radio-group">
              <input
                type="checkbox"
                checked={showNoListado || Boolean(resultadoFilter)}
                disabled={Boolean(resultadoFilter)}
                onChange={(event) => setShowNoListado(event.target.checked)}
              />
              Mostrar no listados
            </label>
          </div>

          {hiddenNoListadoCount > 0 && (
            <p className="form__note">
              {hiddenNoListadoCount} fila(s) "No listado" ocultas por defecto — activá "Mostrar no listados" para verlas.
            </p>
          )}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Resultado</th>
                  <th>PnPID</th>
                  <th>TAG</th>
                  <th title="El instrumento existente en SIEI que esta fila actualiza (por PnPID) — no es el campo &quot;Instrumento Asociado&quot; del reporte, ese se ve al expandir la fila.">
                    Instrumento en SIEI
                  </th>
                  <th>Nº fila fuente</th>
                  <th>Requiere revisión</th>
                  <th aria-label="Diferencias" />
                </tr>
              </thead>
              <tbody>
                {filteredResultados.map((resultado) => (
                  <Fragment key={resultado.id}>
                    <tr
                      className="table__row--clickable"
                      onClick={() =>
                        setExpandedId((prev) => (prev === resultado.id ? null : resultado.id))
                      }
                    >
                      <td>
                        <PnidEstadoBadge codigo={resultado.resultado} />
                      </td>
                      <td>{resultado.pnpid ?? '—'}</td>
                      <td>{resultado.tagInstrumento ?? '—'}</td>
                      <td>
                        {resultado.instrumentoId ? (
                          <Link
                            to={`/projects/${projectId}/instruments/${resultado.instrumentoId}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            Ver instrumento
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{resultado.numeroFila ?? '—'}</td>
                      <td>{resultado.requiereRevision ? 'Sí' : 'No'}</td>
                      <td>{expandedId === resultado.id ? '▲' : '▼'}</td>
                    </tr>
                    {expandedId === resultado.id && (
                      <tr>
                        <td colSpan={7}>
                          <ResultRowDetail resultado={resultado} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
