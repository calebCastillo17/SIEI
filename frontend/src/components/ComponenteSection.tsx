import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';

import { useDevUser } from '../auth/DevUserContext';
import { listComponentes, createComponente, updateComponente, deactivateComponente } from '../api/componentes';
import { useAsyncData } from '../lib/useAsyncData';
import type { ComponenteSpec } from '../lib/componentSpecs';
import type { ComponenteItem } from '../api/types';
import { ErrorMessage } from './ErrorMessage';

/** Arma un objeto vacío { campo: null } para cada campo de la spec —
 * punto de partida tanto del formulario de alta como de cada fila
 * existente cargada en edición. */
function valoresVacios(spec: ComponenteSpec): Record<string, unknown> {
  return Object.fromEntries(spec.campos.map((c) => [c.key, c.tipo === 'booleano' ? null : '']));
}

function itemAValores(spec: ComponenteSpec, item: ComponenteItem): Record<string, unknown> {
  return Object.fromEntries(
    spec.campos.map((c) => [c.key, c.tipo === 'booleano' ? item[c.key] ?? null : (item[c.key] ?? '')])
  );
}

/** Convierte los valores del formulario (todo string en los inputs) al
 * shape que espera la API (null en vez de '', number para decimal). */
function valoresABody(spec: ComponenteSpec, valores: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const c of spec.campos) {
    const v = valores[c.key];
    if (c.tipo === 'booleano') {
      body[c.key] = v === '' || v === null || v === undefined ? null : v;
    } else if (c.tipo === 'decimal') {
      body[c.key] = v === '' || v === null || v === undefined ? null : Number(v);
    } else {
      body[c.key] = v === '' || v === null || v === undefined ? null : String(v);
    }
  }
  return body;
}

function CampoInput({
  tipo,
  value,
  disabled,
  onChange
}: {
  tipo: 'texto' | 'decimal' | 'booleano' | undefined;
  value: unknown;
  disabled?: boolean;
  onChange: (v: unknown) => void;
}) {
  if (tipo === 'booleano') {
    return (
      <select
        disabled={disabled}
        value={value === null || value === undefined ? '' : value ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
      >
        <option value="">—</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <input
      type={tipo === 'decimal' ? 'number' : 'text'}
      step={tipo === 'decimal' ? 'any' : undefined}
      disabled={disabled}
      value={(value as string | number | undefined) ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FilaComponente({
  projectId,
  spec,
  item,
  canWrite,
  canDeactivate,
  onSaved,
  onDeactivated
}: {
  projectId: string;
  spec: ComponenteSpec;
  item: ComponenteItem;
  canWrite: boolean;
  canDeactivate: boolean;
  onSaved: () => void;
  onDeactivated: () => void;
}) {
  const { devUser } = useDevUser();
  const [valores, setValores] = useState<Record<string, unknown>>(() => itemAValores(spec, item));
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await updateComponente(projectId, item.fichaTecnicaId, spec.slug, item.id, valoresABody(spec, valores), devUser.email);
      setEditando(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este componente?')) return;
    try {
      await deactivateComponente(projectId, item.fichaTecnicaId, spec.slug, item.id, devUser.email);
      onDeactivated();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  return (
    <div className="componente-fila">
      <ErrorMessage error={error} />
      <div className="componente-fila__grid">
        {spec.campos.map((c) => (
          <label key={c.key} className="form__field form__field--compact">
            <span>{c.label}</span>
            <CampoInput
              tipo={c.tipo}
              value={valores[c.key]}
              disabled={!editando || guardando}
              onChange={(v) => setValores((prev) => ({ ...prev, [c.key]: v }))}
            />
          </label>
        ))}
      </div>
      <div className="componente-fila__actions">
        {editando ? (
          <>
            <button type="button" className="button button--small" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              className="button button--small button--secondary"
              disabled={guardando}
              onClick={() => { setValores(itemAValores(spec, item)); setEditando(false); }}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button button--small button--secondary" disabled={!canWrite} onClick={() => setEditando(true)}>
              Editar
            </button>
            <button type="button" className="button button--small button--danger" disabled={!canDeactivate} onClick={eliminar}>
              Eliminar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ComponenteSection({
  projectId,
  fichaId,
  spec,
  canWrite,
  canDeactivate
}: {
  projectId: string;
  fichaId: string;
  spec: ComponenteSpec;
  canWrite: boolean;
  canDeactivate: boolean;
}) {
  const { devUser } = useDevUser();

  const fetchItems = useCallback(
    () => listComponentes(projectId, fichaId, spec.slug, devUser.email).then((r) => r.items),
    [projectId, fichaId, spec.slug, devUser.email]
  );
  const { data: items, loading, error: loadError, refresh } = useAsyncData<ComponenteItem[]>(fetchItems);

  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [nuevo, setNuevo] = useState<Record<string, unknown>>(() => valoresVacios(spec));
  const [creando, setCreando] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  const lista = items ?? [];
  const puedeAgregar = spec.cardinalidad === 'muchos' || lista.length === 0;

  async function handleCrear(event: FormEvent) {
    event.preventDefault();
    setCreando(true);
    setCreateError(null);
    try {
      await createComponente(projectId, fichaId, spec.slug, valoresABody(spec, nuevo), devUser.email);
      setNuevo(valoresVacios(spec));
      setMostrarAlta(false);
      refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="componente-section">
      <div className="componente-section__header">
        <h4>{spec.nombre} {spec.cardinalidad === 'muchos' && lista.length > 0 && <span className="page-subtitle">({lista.length})</span>}</h4>
        {canWrite && puedeAgregar && !mostrarAlta && (
          <button type="button" className="button button--small button--secondary" onClick={() => setMostrarAlta(true)}>
            + Agregar
          </button>
        )}
      </div>

      <ErrorMessage error={loadError ?? createError} />
      {loading && <p className="physical-hint">Cargando…</p>}
      {!loading && lista.length === 0 && !mostrarAlta && <p className="physical-hint">Sin datos todavía.</p>}

      {!loading && lista.map((item) => (
        <FilaComponente
          key={item.id}
          projectId={projectId}
          spec={spec}
          item={item}
          canWrite={canWrite}
          canDeactivate={canDeactivate}
          onSaved={refresh}
          onDeactivated={refresh}
        />
      ))}

      {mostrarAlta && (
        <form className="componente-fila componente-fila--nueva" onSubmit={handleCrear}>
          <div className="componente-fila__grid">
            {spec.campos.map((c) => (
              <label key={c.key} className="form__field form__field--compact">
                <span>{c.label}</span>
                <CampoInput
                  tipo={c.tipo}
                  value={nuevo[c.key]}
                  disabled={creando}
                  onChange={(v) => setNuevo((prev) => ({ ...prev, [c.key]: v }))}
                />
              </label>
            ))}
          </div>
          <div className="componente-fila__actions">
            <button type="submit" className="button button--small" disabled={creando}>
              {creando ? 'Creando…' : 'Crear'}
            </button>
            <button type="button" className="button button--small button--secondary" disabled={creando} onClick={() => setMostrarAlta(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
