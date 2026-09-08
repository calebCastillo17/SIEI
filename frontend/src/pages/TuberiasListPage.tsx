import { Fragment, useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  listTuberias,
  createTuberia,
  updateTuberia,
  deleteTuberiaDefinitivamente,
  listPendientesTuberias,
  actualizarTagDesdePnid,
  crearTuberiaDesdePnid
} from '../api/tuberias';
import { listInstruments } from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import type { Tuberia, PendienteTuberia, Instrument } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/** nucleo.tuberia (migración 030). tag_linea sin unique a propósito
 * (mismo criterio que plano.codigo_plano).
 *
 * Regla de negocio explícita del usuario: la ÚNICA asociación correcta
 * entre línea e instrumento la da el P&ID — por eso tag_linea/tag_anterior
 * (migración 043) NO se editan como texto libre acá, solo mediante las
 * acciones de "Pendientes" (actualizar-tag-desde-pnid / crear-desde-pnid).
 * El resto de las propiedades (tamaño, material, etc.) sí se sigue
 * editando a mano. */

const PROPERTY_FIELDS: Array<[keyof Tuberia, string, number]> = [
  ['tamanoDiametro', 'Tamaño / diámetro', 20],
  ['materialTuberia', 'Material', 200],
  ['materialRevestimiento', 'Material revestimiento', 200],
  ['espesorRevestimiento', 'Espesor revestimiento', 50],
  ['schedule', 'Schedule', 20],
  ['normaBridas', 'Norma bridas', 50],
  ['caraBridas', 'Cara bridas', 200],
  ['conexionInstrumento', 'Conexión instrumento', 200]
];

function PendienteRow({
  p,
  projectId,
  devUserEmail,
  onResuelto
}: {
  p: PendienteTuberia;
  projectId: string;
  devUserEmail: string;
  onResuelto: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleActualizar() {
    if (!p.tuberiaId) return;
    setBusy(true);
    setError(null);
    try {
      await actualizarTagDesdePnid(projectId, p.tuberiaId, p.instrumentId, devUserEmail);
      onResuelto();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleCrearNueva() {
    setBusy(true);
    setError(null);
    try {
      await crearTuberiaDesdePnid(projectId, p.instrumentId, devUserEmail);
      onResuelto();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>{p.tagInstrumento}</td>
      <td>{p.tagLineaActual ?? '—'}</td>
      <td>{p.lineaPnid}</td>
      <td>
        {error && <ErrorMessage error={error} />}
        {p.tipo === 'CAMBIO' ? (
          <>
            <button type="button" className="button button--small" disabled={busy} onClick={handleActualizar}>
              {busy ? '…' : 'Actualizar esta línea'}
            </button>{' '}
            <button type="button" className="button button--small button--secondary" disabled={busy} onClick={handleCrearNueva}>
              {busy ? '…' : 'Es una línea nueva'}
            </button>
          </>
        ) : (
          <button type="button" className="button button--small" disabled={busy} onClick={handleCrearNueva}>
            {busy ? '…' : 'Crear línea y vincular'}
          </button>
        )}
      </td>
    </tr>
  );
}

function PendientesSection({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const { devUser } = useDevUser();
  const fetchPendientes = useCallback(
    () => listPendientesTuberias(projectId, devUser.email).then((r) => r.pendientes),
    [projectId, devUser.email]
  );
  const { data: pendientes, loading, refresh } = useAsyncData<PendienteTuberia[]>(fetchPendientes);
  const [verFaltantes, setVerFaltantes] = useState(false);

  const lista = pendientes ?? [];
  const cambios = lista.filter((p) => p.tipo === 'CAMBIO');
  const faltantes = lista.filter((p) => p.tipo === 'FALTANTE');

  if (loading) return null;
  if (cambios.length === 0 && faltantes.length === 0) return null;

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <h2>Pendientes de P&amp;ID</h2>

      {cambios.length > 0 && (
        <>
          <p className="physical-hint">
            Estos {cambios.length} tags tienen tubería vinculada, pero su línea en el P&amp;ID ya no coincide con
            la de HD. Elegí si es la misma línea (corregir el rótulo) o si es una línea físicamente distinta.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>TAG</th>
                <th>Línea en HD</th>
                <th>Línea en P&amp;ID</th>
                {canWrite && <th aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {cambios.map((p) => (
                <PendienteRow key={p.instrumentId} p={p} projectId={projectId} devUserEmail={devUser.email} onResuelto={refresh} />
              ))}
            </tbody>
          </table>
        </>
      )}

      {faltantes.length > 0 && (
        <>
          <button type="button" className="button button--small button--secondary" onClick={() => setVerFaltantes((v) => !v)}>
            {verFaltantes ? 'Ocultar' : 'Ver'} {faltantes.length} instrumentos sin tubería vinculada (tienen línea en el P&amp;ID)
          </button>
          {verFaltantes && (
            <table className="table" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th>TAG</th>
                  <th>Línea en HD</th>
                  <th>Línea en P&amp;ID</th>
                  {canWrite && <th aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {faltantes.map((p) => (
                  <PendienteRow key={p.instrumentId} p={p} projectId={projectId} devUserEmail={devUser.email} onResuelto={refresh} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

export function TuberiasListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchTuberias = useCallback(() => {
    if (!projectId) return Promise.resolve<Tuberia[]>([]);
    return listTuberias(projectId, devUser.email).then((r) => r.tuberias);
  }, [projectId, devUser.email]);
  const { data: tuberias, loading, error: loadError, refresh: load } = useAsyncData<Tuberia[]>(fetchTuberias);

  // Instrumentos asociados por tubería — leídos en vivo (no duplicados acá),
  // igual criterio que ya se usa en FichaTecnicaDetailPage.
  const fetchInstrumentos = useCallback(() => {
    if (!projectId) return Promise.resolve<Instrument[]>([]);
    return listInstruments(projectId, devUser.email).then((r) => r.instruments);
  }, [projectId, devUser.email]);
  const { data: instrumentos } = useAsyncData<Instrument[]>(fetchInstrumentos);
  const tagsPorTuberia = useMemo(() => {
    const mapa = new Map<string, Instrument[]>();
    for (const i of instrumentos ?? []) {
      if (!i.tuberiaId) continue;
      const lista = mapa.get(i.tuberiaId) ?? [];
      lista.push(i);
      mapa.set(i.tuberiaId, lista);
    }
    return mapa;
  }, [instrumentos]);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [tagLinea, setTagLinea] = useState('');
  const [tamanoDiametro, setTamanoDiametro] = useState('');
  const [materialTuberia, setMaterialTuberia] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  // Edición de propiedades (no del tag — ese lo define el P&ID).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<Error | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  function startEdit(t: Tuberia) {
    setEditingId(t.id);
    const values: Record<string, string> = {};
    for (const [key] of PROPERTY_FIELDS) values[key] = (t[key] as string | null) ?? '';
    setEditValues(values);
    setEditError(null);
  }

  async function handleSaveEdit(t: Tuberia) {
    setSavingId(t.id);
    setEditError(null);
    try {
      const body: Record<string, string | null> = {};
      for (const [key] of PROPERTY_FIELDS) body[key] = editValues[key]?.trim() || null;
      await updateTuberia(projectId!, t.id, body, devUser.email);
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSavingId(null);
    }
  }

  async function handleEliminar(t: Tuberia) {
    if (!window.confirm(`¿Eliminar definitivamente la tubería "${t.tagLinea}"? No se puede deshacer.`)) return;
    setDeletingId(t.id);
    setEditError(null);
    try {
      await deleteTuberiaDefinitivamente(projectId!, t.id, devUser.email);
      load();
    } catch (err) {
      setEditError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createTuberia(
        projectId!,
        {
          tagLinea: tagLinea.trim() || null,
          tagAnterior: null,
          tamanoDiametro: tamanoDiametro.trim() || null,
          materialTuberia: materialTuberia.trim() || null,
          materialRevestimiento: null,
          espesorRevestimiento: null,
          schedule: null,
          normaBridas: null,
          caraBridas: null,
          conexionInstrumento: null
        },
        devUser.email
      );
      setTagLinea('');
      setTamanoDiametro('');
      setMaterialTuberia('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const allItems = tuberias ?? [];
  const items = busqueda.trim().length === 0
    ? allItems
    : allItems.filter((t) => (t.tagLinea ?? '').toLowerCase().includes(busqueda.trim().toLowerCase()));
  const error = createError ?? loadError ?? editError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Tuberías</h1>
          {project && <p className="page-subtitle">Proyecto {project.code} — {project.name} · líneas de proceso (Hojas de Datos)</p>}
        </div>
        <button type="button" className="button button--secondary" onClick={load}>Actualizar</button>
      </div>

      <ErrorMessage error={error} />

      <PendientesSection projectId={projectId} canWrite={canWrite} />

      <div className="filter-bar">
        <input type="search" placeholder="Buscar por tag de línea…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      </div>

      {canWrite && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>Tag de línea</span>
            <input type="text" maxLength={100} disabled={creating} value={tagLinea} onChange={(e) => setTagLinea(e.target.value)} placeholder='ej. 620-TL-24"-L1E0U-26807' />
          </label>
          <label className="form__field">
            <span>Tamaño / diámetro</span>
            <input type="text" maxLength={20} disabled={creating} value={tamanoDiametro} onChange={(e) => setTamanoDiametro(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Material</span>
            <input type="text" maxLength={200} disabled={creating} value={materialTuberia} onChange={(e) => setMaterialTuberia(e.target.value)} />
          </label>
          <button type="submit" className="button" disabled={creating}>{creating ? 'Creando…' : '+ Nueva tubería'}</button>
        </form>
      )}
      <p className="physical-hint">
        El tag de línea creado acá manualmente no se vuelve a editar como texto libre — una vez que un instrumento
        lo vincule, cualquier corrección futura sale del P&amp;ID (ver "Pendientes" arriba).
      </p>

      {loading && <p>Cargando tuberías…</p>}
      {!loading && allItems.length === 0 && <p>Este proyecto todavía no tiene tuberías cargadas.</p>}
      {!loading && allItems.length > 0 && items.length === 0 && <p>Ninguna coincide con la búsqueda.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Tag de línea</th>
              <th>Tag anterior</th>
              <th>Tamaño</th>
              <th>Material</th>
              <th>Norma bridas</th>
              <th>Conexión instrumento</th>
              <th>Tags que la usan</th>
              {canWrite && <th aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td>{t.tagLinea ?? '—'}</td>
                  <td>{t.tagAnterior ?? '—'}</td>
                  <td>{t.tamanoDiametro ?? '—'}</td>
                  <td>{t.materialTuberia ?? '—'}</td>
                  <td>{t.normaBridas ?? '—'}</td>
                  <td>{t.conexionInstrumento ?? '—'}</td>
                  <td>
                    {(tagsPorTuberia.get(t.id)?.length ?? 0) === 0 ? (
                      '0'
                    ) : (
                      <button
                        type="button"
                        className="button button--small button--secondary"
                        onClick={() => setExpandidoId((cur) => (cur === t.id ? null : t.id))}
                      >
                        {tagsPorTuberia.get(t.id)?.length} {expandidoId === t.id ? '▲' : '▼'}
                      </button>
                    )}
                  </td>
                  {canWrite && (
                    <td>
                      <button
                        type="button"
                        className="button button--small button--secondary"
                        onClick={() => (editingId === t.id ? setEditingId(null) : startEdit(t))}
                      >
                        {editingId === t.id ? 'Cancelar' : 'Editar propiedades'}
                      </button>{' '}
                      {canDeactivate && t.tagsAsociados === 0 && (
                        <button
                          type="button"
                          className="button button--small button--danger"
                          disabled={deletingId === t.id}
                          onClick={() => handleEliminar(t)}
                        >
                          {deletingId === t.id ? '…' : 'Eliminar'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {expandidoId === t.id && (
                  <tr>
                    <td colSpan={8}>
                      <ul className="physical-hint" style={{ margin: 0 }}>
                        {(tagsPorTuberia.get(t.id) ?? []).map((i) => (
                          <li key={i.id}>
                            <Link to={`/projects/${projectId}/instruments/${i.id}`}>{i.tagInstrumento}</Link>
                            {' — línea P&ID: '}
                            {i.lineaPnid ?? '—'}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
                {editingId === t.id && (
                  <tr>
                    <td colSpan={8}>
                      <div className="form form--inline">
                        {PROPERTY_FIELDS.map(([key, label, max]) => (
                          <label className="form__field" key={key}>
                            <span>{label}</span>
                            <input
                              type="text"
                              maxLength={max}
                              disabled={savingId === t.id}
                              value={editValues[key] ?? ''}
                              onChange={(e) => setEditValues((v) => ({ ...v, [key]: e.target.value }))}
                            />
                          </label>
                        ))}
                        <button type="button" className="button button--small" disabled={savingId === t.id} onClick={() => handleSaveEdit(t)}>
                          {savingId === t.id ? 'Guardando…' : 'Guardar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
