import { useState } from 'react';
import type { FormEvent } from 'react';

import type { CableInput, CatalogItem } from '../api/types';
import { CatalogSelect } from './CatalogSelect';

/** Mismo patrón que TriStateSelect en SignalForm.tsx — apantallado es
 * BIT NULL (no definido / sí / no), no un booleano de 2 estados. */
function TriStateSelect({
  value,
  onChange,
  disabled
}: {
  value: boolean | null;
  onChange: (next: boolean | null) => void;
  disabled?: boolean;
}) {
  return (
    <select
      disabled={disabled}
      value={value === null ? '' : value ? 'true' : 'false'}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(raw === '' ? null : raw === 'true');
      }}
    >
      <option value="">No definido</option>
      <option value="true">Sí</option>
      <option value="false">No</option>
    </select>
  );
}

interface CableFormProps {
  initialValue: CableInput;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  /** cat.cat_tipo_construccion_cable (migración 029) — CONDUCTORES/PARES/
   * TRIADAS. */
  tiposConstruccion: CatalogItem[];
  onSubmit: (value: CableInput) => void;
  onCancel?: () => void;
}

/** Mismos campos y límites que valida backend/src/routes/cables.ts. */
export function CableForm({
  initialValue,
  submitLabel,
  submitting,
  disabled = false,
  tiposConstruccion,
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

      <fieldset className="form__section">
        <legend>Clasificación de construcción (migración 029)</legend>

        <label className="form__field">
          <span>Tipo de construcción</span>
          <CatalogSelect
            disabled={disabled || submitting}
            value={value.tipoConstruccionId}
            onChange={(next) => setValue((prev) => ({ ...prev, tipoConstruccionId: next }))}
            options={tiposConstruccion.map((t) => ({ id: t.id, label: t.descripcion ?? t.codigo }))}
          />
        </label>

        <label className="form__field">
          <span>Cantidad de unidades</span>
          <input
            type="number"
            min={1}
            max={32767}
            disabled={disabled || submitting}
            value={value.cantidadUnidades ?? ''}
            onChange={(event) =>
              setValue((prev) => ({
                ...prev,
                cantidadUnidades: event.target.value.length === 0 ? null : Number(event.target.value)
              }))
            }
          />
        </label>

        <label className="form__field">
          <span>Calibre</span>
          <input
            type="text"
            maxLength={20}
            disabled={disabled || submitting}
            value={value.calibre ?? ''}
            onChange={(event) =>
              setValue((prev) => ({
                ...prev,
                calibre: event.target.value.length === 0 ? null : event.target.value
              }))
            }
          />
        </label>

        <label className="form__field">
          <span>Apantallado</span>
          <TriStateSelect
            disabled={disabled || submitting}
            value={value.apantallado}
            onChange={(next) => setValue((prev) => ({ ...prev, apantallado: next }))}
          />
        </label>
      </fieldset>

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
