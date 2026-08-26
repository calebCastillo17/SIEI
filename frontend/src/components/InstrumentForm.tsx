import { useState } from 'react';
import type { FormEvent } from 'react';

import type { InstrumentInput } from '../api/types';

type FieldKey = keyof InstrumentInput;

interface FieldSpec {
  key: FieldKey;
  label: string;
  max: number;
  required?: boolean;
}

/** Mismos campos y límites que valida backend/src/routes/instruments.ts. */
const FIELDS: FieldSpec[] = [
  { key: 'tagInstrumento', label: 'TAG', max: 50, required: true },
  { key: 'pnpid', label: 'PNPID', max: 50 },
  { key: 'fuentePnpid', label: 'Fuente PNPID', max: 50 },
  { key: 'tipoInstrumento', label: 'Tipo de instrumento', max: 50 },
  { key: 'servicio', label: 'Servicio', max: 200 },
  { key: 'sistema', label: 'Sistema', max: 50 },
  { key: 'ubicacion', label: 'Ubicación', max: 100 },
  { key: 'nodo', label: 'Nodo', max: 50 },
  { key: 'descripcion', label: 'Descripción', max: 300 }
];

interface InstrumentFormProps {
  initialValue: InstrumentInput;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: InstrumentInput) => void;
  onCancel?: () => void;
}

export function InstrumentForm({
  initialValue,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: InstrumentFormProps) {
  const [value, setValue] = useState<InstrumentInput>(initialValue);

  function setField(key: FieldKey, raw: string) {
    setValue((prev) => ({ ...prev, [key]: raw.length === 0 ? null : raw }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, tagInstrumento: value.tagInstrumento.trim() });
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
