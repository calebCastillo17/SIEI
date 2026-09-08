import { Fragment, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateEquipment, listEquipment } from '../api/equipment';
import { listInstruments, listPendientesEquipo, updateInstrument } from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import type { Equipment, Instrument, PendienteEquipo } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/*
 * A diferencia de tuberías, acá el P&ID NUNCA manda solo — equipoAsociadoId
 * es una selección manual y curada en SIEI; equipoAsociadoTag es solo el
 * texto de referencia que trae el P&ID. Esta sección muestra sugerencias
 * (instrumentos con tag pero sin id todavía) y ofrece "Vincular" solo
 * cuando el texto coincide exacto con un equipo ya cargado — nunca se
 * escribe nada automáticamente.
 */
function PendientesEquipoSection({ projectId, canWrite, onVinculado }: { projectId: string; canWrite: boolean; onVinculado: () => void }) {
  const { devUser } = useDevUser();
  const fetchPendientes = useCallback(
    () => listPendientesEquipo(projectId, devUser.email).then((r) => r.pendientes),
    [projectId, devUser.email]
  );
  const { data: pendientes, loading, refresh } = useAsyncData<PendienteEquipo[]>(fetchPendientes);
  const [verTodos, setVerTodos] = useState(false);
  const [vinculandoId, setVinculandoId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const lista = pendientes ?? [];
  const conSugerencia = lista.filter((p) => p.equipoSugeridoId !== null);
  const sinSugerencia = lista.filter((p) => p.equipoSugeridoId === null);

  async function handleVincular(p: PendienteEquipo) {
    if (!p.equipoSugeridoId) return;
    setVinculandoId(p.instrumentId);
    setError(null);
    try {
      await updateInstrument(projectId, p.instrumentId, { equipoAsociadoId: p.equipoSugeridoId }, devUser.email);
      refresh();
      onVinculado();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setVinculandoId(null);
    }
  }

  if (loading) return null;
  if (lista.length === 0) return null;

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <h2>Pendientes de equipo asociado</h2>
      <ErrorMessage error={error} />

      {conSugerencia.length > 0 && (
        <>
          <p className="physical-hint">
            Estos {conSugerencia.length} instrumentos traen un equipo asociado en el P&amp;ID que coincide con uno
            ya cargado — vos decidís si vincularlo (nunca se hace solo).
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>TAG instrumento</th>
                <th>Equipo en P&amp;ID</th>
                <th>Equipo sugerido</th>
                {canWrite && <th aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {conSugerencia.map((p) => (
                <tr key={p.instrumentId}>
                  <td>{p.tagInstrumento}</td>
                  <td>{p.equipoAsociadoTag}</td>
                  <td>{p.equipoSugeridoTag} {p.equipoSugeridoDescripcion ? `— ${p.equipoSugeridoDescripcion}` : ''}</td>
                  {canWrite && (
                    <td>
                      <button type="button" className="button button--small" disabled={vinculandoId === p.instrumentId} onClick={() => handleVincular(p)}>
                        {vinculandoId === p.instrumentId ? '…' : 'Vincular'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {sinSugerencia.length > 0 && (
        <>
          <button type="button" className="button button--small button--secondary" onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? 'Ocultar' : 'Ver'} {sinSugerencia.length} instrumentos cuyo equipo del P&amp;ID no existe todavía como equipo
          </button>
          {verTodos && (
            <table className="table" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr><th>TAG instrumento</th><th>Equipo en P&amp;ID (sin match)</th></tr>
              </thead>
              <tbody>
                {sinSugerencia.map((p) => (
                  <tr key={p.instrumentId}>
                    <td>{p.tagInstrumento}</td>
                    <td>{p.equipoAsociadoTag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

export function EquipmentListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  const fetchEquipment = useCallback(() => {
    if (!projectId) return Promise.resolve<Equipment[]>([]);
    return listEquipment(projectId, devUser.email).then((response) => response.equipment);
  }, [projectId, devUser.email]);

  const {
    data: equipment,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Equipment[]>(fetchEquipment);

  // Instrumentos asociados por equipo — leídos en vivo (no duplicados acá),
  // mismo criterio que ya se usa en Tuberías/FichaTecnicaDetailPage.
  const fetchInstrumentos = useCallback(() => {
    if (!projectId) return Promise.resolve<Instrument[]>([]);
    return listInstruments(projectId, devUser.email).then((r) => r.instruments);
  }, [projectId, devUser.email]);
  const { data: instrumentos, refresh: refreshInstrumentos } = useAsyncData<Instrument[]>(fetchInstrumentos);
  const instrumentosPorEquipo = useMemo(() => {
    const mapa = new Map<string, Instrument[]>();
    for (const i of instrumentos ?? []) {
      if (!i.equipoAsociadoId) continue;
      const lista = mapa.get(i.equipoAsociadoId) ?? [];
      lista.push(i);
      mapa.set(i.equipoAsociadoId, lista);
    }
    return mapa;
  }, [instrumentos]);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [searchText, setSearchText] = useState('');

  const items = useMemo(() => equipment ?? [], [equipment]);

  /* Filtrado en el cliente, igual criterio que InstrumentsListPage: a la
   * escala real de un catálogo curado (decenas de equipos, no miles) no
   * hace falta búsqueda server-side. Considera EQUIPO, DESCRIPCIÓN, PANEL,
   * SISTEMA, NODO, P&ID y TIPO (nombre resuelto). */
  const filteredItems = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    if (needle.length === 0) return items;

    return items.filter((item) => {
      const haystack = [
        item.tagEquipo,
        item.descripcion,
        item.panel,
        item.sistema,
        item.nodo,
        item.planoPnid,
        item.tipoEquipoNombre
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [items, searchText]);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleDeactivate(item: Equipment) {
    if (!projectId) return;

    const confirmed = window.confirm(`¿Desactivar el equipo "${item.tagEquipo}"?`);
    if (!confirmed) return;

    setDeactivatingId(item.id);
    setActionError(null);

    try {
      await deactivateEquipment(projectId, item.id, devUser.email);
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
          <h1>Equipos</h1>
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
          <button
            type="button"
            className="button"
            disabled={!canWrite}
            title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
            onClick={() => navigate(`/projects/${projectId}/equipment/new`)}
          >
            + Nuevo equipo
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {projectId && <PendientesEquipoSection projectId={projectId} canWrite={canWrite} onVinculado={refreshInstrumentos} />}

      {loading && <p>Cargando equipos…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene equipos activos.</p>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="form form--inline">
            <label className="form__field">
              <span>Buscar</span>
              <input
                type="text"
                placeholder="EQUIPO, descripción, panel, sistema, nodo, P&ID o tipo"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
          </div>

          <p className="page-subtitle">
            Mostrando {filteredItems.length} de {items.length} equipos.
          </p>
        </>
      )}

      {!loading && items.length > 0 && filteredItems.length === 0 && (
        <p>Ningún equipo coincide con la búsqueda actual.</p>
      )}

      {!loading && filteredItems.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>EQUIPO</th>
                <th>DESCRIPCIÓN</th>
                <th>TIPO</th>
                <th>PANEL</th>
                <th>SISTEMA</th>
                <th>NODO</th>
                <th>P&amp;ID</th>
                <th>Instrumentos</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const asociados = instrumentosPorEquipo.get(item.id) ?? [];
                return (
                <Fragment key={item.id}>
                <tr>
                  <td>
                    <Link to={`/projects/${projectId}/equipment/${item.id}`}>{item.tagEquipo}</Link>
                  </td>
                  <td>{item.descripcion ?? '—'}</td>
                  <td>{item.tipoEquipoNombre ?? '—'}</td>
                  <td>{item.panel ?? '—'}</td>
                  <td>{item.sistema ?? '—'}</td>
                  <td>{item.nodo ?? '—'}</td>
                  <td>{item.planoPnid ?? '—'}</td>
                  <td>
                    {asociados.length === 0 ? (
                      '0'
                    ) : (
                      <button
                        type="button"
                        className="button button--small button--secondary"
                        onClick={() => setExpandidoId((cur) => (cur === item.id ? null : item.id))}
                      >
                        {asociados.length} {expandidoId === item.id ? '▲' : '▼'}
                      </button>
                    )}
                  </td>
                  <td className="table__row-actions">
                    <Link
                      to={`/projects/${projectId}/equipment/${item.id}`}
                      className="button button--secondary button--small"
                    >
                      Editar
                    </Link>
                    <button
                      type="button"
                      className="button button--danger button--small"
                      disabled={!canDeactivate || deactivatingId === item.id}
                      title={
                        canDeactivate
                          ? undefined
                          : 'Tu rol no tiene permiso de desactivación en este proyecto.'
                      }
                      onClick={() => handleDeactivate(item)}
                    >
                      {deactivatingId === item.id ? 'Desactivando…' : 'Desactivar'}
                    </button>
                  </td>
                </tr>
                {expandidoId === item.id && (
                  <tr>
                    <td colSpan={9}>
                      <ul className="physical-hint" style={{ margin: 0 }}>
                        {asociados.map((i) => (
                          <li key={i.id}>
                            <Link to={`/projects/${projectId}/instruments/${i.id}`}>{i.tagInstrumento}</Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
