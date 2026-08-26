import { useDevUser } from '../auth/DevUserContext';
import { DEV_USERS } from '../auth/devUsers';

/**
 * DEV_ONLY — selector de identidad para desarrollo. Reemplaza al login
 * real (Microsoft Entra ID, todavía no implementado). Debe quedar
 * inconfundiblemente marcado como herramienta de desarrollo, nunca como
 * una pantalla de login real.
 */
export function DevUserSwitcher() {
  const { devUser, setDevUserEmail } = useDevUser();

  return (
    <div className="dev-user-switcher" title="Selector de usuario de desarrollo — reemplaza el login real mientras no exista Microsoft Entra ID">
      <span className="dev-user-switcher__badge">DEV</span>
      <select
        value={devUser.email}
        onChange={(event) => setDevUserEmail(event.target.value)}
        aria-label="Usuario de desarrollo activo"
      >
        {DEV_USERS.map((user) => (
          <option key={user.email} value={user.email}>
            {user.label} — {user.roleHint}
          </option>
        ))}
      </select>
    </div>
  );
}
