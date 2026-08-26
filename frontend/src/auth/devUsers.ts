/**
 * DEV_ONLY: usuarios de desarrollo pre-sembrados por
 * database/dev/001_dev_auth_seed.sql. Se seleccionan a mano en vez de
 * autenticar de verdad — es exactamente lo que backend/src/middleware/
 * authenticate.ts espera vía el header X-Dev-User-Email mientras
 * AUTH_MODE=dev. Esto se reemplaza por completo cuando se integre
 * Microsoft Entra ID; no debe sobrevivir a esa migración.
 */
export interface DevUser {
  email: string;
  label: string;
  roleHint: string;
}

export const DEV_USERS: DevUser[] = [
  { email: 'admin@siei.local', label: 'Administrador', roleHint: 'ADMIN de sistema' },
  { email: 'editor@siei.local', label: 'Editor', roleHint: 'EDITOR en TEST-001' },
  { email: 'viewer@siei.local', label: 'Viewer', roleHint: 'VIEWER en TEST-001' }
];

export const DEFAULT_DEV_USER = DEV_USERS[0];
