import { useState } from 'react';
import type { FormEvent } from 'react';

import type { CatalogInput, CatalogItem } from '../api/types';
import { ErrorMessage } from './ErrorMessage';

interface CatalogSectionProps {
  title: string;
  items: CatalogItem[];
  loading: boolean;
  error: unknown;
  canWrite: boolean;
  creating: boolean;
  onCreate: (value: CatalogInput) => void;
}

/**
 * Un catálogo de dominio ABIERTO (interface-types/com-types/com-media-types):
 * admite crear código nuevo (solo es_admin_sistema), pero nunca editar ni
 * borrar — el backend no lo expone (ver simpleCatalogRouter.ts: sin
 * `activo` para desactivar, y un código ya referenciado por filas de
 * `nucleo` rompería FKs existentes sin ganar nada).
 */
export function CatalogSection({
  title,
  items,
  loading,
  error,
  canWrite,
  creating,
  onCreate
}: CatalogSectionProps) {
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      codigo: codigo.trim(),
      descripcion: descripcion.trim().length > 0 ? descripcion.trim() : null
    });
    setCodigo('');
    setDescripcion('');
  }

  return (
    <section className="catalog-section">
      <h2>{title}</h2>

      <ErrorMessage error={error} />

      {canWrite && (
        <form className="form form--inline" onSubmit={handleSubmit}>
          <label className="form__field">
            <span>Código *</span>
            <input
              type="text"
              maxLength={30}
              required
              disabled={creating}
              value={codigo}
              onChange={(event) => setCodigo(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Descripción</span>
            <input
              type="text"
              maxLength={200}
              disabled={creating}
              value={descripcion}
              onChange={(event) => setDescripcion(event.target.value)}
            />
          </label>
          <button type="submit" className="button button--small" disabled={creating}>
            {creating ? 'Creando…' : '+ Agregar código'}
          </button>
        </form>
      )}

      {loading && <p>Cargando…</p>}

      {!loading && items.length === 0 && <p className="physical-hint">Todavía no hay códigos.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.codigo}</td>
                <td>{item.descripcion ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
