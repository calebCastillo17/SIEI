import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deleteInstrumentDefinitivamente, listInstruments } from '../api/instruments';
import { listSignals } from '../api/signals';
import { getPnidImport, listPnidImports } from '../api/pnidImports';
import { useAsyncData } from '../lib/useAsyncData';
import type { Instrument, PnidDetailResultado, PnidImport, Signal } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';
import { PnidEstadoBadge } from '../components/PnidEstadoBadge';
import { usePnidEstados } from '../components/usePnidEstados';
import { PNID_ESTADO_LABELS } from '../components/pnidLabels';

const TIPOS_IO_RESUMEN = ['DI', 'DO', 'AI', 'AO', 'RTD'] as const;

export function InstrumentsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  /* mostrarHijos=true (default) -> soloPadres=false en el backend: se
   * ven todos, padres e hijos, de entrada — pedido explícito del
   * usuario. Un instrumento "hijo" (instrumentoAsociadoId no nulo) no es
   * un instrumento independiente, es un tag del padre, así que quien
   * quiera ocultarlos lo hace con el botón de abajo. */
  const [mostrarHijos, setMostrarHijos] = useState(true);

  /* mostrarNoListados=false (default) -> soloListados=true en el backend
   * (migración 044): "se guarda todo, pero los no listados no se
   * muestran" — pedido explícito del usuario. El botón de abajo permite
   * auditarlos igual sin cambiar el dato. */
  const [mostrarNoListados, setMostrarNoListados] = useState(false);

  const fetchInstruments = useCallback(() => {
    if (!projectId) return Promise.resolve<Instrument[]>([]);
    return listInstruments(projectId, devUser.email, {
      soloPadres: !mostrarHijos,
      soloListados: !mostrarNoListados
    }).then((response) => response.instruments);
  }, [projectId, devUser.email, mostrarHijos, mostrarNoListados]);

  const {
    data: instruments,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Instrument[]>(fetchInstruments);

  /* Pedido explícito del usuario: poder ver, desde el Master, qué
   * instrumentos son dueños de al menos una señal — las señales en sí
   * nunca aparecen acá (una fila de señal del P&ID nunca crea un
   * instrumento, ver ES_SENAL), pero el instrumento REAL que las tiene sí
   * es un instrumento normal y puede filtrarse/expandirse como tal. Mismo
   * patrón que "instrumentos asociados" en EquipmentListPage.tsx: se trae
   * la lista completa de señales del proyecto una sola vez y se agrupa en
   * el cliente, sin un endpoint nuevo. */
  const fetchSignals = useCallback(() => {
    if (!projectId) return Promise.resolve<Signal[]>([]);
    return listSignals(projectId, devUser.email).then((r) => r.signals);
  }, [projectId, devUser.email]);
  const { data: signals } = useAsyncData<Signal[]>(fetchSignals);

  /* codigoSenal puramente numérico = vino de una fila de señal de un
   * reporte P&ID (su PnPID, ver migración 046/pnidImports.ts) — a
   * diferencia del formato legacy "620-SIG-000001" del Excel original,
   * que nunca tuvo relación con ninguna fila "PRIMARY ACCESSIBLE/
   * INACCESSIBLE DCS". Mismo filtro que usa el backend para no confundir
   * ambos orígenes. */
  const esSenalDeReporte = (senal: Signal) => senal.codigoSenal !== null && /^\d+$/.test(senal.codigoSenal);

  const senalesDeReporte = useMemo(() => (signals ?? []).filter(esSenalDeReporte), [signals]);

  const tagPorInstrumentoId = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of instruments ?? []) map.set(i.id, i.tagInstrumento);
    return map;
  }, [instruments]);

  const [vista, setVista] = useState<'instrumentos' | 'senales' | 'validaciones'>('instrumentos');

  /*
   * Validaciones (pedido explícito del usuario) — tres listas de auditoría
   * más una tabla resumen, para ver "si todos los instrumentos están bien
   * asociados y tienen sus señales completas":
   *
   *  1. Señales sin padre (dueno_ausente=true, migración 016) — la señal
   *     sigue activa pero su instrumento/equipo dueño fue eliminado.
   *  2. Señales que están en nuestro ruteo (nucleo.senal, ya vinculadas
   *     por codigo_senal) pero YA NO aparecen en el último reporte P&ID
   *     aplicado (sin_match_pnid=true, migración 047).
   *  3. Señales que SÍ vienen en el último reporte P&ID (fila ES_SENAL)
   *     pero todavía no existen en nuestro ruteo — "cuando digo vinieron
   *     en el P&ID me refiero que actualmente no existen en el master":
   *     resultado ES_SENAL cuyo senal_id es null (nunca se vinculó a
   *     ninguna señal existente, ver migración 046).
   *
   * La 3ra necesita los resultados del último import APLICADO — no hay
   * endpoint de "resultados sueltos", así que se trae la lista de imports
   * y se pide el detalle del más reciente ya aplicado.
   */
  const fetchImports = useCallback(() => {
    if (!projectId) return Promise.resolve<PnidImport[]>([]);
    return listPnidImports(projectId, devUser.email).then((r) => r.imports);
  }, [projectId, devUser.email]);
  const { data: imports } = useAsyncData<PnidImport[]>(fetchImports);

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
  const { data: ultimoImportResultados } = useAsyncData<PnidDetailResultado[]>(fetchUltimoImportResultados);

  const senalesSinPadre = useMemo(() => (signals ?? []).filter((s) => s.duenoAusente), [signals]);
  const senalesSinMatchReporte = useMemo(() => (signals ?? []).filter((s) => s.sinMatchPnid), [signals]);
  const senalesNoVinculadas = useMemo(
    () => (ultimoImportResultados ?? []).filter((r) => r.resultado === 'ES_SENAL' && r.senalId === null),
    [ultimoImportResultados]
  );

  /* Tabla resumen por instrumento dueño: total de señales + desglose por
   * tipo de E/S (DI/DO/AI/AO/RTD) — para auditar visualmente si un
   * instrumento tiene sus señales "completas" (el usuario no dio una
   * regla de qué es "completo" por tipo de instrumento, así que esto
   * muestra el desglose real para que lo audite a ojo, no un pass/fail
   * automático inventado). */
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

  const { itemsById: pnidEstadosById } = usePnidEstados(devUser.email);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  const [searchText, setSearchText] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [sistemaFilter, setSistemaFilter] = useState('');
  const [nodoFilter, setNodoFilter] = useState('');
  const [planoPnidFilter, setPlanoPnidFilter] = useState('');
  const [hojaDatosFilter, setHojaDatosFilter] = useState('');

  const items = useMemo(() => instruments ?? [], [instruments]);

  /* Opciones de Sistema/Nodo/P&ID = valores realmente presentes en los
   * instrumentos ya cargados — no son catálogos propios (son texto libre
   * en nucleo.instrumento), así que no hay de dónde más sacar la lista. */
  const sistemaOptions = useMemo(
    () => [...new Set(items.map((i) => i.sistema).filter((v): v is string => Boolean(v)))].sort(),
    [items]
  );
  const nodoOptions = useMemo(
    () => [...new Set(items.map((i) => i.nodo).filter((v): v is string => Boolean(v)))].sort(),
    [items]
  );
  const planoPnidOptions = useMemo(
    () => [...new Set(items.map((i) => i.planoPnid).filter((v): v is string => Boolean(v)))].sort(),
    [items]
  );

  /*
   * Filtrado en el cliente: GET /instruments no acepta ningún query param
   * de búsqueda hoy (ver instruments.ts) — igual que en la tabla de
   * resultados del import P&ID, con la escala real de un proyecto
   * (cientos de instrumentos, no miles) filtrar sobre la lista ya cargada
   * es razonable, no hace falta paginación/búsqueda server-side para esto.
   */
  const filteredItems = useMemo(() => {
    const needle = searchText.trim().toLowerCase();

    const filtered = items.filter((instrument) => {
      if (estadoFilter) {
        const codigo = instrument.estadoPnidId
          ? (pnidEstadosById.get(instrument.estadoPnidId)?.codigo ?? null)
          : null;
        if (codigo !== estadoFilter) return false;
      }

      if (sistemaFilter && instrument.sistema !== sistemaFilter) return false;
      if (nodoFilter && instrument.nodo !== nodoFilter) return false;
      if (planoPnidFilter && instrument.planoPnid !== planoPnidFilter) return false;
      if (hojaDatosFilter === 'CON' && !instrument.fichaTecnicaId) return false;
      if (hojaDatosFilter === 'SIN' && instrument.fichaTecnicaId) return false;

      if (needle.length === 0) return true;

      const haystack = [
        instrument.tagInstrumento,
        instrument.tagAnterior,
        instrument.pnpid,
        instrument.planoPnid,
        instrument.servicio,
        instrument.tipoInstrumento,
        instrument.sistema,
        instrument.nodo
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });

    // El Master lista plano, sin agrupar — pedido explícito del usuario
    // (reversa de un agrupamiento visual que se había agregado antes):
    // el agrupamiento por Instrumento Asociado es cosa del entregable
    // LDI (criterio "Orden de Instrumentos Asociados" en el editor de
    // orden al crear una revisión), no de esta vista. Se confía en el
    // ORDER BY tag_instrumento que ya trae el backend.
    return filtered;
  }, [items, searchText, estadoFilter, sistemaFilter, nodoFilter, planoPnidFilter, hojaDatosFilter, pnidEstadosById]);

  const [senalesSearchText, setSenalesSearchText] = useState('');
  const filteredSenales = useMemo(() => {
    const needle = senalesSearchText.trim().toLowerCase();
    if (needle.length === 0) return senalesDeReporte;
    return senalesDeReporte.filter((senal) => {
      const duenoTag = senal.instrumentoId ? (tagPorInstrumentoId.get(senal.instrumentoId) ?? '') : '';
      const haystack = [senal.tagSenal, senal.tagPnid, senal.codigoSenal, senal.servicio, duenoTag]
        .filter((v): v is string => Boolean(v))
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [senalesDeReporte, senalesSearchText, tagPorInstrumentoId]);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleDeleteDefinitivamente(instrument: Instrument) {
    if (!projectId) return;

    const confirmed = window.confirm(
      `¿Eliminar DEFINITIVAMENTE el instrumento "${instrument.tagInstrumento}"? ` +
        'Esto lo borra por completo del Master — no queda como historial, no se puede deshacer. ' +
        'Solo funciona porque su estado P&ID es "No existe en P&ID"; si tiene señales, puntos de conexión, ' +
        'lazos o enlaces de comunicación reales, se va a rechazar.'
    );
    if (!confirmed) return;

    setDeletingId(instrument.id);
    setActionError(null);

    try {
      await deleteInstrumentDefinitivamente(projectId, instrument.id, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeletingId(null);
    }
  }

  const canWrite = project?.access.permissions.write ?? false;
  const canAdminister = project?.access.permissions.administer ?? false;
  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Instrumentos</h1>
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
          {/*
            Los botones reflejan el permiso para no ofrecer una acción que
            el backend igual va a rechazar — pero la autorización real la
            aplica requireProjectPermission('write')/('read') en el
            servidor, esto es solo una guía visual. Un usuario sin permiso
            de escritura igual puede entrar al historial de importaciones
            P&ID (requiere solo 'read'), solo no puede generar preview,
            aplicar ni descartar desde ahí.
          */}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => navigate(`/projects/${projectId}/instruments/pnid-imports`)}
          >
            Importar P&amp;ID
          </button>
          <button
            type="button"
            className="button"
            disabled={!canWrite}
            title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
            onClick={() => navigate(`/projects/${projectId}/instruments/new`)}
          >
            Nuevo instrumento
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando instrumentos…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene instrumentos activos.</p>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="form form--inline">
            <label className="form__field">
              <span>Buscar</span>
              <input
                type="text"
                placeholder="TAG, TAG anterior, PnPID, P&ID, servicio, tipo, sistema o nodo"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
            <label className="form__field">
              <span>Estado P&amp;ID (última actualización)</span>
              <select value={estadoFilter} onChange={(event) => setEstadoFilter(event.target.value)}>
                <option value="">Todos</option>
                {Object.entries(PNID_ESTADO_LABELS)
                  .filter(([codigo]) => codigo !== 'NO_LISTADO' && codigo !== 'TAG_VACIO')
                  .map(([codigo, label]) => (
                    <option key={codigo} value={codigo}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="form__field">
              <span>Sistema</span>
              <select value={sistemaFilter} onChange={(event) => setSistemaFilter(event.target.value)}>
                <option value="">Todos</option>
                {sistemaOptions.map((sistema) => (
                  <option key={sistema} value={sistema}>
                    {sistema}
                  </option>
                ))}
              </select>
            </label>
            <label className="form__field">
              <span>Nodo</span>
              <select value={nodoFilter} onChange={(event) => setNodoFilter(event.target.value)}>
                <option value="">Todos</option>
                {nodoOptions.map((nodo) => (
                  <option key={nodo} value={nodo}>
                    {nodo}
                  </option>
                ))}
              </select>
            </label>
            <label className="form__field">
              <span>P&amp;ID</span>
              <select value={planoPnidFilter} onChange={(event) => setPlanoPnidFilter(event.target.value)}>
                <option value="">Todos</option>
                {planoPnidOptions.map((plano) => (
                  <option key={plano} value={plano}>
                    {plano}
                  </option>
                ))}
              </select>
            </label>
            <label className="form__field">
              <span>Hoja de Datos</span>
              <select value={hojaDatosFilter} onChange={(event) => setHojaDatosFilter(event.target.value)}>
                <option value="">Todos</option>
                <option value="CON">Con ficha técnica</option>
                <option value="SIN">Sin ficha técnica</option>
              </select>
            </label>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setMostrarHijos((valor) => !valor)}
              title="Un hijo (Instrumento Asociado) no es un instrumento independiente, es un tag del padre"
            >
              {mostrarHijos ? 'Ocultar hijos' : 'Mostrar hijos'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setMostrarNoListados((valor) => !valor)}
              title="Un instrumento no listado sigue existiendo completo — solo no se imprime en el LDI ni aparece acá por defecto"
            >
              {mostrarNoListados ? 'Ocultar no listados' : 'Mostrar no listados'}
            </button>
            <button
              type="button"
              className={vista === 'senales' ? 'button' : 'button button--secondary'}
              onClick={() => setVista((v) => (v === 'senales' ? 'instrumentos' : 'senales'))}
              title='Una fila de señal del P&ID (Description = "PRIMARY ACCESSIBLE/INACCESSIBLE DCS") nunca crea su propio instrumento — esto las muestra como lo que son, señales, no agrupadas bajo su dueño'
            >
              {vista === 'senales' ? 'Ver instrumentos' : 'Ver señales del P&ID'}
            </button>
            <button
              type="button"
              className={vista === 'validaciones' ? 'button' : 'button button--secondary'}
              onClick={() => setVista((v) => (v === 'validaciones' ? 'instrumentos' : 'validaciones'))}
              title="Auditoría: señales sin dueño, señales que desaparecieron del último reporte, señales del reporte que aún no están vinculadas, y desglose de E/S por instrumento"
            >
              {vista === 'validaciones' ? 'Ver instrumentos' : 'Validaciones'}
            </button>
          </div>

          <p className="page-subtitle">
            {vista === 'senales' && `Mostrando ${filteredSenales.length} de ${senalesDeReporte.length} señales.`}
            {vista === 'instrumentos' && `Mostrando ${filteredItems.length} de ${items.length} instrumentos.`}
            {vista === 'validaciones' && 'Auditoría de señales e instrumentos asociados.'}
          </p>
        </>
      )}

      {vista === 'instrumentos' && !loading && items.length > 0 && filteredItems.length === 0 && (
        <p>Ningún instrumento coincide con la búsqueda/filtro actual.</p>
      )}

      {vista === 'instrumentos' && !loading && filteredItems.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>TAG</th>
                <th>TAG anterior</th>
                <th>Tipo</th>
                <th>Servicio</th>
                <th>Línea</th>
                <th>Equipo asociado</th>
                <th>Grupo</th>
                <th>Sistema</th>
                <th>Nodo</th>
                <th>PnPID</th>
                <th>P&amp;ID</th>
                <th>Estado P&amp;ID</th>
                <th>Hoja de Datos</th>
                <th>Listado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((instrument) => {
                const estadoPnidCodigo = instrument.estadoPnidId
                  ? (pnidEstadosById.get(instrument.estadoPnidId)?.codigo ?? null)
                  : null;
                const puedeEliminarDefinitivamente = estadoPnidCodigo === 'NO_EXISTE_EN_PNID';

                return (
                  <tr key={instrument.id}>
                    <td>
                      <Link to={`/projects/${projectId}/instruments/${instrument.id}`}>
                        {instrument.tagInstrumento}
                      </Link>
                    </td>
                    <td>{instrument.tagAnterior ?? '—'}</td>
                    <td>{instrument.tipoInstrumento ?? '—'}</td>
                    <td>{instrument.servicio ?? '—'}</td>
                    <td>{instrument.lineaPnid ?? '—'}</td>
                    <td>{instrument.equipoAsociadoTag ?? '—'}</td>
                    {/*
                      Muestra los HIJOS de este instrumento (los tags que
                      apuntan a él vía su propio instrumentoAsociadoId),
                      no el instrumento asociado del propio row — pedido
                      explícito del usuario: acá solo se listan padres, así
                      que este campo ya no necesita resolver "mi padre"
                      (nunca aplica, un padre no tiene instrumentoAsociadoId).
                      Puramente de visualización, `hijosTags` nunca se
                      guarda en ningún lado.
                    */}
                    <td>{instrument.hijosTags ?? '—'}</td>
                    <td>{instrument.sistema ?? '—'}</td>
                    <td>{instrument.nodo ?? '—'}</td>
                    <td>{instrument.pnpid ?? '—'}</td>
                    <td>{instrument.planoPnid ?? '—'}</td>
                    <td>
                      <PnidEstadoBadge codigo={estadoPnidCodigo} />
                    </td>
                    <td>
                      {instrument.fichaTecnicaId ? (
                        <Link to={`/projects/${projectId}/fichas-tecnicas/${instrument.fichaTecnicaId}`}>Sí</Link>
                      ) : (
                        <span className="page-subtitle">No</span>
                      )}
                    </td>
                    <td>
                      {instrument.listado ? 'Sí' : <span className="page-subtitle" title="No se imprime en el LDI ni se cuenta en el Master por defecto">No</span>}
                    </td>
                    <td className="table__row-actions">
                      {/*
                        Solo aparece cuando el estado P&ID es exactamente
                        "No existe en P&ID" — mismo criterio angosto que
                        exige el backend (409 en cualquier otro caso), así
                        que ni vale la pena ofrecer el botón fuera de ese
                        estado. Ver migración 011 / CLAUDE.md "Eliminación
                        definitiva de instrumentos".
                      */}
                      {puedeEliminarDefinitivamente && (
                        <button
                          type="button"
                          className="button button--danger button--small"
                          disabled={!canAdminister || deletingId === instrument.id}
                          title={
                            canAdminister
                              ? 'Borra el instrumento por completo — no queda como historial.'
                              : 'Eliminar definitivamente requiere permiso de administración en el proyecto.'
                          }
                          onClick={() => handleDeleteDefinitivamente(instrument)}
                        >
                          {deletingId === instrument.id ? 'Eliminando…' : 'Eliminar definitivamente'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        "Ver señales del P&ID" — pedido explícito del usuario tras aclarar
        que NO quería instrumentos agrupados por dueño, sino las señales
        mismas como filas propias: "quiero que se muestren los
        instrumentos que son señales... serian los que tienen description
        PRIMARY ACCESSIBLE DCS". Esa columna Description es cruda del
        reporte y no vive en nucleo.senal — el filtro equivalente en la
        base es codigoSenal puramente numérico (su PnPID), ver
        esSenalDeReporte más arriba.
      */}
      {vista === 'senales' && (
        <>
          <label className="form__field">
            <span>Buscar</span>
            <input
              type="text"
              value={senalesSearchText}
              onChange={(event) => setSenalesSearchText(event.target.value)}
              placeholder="Tag, servicio, dueño…"
            />
          </label>

          {!loading && senalesDeReporte.length === 0 && (
            <p>Todavía no hay señales vinculadas a un reporte P&ID en este proyecto.</p>
          )}

          {!loading && senalesDeReporte.length > 0 && filteredSenales.length === 0 && (
            <p>Ninguna señal coincide con la búsqueda actual.</p>
          )}

          {!loading && filteredSenales.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tag señal</th>
                    <th>Tag en el reporte</th>
                    <th>Dueño</th>
                    <th>Servicio</th>
                    <th>Tipo E/S</th>
                    <th>PnPID</th>
                    <th>Ya no está en el P&amp;ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSenales.map((senal) => (
                    <tr key={senal.id}>
                      <td>
                        <Link to={`/projects/${projectId}/signals/${senal.id}`}>
                          {senal.tagSenal ?? `Señal #${senal.id}`}
                        </Link>
                      </td>
                      <td>{senal.tagPnid ?? '—'}</td>
                      <td>
                        {senal.instrumentoId ? (
                          <Link to={`/projects/${projectId}/instruments/${senal.instrumentoId}`}>
                            {tagPorInstrumentoId.get(senal.instrumentoId) ?? senal.instrumentoId}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{senal.servicio ?? '—'}</td>
                      <td>{senal.tipoIoCodigo ?? '—'}</td>
                      <td>{senal.codigoSenal ?? '—'}</td>
                      <td>
                        {senal.sinMatchPnid ? (
                          <span className="badge badge--danger">⚠ sí</span>
                        ) : (
                          <span className="page-subtitle">No</span>
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

      {/*
        Validaciones — pedido explícito del usuario, ver comentario junto a
        senalesSinPadre/senalesSinMatchReporte/senalesNoVinculadas más
        arriba para el detalle de cada una de las tres listas.
      */}
      {vista === 'validaciones' && !loading && (
        <div className="form form--stacked" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <section>
            <h2>1. Señales sin dueño ({senalesSinPadre.length})</h2>
            {senalesSinPadre.length === 0 ? (
              <p className="page-subtitle">Ninguna — todas las señales tienen un instrumento o equipo dueño.</p>
            ) : (
              <ul className="physical-hint">
                {senalesSinPadre.map((s) => (
                  <li key={s.id}>
                    <Link to={`/projects/${projectId}/signals/${s.id}`}>{s.tagSenal ?? `Señal #${s.id}`}</Link>
                    {s.servicio && <> — {s.servicio}</>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>2. En el ruteo, ya no en el último P&amp;ID ({senalesSinMatchReporte.length})</h2>
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

          <section>
            <h2>3. En el último P&amp;ID, todavía no en el ruteo ({senalesNoVinculadas.length})</h2>
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

          <section>
            <h2>4. Señales por instrumento (E/S)</h2>
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
        </div>
      )}
    </section>
  );
}
