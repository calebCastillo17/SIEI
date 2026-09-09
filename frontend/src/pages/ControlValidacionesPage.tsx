import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listInstruments } from '../api/instruments';
import { listSignals } from '../api/signals';
import { getPnidImport, listPnidImports } from '../api/pnidImports';
import { useAsyncData } from '../lib/useAsyncData';
import type { Instrument, PnidDetailResultado, PnidImport, Signal } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const TIPOS_IO_RESUMEN = ['DI', 'DO', 'AI', 'AO', 'RTD'] as const;

type Validacion = 'sinDueno' | 'sinMatchReporte' | 'noVinculadas' | 'resumenIo';

/**
 * Sección CONTROL — pestaña "Validaciones". Pedido explícito del usuario:
 * auditar "si todos los instrumentos están bien asociados y tienen sus
 * señales completas", con un botón por validación para verlas una por una
 * (no las 4 juntas de entrada).
 *
 *  1. Señales sin dueño (dueno_ausente=true, migración 016) — su
 *     instrumento/equipo fue eliminado pero la señal sigue activa.
 *  2. Señales en nuestro ruteo (vinculadas por codigo_senal) que ya no
 *     aparecen en el último reporte P&ID aplicado (sin_match_pnid=true,
 *     migración 047) — nunca se borran solas.
 *  3. Señales que SÍ vienen en el último reporte P&ID (fila ES_SENAL) pero
 *     todavía no existen en nuestro ruteo — "cuando digo vinieron en el
 *     P&ID me refiero que actualmente no existen en el master": resultado
 *     ES_SENAL cuyo senal_id es null (nunca se vinculó a ninguna señal
 *     existente, ver migración 046/senalId en GET /pnid-imports/:id).
 *  4. Tabla resumen por instrumento dueño: total de señales + desglose por
 *     tipo de E/S (DI/DO/AI/AO/RTD) — sin una regla de "completo" por tipo
 *     de instrumento (no inventada), para que el usuario la audite a ojo.
 *
 * Todo client-side sobre datos ya expuestos (listInstruments/listSignals +
 * el detalle del último import APLICADO), sin endpoints nuevos.
 */
export function ControlValidacionesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);

  const fetchInstruments = useCallback(() => {
    if (!projectId) return Promise.resolve<Instrument[]>([]);
    return listInstruments(projectId, devUser.email).then((r) => r.instruments);
  }, [projectId, devUser.email]);
  const { data: instruments, loading: loadingInstruments, error: errorInstruments } =
    useAsyncData<Instrument[]>(fetchInstruments);

  const fetchSignals = useCallback(() => {
    if (!projectId) return Promise.resolve<Signal[]>([]);
    return listSignals(projectId, devUser.email).then((r) => r.signals);
  }, [projectId, devUser.email]);
  const { data: signals, loading: loadingSignals, error: errorSignals, refresh: refreshSignals } =
    useAsyncData<Signal[]>(fetchSignals);

  const fetchImports = useCallback(() => {
    if (!projectId) return Promise.resolve<PnidImport[]>([]);
    return listPnidImports(projectId, devUser.email).then((r) => r.imports);
  }, [projectId, devUser.email]);
  const { data: imports, loading: loadingImports, error: errorImports } = useAsyncData<PnidImport[]>(fetchImports);

  const ultimoImportAplicadoId = useMemo(() => {
    const aplicados = (imports ?? [])
      .filter((imp) => imp.estado === 'APLICADO')
      .sort((a, b) => Number(b.id) - Number(a.id));
    return aplicados[0]?.id ?? null;
  }, [imports]);

  const fetchUltimoImportResultados = useCallback(() => {
    if (!projectId || !ultimoImportAplicadoId) return Promise.resolve<PnidDetailResultado[]>([]);
    return getPnidImport(projectId, ultimoImportAplicadoId, devUser.email).then((r) => r.resultados);
  }, [projectId, ultimoImportAplicadoId, devUser.email]);
  const {
    data: ultimoImportResultados,
    loading: loadingResultados,
    error: errorResultados
  } = useAsyncData<PnidDetailResultado[]>(fetchUltimoImportResultados);

  const tagPorInstrumentoId = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of instruments ?? []) map.set(i.id, i.tagInstrumento);
    return map;
  }, [instruments]);

  const senalesSinDueno = useMemo(() => (signals ?? []).filter((s) => s.duenoAusente), [signals]);
  const senalesSinMatchReporte = useMemo(() => (signals ?? []).filter((s) => s.sinMatchPnid), [signals]);
  const senalesNoVinculadas = useMemo(
    () => (ultimoImportResultados ?? []).filter((r) => r.resultado === 'ES_SENAL' && r.senalId === null),
    [ultimoImportResultados]
  );

  const resumenPorInstrumento = useMemo(() => {
    const map = new Map<string, { instrumentoId: string; total: number; porTipo: Record<string, number> }>();
    for (const senal of signals ?? []) {
      if (!senal.instrumentoId) continue;
      const entry = map.get(senal.instrumentoId) ?? {
        instrumentoId: senal.instrumentoId,
        total: 0,
        porTipo: Object.fromEntries(TIPOS_IO_RESUMEN.map((t) => [t, 0]))
      };
      entry.total += 1;
      if (senal.tipoIoCodigo && TIPOS_IO_RESUMEN.includes(senal.tipoIoCodigo as (typeof TIPOS_IO_RESUMEN)[number])) {
        entry.porTipo[senal.tipoIoCodigo] += 1;
      }
      map.set(senal.instrumentoId, entry);
    }
    return [...map.values()].sort((a, b) =>
      (tagPorInstrumentoId.get(a.instrumentoId) ?? '').localeCompare(tagPorInstrumentoId.get(b.instrumentoId) ?? '')
    );
  }, [signals, tagPorInstrumentoId]);

  const [activa, setActiva] = useState<Validacion | null>(null);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  const loading = loadingInstruments || loadingSignals || loadingImports || loadingResultados;
  const error = errorInstruments ?? errorSignals ?? errorImports ?? errorResultados;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Validaciones</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={refreshSignals}>
            Actualizar
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando…</p>}

      {!loading && (
        <>
          <div className="form form--inline">
            <button
              type="button"
              className={activa === 'sinDueno' ? 'button' : 'button button--secondary'}
              onClick={() => setActiva((v) => (v === 'sinDueno' ? null : 'sinDueno'))}
            >
              1. Señales sin dueño ({senalesSinDueno.length})
            </button>
            <button
              type="button"
              className={activa === 'sinMatchReporte' ? 'button' : 'button button--secondary'}
              onClick={() => setActiva((v) => (v === 'sinMatchReporte' ? null : 'sinMatchReporte'))}
            >
              2. En el ruteo, ya no en el último P&amp;ID ({senalesSinMatchReporte.length})
            </button>
            <button
              type="button"
              className={activa === 'noVinculadas' ? 'button' : 'button button--secondary'}
              onClick={() => setActiva((v) => (v === 'noVinculadas' ? null : 'noVinculadas'))}
            >
              3. En el último P&amp;ID, todavía no en el ruteo ({senalesNoVinculadas.length})
            </button>
            <button
              type="button"
              className={activa === 'resumenIo' ? 'button' : 'button button--secondary'}
              onClick={() => setActiva((v) => (v === 'resumenIo' ? null : 'resumenIo'))}
            >
              4. Señales por instrumento (E/S)
            </button>
          </div>

          {activa === 'sinDueno' && (
            <section>
              <h2>Señales sin dueño</h2>
              <p className="page-subtitle">
                El instrumento o equipo que era su dueño fue eliminado definitivamente, pero la señal sigue activa
                (migración 016) — nunca se borra sola.
              </p>
              {senalesSinDueno.length === 0 ? (
                <p className="page-subtitle">Ninguna — todas las señales tienen un instrumento o equipo dueño.</p>
              ) : (
                <ul className="physical-hint">
                  {senalesSinDueno.map((s) => (
                    <li key={s.id}>
                      <Link to={`/projects/${projectId}/signals/${s.id}`}>{s.tagSenal ?? `Señal #${s.id}`}</Link>
                      {s.servicio && <> — {s.servicio}</>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activa === 'sinMatchReporte' && (
            <section>
              <h2>En el ruteo, ya no en el último P&amp;ID</h2>
              <p className="page-subtitle">
                Están vinculadas a un reporte P&amp;ID (tienen PnPID), pero ese PnPID ya no aparece en el último
                reporte aplicado — nunca se borran ni desvinculan solas.
              </p>
              {senalesSinMatchReporte.length === 0 ? (
                <p className="page-subtitle">Ninguna.</p>
              ) : (
                <ul className="physical-hint">
                  {senalesSinMatchReporte.map((s) => (
                    <li key={s.id}>
                      <Link to={`/projects/${projectId}/signals/${s.id}`}>{s.tagSenal ?? `Señal #${s.id}`}</Link>
                      {' — PnPID '}
                      {s.codigoSenal}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activa === 'noVinculadas' && (
            <section>
              <h2>En el último P&amp;ID, todavía no en el ruteo</h2>
              <p className="page-subtitle">
                {ultimoImportAplicadoId
                  ? 'Filas de señal del último reporte aplicado cuyo "Instrumento Asociado" ya existe, pero que todavía no fueron vinculadas a ninguna señal del Master.'
                  : 'Todavía no hay ningún import P&ID aplicado en este proyecto.'}
              </p>
              {senalesNoVinculadas.length === 0 ? (
                <p className="page-subtitle">Ninguna.</p>
              ) : (
                <ul className="physical-hint">
                  {senalesNoVinculadas.map((r) => (
                    <li key={r.id}>
                      {r.tagInstrumento} — Instrumento Asociado: {r.datosPropuestos?.instrumentoAsociadoTag ?? '—'} (PnPID{' '}
                      {r.pnpid})
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activa === 'resumenIo' && (
            <section>
              <h2>Señales por instrumento (E/S)</h2>
              <p className="page-subtitle">
                Total de señales y desglose por tipo de E/S de cada instrumento dueño — para auditar a ojo si está
                bien asociado y completo.
              </p>
              {resumenPorInstrumento.length === 0 ? (
                <p className="page-subtitle">Ningún instrumento tiene señales todavía.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Instrumento</th>
                        <th>Total señales</th>
                        {TIPOS_IO_RESUMEN.map((t) => (
                          <th key={t}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resumenPorInstrumento.map((r) => (
                        <tr key={r.instrumentoId}>
                          <td>
                            <Link to={`/projects/${projectId}/instruments/${r.instrumentoId}`}>
                              {tagPorInstrumentoId.get(r.instrumentoId) ?? r.instrumentoId}
                            </Link>
                          </td>
                          <td>{r.total}</td>
                          {TIPOS_IO_RESUMEN.map((t) => (
                            <td key={t}>{r.porTipo[t] || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
