import { useState } from 'react';
import type { FormEvent } from 'react';

import type { CommLinkInput } from '../api/types';
import type { CommLinkFormOptions } from './useCommLinkFormOptions';
import { CatalogSelect } from './CatalogSelect';

type OwnerType = 'instrumento' | 'equipo';

interface CommLinkFormProps {
  initialValue: CommLinkInput;
  options: CommLinkFormOptions;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: CommLinkInput) => void;
  onCancel?: () => void;
}

/** Un enlace de comunicación vive de un puerto (dueño XOR equipo/instrumento,
 * ver CK_enlace_com_origen_xor). puertoId viene fijo en initialValue — este
 * formulario nunca lo expone como campo editable. */
export function CommLinkForm({
  initialValue,
  options,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: CommLinkFormProps) {
  const [value, setValue] = useState<CommLinkInput>(initialValue);
  const [ownerType, setOwnerType] = useState<OwnerType>(
    initialValue.equipoId ? 'equipo' : 'instrumento'
  );

  function set<K extends keyof CommLinkInput>(key: K, next: CommLinkInput[K]) {
    setValue((prev) => ({ ...prev, [key]: next }));
  }

  function setOwner(nextType: OwnerType) {
    setOwnerType(nextType);
    if (nextType === 'instrumento') {
      setValue((prev) => ({ ...prev, equipoId: null }));
    } else {
      setValue((prev) => ({ ...prev, instrumentoId: null }));
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(value);
  }

  const instrumentOptions = options.instruments.map((i) => ({
    id: i.id,
    label: i.tagInstrumento
  }));
  const equipmentOptions = options.equipment.map((e) => ({ id: e.id, label: e.tagEquipo }));

  return (
    <form className="form form--inline" onSubmit={handleSubmit}>
      <div className="form__radio-group">
        <label>
          <input
            type="radio"
            name="commLinkOwnerType"
            checked={ownerType === 'instrumento'}
            disabled={disabled || submitting}
            onChange={() => setOwner('instrumento')}
          />
          Instrumento
        </label>
        <label>
          <input
            type="radio"
            name="commLinkOwnerType"
            checked={ownerType === 'equipo'}
            disabled={disabled || submitting}
            onChange={() => setOwner('equipo')}
          />
          Equipo
        </label>
      </div>

      <label className="form__field">
        <span>{ownerType === 'instrumento' ? 'Instrumento' : 'Equipo'} *</span>
        {ownerType === 'instrumento' ? (
          <CatalogSelect
            required
            disabled={disabled || submitting}
            value={value.instrumentoId}
            onChange={(next) => set('instrumentoId', next)}
            options={instrumentOptions}
            emptyLabel="— elegir instrumento —"
          />
        ) : (
          <CatalogSelect
            required
            disabled={disabled || submitting}
            value={value.equipoId}
            onChange={(next) => set('equipoId', next)}
            options={equipmentOptions}
            emptyLabel="— elegir equipo —"
          />
        )}
      </label>

      <label className="form__field">
        <span>Tipo de comunicación</span>
        <CatalogSelect
          disabled={disabled || submitting}
          value={value.tipoComId}
          onChange={(next) => set('tipoComId', next)}
          options={options.comTypes.map((c) => ({ id: c.id, label: c.codigo }))}
        />
      </label>

      <label className="form__field">
        <span>Tipo de medio</span>
        <CatalogSelect
          disabled={disabled || submitting}
          value={value.tipoMedioId}
          onChange={(next) => set('tipoMedioId', next)}
          options={options.comMediaTypes.map((m) => ({ id: m.id, label: m.codigo }))}
        />
      </label>

      <label className="form__field">
        <span>Tag de medio</span>
        <input
          type="text"
          maxLength={50}
          disabled={disabled || submitting}
          value={value.tagMedio ?? ''}
          onChange={(event) =>
            set('tagMedio', event.target.value.length === 0 ? null : event.target.value)
          }
        />
      </label>

      <div className="form__actions">
        <button type="submit" className="button button--small" disabled={disabled || submitting}>
          {submitting ? 'Guardando…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="button button--secondary button--small"
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
