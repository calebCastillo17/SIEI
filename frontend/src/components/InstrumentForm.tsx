import { useState } from 'react';
import type { FormEvent } from 'react';

import type { InstrumentInput } from '../api/types';
import type { InstrumentFormOptions } from './useInstrumentFormOptions';
import { CatalogSelect } from './CatalogSelect';
import { PNID_FIELD_LABELS } from './pnidLabels';

type TextFieldKey = Exclude<keyof InstrumentInput, 'tagInstrumento' | 'equipoAsociadoId'>;

interface FieldSpec {
  key: TextFieldKey;
  label: string;
  max: number;
}

/** Datos generales del instrumento (no vienen de un reporte P&ID). */
const GENERAL_FIELDS: FieldSpec[] = [
  { key: 'tipoInstrumento', label: 'Tipo de instrumento', max: 50 },
  { key: 'servicio', label: 'Servicio', max: 200 },
  { key: 'sistema', label: 'Sistema', max: 50 },
  { key: 'ubicacion', label: 'Ubicación', max: 100 },
  { key: 'nodo', label: 'Nodo', max: 50 },
  { key: 'descripcion', label: 'Descripción', max: 300 }
];

/**
 * Contenido que la importación P&ID también sincroniza (ver
 * MAPPED_FIELD_COLUMNS en backend/src/routes/pnidImports.ts) pero que acá
 * se edita a mano — a diferencia de pnpid/fuentePnpid/estadoPnidId, que el
 * backend rechaza si siquiera vienen en el body (ver instruments.ts) y por
 * eso NO aparecen en este formulario, solo en el detalle de solo lectura.
 * Los límites (`max`) son los mismos que valida el backend.
 */
const PNID_CONTENT_FIELDS: FieldSpec[] = [
  { key: 'tagAnterior', label: PNID_FIELD_LABELS.tagAnterior, max: 50 },
  { key: 'tecnologia', label: PNID_FIELD_LABELS.tecnologia, max: 100 },
  { key: 'funcionamiento', label: PNID_FIELD_LABELS.funcionamiento, max: 50 },
  { key: 'cuerpoInstrumento', label: PNID_FIELD_LABELS.cuerpoInstrumento, max: 50 },
  { key: 'conexionProceso', label: PNID_FIELD_LABELS.conexionProceso, max: 100 },
  { key: 'planoPnid', label: PNID_FIELD_LABELS.planoPnid, max: 30 },
  { key: 'lineaPnid', label: PNID_FIELD_LABELS.lineaPnid, max: 100 },
  { key: 'tipoSenalPnid', label: PNID_FIELD_LABELS.tipoSenalPnid, max: 50 },
  { key: 'equipoAsociadoTag', label: 'Equipo asociado (tag libre)', max: 50 }
];

interface InstrumentFormProps {
  initialValue: InstrumentInput;
  options: InstrumentFormOptions;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: InstrumentInput) => void;
  onCancel?: () => void;
}

export function InstrumentForm({
  initialValue,
  options,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: InstrumentFormProps) {
  const [value, setValue] = useState<InstrumentInput>(initialValue);

  function setField(key: TextFieldKey, raw: string) {
    setValue((prev) => ({ ...prev, [key]: raw.length === 0 ? null : raw }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...value, tagInstrumento: value.tagInstrumento.trim() });
  }

  const equipmentOptions = options.equipment.map((e) => ({ id: e.id, label: e.tagEquipo }));

  return (
    <form className="form form--wide" onSubmit={handleSubmit}>
      <fieldset className="form__section">
        <legend>Identificación</legend>

        <label className="form__field">
          <span>TAG *</span>
          <input
            type="text"
            maxLength={50}
            required
            disabled={disabled || submitting}
            value={value.tagInstrumento}
            onChange={(event) =>
              setValue((prev) => ({ ...prev, tagInstrumento: event.target.value }))
            }
          />
        </label>

        {GENERAL_FIELDS.map((field) => (
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
      </fieldset>

      <fieldset className="form__section">
        <legend>Datos de origen P&amp;ID (editables)</legend>

        <label className="form__field">
          <span>Equipo asociado</span>
          <CatalogSelect
            disabled={disabled || submitting}
            value={value.equipoAsociadoId}
            onChange={(next) => setValue((prev) => ({ ...prev, equipoAsociadoId: next }))}
            options={equipmentOptions}
          />
        </label>

        {PNID_CONTENT_FIELDS.map((field) => (
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
        <p className="form__field form__field--wide form__note">
          "Equipo asociado" (el selector) y "Equipo asociado (tag libre)" son
          dos campos independientes en la base — el import P&amp;ID los
          sincroniza automáticamente, pero este formulario no lo hace.
        </p>
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
