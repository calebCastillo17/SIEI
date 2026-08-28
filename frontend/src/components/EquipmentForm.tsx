import { useState } from 'react';
import type { FormEvent } from 'react';

import type { EquipmentInput, TipoEquipo } from '../api/types';

type TextFieldKey = Exclude<keyof EquipmentInput, 'tagEquipo' | 'tipoEquipoId'>;

interface FieldSpec {
  key: TextFieldKey;
  label: string;
  max: number;
}

/** Mismos campos y límites que valida backend/src/routes/equipment.ts.
 * Orden pedido: EQUIPO, DESCRIPCIÓN, TIPO DE EQUIPO (selector aparte, ver
 * abajo), PANEL, SISTEMA, NODO, P&ID. */
const DESCRIPCION_FIELD: FieldSpec = { key: 'descripcion', label: 'Descripción', max: 300 };
const REMAINING_FIELDS: FieldSpec[] = [
  { key: 'panel', label: 'Panel', max: 50 },
  { key: 'sistema', label: 'Sistema', max: 50 },
  { key: 'nodo', label: 'Nodo', max: 50 },
  { key: 'planoPnid', label: 'P&ID', max: 50 }
];

interface EquipmentFormProps {
  initialValue: EquipmentInput;
  tiposEquipo: TipoEquipo[];
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: EquipmentInput) => void;
  onCancel?: () => void;
}

export function EquipmentForm({
  initialValue,
  tiposEquipo,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: EquipmentFormProps) {
  const [value, setValue] = useState<EquipmentInput>(initialValue);

  function setField(key: TextFieldKey, raw: string) {
    setValue((prev) => ({ ...prev, [key]: raw.length === 0 ? null : raw }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, tagEquipo: value.tagEquipo.trim() });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label className="form__field">
        <span>EQUIPO *</span>
        <input
          type="text"
          maxLength={50}
          required
          disabled={disabled || submitting}
          value={value.tagEquipo}
          onChange={(event) => setValue((prev) => ({ ...prev, tagEquipo: event.target.value }))}
        />
      </label>

      <label className="form__field">
        <span>{DESCRIPCION_FIELD.label}</span>
        <input
          type="text"
          maxLength={DESCRIPCION_FIELD.max}
          disabled={disabled || submitting}
          value={value[DESCRIPCION_FIELD.key] ?? ''}
          onChange={(event) => setField(DESCRIPCION_FIELD.key, event.target.value)}
        />
      </label>

      <label className="form__field">
        <span>Tipo de equipo</span>
        <select
          disabled={disabled || submitting}
          value={value.tipoEquipoId ?? ''}
          onChange={(event) =>
            setValue((prev) => ({ ...prev, tipoEquipoId: event.target.value.length === 0 ? null : event.target.value }))
          }
        >
          <option value="">— Sin definir —</option>
          {tiposEquipo.map((tipo) => (
            <option key={tipo.id} value={tipo.id}>
              {tipo.nombre}
            </option>
          ))}
        </select>
      </label>

      {REMAINING_FIELDS.map((field) => (
        <label key={field.key} className="form__field">
          <span>{field.label}</span>
          <input
            type="text"
            maxLength={field.max}
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
