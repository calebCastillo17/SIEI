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

/** Coincide si el filtro está vacío, o si el texto (case-insensitive) lo
 * contiene — mismo criterio de búsqueda usado en el resto de la app. */
function coincide(valor: string | null | undefined, filtro: string): boolean {
  const needle = filtro.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (valor ?? '').toLowerCase().includes(needle);
}

/** Coincide si el filtro está vacío o es EXACTAMENTE igual — para las
 * columnas con desplegable (pedido explícito del usuario: "en los demas
 * que sea como desplegable", solo Tag/Servicio quedan de escribir). */
function coincideExacto(valor: string | null | undefined, filtro: string): boolean {
  if (filtro.length === 0) return true;
  return (valor ?? '') === filtro;
}

/** Valores distintos, no vacíos, de una columna — para poblar un
 * desplegable de filtro sin inventar ninguna lista, solo lo que hay
 * realmente en los datos cargados. */
function opcionesDistintas<T>(items: T[], getValue: (item: T) => string | null | undefined): string[] {
  return [...new Set(items.map(getValue).filter((v): v is string => Boolean(v)))].sort();
}

/** Encabezado de columna filtrable "como un Excel" — pedido explícito del
 * usuario: la etiqueta arriba, un input angosto de filtro justo debajo,
 * dentro del mismo <th>. */
function ThFiltrable({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <th>
      <div>{label}</div>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filtrar…"
        style={{ width: '100%', fontWeight: 'normal', fontSize: '0.85em', marginTop: '0.25rem' }}
      />
    </th>
  );
}

/** Encabezado de columna filtrable con DESPLEGABLE — pedido explícito del
 * usuario: solo Tag/Servicio quedan de escribir libre (ThFiltrable), el
 * resto se elige de una lista con los valores que de verdad existen en
 * los datos cargados (opcionesDistintas), nunca una lista inventada. */
function ThFiltrableSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <th>
      <div>{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: '100%', fontWeight: 'normal', fontSize: '0.85em', marginTop: '0.25rem' }}
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </th>
  );
}

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

  const instrumentoIdPorTag = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of instruments ?? []) map.set(i.tagInstrumento, i.id);
    return map;
  }, [instruments]);

  /** P&ID (plano) y servicio DEL INSTRUMENTO dueño — pedido explícito del
   * usuario para la validación 4 ("en el cuatro tambien quiero ver el
   * P&ID y servicio"). Viene del instrumento real, no de la señal. */
  const instrumentoInfoPorId = useMemo(() => {
    const map = new Map<string, { planoPnid: string | null; servicio: string | null }>();
    for (const i of instruments ?? []) map.set(i.id, { planoPnid: i.planoPnid, servicio: i.servicio });
    return map;
  }, [instruments]);

  const senalesSinDueno = useMemo(() => (signals ?? []).filter((s) => s.duenoAusente), [signals]);
  const senalesSinMatchReporte = useMemo(() => (signals ?? []).filter((s) => s.sinMatchPnid), [signals]);
  const senalesNoVinculadas = useMemo(
    () => (ultimoImportResultados ?? []).filter((r) => r.resultado === 'ES_SENAL' && r.senalId === null),
    [ultimoImportResultados]
  );

  /* codigoSenal puramente numérico = vino de una fila de señal de un
   * reporte P&ID (su PnPID, ver migración 046) — a diferencia del formato
   * legacy "620-SIG-000001" del Excel original de SENALES_COM, que nunca
   * tuvo relación con ningún reporte P&ID. Pedido explícito del usuario
   * para esta validación: "solo los instrumentos que son asociados... los
   * que tienen instrumentos señales asociados" — 60 de los 157
   * instrumentos con alguna señal, verificado con datos reales, solo
   * tenían señales COM legacy sin ninguna relación al P&ID; sin este
   * filtro ensuciaban la tabla con instrumentos irrelevantes para esta
   * auditoría. */
  const esSenalDeReporte = (senal: Signal) => senal.codigoSenal !== null && /^\d+$/.test(senal.codigoSenal);

  const resumenPorInstrumento = useMemo(() => {
    const map = new Map<string, { instrumentoId: string; total: number; porTipo: Record<string, number> }>();
    for (const senal of signals ?? []) {
      if (!senal.instrumentoId || !esSenalDeReporte(senal)) continue;
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

  /* Filtros "como un Excel" en el encabezado — pedido explícito del
   * usuario, aplicado a las validaciones 3 y 4 (en la 4, nunca a las
   * columnas DI/DO/AI/AO/RTD). */
  const [filtrosNoVinculadas, setFiltrosNoVinculadas] = useState({
    tag: '',
    planoPnid: '',
    servicio: '',
    tipoSenal: '',
    asociado: ''
  });
  const senalesNoVinculadasFiltradas = useMemo(
    () =>
      senalesNoVinculadas.filter(
        (r) =>
          coincide(r.tagInstrumento, filtrosNoVinculadas.tag) &&
          coincideExacto(r.datosPropuestos?.planoPnid, filtrosNoVinculadas.planoPnid) &&
          coincide(r.datosPropuestos?.servicio, filtrosNoVinculadas.servicio) &&
          coincideExacto(r.datosPropuestos?.tipoSenalPnid, filtrosNoVinculadas.tipoSenal) &&
          coincideExacto(r.datosPropuestos?.instrumentoAsociadoTag, filtrosNoVinculadas.asociado)
      ),
    [senalesNoVinculadas, filtrosNoVinculadas]
  );

  /* Opciones de los desplegables — solo valores que de verdad existen en
   * esta lista, no un catálogo inventado. */
  const opcionesPlanoPnidNoVinculadas = useMemo(
    () => opcionesDistintas(senalesNoVinculadas, (r) => r.datosPropuestos?.planoPnid),
    [senalesNoVinculadas]
  );
  const opcionesTipoSenalNoVinculadas = useMemo(
    () => opcionesDistintas(senalesNoVinculadas, (r) => r.datosPropuestos?.tipoSenalPnid),
    [senalesNoVinculadas]
  );
  const opcionesAsociadoNoVinculadas = useMemo(
    () => opcionesDistintas(senalesNoVinculadas, (r) => r.datosPropuestos?.instrumentoAsociadoTag),
    [senalesNoVinculadas]
  );

  const [filtrosResumenIo, setFiltrosResumenIo] = useState({
    instrumento: '',
    planoPnid: '',
    servicio: '',
    total: ''
  });
  const resumenPorInstrumentoFiltrado = useMemo(
    () =>
      resumenPorInstrumento.filter((r) => {
        const info = instrumentoInfoPorId.get(r.instrumentoId);
        return (
          coincide(tagPorInstrumentoId.get(r.instrumentoId), filtrosResumenIo.instrumento) &&
          coincideExacto(info?.planoPnid, filtrosResumenIo.planoPnid) &&
          coincide(info?.servicio, filtrosResumenIo.servicio) &&
          coincideExacto(String(r.total), filtrosResumenIo.total)
        );
      }),
    [resumenPorInstrumento, instrumentoInfoPorId, tagPorInstrumentoId, filtrosResumenIo]
  );

  const opcionesPlanoPnidResumen = useMemo(
    () => opcionesDistintas(resumenPorInstrumento, (r) => instrumentoInfoPorId.get(r.instrumentoId)?.planoPnid),
    [resumenPorInstrumento, instrumentoInfoPorId]
  );
  const opcionesTotalResumen = useMemo(
    () => [...new Set(resumenPorInstrumento.map((r) => String(r.total)))].sort((a, b) => Number(a) - Number(b)),
    [resumenPorInstrumento]
  );

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
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <ThFiltrable
                          label="Tag (reporte)"
                          value={filtrosNoVinculadas.tag}
                          onChange={(v) => setFiltrosNoVinculadas((f) => ({ ...f, tag: v }))}
                        />
                        <ThFiltrableSelect
                          label="P&ID"
                          value={filtrosNoVinculadas.planoPnid}
                          options={opcionesPlanoPnidNoVinculadas}
                          onChange={(v) => setFiltrosNoVinculadas((f) => ({ ...f, planoPnid: v }))}
                        />
                        <ThFiltrable
                          label="Servicio"
                          value={filtrosNoVinculadas.servicio}
                          onChange={(v) => setFiltrosNoVinculadas((f) => ({ ...f, servicio: v }))}
                        />
                        <ThFiltrableSelect
                          label="Tipo de señal"
                          value={filtrosNoVinculadas.tipoSenal}
                          options={opcionesTipoSenalNoVinculadas}
                          onChange={(v) => setFiltrosNoVinculadas((f) => ({ ...f, tipoSenal: v }))}
                        />
                        <ThFiltrableSelect
                          label="Instrumento Asociado"
                          value={filtrosNoVinculadas.asociado}
                          options={opcionesAsociadoNoVinculadas}
                          onChange={(v) => setFiltrosNoVinculadas((f) => ({ ...f, asociado: v }))}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {senalesNoVinculadasFiltradas.map((r) => (
                        <tr key={r.id}>
                          <td>{r.tagInstrumento ?? '—'}</td>
                          <td>{r.datosPropuestos?.planoPnid ?? '—'}</td>
                          <td>{r.datosPropuestos?.servicio ?? '—'}</td>
                          <td>{r.datosPropuestos?.tipoSenalPnid ?? '—'}</td>
                          <td>
                            {(() => {
                              const tag = r.datosPropuestos?.instrumentoAsociadoTag;
                              if (!tag) return '—';
                              const instrumentoId = instrumentoIdPorTag.get(tag);
                              return instrumentoId ? (
                                <Link to={`/projects/${projectId}/instruments/${instrumentoId}`}>{tag}</Link>
                              ) : (
                                tag
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {senalesNoVinculadasFiltradas.length === 0 && (
                    <p className="page-subtitle">Ninguna coincide con los filtros actuales.</p>
                  )}
                </div>
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
                        <ThFiltrable
                          label="Instrumento"
                          value={filtrosResumenIo.instrumento}
                          onChange={(v) => setFiltrosResumenIo((f) => ({ ...f, instrumento: v }))}
                        />
                        <ThFiltrableSelect
                          label="P&ID"
                          value={filtrosResumenIo.planoPnid}
                          options={opcionesPlanoPnidResumen}
                          onChange={(v) => setFiltrosResumenIo((f) => ({ ...f, planoPnid: v }))}
                        />
                        <ThFiltrable
                          label="Servicio"
                          value={filtrosResumenIo.servicio}
                          onChange={(v) => setFiltrosResumenIo((f) => ({ ...f, servicio: v }))}
                        />
                        <ThFiltrableSelect
                          label="Total señales"
                          value={filtrosResumenIo.total}
                          options={opcionesTotalResumen}
                          onChange={(v) => setFiltrosResumenIo((f) => ({ ...f, total: v }))}
                        />
                        {/* Sin filtro acá — pedido explícito del usuario:
                            "no a la parte de DI DO AI AO RTD". */}
                        {TIPOS_IO_RESUMEN.map((t) => (
                          <th key={t}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resumenPorInstrumentoFiltrado.map((r) => {
                        const info = instrumentoInfoPorId.get(r.instrumentoId);
                        return (
                          <tr key={r.instrumentoId}>
                            <td>
                              <Link to={`/projects/${projectId}/instruments/${r.instrumentoId}`}>
                                {tagPorInstrumentoId.get(r.instrumentoId) ?? r.instrumentoId}
                              </Link>
                            </td>
                            <td>{info?.planoPnid ?? '—'}</td>
                            <td>{info?.servicio ?? '—'}</td>
                            <td>{r.total}</td>
                            {TIPOS_IO_RESUMEN.map((t) => (
                              <td key={t}>{r.porTipo[t] || '—'}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {resumenPorInstrumentoFiltrado.length === 0 && (
                    <p className="page-subtitle">Ninguno coincide con los filtros actuales.</p>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
