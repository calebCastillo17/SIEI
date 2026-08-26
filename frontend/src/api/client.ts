/**
 * Cliente HTTP mínimo para el backend de SIEI.
 *
 * Sin librerías externas: `fetch` nativo + una excepción tipada. El
 * backend siempre responde errores como { error, message } (ver
 * backend/src/routes/*.ts), así que ApiError refleja exactamente eso.
 */

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:3000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  devUserEmail: string;
}

/**
 * DEV_ONLY: el header X-Dev-User-Email es la autenticación temporal de
 * desarrollo (ver backend/src/middleware/authenticate.ts). Cuando se
 * integre Microsoft Entra ID, este es el único lugar que hay que cambiar
 * para pasar a un token real.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User-Email': options.devUserEmail
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  let json: unknown = null;

  try {
    json = await response.json();
  } catch {
    // Respuesta sin cuerpo (no debería pasar en esta API, pero no truena).
  }

  if (!response.ok) {
    const body = (json ?? {}) as Partial<{ error: string; message: string }>;

    throw new ApiError(
      response.status,
      body.error ?? 'unknown_error',
      body.message ?? `La solicitud falló con estado ${response.status}.`
    );
  }

  return json as T;
}
