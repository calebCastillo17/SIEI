import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  createConnectionPoint,
  deactivateConnectionPoint,
  listConnectionPoints,
  updateConnectionPoint
} from '../api/connectionPoints';
import type { ConnectionPointEditableInput } from '../api/connectionPoints';
import { useAsyncData } from '../lib/useAsyncData';
import { useConnectionPointFormOptions } from '../components/useConnectionPointFormOptions';
import { ConnectionPointForm } from '../components/ConnectionPointForm';
import { emptyConnectionPointInput } from '../components/connectionPointFormDefaults';
import { connectionPointOwnerLabel } from '../components/connectionPointLabel';
import type { ConnectionPoint, ConnectionPointInput } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const EDITABLE_FIELDS: Array<{ key: keyof ConnectionPointEditableInput; label: string; max: number }> = [
  { key: 'regleta', label: 'Regleta', max: 30 },
  { key: 'bornera', label: 'Bornera', max: 30 },
  { key: 'borne', label: 'Borne', max: 30 },
  { key: 'lado', label: 'Lado', max: 20 },
  { key: 'circuito', label: 'Circuito', max: 30 },
  { key: 'hilo', label: 'Hilo', max: 30 },
  { key: 'descripcion', label: 'Descripción', max: 200 }
];

function EditRow({
  point,
  ownerText,
  canWrite,
  onSave,
  onCancel
}: {
  point: ConnectionPoint;
  ownerText: string;
  canWrite: boolean;
  onSave: (value: ConnectionPointEditableInput) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<ConnectionPointEditableInput>({
    regleta: point.regleta,
    bornera: point.bornera,
    borne: point.borne,
    lado: point.lado,
    circuito: point.circuito,
    hilo: point.hilo,
    descripcion: point.descripcion
  });

  return (
    <tr>
      <td>{ownerText}</td>
      {EDITABLE_FIELDS.map((field) => (
        <td key={field.key}>
          <input
            type="text"
            maxLength={field.max}
            disabled={!canWrite}
            value={value[field.key] ?? ''}
            onChange={(event) =>
              setValue((prev) => ({
                ...prev,
                [field.key]: event.target.value.length === 0 ? null : event.target.value
              }))
            }
          />
        </td>
      ))}
      <td className="table__row-actions">
        <button type="button" className="button button--small" onClick={() => onSave(value)}>
          Guardar
        </button>
        <button type="button" className="button button--secondary button--small" onClick={onCancel}>
          Cancelar
        </button>
      </td>
    </tr>
  );
}

export function ConnectionPointsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchPoints = useCallback(() => {
    if (!projectId) return Promise.resolve<ConnectionPoint[]>([]);
    return listConnectionPoints(projectId, devUser.email).then((r) => r.connectionPoints);
  }, [projectId, devUser.email]);

  const { data: points, loading, error: loadError, refresh: load } = useAsyncData<
    ConnectionPoint[]
  >(fetchPoints);

  const { data: options, loading: optionsLoading, error: optionsError } =
    useConnectionPointFormOptions(projectId ?? '', devUser.email);

  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleCreate(value: ConnectionPointInput) {
    setCreating(true);
    setActionError(null);
    try {
      await createConnectionPoint(projectId!, value, devUser.email);
      setShowForm(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(pointId: string, value: ConnectionPointEditableInput) {
    setActionError(null);
    try {
      await updateConnectionPoint(projectId!, pointId, value, devUser.email);
      setEditingId(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  async function handleDeactivate(point: ConnectionPoint) {
    if (!window.confirm('¿Desactivar este punto de conexión?')) return;
    setDeactivatingId(point.id);
    setActionError(null);
    try {
      await deactivateConnectionPoint(projectId!, point.id, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  const items = points ?? [];
  const error = actionError ?? loadError ?? optionsError;
  const loadingAny = loading || optionsLoading;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Puntos de conexión</h1>
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
          {canWrite && !showForm && (
            <button type="button" className="button" onClick={() => setShowForm(true)}>
              + Nuevo punto de conexión
            </button>
          )}
        </div>
      </div>

      <ErrorMessage error={error} />

      {canWrite && showForm && options && (
        <ConnectionPointForm
          initialValue={emptyConnectionPointInput()}
          options={options}
          submitLabel="Crear punto de conexión"
          submitting={creating}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loadingAny && <p>Cargando puntos de conexión…</p>}

      {!loadingAny && items.length === 0 && (
        <p>Este proyecto todavía no tiene puntos de conexión activos.</p>
      )}

      {!loadingAny && items.length > 0 && options && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Dueño</th>
                <th>Regleta</th>
                <th>Bornera</th>
                <th>Borne</th>
                <th>Lado</th>
                <th>Circuito</th>
                <th>Hilo</th>
                <th>Descripción</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((point) =>
                editingId === point.id ? (
                  <EditRow
                    key={point.id}
                    point={point}
                    ownerText={connectionPointOwnerLabel(point, options)}
                    canWrite={canWrite}
                    onSave={(value) => handleSaveEdit(point.id, value)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={point.id}>
                    <td>{connectionPointOwnerLabel(point, options)}</td>
                    <td>{point.regleta ?? '—'}</td>
                    <td>{point.bornera ?? '—'}</td>
                    <td>{point.borne ?? '—'}</td>
                    <td>{point.lado ?? '—'}</td>
                    <td>{point.circuito ?? '—'}</td>
                    <td>{point.hilo ?? '—'}</td>
                    <td>{point.descripcion ?? '—'}</td>
                    <td className="table__row-actions">
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        disabled={!canWrite}
                        onClick={() => setEditingId(point.id)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="button button--danger button--small"
                        disabled={!canDeactivate || deactivatingId === point.id}
                        onClick={() => handleDeactivate(point)}
                      >
                        {deactivatingId === point.id ? 'Desactivando…' : 'Desactivar'}
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
