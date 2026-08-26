import { useState } from 'react';
import type { FormEvent } from 'react';

import type { UserInput } from '../api/types';

interface UserFormProps {
  initialValue: UserInput;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (value: UserInput) => void;
  onCancel?: () => void;
}

/** Mismos campos que valida backend/src/routes/users.ts — nunca
 * esAdminSistema/authIssuer/authSubject, ese privilegio no se administra
 * desde acá (CLAUDE.md, "Security model"). */
export function UserForm({
  initialValue,
  submitLabel,
  submitting,
  disabled = false,
  onSubmit,
  onCancel
}: UserFormProps) {
  const [value, setValue] = useState<UserInput>(initialValue);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ email: value.email.trim(), nombre: value.nombre.trim() });
  }

  return (
    <form className="form form--inline" onSubmit={handleSubmit}>
      <label className="form__field">
        <span>Email *</span>
        <input
          type="email"
          maxLength={320}
          required
          disabled={disabled || submitting}
          value={value.email}
          onChange={(event) => setValue((prev) => ({ ...prev, email: event.target.value }))}
        />
      </label>

      <label className="form__field">
        <span>Nombre *</span>
        <input
          type="text"
          maxLength={200}
          required
          disabled={disabled || submitting}
          value={value.nombre}
          onChange={(event) => setValue((prev) => ({ ...prev, nombre: event.target.value }))}
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
