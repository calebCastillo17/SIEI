import { useCallback, useState } from 'react';

import { useDevUser } from '../auth/DevUserContext';
import { useMe } from '../auth/MeContext';
import {
  createComMediaType,
  createComType,
  createInterfaceType,
  listComMediaTypes,
  listComTypes,
  listInterfaceTypes
} from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import { CatalogSection } from '../components/CatalogSection';
import type { CatalogInput, CatalogItem } from '../api/types';

interface CatalogBlockProps {
  title: string;
  devUserEmail: string;
  canWrite: boolean;
  listFn: (devUserEmail: string) => Promise<{ items: CatalogItem[] }>;
  createFn: (input: CatalogInput, devUserEmail: string) => Promise<unknown>;
}

/**
 * Un bloque de catálogo con su propio fetch y su propio estado de "creando"
 * — los 3 catálogos de esta pantalla son independientes entre sí, no
 * comparten loading/error/creating.
 */
function CatalogBlock({ title, devUserEmail, canWrite, listFn, createFn }: CatalogBlockProps) {
  const fetcher = useCallback(() => listFn(devUserEmail).then((r) => r.items), [
    listFn,
    devUserEmail
  ]);
  const { data: items, loading, error: loadError, refresh: load } = useAsyncData<CatalogItem[]>(
    fetcher
  );

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  async function handleCreate(value: CatalogInput) {
    setCreating(true);
    setCreateError(null);
    try {
      await createFn(value, devUserEmail);
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <CatalogSection
      title={title}
      items={items ?? []}
      loading={loading}
      error={createError ?? loadError}
      canWrite={canWrite}
      creating={creating}
      onCreate={handleCreate}
    />
  );
}

/**
 * Los 3 catálogos de dominio ABIERTO (sin lista cerrada confirmada en los
 * Excel de origen): admiten agregar códigos nuevos, solo es_admin_sistema.
 * Los otros 6 catálogos globales (estado de revisión, prioridad de alarma,
 * estado P&ID, clase de señal, tipo de E/S, dirección de comunicación) son
 * de lista CERRADA — ya sembrados por la migración 001, sin endpoint de
 * escritura, así que no tienen lugar en esta pantalla de administración.
 */
export function OpenCatalogsPage() {
  const { devUser } = useDevUser();
  const { me } = useMe();
  const isSystemAdmin = me?.user.esAdminSistema ?? false;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Catálogos</h1>
          <p className="page-subtitle">
            Catálogos de dominio abierto, compartidos por todos los proyectos. No admiten editar
            ni borrar un código: si ya está referenciado por datos de ingeniería, hacerlo
            rompería esa relación.
          </p>
        </div>
      </div>

      <CatalogBlock
        title="Tipos de interfaz"
        devUserEmail={devUser.email}
        canWrite={isSystemAdmin}
        listFn={listInterfaceTypes}
        createFn={createInterfaceType}
      />
      <CatalogBlock
        title="Tipos de comunicación"
        devUserEmail={devUser.email}
        canWrite={isSystemAdmin}
        listFn={listComTypes}
        createFn={createComType}
      />
      <CatalogBlock
        title="Tipos de medio de comunicación"
        devUserEmail={devUser.email}
        canWrite={isSystemAdmin}
        listFn={listComMediaTypes}
        createFn={createComMediaType}
      />
    </section>
  );
}
