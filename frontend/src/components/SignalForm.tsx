import { useState } from 'react';
import type { FormEvent } from 'react';

import type { SignalInput } from '../api/types';
import type { SignalFormOptions } from './useSignalFormOptions';
import { CatalogSelect } from './CatalogSelect';

type OwnerType = 'instrumento' | 'equipo';

const TEXT_FIELDS: Array<{ key: keyof SignalInput; label: string; max: number }> = [
  { key: 'nombreCorto', label: 'Nombre corto', max: 30 },
  { key: 'valorNormal', label: 'Valor normal', max: 50 },
  { key: 'unidadIngenieria', label: 'Unidad de ingeniería', max: 20 },
  { key: 'retardo', label: 'Retardo', max: 50 }
];

const LONG_TEXT_FIELDS: Array<{ key: keyof SignalInput; label: string; max: number }> = [
  { key: 'descripcion', label: 'Descripción', max: 300 },
  { key: 'enclavamiento', label: 'Enclavamiento', max: 300 },
  { key: 'observacion', label: 'Observación', max: 500 }
];

const NUMBER_FIELDS: Array<{ key: keyof SignalInput; label: string }> = [
  { key: 'rangoMin', label: 'Rango mín.' },
  { key: 'rangoMax', label: 'Rango máx.' },
  { key: 'alarmaHh', label: 'Alarma HH' },
  { key: 'alarmaH', label: 'Alarma H' },
  { key: 'alarmaL', label: 'Alarma L' },
  { key: 'alarmaLl', label: 'Alarma LL' }
];

interface SignalFormProps {
  initialValue: SignalInput;
  options: SignalFormOptions;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: SignalInput) => void;
  onCancel?: () => void;
}

export function SignalForm({
  initialValue,
  options,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: SignalFormProps) {
  const [value, setValue] = useState<SignalInput>(initialValue);
  const [ownerType, setOwnerType] = useState<OwnerType>(
    initialValue.equipoId ? 'equipo' : 'instrumento'
  );

  const claseCodigo = options.signalClasses.find((c) => c.id === value.claseSenalId)?.codigo;
  const isControl = claseCodigo === 'CONTROL';
  const isCom = claseCodigo === 'COM';

  function set<K extends keyof SignalInput>(key: K, next: SignalInput[K]) {
    setValue((prev) => ({ ...prev, [key]: next }));
  }

  function setOwner(nextType: OwnerType) {
    setOwnerType(nextType);
    // Cambiar de tipo de dueño limpia el otro campo — la base exige XOR
    // (instrumentoId, equipoId), no pueden convivir los dos con valor.
    if (nextType === 'instrumento') {
      setValue((prev) => ({ ...prev, equipoId: null }));
    } else {
      setValue((prev) => ({ ...prev, instrumentoId: null }));
    }
  }

  function setText(key: keyof SignalInput, raw: string) {
    set(key, (raw.length === 0 ? null : raw) as SignalInput[typeof key]);
  }

  function setNumber(key: keyof SignalInput, raw: string) {
    set(key, (raw.length === 0 ? null : Number(raw)) as SignalInput[typeof key]);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, tagSenal: value.tagSenal.trim() });
  }

  const instrumentOptions = options.instruments.map((i) => ({
    id: i.id,
    label: i.tagInstrumento
  }));
  const equipmentOptions = options.equipment.map((e) => ({ id: e.id, label: e.tagEquipo }));

  return (
    <form className="form form--wide" onSubmit={handleSubmit}>
      <fieldset className="form__section">
        <legend>Identificación</legend>

        <label className="form__field">
          <span>TAG *</span>
          <input
            type="text"
            maxLength={80}
            required
            disabled={disabled || submitting}
            value={value.tagSenal}
            onChange={(event) => setText('tagSenal', event.target.value)}
          />
        </label>

        <label className="form__field">
          <span>Clase de señal *</span>
          <CatalogSelect
            required
            disabled={disabled || submitting}
            value={value.claseSenalId || null}
            onChange={(next) => set('claseSenalId', next ?? '')}
            options={options.signalClasses.map((c) => ({ id: c.id, label: c.codigo }))}
            emptyLabel="— elegir —"
          />
        </label>
      </fieldset>

      <fieldset className="form__section">
        <legend>Dueño *</legend>

        <div className="form__radio-group">
          <label>
            <input
              type="radio"
              name="ownerType"
              checked={ownerType === 'instrumento'}
              disabled={disabled || submitting}
              onChange={() => setOwner('instrumento')}
            />
            Instrumento
          </label>
          <label>
            <input
              type="radio"
              name="ownerType"
              checked={ownerType === 'equipo'}
              disabled={disabled || submitting}
              onChange={() => setOwner('equipo')}
            />
            Equipo
          </label>
        </div>

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

        <label className="form__field">
          <span>Instrumento agrupador</span>
          <CatalogSelect
            disabled={disabled || submitting}
            value={value.instrumentoAgrupadorId}
            onChange={(next) => set('instrumentoAgrupadorId', next)}
            options={instrumentOptions}
          />
        </label>
      </fieldset>

      {isControl && (
        <fieldset className="form__section">
          <legend>CONTROL</legend>

          <label className="form__field">
            <span>Tipo de E/S</span>
            <CatalogSelect
              disabled={disabled || submitting}
              value={value.tipoIoId}
              onChange={(next) => set('tipoIoId', next)}
              options={options.ioTypes.map((t) => ({ id: t.id, label: t.codigo }))}
            />
          </label>

          <label className="form__field">
            <span>Canal (id)</span>
            <input
              type="number"
              disabled={disabled || submitting}
              value={value.canalId ?? ''}
              onChange={(event) => setText('canalId', event.target.value)}
            />
          </label>
        </fieldset>
      )}

      {isCom && (
        <fieldset className="form__section">
          <legend>COM</legend>

          <label className="form__field">
            <span>Dirección</span>
            <CatalogSelect
              disabled={disabled || submitting}
              value={value.direccionComId}
              onChange={(next) => set('direccionComId', next)}
              options={options.comDirections.map((d) => ({ id: d.id, label: d.codigo }))}
            />
          </label>
        </fieldset>
      )}

      <fieldset className="form__section">
        <legend>Ingeniería</legend>

        <label className="form__field">
          <span>Estado de revisión</span>
          <CatalogSelect
            disabled={disabled || submitting}
            value={value.estadoRevisionId}
            onChange={(next) => set('estadoRevisionId', next)}
            options={options.revisionStates.map((s) => ({ id: s.id, label: s.codigo }))}
          />
        </label>

        <label className="form__field">
          <span>Prioridad de alarma</span>
          <CatalogSelect
            disabled={disabled || submitting}
            value={value.prioridadAlarmaId}
            onChange={(next) => set('prioridadAlarmaId', next)}
            options={options.alarmPriorities.map((p) => ({ id: p.id, label: p.codigo }))}
          />
        </label>

        <label className="form__field">
          <span>Tipo de interfaz</span>
          <CatalogSelect
            disabled={disabled || submitting}
            value={value.tipoInterfazId}
            onChange={(next) => set('tipoInterfazId', next)}
            options={options.interfaceTypes.map((t) => ({ id: t.id, label: t.codigo }))}
            emptyLabel={options.interfaceTypes.length === 0 ? '— catálogo vacío —' : '—'}
          />
        </label>

        {NUMBER_FIELDS.map((field) => (
          <label key={field.key} className="form__field">
            <span>{field.label}</span>
            <input
              type="number"
              step="any"
              disabled={disabled || submitting}
              value={(value[field.key] as number | null) ?? ''}
              onChange={(event) => setNumber(field.key, event.target.value)}
            />
          </label>
        ))}

        {TEXT_FIELDS.map((field) => (
          <label key={field.key} className="form__field">
            <span>{field.label}</span>
            <input
              type="text"
              maxLength={field.max}
              disabled={disabled || submitting}
              value={(value[field.key] as string | null) ?? ''}
              onChange={(event) => setText(field.key, event.target.value)}
            />
          </label>
        ))}

        {LONG_TEXT_FIELDS.map((field) => (
          <label key={field.key} className="form__field form__field--wide">
            <span>{field.label}</span>
            <textarea
              maxLength={field.max}
              disabled={disabled || submitting}
              value={(value[field.key] as string | null) ?? ''}
              onChange={(event) => setText(field.key, event.target.value)}
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
