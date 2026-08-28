import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateInstrument, listInstruments } from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import type { Instrument } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';
import { PnidEstadoBadge } from '../components/PnidEstadoBadge';
import { usePnidEstados } from '../components/usePnidEstados';
import { PNID_ESTADO_LABELS } from '../components/pnidLabels';

export function InstrumentsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  const fetchInstruments = useCallback(() => {
    if (!projectId) return Promise.resolve<Instrument[]>([]);
    return listInstruments(projectId, devUser.email).then((response) => response.instruments);
  }, [projectId, devUser.email]);

  const {
    data: instruments,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Instrument[]>(fetchInstruments);

  const { itemsById: pnidEstadosById } = usePnidEstados(devUser.email);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  const [searchText, setSearchText] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [sistemaFilter, setSistemaFilter] = useState('');
  const [nodoFilter, setNodoFilter] = useState('');
  const [planoPnidFilter, setPlanoPnidFilter] = useState('');

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

    return items.filter((instrument) => {
      if (estadoFilter) {
        const codigo = instrument.estadoPnidId
          ? (pnidEstadosById.get(instrument.estadoPnidId)?.codigo ?? null)
          : null;
        if (codigo !== estadoFilter) return false;
      }

      if (sistemaFilter && instrument.sistema !== sistemaFilter) return false;
      if (nodoFilter && instrument.nodo !== nodoFilter) return false;
      if (planoPnidFilter && instrument.planoPnid !== planoPnidFilter) return false;

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
  }, [items, searchText, estadoFilter, sistemaFilter, nodoFilter, planoPnidFilter, pnidEstadosById]);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleDeactivate(instrument: Instrument) {
    if (!projectId) return;

    const confirmed = window.confirm(
      `¿Desactivar el instrumento "${instrument.tagInstrumento}"? Esta acción es reversible solo reactivándolo desde la base (no hay endpoint de reactivación todavía).`
    );
    if (!confirmed) return;

    setDeactivatingId(instrument.id);
    setActionError(null);

    try {
      await deactivateInstrument(projectId, instrument.id, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;
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
              <span>Estado P&amp;ID</span>
              <select value={estadoFilter} onChange={(event) => setEstadoFilter(event.target.value)}>
                <option value="">Todos</option>
                {Object.entries(PNID_ESTADO_LABELS).map(([codigo, label]) => (
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
          </div>

          <p className="page-subtitle">
            Mostrando {filteredItems.length} de {items.length} instrumentos.
          </p>
        </>
      )}

      {!loading && items.length > 0 && filteredItems.length === 0 && (
        <p>Ningún instrumento coincide con la búsqueda/filtro actual.</p>
      )}

      {!loading && filteredItems.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>TAG</th>
                <th>TAG anterior</th>
                <th>Tipo</th>
                <th>Servicio</th>
                <th>Sistema</th>
                <th>Nodo</th>
                <th>PnPID</th>
                <th>P&amp;ID</th>
                <th>Estado P&amp;ID</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((instrument) => (
                <tr key={instrument.id}>
                  <td>
                    <Link to={`/projects/${projectId}/instruments/${instrument.id}`}>
                      {instrument.tagInstrumento}
                    </Link>
                  </td>
                  <td>{instrument.tagAnterior ?? '—'}</td>
                  <td>{instrument.tipoInstrumento ?? '—'}</td>
                  <td>{instrument.servicio ?? '—'}</td>
                  <td>{instrument.sistema ?? '—'}</td>
                  <td>{instrument.nodo ?? '—'}</td>
                  <td>{instrument.pnpid ?? '—'}</td>
                  <td>{instrument.planoPnid ?? '—'}</td>
                  <td>
                    <PnidEstadoBadge
                      codigo={
                        instrument.estadoPnidId
                          ? (pnidEstadosById.get(instrument.estadoPnidId)?.codigo ?? null)
                          : null
                      }
                    />
                  </td>
                  <td className="table__row-actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      disabled={!canDeactivate || deactivatingId === instrument.id}
                      title={
                        canDeactivate
                          ? undefined
                          : 'Tu rol no tiene permiso de desactivación en este proyecto.'
                      }
                      onClick={() => handleDeactivate(instrument)}
                    >
                      {deactivatingId === instrument.id ? 'Desactivando…' : 'Desactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
