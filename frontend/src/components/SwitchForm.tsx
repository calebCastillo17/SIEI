import { useState } from 'react';
import type { FormEvent } from 'react';

import type { SwitchInput } from '../api/types';

type FieldKey = keyof SwitchInput;

interface FieldSpec {
  key: FieldKey;
  label: string;
  max: number;
  required?: boolean;
}

/** Mismos campos y límites que valida backend/src/routes/switches.ts. */
const FIELDS: FieldSpec[] = [
  { key: 'tagSwitch', label: 'TAG', max: 50, required: true },
  { key: 'marcaModelo', label: 'Marca / modelo', max: 100 },
  { key: 'descripcion', label: 'Descripción', max: 300 }
];

interface SwitchFormProps {
  initialValue: SwitchInput;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: SwitchInput) => void;
  onCancel?: () => void;
}

export function SwitchForm({
  initialValue,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: SwitchFormProps) {
  const [value, setValue] = useState<SwitchInput>(initialValue);

  function setField(key: FieldKey, raw: string) {
    setValue((prev) => ({ ...prev, [key]: raw.length === 0 ? null : raw }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, tagSwitch: value.tagSwitch.trim() });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      {FIELDS.map((field) => (
        <label key={field.key} className="form__field">
          <span>
            {field.label}
            {field.required && ' *'}
          </span>
          <input
            type="text"
            maxLength={field.max}
            required={field.required}
            disabled={disabled || submitting}
            value={value[field.key] ?? ''}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        </label>
      ))}

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
