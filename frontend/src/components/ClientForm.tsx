import { useState } from 'react';
import type { FormEvent } from 'react';

import type { ClientInput } from '../api/types';

type FieldKey = keyof ClientInput;

interface FieldSpec {
  key: FieldKey;
  label: string;
  max: number;
  required?: boolean;
}

/** Mismos campos y límites que valida backend/src/routes/clients.ts. */
const FIELDS: FieldSpec[] = [
  { key: 'nombre', label: 'Nombre', max: 200, required: true },
  { key: 'codigoInterno', label: 'Código interno', max: 50 }
];

interface ClientFormProps {
  initialValue: ClientInput;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: ClientInput) => void;
  onCancel?: () => void;
}

export function ClientForm({
  initialValue,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: ClientFormProps) {
  const [value, setValue] = useState<ClientInput>(initialValue);

  function setField(key: FieldKey, raw: string) {
    setValue((prev) => ({ ...prev, [key]: raw.length === 0 ? null : raw }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, nombre: value.nombre.trim() });
  }

  return (
    <form className="form form--inline" onSubmit={handleSubmit}>
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
