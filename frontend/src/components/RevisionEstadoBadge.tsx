import type { RevisionEstado } from '../api/types';

const LABELS: Record<RevisionEstado, string> = {
  BORRADOR: 'Borrador',
  EMITIDA: 'Emitida',
  DESCARTADA: 'Descartada'
};

/** Insignia de estado de una revisión de entregable — reutiliza las
 * clases `.badge*` existentes en vez de introducir colores nuevos:
 * BORRADOR (en preparación, aún editable) usa el tono neutro `--com`,
 * EMITIDA (definitivo, congelado) usa el tono de acento `--control`,
 * DESCARTADA (final pero sin efecto) usa el tono de alerta `--admin`. */
export function RevisionEstadoBadge({ estado }: { estado: RevisionEstado }) {
  const className =
    estado === 'EMITIDA'
      ? 'badge badge--control'
      : estado === 'DESCARTADA'
        ? 'badge badge--admin'
        : 'badge badge--com';

  return <span className={className}>{LABELS[estado] ?? estado}</span>;
}
