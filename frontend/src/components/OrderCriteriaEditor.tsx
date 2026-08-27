import type { CriterioOrden, OrdenCampo } from '../api/types';
import { ALL_ORDEN_CAMPOS, CAMPO_LABELS, ordenCampoLabel } from './orderCriteriaLabels';

interface OrderCriteriaEditorProps {
  value: CriterioOrden[];
  onChange: (next: CriterioOrden[]) => void;
  disabled?: boolean;
}

/** Editor reordenable de criterios de orden — sube/baja con flechas
 * (nada de drag-and-drop: mismo nivel de simplicidad que el resto de los
 * formularios de SIEI), permite cambiar ASC/DESC por criterio, quitar
 * cualquiera salvo el último (el backend exige un arreglo no vacío) y
 * agregar cualquiera de los campos válidos que todavía no esté en uso. */
export function OrderCriteriaEditor({ value, onChange, disabled }: OrderCriteriaEditorProps) {
  const usedCampos = new Set(value.map((c) => c.campo));
  const availableToAdd = ALL_ORDEN_CAMPOS.filter((campo) => !usedCampos.has(campo));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function updateDireccion(index: number, direccion: 'ASC' | 'DESC') {
    onChange(value.map((c, i) => (i === index ? { ...c, direccion } : c)));
  }

  function remove(index: number) {
    if (value.length <= 1) return;
    onChange(value.filter((_, i) => i !== index));
  }

  function add(campo: OrdenCampo) {
    onChange([...value, { campo, direccion: 'ASC' }]);
  }

  return (
    <div className="order-criteria">
      <ol className="order-criteria__list">
        {value.map((criterio, index) => (
          <li key={criterio.campo} className="order-criteria__item">
            <span className="order-criteria__position">{index + 1}</span>
            <span className="order-criteria__label">{ordenCampoLabel(criterio.campo)}</span>
            <select
              value={criterio.direccion}
              disabled={disabled}
              onChange={(event) => updateDireccion(index, event.target.value as 'ASC' | 'DESC')}
            >
              <option value="ASC">Ascendente</option>
              <option value="DESC">Descendente</option>
            </select>
            <div className="order-criteria__actions">
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Subir ${ordenCampoLabel(criterio.campo)}`}
              >
                ↑
              </button>
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={disabled || index === value.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Bajar ${ordenCampoLabel(criterio.campo)}`}
              >
                ↓
              </button>
              <button
                type="button"
                className="button button--danger button--small"
                disabled={disabled || value.length <= 1}
                title={value.length <= 1 ? 'Debe quedar al menos un criterio.' : undefined}
                onClick={() => remove(index)}
              >
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ol>

      {availableToAdd.length > 0 && (
        <label className="order-criteria__add">
          <span>+ Agregar criterio</span>
          <select
            disabled={disabled}
            defaultValue=""
            onChange={(event) => {
              const campo = event.target.value as OrdenCampo | '';
              if (campo) {
                add(campo);
                event.target.value = '';
              }
            }}
          >
            <option value="" disabled>
              Elegir campo…
            </option>
            {availableToAdd.map((campo) => (
              <option key={campo} value={campo}>
                {CAMPO_LABELS[campo]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
