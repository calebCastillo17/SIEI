import { apiFetch } from './client';
import type { CatalogInput, CatalogItemMutationResponse, CatalogListResponse } from './types';

/**
 * Los 9 catálogos globales expuestos por backend/src/lib/simpleCatalogRouter.ts
 * comparten la misma forma { items: [{id, codigo, descripcion, ...}] } — un
 * solo fetcher genérico alcanza para todos, no hace falta uno por catálogo.
 */
function listCatalog(path: string, devUserEmail: string): Promise<CatalogListResponse> {
  return apiFetch<CatalogListResponse>(path, { devUserEmail });
}

/** Solo los 3 catálogos de dominio ABIERTO admiten POST, y solo
 * es_admin_sistema (ver simpleCatalogRouter.ts, `writable: true`). */
function createCatalogItem(
  path: string,
  input: CatalogInput,
  devUserEmail: string
): Promise<CatalogItemMutationResponse> {
  return apiFetch<CatalogItemMutationResponse>(path, {
    method: 'POST',
    body: input,
    devUserEmail
  });
}

export const listSignalClasses = (devUserEmail: string) =>
  listCatalog('/api/catalogs/signal-classes', devUserEmail);

export const listIoTypes = (devUserEmail: string) =>
  listCatalog('/api/catalogs/io-types', devUserEmail);

export const listComDirections = (devUserEmail: string) =>
  listCatalog('/api/catalogs/com-directions', devUserEmail);

export const listRevisionStates = (devUserEmail: string) =>
  listCatalog('/api/catalogs/revision-states', devUserEmail);

export const listAlarmPriorities = (devUserEmail: string) =>
  listCatalog('/api/catalogs/alarm-priorities', devUserEmail);

export const listInterfaceTypes = (devUserEmail: string) =>
  listCatalog('/api/catalogs/interface-types', devUserEmail);

export const listComTypes = (devUserEmail: string) =>
  listCatalog('/api/catalogs/com-types', devUserEmail);

export const listComMediaTypes = (devUserEmail: string) =>
  listCatalog('/api/catalogs/com-media-types', devUserEmail);

export const createInterfaceType = (input: CatalogInput, devUserEmail: string) =>
  createCatalogItem('/api/catalogs/interface-types', input, devUserEmail);

export const createComType = (input: CatalogInput, devUserEmail: string) =>
  createCatalogItem('/api/catalogs/com-types', input, devUserEmail);

export const createComMediaType = (input: CatalogInput, devUserEmail: string) =>
  createCatalogItem('/api/catalogs/com-media-types', input, devUserEmail);
