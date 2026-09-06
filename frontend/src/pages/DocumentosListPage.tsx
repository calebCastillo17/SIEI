import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listDocumentos, createDocumento } from '../api/documentos';
import { listTiposDocumento } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import type { Documento, CatalogItem } from '../api/types';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';

/**
 * Módulo Hojas de Datos — nucleo.documento (migración 031). Mismo
 * espíritu que nucleo.plano: contenido externo (una Hoja de Datos real
 * ya emitida) que SIEI cataloga, no genera.
 */
export function DocumentosListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchDocumentos = useCallback(() => {
    if (!projectId) return Promise.resolve<Documento[]>([]);
    return listDocumentos(projectId, devUser.email).then((r) => r.documentos);
  }, [projectId, devUser.email]);
  const { data: documentos, loading, error: loadError, refresh: load } = useAsyncData<Documento[]>(fetchDocumentos);

  const fetchTipos = useCallback(
    () => listTiposDocumento(devUser.email).then((r) => r.items),
    [devUser.email]
  );
  const { data: tipos } = useAsyncData<CatalogItem[]>(fetchTipos);
  const tipoPorId = new Map((tipos ?? []).map((t) => [t.id, t.descripcion ?? t.codigo]));

  const [codigoDocumento, setCodigoDocumento] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipoDocumentoId, setTipoDocumentoId] = useState<string | null>(null);
  const [revision, setRevision] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!tipoDocumentoId) {
      setCreateError(new Error('Elegí un tipo de documento.'));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createDocumento(
        projectId!,
        {
          codigoDocumento: codigoDocumento.trim() || null,
          descripcion: descripcion.trim(),
          tipoDocumentoId,
          revision: revision.trim() || null
        },
        devUser.email
      );
      setCodigoDocumento('');
      setDescripcion('');
      setRevision('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  const items = documentos ?? [];
  const error = createError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Documentos</h1>
          {project && <p className="page-subtitle">Proyecto {project.code} — {project.name} · Hojas de Datos y otros documentos externos catalogados</p>}
        </div>
        <button type="button" className="button button--secondary" onClick={load}>Actualizar</button>
      </div>

      <ErrorMessage error={error} />

      {canWrite && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>Código de documento</span>
            <input type="text" maxLength={100} disabled={creating} value={codigoDocumento} onChange={(e) => setCodigoDocumento(e.target.value)} placeholder="ej. 104-...-DSH-620-J-0004" />
          </label>
          <label className="form__field">
            <span>Descripción *</span>
            <input type="text" maxLength={300} required disabled={creating} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Tipo *</span>
            <CatalogSelect
              disabled={creating}
              value={tipoDocumentoId}
              onChange={setTipoDocumentoId}
              options={(tipos ?? []).map((t) => ({ id: t.id, label: t.descripcion ?? t.codigo }))}
            />
          </label>
          <label className="form__field">
            <span>Revisión</span>
            <input type="text" maxLength={10} disabled={creating} value={revision} onChange={(e) => setRevision(e.target.value)} />
          </label>
          <button type="submit" className="button" disabled={creating}>{creating ? 'Creando…' : '+ Nuevo documento'}</button>
        </form>
      )}

      {loading && <p>Cargando documentos…</p>}
      {!loading && items.length === 0 && <p>Este proyecto todavía no tiene documentos cargados.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Tipo</th>
              <th>Rev.</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.codigoDocumento ?? '—'}</td>
                <td><Link to={`/projects/${projectId}/documentos/${d.id}`}>{d.descripcion}</Link></td>
                <td>{tipoPorId.get(d.tipoDocumentoId) ?? '—'}</td>
                <td>{d.revision ?? '—'}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
