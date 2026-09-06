import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listFichasTecnicas, createFichaTecnica } from '../api/fichasTecnicas';
import { listDocumentos } from '../api/documentos';
import { listFabricantes } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import type { FichaTecnica, Documento, CatalogItem } from '../api/types';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';

/**
 * Módulo Hojas de Datos — nucleo.ficha_tecnica_instrumento (migración
 * 032): la configuración técnica deduplicada que comparten varios tags
 * físicos (nucleo.instrumento). Acá se lista/crea; los componentes,
 * requisitos y marcas aceptables viven en el detalle.
 */
export function FichasTecnicasListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchFichas = useCallback(() => {
    if (!projectId) return Promise.resolve<FichaTecnica[]>([]);
    return listFichasTecnicas(projectId, devUser.email).then((r) => r.fichasTecnicas);
  }, [projectId, devUser.email]);
  const { data: fichas, loading, error: loadError, refresh: load } = useAsyncData<FichaTecnica[]>(fetchFichas);

  const fetchDocumentos = useCallback(() => {
    if (!projectId) return Promise.resolve<Documento[]>([]);
    return listDocumentos(projectId, devUser.email).then((r) => r.documentos);
  }, [projectId, devUser.email]);
  const { data: documentos } = useAsyncData<Documento[]>(fetchDocumentos);
  const documentoPorId = useMemo(() => new Map((documentos ?? []).map((d) => [d.id, d.descripcion])), [documentos]);

  const fetchFabricantes = useCallback(() => listFabricantes(devUser.email).then((r) => r.items), [devUser.email]);
  const { data: fabricantes } = useAsyncData<CatalogItem[]>(fetchFabricantes);
  const fabricantePorId = useMemo(() => new Map((fabricantes ?? []).map((f) => [f.id, f.descripcion ?? f.codigo])), [fabricantes]);

  const [filtroDocumento, setFiltroDocumento] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');

  const [documentoId, setDocumentoId] = useState<string | null>(null);
  const [fabricanteId, setFabricanteId] = useState<string | null>(null);
  const [modelo, setModelo] = useState('');
  const [codigoReferencia, setCodigoReferencia] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createFichaTecnica(
        projectId!,
        { documentoId, fabricanteId, modelo: modelo.trim() || null, codigoReferencia: codigoReferencia.trim() || null },
        devUser.email
      );
      setModelo('');
      setCodigoReferencia('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const allItems = fichas ?? [];
  const items = allItems.filter((f) => {
    if (filtroDocumento !== 'TODOS' && f.documentoId !== filtroDocumento) return false;
    if (busqueda.trim().length > 0) {
      const q = busqueda.trim().toLowerCase();
      const haystack = `${f.codigoReferencia ?? ''} ${f.modelo ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Fichas técnicas</h1>
          {project && <p className="page-subtitle">Proyecto {project.code} — {project.name} · configuraciones técnicas de instrumento (Hojas de Datos)</p>}
        </div>
        <button type="button" className="button button--secondary" onClick={load}>Actualizar</button>
      </div>

      <ErrorMessage error={error} />

      <div className="filter-bar">
        <select value={filtroDocumento} onChange={(e) => setFiltroDocumento(e.target.value)}>
          <option value="TODOS">Todos los documentos</option>
          {(documentos ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.descripcion}</option>
          ))}
        </select>
        <input type="search" placeholder="Buscar por código/modelo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      </div>

      {canWrite && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>Documento</span>
            <CatalogSelect
              value={documentoId}
              onChange={setDocumentoId}
              options={(documentos ?? []).map((d) => ({ id: d.id, label: d.descripcion }))}
            />
          </label>
          <label className="form__field">
            <span>Fabricante</span>
            <CatalogSelect
              value={fabricanteId}
              onChange={setFabricanteId}
              options={(fabricantes ?? []).map((f) => ({ id: f.id, label: f.descripcion ?? f.codigo }))}
            />
          </label>
          <label className="form__field">
            <span>Modelo</span>
            <input type="text" maxLength={100} disabled={creating} value={modelo} onChange={(e) => setModelo(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Código de referencia</span>
            <input type="text" maxLength={50} disabled={creating} value={codigoReferencia} onChange={(e) => setCodigoReferencia(e.target.value)} placeholder="opcional, ej. INS-DOC-01-01" />
          </label>
          <button type="submit" className="button" disabled={creating}>{creating ? 'Creando…' : '+ Nueva ficha técnica'}</button>
        </form>
      )}

      {loading && <p>Cargando fichas técnicas…</p>}
      {!loading && allItems.length === 0 && <p>Este proyecto todavía no tiene fichas técnicas.</p>}
      {!loading && allItems.length > 0 && items.length === 0 && <p>Ninguna coincide con los filtros.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Código de referencia</th>
              <th>Documento</th>
              <th>Fabricante</th>
              <th>Modelo</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id}>
                <td><Link to={`/projects/${projectId}/fichas-tecnicas/${f.id}`}>{f.codigoReferencia ?? `Ficha #${f.id}`}</Link></td>
                <td>{f.documentoId ? documentoPorId.get(f.documentoId) ?? '—' : '—'}</td>
                <td>{f.fabricanteId ? fabricantePorId.get(f.fabricanteId) ?? '—' : '—'}</td>
                <td>{f.modelo ?? '—'}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
