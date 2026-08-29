import { useState } from 'react';
import type { FormEvent } from 'react';

import type { PlanoInput } from '../api/types';
import type { PlanoFormOptions } from './usePlanoFormOptions';
import { CatalogSelect } from './CatalogSelect';

interface PlanoFormProps {
  initialValue: PlanoInput;
  options: PlanoFormOptions;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: PlanoInput) => void;
  onCancel?: () => void;
}

/**
 * Solo los 4 campos propios del plano (código, código anterior,
 * descripción, tipo) — las asociaciones a gabinete/caja son N:M reales,
 * se gestionan aparte en PlanoDetailPage, nunca en este formulario (UX
 * opción B, ver docs/DIAGNOSTICO_SENALES_GABINETES.md sección 35.22).
 */
export function PlanoForm({
  initialValue,
  options,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: PlanoFormProps) {
  const [value, setValue] = useState<PlanoInput>(initialValue);

  function set<K extends keyof PlanoInput>(key: K, next: PlanoInput[K]) {
    setValue((prev) => ({ ...prev, [key]: next }));
  }

  function setText(key: 'codigoPlano' | 'codigoAnterior', raw: string) {
    set(key, raw.length === 0 ? null : raw);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, descripcion: value.descripcion.trim() });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label className="form__field">
        <span>Código</span>
        <input
          type="text"
          maxLength={50}
          disabled={disabled || submitting}
          value={value.codigoPlano ?? ''}
          onChange={(event) => setText('codigoPlano', event.target.value)}
        />
      </label>

      <label className="form__field">
        <span>Descripción *</span>
        <input
          type="text"
          maxLength={300}
          required
          disabled={disabled || submitting}
          value={value.descripcion}
          onChange={(event) => set('descripcion', event.target.value)}
        />
      </label>

      <label className="form__field">
        <span>Tipo *</span>
        <CatalogSelect
          required
          disabled={disabled || submitting}
          value={value.tipoPlanoId || null}
          onChange={(next) => set('tipoPlanoId', next ?? '')}
          options={options.tiposPlano.map((t) => ({ id: t.id, label: t.codigo }))}
          emptyLabel="— elegir —"
        />
      </label>

      <label className="form__field">
        <span>Código anterior</span>
        <input
          type="text"
          maxLength={50}
          disabled={disabled || submitting}
          value={value.codigoAnterior ?? ''}
          onChange={(event) => setText('codigoAnterior', event.target.value)}
        />
      </label>

      <div className="form__actions">
        <button type="submit" className="button" disabled={disabled || submitting}>
          {submitting ? 'Guardando…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="button button--secondary"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
