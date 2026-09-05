import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { FormEvent } from 'react';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivatePlano, listPlanos, updatePlano } from '../api/planos';
import { listTiposPlano } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import type { CatalogItem, Plano } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const DISCIPLINA_LABEL: Record<string, string> = {
  ELECTRICIDAD: 'Electricidad',
  INSTRUMENTACION: 'Instrumentación'
};

/*
 * Fila editable en el lugar (pedido explícito del usuario — "no me mandes
 * a otra hoja para poder editar"): "Editar" convierte la fila en inputs,
 * "Guardar"/"Cancelar" la devuelven a modo lectura. Componente aparte para
 * que el estado del formulario (codigoPlano/descripcion/tipoPlanoId/
 * revision) viva por fila, sin pisarse entre sí si hay varias abiertas.
 */
function PlanoRow({
  projectId,
  devUserEmail,
  plano,
  tiposPlano,
  canWrite,
  canDeactivate,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  plano: Plano;
  tiposPlano: CatalogItem[];
  canWrite: boolean;
  canDeactivate: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [codigoPlano, setCodigoPlano] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipoPlanoId, setTipoPlanoId] = useState('');
  const [revision, setRevision] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  function startEditing() {
    setCodigoPlano(plano.codigoPlano ?? '');
    setDescripcion(plano.descripcion);
    setTipoPlanoId(plano.tipoPlanoId ?? '');
    setRevision(plano.revision ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updatePlano(
        projectId,
        plano.id,
        {
          codigoPlano: codigoPlano.trim() || null,
          descripcion,
          tipoPlanoId,
          revision: revision.trim() || null
        },
        devUserEmail
      );
      setEditing(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    const confirmed = window.confirm(`¿Desactivar el plano "${plano.codigoPlano ?? `#${plano.id}`}"?`);
    if (!confirmed) return;

    setDeactivating(true);
    setError(null);
    try {
      await deactivatePlano(projectId, plano.id, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={6}>
          <form className="form form--inline" onSubmit={handleSave}>
            <ErrorMessage error={error} />
            <label className="form__field">
              <span>Código</span>
              <input
                type="text"
                maxLength={50}
                value={codigoPlano}
                disabled={saving}
                onChange={(event) => setCodigoPlano(event.target.value)}
              />
            </label>
            <label className="form__field">
              <span>Descripción</span>
              <input
                type="text"
                required
                maxLength={300}
                value={descripcion}
                disabled={saving}
                onChange={(event) => setDescripcion(event.target.value)}
              />
            </label>
            <label className="form__field">
              <span>Tipo</span>
              <select required value={tipoPlanoId} disabled={saving} onChange={(event) => setTipoPlanoId(event.target.value)}>
                <option value="" disabled>
                  — elegir —
                </option>
                {tiposPlano.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>
                    {tipo.codigo}
                  </option>
                ))}
              </select>
            </label>
            <label className="form__field">
              <span>Revisión</span>
              <input
                type="text"
                maxLength={10}
                value={revision}
                disabled={saving}
                onChange={(event) => setRevision(event.target.value)}
              />
            </label>
            <button type="submit" className="button button--small" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancelar
            </button>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{plano.codigoPlano ?? <em>— sin código —</em>}</td>
      <td>{plano.descripcion}</td>
      <td>{plano.tipoPlanoCodigo ?? '—'}</td>
      <td>{plano.revision ?? '—'}</td>
      <td>{plano.disciplina ? DISCIPLINA_LABEL[plano.disciplina] : '—'}</td>
      <td className="table__row-actions">
        <ErrorMessage error={error} />
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={!canWrite}
          title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
          onClick={startEditing}
        >
          Editar
        </button>
        <button
          type="button"
          className="button button--danger button--small"
          disabled={!canDeactivate || deactivating}
          title={canDeactivate ? undefined : 'Tu rol no tiene permiso de desactivación en este proyecto.'}
          onClick={handleDeactivate}
        >
          {deactivating ? 'Desactivando…' : 'Desactivar'}
        </button>
      </td>
    </tr>
  );
}

export function PlanosListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);

  const fetchPlanos = useCallback(() => {
    if (!projectId) return Promise.resolve<Plano[]>([]);
    return listPlanos(projectId, devUser.email).then((response) => response.planos);
  }, [projectId, devUser.email]);

  const {
    data: planos,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Plano[]>(fetchPlanos);

  const fetchTiposPlano = useCallback(
    () => listTiposPlano(devUser.email).then((response) => response.items),
    [devUser.email]
  );
  const { data: tiposPlano } = useAsyncData(fetchTiposPlano);

  const [codigoFilter, setCodigoFilter] = useState('');
  const [descripcionFilter, setDescripcionFilter] = useState('');
  const [tipoFilter, setTipoFilter] = useState('');
  const [disciplinaFilter, setDisciplinaFilter] = useState('');

  const items = planos ?? [];

  const filteredItems = useMemo(() => {
    const codigoNeedle = codigoFilter.trim().toLowerCase();
    const descripcionNeedle = descripcionFilter.trim().toLowerCase();

    return items.filter((plano) => {
      if (tipoFilter && plano.tipoPlanoCodigo !== tipoFilter) return false;
      if (disciplinaFilter && plano.disciplina !== disciplinaFilter) return false;
      if (codigoNeedle.length > 0 && !(plano.codigoPlano ?? '').toLowerCase().includes(codigoNeedle)) {
        return false;
      }
      if (descripcionNeedle.length > 0 && !plano.descripcion.toLowerCase().includes(descripcionNeedle)) {
        return false;
      }
      return true;
    });
  }, [items, codigoFilter, descripcionFilter, tipoFilter, disciplinaFilter]);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;
  const error = loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Planos</h1>
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
            onClick={() => navigate(`/projects/${projectId}/planos/new`)}
          >
            Nuevo plano
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando planos…</p>}

      {!loading && !error && items.length === 0 && (
        <p>Este proyecto todavía no tiene planos activos.</p>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="form form--inline">
            <label className="form__field">
              <span>Código</span>
              <input
                type="text"
                placeholder="Buscar por código de plano"
                value={codigoFilter}
                onChange={(event) => setCodigoFilter(event.target.value)}
              />
            </label>
            <label className="form__field">
              <span>Descripción</span>
              <input
                type="text"
                placeholder="Buscar por descripción"
                value={descripcionFilter}
                onChange={(event) => setDescripcionFilter(event.target.value)}
              />
            </label>
            <label className="form__field">
              <span>Tipo</span>
              <select value={tipoFilter} onChange={(event) => setTipoFilter(event.target.value)}>
                <option value="">Todos</option>
                {(tiposPlano ?? []).map((tipo) => (
                  <option key={tipo.id} value={tipo.codigo}>
                    {tipo.codigo}
                  </option>
                ))}
              </select>
            </label>
            <label className="form__field">
              <span>Disciplina</span>
              <select value={disciplinaFilter} onChange={(event) => setDisciplinaFilter(event.target.value)}>
                <option value="">Todas</option>
                <option value="ELECTRICIDAD">Electricidad</option>
                <option value="INSTRUMENTACION">Instrumentación</option>
              </select>
            </label>
          </div>

          <p className="page-subtitle">
            Mostrando {filteredItems.length} de {items.length} planos.
          </p>
        </>
      )}

      {!loading && items.length > 0 && filteredItems.length === 0 && (
        <p>Ningún plano coincide con la búsqueda/filtro actual.</p>
      )}

      {!loading && filteredItems.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Tipo</th>
                <th>Revisión</th>
                <th>Disciplina</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((plano) => (
                <PlanoRow
                  key={plano.id}
                  projectId={projectId}
                  devUserEmail={devUser.email}
                  plano={plano}
                  tiposPlano={tiposPlano ?? []}
                  canWrite={canWrite}
                  canDeactivate={canDeactivate}
                  onChange={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
