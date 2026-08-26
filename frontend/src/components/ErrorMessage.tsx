import { ApiError } from '../api/client';

/**
 * Traduce un error de la API a una etiqueta corta + el mensaje real del
 * backend (que ya viene en español y es específico — no hace falta
 * reinventarlo, solo darle contexto de qué tipo de error es).
 */
function statusLabel(status: number): string {
  switch (status) {
    case 400:
      return 'Datos inválidos';
    case 401:
      return 'Sesión no reconocida';
    case 403:
      return 'Sin permiso';
    case 404:
      return 'No encontrado';
    case 409:
      return 'Conflicto';
    default:
      return status >= 500 ? 'Error del servidor' : 'Error';
  }
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;

  if (error instanceof ApiError) {
    return (
      <div className="error-message" role="alert">
        <strong>{statusLabel(error.status)}:</strong> {error.message}
      </div>
    );
  }

  const message = error instanceof Error ? error.message : 'Error desconocido.';

  return (
    <div className="error-message" role="alert">
      <strong>Error:</strong> {message}
    </div>
  );
}
