import { PNID_ATTENTION_CODES, pnidEstadoLabel } from './pnidLabels';

/**
 * Insignia para un código de cat.cat_estado_pnid (o el `resultado` de un
 * import). Reutiliza las clases `.badge`/`.badge--admin` ya existentes en
 * vez de introducir colores nuevos — REQUIERE_REVISION/TAG_DUPLICADO/
 * TAG_VACIO usan `.badge--admin` (el mismo tono de alerta que ya se usa en
 * el resto del frontend) porque no se aplican solos en APPLY.
 */
export function PnidEstadoBadge({ codigo }: { codigo: string | null }) {
  if (codigo === null) {
    return <span className="badge">—</span>;
  }

  const attention = PNID_ATTENTION_CODES.has(codigo);

  return (
    <span className={attention ? 'badge badge--admin' : 'badge'}>
      {pnidEstadoLabel(codigo)}
    </span>
  );
}
