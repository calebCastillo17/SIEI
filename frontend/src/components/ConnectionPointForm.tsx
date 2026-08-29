import { useState } from 'react';
import type { FormEvent } from 'react';

import type { ConnectionPointInput, ConnectionPointOwnerField } from '../api/types';
import type { ConnectionPointFormOptions } from './useConnectionPointFormOptions';
import { CatalogSelect } from './CatalogSelect';

type OwnerType = 'instrumento' | 'equipo' | 'caja' | 'gabinete' | 'modulo';

const OWNER_FIELD: Record<OwnerType, ConnectionPointOwnerField> = {
  instrumento: 'instrumentoId',
  equipo: 'equipoId',
  caja: 'cajaId',
  gabinete: 'gabineteId',
  modulo: 'moduloId'
};

const OWNER_LABEL: Record<OwnerType, string> = {
  instrumento: 'Instrumento',
  equipo: 'Equipo',
  caja: 'Caja',
  gabinete: 'Gabinete',
  modulo: 'Módulo'
};

const DESCRIPTIVE_FIELDS: Array<{ key: keyof ConnectionPointInput; label: string; max: number }> = [
  { key: 'regleta', label: 'Regleta', max: 30 },
  { key: 'bornera', label: 'Bornera', max: 30 },
  { key: 'borne', label: 'Borne', max: 30 },
  { key: 'lado', label: 'Lado', max: 20 },
  { key: 'circuito', label: 'Circuito', max: 30 },
  { key: 'hilo', label: 'Hilo', max: 30 },
  { key: 'descripcion', label: 'Descripción', max: 200 }
];

function initialOwnerType(value: ConnectionPointInput): OwnerType {
  const entry = (Object.entries(OWNER_FIELD) as Array<[OwnerType, ConnectionPointOwnerField]>).find(
    ([, field]) => value[field] !== null
  );
  return entry ? entry[0] : 'instrumento';
}

interface ConnectionPointFormProps {
  initialValue: ConnectionPointInput;
  options: ConnectionPointFormOptions;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: ConnectionPointInput) => void;
  onCancel?: () => void;
}

/** Exactamente uno de los 5 campos de dueño puede tener valor (XOR, ver
 * CK_punto_conexion_dueno_xor). Solo se usa para crear: el backend no
 * permite reasignar el dueño en PATCH. */
export function ConnectionPointForm({
  initialValue,
  options,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: ConnectionPointFormProps) {
  const [value, setValue] = useState<ConnectionPointInput>(initialValue);
  const [ownerType, setOwnerType] = useState<OwnerType>(initialOwnerType(initialValue));

  function set<K extends keyof ConnectionPointInput>(key: K, next: ConnectionPointInput[K]) {
    setValue((prev) => ({ ...prev, [key]: next }));
  }

  function setOwner(nextType: OwnerType) {
    setOwnerType(nextType);
    setValue((prev) => {
      const cleared: ConnectionPointInput = { ...prev };
      for (const field of Object.values(OWNER_FIELD)) {
        cleared[field] = null;
      }
      return cleared;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(value);
  }

  const ownerOptionsByType: Record<OwnerType, Array<{ id: string; label: string }>> = {
    instrumento: options.instruments.map((i) => ({ id: i.id, label: i.tagInstrumento })),
    equipo: options.equipment.map((e) => ({ id: e.id, label: e.tagEquipo })),
    caja: options.boxes.map((b) => ({ id: b.id, label: b.tagCaja })),
    gabinete: options.gabinetes.map((g) => ({ id: g.id, label: g.tagGabinete })),
    modulo: options.modules.map((m) => ({ id: m.id, label: `${m.fabricante} ${m.modelo}` }))
  };

  const ownerField = OWNER_FIELD[ownerType];

  return (
    <form className="form form--wide" onSubmit={handleSubmit}>
      <fieldset className="form__section">
        <legend>Dueño *</legend>

        <div className="form__radio-group">
          {(Object.keys(OWNER_FIELD) as OwnerType[]).map((type) => (
            <label key={type}>
              <input
                type="radio"
                name="connectionPointOwnerType"
                checked={ownerType === type}
                disabled={disabled || submitting}
                onChange={() => setOwner(type)}
              />
              {OWNER_LABEL[type]}
            </label>
          ))}
        </div>

        <CatalogSelect
          required
          disabled={disabled || submitting}
          value={value[ownerField]}
          onChange={(next) => set(ownerField, next)}
          options={ownerOptionsByType[ownerType]}
          emptyLabel={`— elegir ${OWNER_LABEL[ownerType].toLowerCase()} —`}
        />
      </fieldset>

      <fieldset className="form__section">
        <legend>Ubicación física</legend>

        {DESCRIPTIVE_FIELDS.map((field) => (
          <label key={field.key} className="form__field">
            <span>{field.label}</span>
            <input
              type="text"
              maxLength={field.max}
              disabled={disabled || submitting}
              value={(value[field.key] as string | null) ?? ''}
              onChange={(event) =>
                set(field.key, (event.target.value.length === 0 ? null : event.target.value) as ConnectionPointInput[typeof field.key])
              }
            />
          </label>
        ))}
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
