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

/** cat.cat_tipo_dato_com (migración 013) — lista cerrada (BIT/WORD/DWORD/
 * UINT/UDINT/DINT/REAL), exclusiva de señales COM. */
export const listComDataTypes = (devUserEmail: string) =>
  listCatalog('/api/catalogs/com-data-types', devUserEmail);

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

/** cat.cat_estado_pnid — usado para mostrar el estado P&ID de un
 * instrumento (Instrument.estadoPnidId es un id crudo; acá se resuelve a
 * su código legible, ver PnidEstadoBadge). Es de lista cerrada (`writable:
 * false`), igual que la mayoría de los otros 8 catálogos de este archivo. */
export const listPnidStates = (devUserEmail: string) =>
  listCatalog('/api/catalogs/pnid-states', devUserEmail);

export const createInterfaceType = (input: CatalogInput, devUserEmail: string) =>
  createCatalogItem('/api/catalogs/interface-types', input, devUserEmail);

export const createComType = (input: CatalogInput, devUserEmail: string) =>
  createCatalogItem('/api/catalogs/com-types', input, devUserEmail);

export const createComMediaType = (input: CatalogInput, devUserEmail: string) =>
  createCatalogItem('/api/catalogs/com-media-types', input, devUserEmail);
