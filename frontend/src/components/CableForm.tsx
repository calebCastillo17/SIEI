import { useState } from 'react';
import type { FormEvent } from 'react';

import type { CableInput } from '../api/types';

interface CableFormProps {
  initialValue: CableInput;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: CableInput) => void;
  onCancel?: () => void;
}

/** Mismos campos y límites que valida backend/src/routes/cables.ts. */
export function CableForm({
  initialValue,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: CableFormProps) {
  const [value, setValue] = useState<CableInput>(initialValue);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, tagCable: value.tagCable.trim() });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label className="form__field">
        <span>TAG *</span>
        <input
          type="text"
          maxLength={50}
          required
          disabled={disabled || submitting}
          value={value.tagCable}
          onChange={(event) => setValue((prev) => ({ ...prev, tagCable: event.target.value }))}
        />
      </label>

      <label className="form__field">
        <span>Tipo de cable</span>
        <input
          type="text"
          maxLength={100}
          disabled={disabled || submitting}
          value={value.tipoCable ?? ''}
          onChange={(event) =>
            setValue((prev) => ({
              ...prev,
              tipoCable: event.target.value.length === 0 ? null : event.target.value
            }))
          }
        />
      </label>

      <label className="form__field">
        <span>Capacidad de conductores *</span>
        <input
          type="number"
          min={1}
          max={32767}
          required
          disabled={disabled || submitting}
          value={value.capacidadConductores}
          onChange={(event) =>
            setValue((prev) => ({ ...prev, capacidadConductores: Number(event.target.value) }))
          }
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
