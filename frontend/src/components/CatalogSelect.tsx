interface Option {
  id: string;
  label: string;
}

interface CatalogSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: Option[];
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * <select> genérico para IDs de catálogo/entidad. Si el valor actual no
 * está entre las opciones activas (por ejemplo, editando una señal cuyo
 * instrumento dueño ya se desactivó y por eso no aparece en la lista de
 * instrumentos activos), se agrega como opción sintética en vez de
 * perderlo silenciosamente — el usuario ve que hay un valor "no listado"
 * en lugar de que el formulario le cambie el dueño sin que lo haya tocado.
 */
export function CatalogSelect({
  value,
  onChange,
  options,
  emptyLabel = '—',
  disabled,
  required
}: CatalogSelectProps) {
  const hasCurrent = value === null || options.some((option) => option.id === value);

  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      required={required}
      onChange={(event) => onChange(event.target.value.length === 0 ? null : event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {!hasCurrent && value !== null && (
        <option value={value}>Id {value} (no está activo/en la lista)</option>
      )}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
