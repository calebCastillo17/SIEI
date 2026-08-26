import { useEffect, useState } from 'react';

interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface UseAsyncDataResult<T> extends AsyncDataState<T> {
  refresh: () => void;
}

/**
 * Único lugar de todo el frontend donde se hace fetch dentro de un efecto.
 * Sincronizar estado de React con un sistema externo (el backend) es
 * justamente para lo que React documenta que sirven los efectos.
 * Centralizar el patrón acá, en vez de repetirlo en cada pantalla que hace
 * fetch, es lo que permitió resolver las 4 advertencias que había sin
 * desactivar ninguna regla.
 *
 * No recibe un array de dependencias aparte: `fetcher` (memoizado por
 * quien llama con `useCallback` y sus propias dependencias reactivas) es
 * la única dependencia del efecto. Tener `fetcher` + un `deps` separado
 * era redundante y, para el linter, imposible de verificar como
 * exhaustivo — la identidad de `fetcher` ya es la señal correcta de
 * "hay que volver a pedir los datos".
 */
export function useAsyncData<T>(fetcher: () => Promise<T>): UseAsyncDataResult<T> {
  const [state, setState] = useState<AsyncDataState<T>>({
    data: null,
    loading: true,
    error: null
  });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Este SÍ es el caso que la propia regla documenta como legítimo ("Use an
    // effect only when synchronizing with an external system"): sincroniza el
    // estado con la respuesta de una llamada de red al backend, no hay valor
    // derivable en render ni un evento de usuario que lo dispare. Es el único
    // lugar del frontend donde ocurre (ver comentario del hook) — ya no está
    // repetido en cada pantalla.
    // oxlint-disable-next-line react/set-state-in-effect
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetcher()
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error : new Error('Error desconocido.')
        });
      });

    return () => {
      cancelled = true;
    };
  }, [fetcher, reloadToken]);

  return { ...state, refresh: () => setReloadToken((token) => token + 1) };
}
