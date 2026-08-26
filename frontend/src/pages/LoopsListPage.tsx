import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { createLoop, deactivateLoop, listLoops, updateLoop } from '../api/loops';
import { listInstruments } from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Instrument, Loop } from '../api/types';

interface LoopsData {
  loops: Loop[];
  instruments: Instrument[];
}

function EditRow({
  loop,
  canWrite,
  onSave,
  onCancel
}: {
  loop: Loop;
  canWrite: boolean;
  onSave: (codigoDocumento: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(loop.codigoDocumento ?? '');

  return (
    <tr>
      <td colSpan={2}>
        <input
          type="text"
          maxLength={100}
          disabled={!canWrite}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </td>
      <td className="table__row-actions">
        <button
          type="button"
          className="button button--small"
          onClick={() => onSave(value.trim().length === 0 ? null : value.trim())}
        >
          Guardar
        </button>
        <button type="button" className="button button--secondary button--small" onClick={onCancel}>
          Cancelar
        </button>
      </td>
    </tr>
  );
}

export function LoopsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetcher = useCallback(async (): Promise<LoopsData> => {
    if (!projectId) return { loops: [], instruments: [] };
    const [loops, instruments] = await Promise.all([
      listLoops(projectId, devUser.email),
      listInstruments(projectId, devUser.email)
    ]);
    return { loops: loops.loops, instruments: instruments.instruments };
  }, [projectId, devUser.email]);

  const { data, loading, error: loadError, refresh: load } = useAsyncData<LoopsData>(fetcher);

  const [instrumentoId, setInstrumentoId] = useState<string | null>(null);
  const [codigoDocumento, setCodigoDocumento] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  const loops = data?.loops ?? [];
  const instruments = data?.instruments ?? [];

  // Un instrumento admite como máximo un lazo activo (UX_lazo_instrumento_id)
  // — no se ofrecen en el picker los que ya tienen uno, para no garantizar
  // un 409 al enviar.
  const instrumentsWithoutLoop = instruments.filter(
    (instrument) => !loops.some((loop) => loop.instrumentoId === instrument.id)
  );

  function instrumentTag(instrumentoId: string): string {
    return instruments.find((i) => i.id === instrumentoId)?.tagInstrumento ?? `#${instrumentoId}`;
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!instrumentoId) return;
    setCreating(true);
    setActionError(null);
    try {
      await createLoop(
        projectId!,
        {
          instrumentoId,
          codigoDocumento: codigoDocumento.trim().length > 0 ? codigoDocumento.trim() : null
        },
        devUser.email
      );
      setInstrumentoId(null);
      setCodigoDocumento('');
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(loopId: string, value: string | null) {
    setActionError(null);
    try {
      await updateLoop(projectId!, loopId, value, devUser.email);
      setEditingId(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  async function handleDeactivate(loop: Loop) {
    if (!window.confirm(`¿Desactivar el lazo de ${instrumentTag(loop.instrumentoId)}?`)) return;
    setDeactivatingId(loop.id);
    setActionError(null);
    try {
      await deactivateLoop(projectId!, loop.id, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Lazos</h1>
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

      <ErrorMessage error={error} />

      {canWrite && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>Instrumento *</span>
            <CatalogSelect
              required
              disabled={creating}
              value={instrumentoId}
              onChange={setInstrumentoId}
              options={instrumentsWithoutLoop.map((i) => ({ id: i.id, label: i.tagInstrumento }))}
              emptyLabel="— elegir instrumento —"
            />
          </label>
          <label className="form__field">
            <span>Código de documento</span>
            <input
              type="text"
              maxLength={100}
              disabled={creating}
              value={codigoDocumento}
              onChange={(event) => setCodigoDocumento(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={creating || !instrumentoId}>
            {creating ? 'Creando…' : '+ Nuevo lazo'}
          </button>
        </form>
      )}

      {loading && <p>Cargando lazos…</p>}

      {!loading && loops.length === 0 && <p>Este proyecto todavía no tiene lazos activos.</p>}

      {!loading && loops.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Instrumento</th>
              <th>Código de documento</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {loops.map((loop) =>
              editingId === loop.id ? (
                <EditRow
                  key={loop.id}
                  loop={loop}
                  canWrite={canWrite}
                  onSave={(value) => handleSaveEdit(loop.id, value)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <tr key={loop.id}>
                  <td>{instrumentTag(loop.instrumentoId)}</td>
                  <td>{loop.codigoDocumento ?? '—'}</td>
                  <td className="table__row-actions">
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={!canWrite}
                      onClick={() => setEditingId(loop.id)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="button button--danger button--small"
                      disabled={!canDeactivate || deactivatingId === loop.id}
                      onClick={() => handleDeactivate(loop)}
                    >
                      {deactivatingId === loop.id ? 'Desactivando…' : 'Desactivar'}
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
