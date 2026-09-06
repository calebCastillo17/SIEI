import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';

import { useDevUser } from '../auth/DevUserContext';
import { listTagProceso, createTagProceso, deactivateTagProceso } from '../api/tagProceso';
import { useAsyncData } from '../lib/useAsyncData';
import type { TagProceso } from '../api/types';
import { ErrorMessage } from './ErrorMessage';

/**
 * nucleo.tag_proceso (migración 032) — condiciones de proceso del TAG
 * FÍSICO, no de la ficha técnica (dos tags con la misma ficha pueden
 * medir cosas distintas). Formato largo: variable + mín/nominal/máx +
 * unidad — valores como texto, no numérico, porque el dato real trae
 * placeholders como "VTS"/"TBD" además de números.
 */
export function TagProcesoSection({
  projectId,
  instrumentId,
  canWrite,
  canDeactivate
}: {
  projectId: string;
  instrumentId: string;
  canWrite: boolean;
  canDeactivate: boolean;
}) {
  const { devUser } = useDevUser();

  const fetchTagProceso = useCallback(
    () => listTagProceso(projectId, instrumentId, devUser.email).then((r) => r.tagProceso),
    [projectId, instrumentId, devUser.email]
  );
  const { data: filas, loading, error: loadError, refresh } = useAsyncData<TagProceso[]>(fetchTagProceso);

  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [variable, setVariable] = useState('');
  const [valorMin, setValorMin] = useState('');
  const [valorNominal, setValorNominal] = useState('');
  const [valorMax, setValorMax] = useState('');
  const [unidad, setUnidad] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  const lista = filas ?? [];

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createTagProceso(
        projectId,
        instrumentId,
        {
          variable: variable.trim(),
          valorMin: valorMin.trim() || null,
          valorNominal: valorNominal.trim() || null,
          valorMax: valorMax.trim() || null,
          unidad: unidad.trim() || null,
          rangoCalibradoCampo: null
        },
        devUser.email
      );
      setVariable('');
      setValorMin('');
      setValorNominal('');
      setValorMax('');
      setUnidad('');
      setMostrarAlta(false);
      refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleEliminar(id: string) {
    if (!window.confirm('¿Eliminar esta condición de proceso?')) return;
    try {
      await deactivateTagProceso(projectId, instrumentId, id, devUser.email);
      refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Condiciones de proceso</h2>
        {canWrite && !mostrarAlta && (
          <button type="button" className="button button--small button--secondary" onClick={() => setMostrarAlta(true)}>
            + Agregar
          </button>
        )}
      </div>

      <ErrorMessage error={loadError ?? createError} />
      {loading && <p className="physical-hint">Cargando…</p>}
      {!loading && lista.length === 0 && !mostrarAlta && <p className="physical-hint">Sin datos de proceso todavía.</p>}

      {mostrarAlta && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>Variable *</span>
            <input type="text" required maxLength={100} disabled={creating} value={variable} onChange={(e) => setVariable(e.target.value)} placeholder="ej. Flujo" />
          </label>
          <label className="form__field">
            <span>Mín.</span>
            <input type="text" maxLength={50} disabled={creating} value={valorMin} onChange={(e) => setValorMin(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Nominal</span>
            <input type="text" maxLength={50} disabled={creating} value={valorNominal} onChange={(e) => setValorNominal(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Máx.</span>
            <input type="text" maxLength={50} disabled={creating} value={valorMax} onChange={(e) => setValorMax(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Unidad</span>
            <input type="text" maxLength={30} disabled={creating} value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="ej. m3/h" />
          </label>
          <button type="submit" className="button button--small" disabled={creating}>{creating ? 'Agregando…' : 'Crear'}</button>
          <button type="button" className="button button--small button--secondary" disabled={creating} onClick={() => setMostrarAlta(false)}>Cancelar</button>
        </form>
      )}

      {!loading && lista.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Mín.</th>
              <th>Nominal</th>
              <th>Máx.</th>
              <th>Unidad</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id}>
                <td>{f.variable}</td>
                <td>{f.valorMin ?? '—'}</td>
                <td>{f.valorNominal ?? '—'}</td>
                <td>{f.valorMax ?? '—'}</td>
                <td>{f.unidad ?? '—'}</td>
                <td>
                  <button type="button" className="button button--small button--danger" disabled={!canDeactivate} onClick={() => handleEliminar(f.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
