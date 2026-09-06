import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getDocumento, listNotas, createNota, deactivateNota } from '../api/documentos';
import { listFichasTecnicas } from '../api/fichasTecnicas';
import { listTiposDocumento } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import type { Documento, Nota, FichaTecnica, CatalogItem } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

export function DocumentoDetailPage() {
  const { projectId, documentoId } = useParams<{ projectId: string; documentoId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchDoc = useCallback(() => {
    if (!projectId || !documentoId) return Promise.resolve<Documento | null>(null);
    return getDocumento(projectId, documentoId, devUser.email).then((r) => r.documento);
  }, [projectId, documentoId, devUser.email]);
  const { data: documento, loading, error: loadError } = useAsyncData<Documento | null>(fetchDoc);

  const fetchTipos = useCallback(() => listTiposDocumento(devUser.email).then((r) => r.items), [devUser.email]);
  const { data: tipos } = useAsyncData<CatalogItem[]>(fetchTipos);

  const fetchNotas = useCallback(() => {
    if (!projectId || !documentoId) return Promise.resolve<Nota[]>([]);
    return listNotas(projectId, documentoId, devUser.email).then((r) => r.notas);
  }, [projectId, documentoId, devUser.email]);
  const { data: notas, loading: notasLoading, error: notasError, refresh: refreshNotas } = useAsyncData<Nota[]>(fetchNotas);

  const fetchFichas = useCallback(() => {
    if (!projectId) return Promise.resolve<FichaTecnica[]>([]);
    return listFichasTecnicas(projectId, devUser.email).then((r) => r.fichasTecnicas);
  }, [projectId, devUser.email]);
  const { data: todasFichas } = useAsyncData<FichaTecnica[]>(fetchFichas);
  const fichasDeEsteDoc = (todasFichas ?? []).filter((f) => f.documentoId === documentoId);

  const [numero, setNumero] = useState('');
  const [texto, setTexto] = useState('');
  const [creandoNota, setCreandoNota] = useState(false);
  const [notaError, setNotaError] = useState<Error | null>(null);

  if (!projectId || !documentoId) return <p>Faltan datos en la URL.</p>;

  async function handleCrearNota(event: FormEvent) {
    event.preventDefault();
    setCreandoNota(true);
    setNotaError(null);
    try {
      await createNota(projectId!, documentoId!, { numero: Number(numero), texto: texto.trim() }, devUser.email);
      setNumero('');
      setTexto('');
      refreshNotas();
    } catch (err) {
      setNotaError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreandoNota(false);
    }
  }

  async function handleEliminarNota(notaId: string) {
    if (!window.confirm('¿Eliminar esta nota?')) return;
    try {
      await deactivateNota(projectId!, documentoId!, notaId, devUser.email);
      refreshNotas();
    } catch (err) {
      setNotaError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  const notasOrdenadas = [...(notas ?? [])].sort((a, b) => a.numero - b.numero);
  const tipoNombre = documento && tipos ? tipos.find((t) => t.id === documento.tipoDocumentoId)?.descripcion : undefined;

  return (
    <section>
      <div className="page-header">
        <h1>{documento ? documento.descripcion : 'Documento'}</h1>
      </div>

      <ErrorMessage error={loadError} />
      {loading && <p>Cargando documento…</p>}

      {!loading && documento && (
        <dl className="detail-list">
          <div><dt>Código</dt><dd>{documento.codigoDocumento ?? '—'}</dd></div>
          <div><dt>Tipo</dt><dd>{tipoNombre ?? '—'}</dd></div>
          <div><dt>Revisión</dt><dd>{documento.revision ?? '—'}</dd></div>
        </dl>
      )}

      {!loading && documento && (
        <>
          <h2>Notas</h2>
          <ErrorMessage error={notaError ?? notasError} />

          {canWrite && (
            <form className="form form--inline" onSubmit={handleCrearNota}>
              <label className="form__field">
                <span>N.º</span>
                <input type="number" min={1} required style={{ width: 70 }} disabled={creandoNota} value={numero} onChange={(e) => setNumero(e.target.value)} />
              </label>
              <label className="form__field form__field--wide" style={{ flex: 1 }}>
                <span>Texto</span>
                <input type="text" required disabled={creandoNota} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </label>
              <button type="submit" className="button button--small" disabled={creandoNota}>{creandoNota ? 'Creando…' : '+ Agregar nota'}</button>
            </form>
          )}

          {notasLoading && <p className="physical-hint">Cargando notas…</p>}
          {!notasLoading && notasOrdenadas.length === 0 && <p className="physical-hint">Sin notas todavía.</p>}
          {!notasLoading && notasOrdenadas.length > 0 && (
            <table className="table">
              <thead><tr><th style={{ width: 50 }}>N.º</th><th>Texto</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {notasOrdenadas.map((n) => (
                  <tr key={n.id}>
                    <td>{n.numero}</td>
                    <td>{n.texto}</td>
                    <td>
                      <button type="button" className="button button--small button--danger" disabled={!canDeactivate} onClick={() => handleEliminarNota(n.id)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Fichas técnicas de este documento</h2>
          {fichasDeEsteDoc.length === 0 && <p className="physical-hint">Ninguna todavía.</p>}
          {fichasDeEsteDoc.length > 0 && (
            <ul className="rio-list">
              {fichasDeEsteDoc.map((f) => (
                <li key={f.id}>
                  <Link to={`/projects/${projectId}/fichas-tecnicas/${f.id}`}>
                    {f.codigoReferencia ?? `Ficha #${f.id}`} {f.modelo ? `— ${f.modelo}` : ''}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
