import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  getFichaTecnica,
  updateFichaTecnica,
  listRequisitosDeFicha,
  addRequisitoAFicha,
  quitarRequisitoDeFicha,
  listMarcasDeFicha,
  addMarcaAFicha,
  quitarMarcaDeFicha
} from '../api/fichasTecnicas';
import { listDocumentos } from '../api/documentos';
import { listFabricantes, listRequisitos } from '../api/catalogs';
import { useAsyncData } from '../lib/useAsyncData';
import { COMPONENTES } from '../lib/componentSpecs';
import { ComponenteSection } from '../components/ComponenteSection';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';
import type {
  FichaTecnica,
  Documento,
  CatalogItem,
  RequisitoCatalogItem,
  FichaTecnicaRequisito,
  MarcaAceptable,
  ValorRequisito
} from '../api/types';

const VALORES: ValorRequisito[] = ['REQUERIDO', 'NO_REQUERIDO', 'NO_APLICA'];

function ComponenteAccordion({
  projectId,
  fichaId,
  spec,
  canWrite,
  canDeactivate
}: {
  projectId: string;
  fichaId: string;
  spec: (typeof COMPONENTES)[number];
  canWrite: boolean;
  canDeactivate: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tree__node">
      <button type="button" className="tree__row" onClick={() => setOpen((o) => !o)}>
        <span className={`tree__toggle ${open ? 'tree__toggle--open' : ''}`}>▸</span>
        <strong>{spec.nombre}</strong>
        {spec.cardinalidad === 'muchos' && <span className="page-subtitle">(varios)</span>}
      </button>
      {open && (
        <div className="ruteo-gabinete">
          <ComponenteSection projectId={projectId} fichaId={fichaId} spec={spec} canWrite={canWrite} canDeactivate={canDeactivate} />
        </div>
      )}
    </div>
  );
}

export function FichaTecnicaDetailPage() {
  const { projectId, fichaId } = useParams<{ projectId: string; fichaId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchFicha = useCallback(() => {
    if (!projectId || !fichaId) return Promise.resolve<FichaTecnica | null>(null);
    return getFichaTecnica(projectId, fichaId, devUser.email).then((r) => r.fichaTecnica);
  }, [projectId, fichaId, devUser.email]);
  const { data: ficha, loading, error: loadError, refresh: refreshFicha } = useAsyncData<FichaTecnica | null>(fetchFicha);

  const fetchDocumentos = useCallback(() => {
    if (!projectId) return Promise.resolve<Documento[]>([]);
    return listDocumentos(projectId, devUser.email).then((r) => r.documentos);
  }, [projectId, devUser.email]);
  const { data: documentos } = useAsyncData<Documento[]>(fetchDocumentos);

  const fetchFabricantes = useCallback(() => listFabricantes(devUser.email).then((r) => r.items), [devUser.email]);
  const { data: fabricantes } = useAsyncData<CatalogItem[]>(fetchFabricantes);

  const fetchRequisitosCat = useCallback(() => listRequisitos(devUser.email).then((r) => r.items), [devUser.email]);
  const { data: requisitosCat } = useAsyncData<RequisitoCatalogItem[]>(fetchRequisitosCat);

  const fetchRequisitos = useCallback(() => {
    if (!projectId || !fichaId) return Promise.resolve<FichaTecnicaRequisito[]>([]);
    return listRequisitosDeFicha(projectId, fichaId, devUser.email).then((r) => r.requisitos);
  }, [projectId, fichaId, devUser.email]);
  const { data: requisitos, refresh: refreshRequisitos } = useAsyncData<FichaTecnicaRequisito[]>(fetchRequisitos);

  const fetchMarcas = useCallback(() => {
    if (!projectId || !fichaId) return Promise.resolve<MarcaAceptable[]>([]);
    return listMarcasDeFicha(projectId, fichaId, devUser.email).then((r) => r.marcasAceptables);
  }, [projectId, fichaId, devUser.email]);
  const { data: marcas, refresh: refreshMarcas } = useAsyncData<MarcaAceptable[]>(fetchMarcas);

  const [editing, setEditing] = useState(false);
  const [documentoId, setDocumentoId] = useState<string | null>(null);
  const [fabricanteId, setFabricanteId] = useState<string | null>(null);
  const [modelo, setModelo] = useState('');
  const [codigoReferencia, setCodigoReferencia] = useState('');
  const [savingHeader, setSavingHeader] = useState(false);
  const [headerError, setHeaderError] = useState<Error | null>(null);

  const [nuevoRequisitoId, setNuevoRequisitoId] = useState<string | null>(null);
  const [nuevoValor, setNuevoValor] = useState<ValorRequisito>('REQUERIDO');
  const [nuevoDetalle, setNuevoDetalle] = useState('');
  const [creandoRequisito, setCreandoRequisito] = useState(false);
  const [requisitoError, setRequisitoError] = useState<Error | null>(null);

  const [nuevoComponente, setNuevoComponente] = useState('');
  const [nuevaMarcaFabricanteId, setNuevaMarcaFabricanteId] = useState<string | null>(null);
  const [nuevaMarcaPreferente, setNuevaMarcaPreferente] = useState(false);
  const [creandoMarca, setCreandoMarca] = useState(false);
  const [marcaError, setMarcaError] = useState<Error | null>(null);

  if (!projectId || !fichaId) return <p>Faltan datos en la URL.</p>;

  function startEdit() {
    if (!ficha) return;
    setDocumentoId(ficha.documentoId);
    setFabricanteId(ficha.fabricanteId);
    setModelo(ficha.modelo ?? '');
    setCodigoReferencia(ficha.codigoReferencia ?? '');
    setEditing(true);
  }

  async function handleSaveHeader(event: FormEvent) {
    event.preventDefault();
    setSavingHeader(true);
    setHeaderError(null);
    try {
      await updateFichaTecnica(
        projectId!,
        fichaId!,
        { documentoId, fabricanteId, modelo: modelo.trim() || null, codigoReferencia: codigoReferencia.trim() || null },
        devUser.email
      );
      setEditing(false);
      refreshFicha();
    } catch (err) {
      setHeaderError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSavingHeader(false);
    }
  }

  async function handleAddRequisito(event: FormEvent) {
    event.preventDefault();
    if (!nuevoRequisitoId) {
      setRequisitoError(new Error('Elegí un requisito.'));
      return;
    }
    setCreandoRequisito(true);
    setRequisitoError(null);
    try {
      await addRequisitoAFicha(projectId!, fichaId!, { requisitoId: nuevoRequisitoId, valor: nuevoValor, detalle: nuevoDetalle.trim() || null }, devUser.email);
      setNuevoRequisitoId(null);
      setNuevoDetalle('');
      refreshRequisitos();
    } catch (err) {
      setRequisitoError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreandoRequisito(false);
    }
  }

  async function handleQuitarRequisito(id: string) {
    try {
      await quitarRequisitoDeFicha(projectId!, fichaId!, id, devUser.email);
      refreshRequisitos();
    } catch (err) {
      setRequisitoError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  async function handleAddMarca(event: FormEvent) {
    event.preventDefault();
    if (!nuevaMarcaFabricanteId || nuevoComponente.trim().length === 0) {
      setMarcaError(new Error('Completá componente y fabricante.'));
      return;
    }
    setCreandoMarca(true);
    setMarcaError(null);
    try {
      await addMarcaAFicha(projectId!, fichaId!, { componente: nuevoComponente.trim(), fabricanteId: nuevaMarcaFabricanteId, preferente: nuevaMarcaPreferente }, devUser.email);
      setNuevoComponente('');
      setNuevaMarcaFabricanteId(null);
      setNuevaMarcaPreferente(false);
      refreshMarcas();
    } catch (err) {
      setMarcaError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreandoMarca(false);
    }
  }

  async function handleQuitarMarca(id: string) {
    try {
      await quitarMarcaDeFicha(projectId!, fichaId!, id, devUser.email);
      refreshMarcas();
    } catch (err) {
      setMarcaError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  const documentoNombre = ficha?.documentoId ? documentos?.find((d) => d.id === ficha.documentoId)?.descripcion : null;
  const fabricanteNombre = ficha?.fabricanteId ? fabricantes?.find((f) => f.id === ficha.fabricanteId)?.descripcion : null;
  const requisitoPorId = new Map((requisitosCat ?? []).map((r) => [r.id, r]));
  const fabricantePorId = new Map((fabricantes ?? []).map((f) => [f.id, f.descripcion ?? f.codigo]));

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{ficha?.codigoReferencia ?? (ficha ? `Ficha #${ficha.id}` : 'Ficha técnica')}</h1>
          {documentoNombre && <p className="page-subtitle">{documentoNombre}</p>}
        </div>
        {ficha && !editing && (
          <button type="button" className="button button--secondary" disabled={!canWrite} onClick={startEdit}>Editar</button>
        )}
      </div>

      <ErrorMessage error={loadError ?? headerError} />
      {loading && <p>Cargando ficha técnica…</p>}

      {!loading && ficha && !editing && (
        <dl className="detail-list">
          <div><dt>Documento</dt><dd>{documentoNombre ?? '—'}</dd></div>
          <div><dt>Fabricante (principal)</dt><dd>{fabricanteNombre ?? '—'}</dd></div>
          <div><dt>Modelo (principal)</dt><dd>{ficha.modelo ?? '—'}</dd></div>
          <div><dt>Código de referencia</dt><dd>{ficha.codigoReferencia ?? '—'}</dd></div>
        </dl>
      )}

      {!loading && ficha && editing && (
        <form className="form" onSubmit={handleSaveHeader}>
          <label className="form__field">
            <span>Documento</span>
            <CatalogSelect value={documentoId} onChange={setDocumentoId} options={(documentos ?? []).map((d) => ({ id: d.id, label: d.descripcion }))} />
          </label>
          <label className="form__field">
            <span>Fabricante (principal)</span>
            <CatalogSelect value={fabricanteId} onChange={setFabricanteId} options={(fabricantes ?? []).map((f) => ({ id: f.id, label: f.descripcion ?? f.codigo }))} />
          </label>
          <label className="form__field">
            <span>Modelo (principal)</span>
            <input type="text" maxLength={100} disabled={savingHeader} value={modelo} onChange={(e) => setModelo(e.target.value)} />
          </label>
          <label className="form__field">
            <span>Código de referencia</span>
            <input type="text" maxLength={50} disabled={savingHeader} value={codigoReferencia} onChange={(e) => setCodigoReferencia(e.target.value)} />
          </label>
          <div className="form__actions">
            <button type="submit" className="button" disabled={savingHeader}>{savingHeader ? 'Guardando…' : 'Guardar cambios'}</button>
            <button type="button" className="button button--secondary" disabled={savingHeader} onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {!loading && ficha && (
        <>
          <h2>Requisitos</h2>
          <ErrorMessage error={requisitoError} />
          {canWrite && (
            <form className="form form--inline" onSubmit={handleAddRequisito}>
              <label className="form__field">
                <span>Requisito</span>
                <CatalogSelect
                  value={nuevoRequisitoId}
                  onChange={setNuevoRequisitoId}
                  options={(requisitosCat ?? []).map((r) => ({ id: r.id, label: r.descripcion ?? r.codigo }))}
                />
              </label>
              <label className="form__field">
                <span>Valor</span>
                <select value={nuevoValor} onChange={(e) => setNuevoValor(e.target.value as ValorRequisito)}>
                  {VALORES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="form__field" style={{ flex: 1 }}>
                <span>Detalle</span>
                <input type="text" maxLength={300} disabled={creandoRequisito} value={nuevoDetalle} onChange={(e) => setNuevoDetalle(e.target.value)} />
              </label>
              <button type="submit" className="button button--small" disabled={creandoRequisito}>{creandoRequisito ? 'Agregando…' : '+ Agregar'}</button>
            </form>
          )}
          {(requisitos ?? []).length === 0 && <p className="physical-hint">Sin requisitos cargados.</p>}
          {(requisitos ?? []).length > 0 && (
            <table className="table">
              <thead><tr><th>Requisito</th><th>Categoría</th><th>Valor</th><th>Detalle</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {(requisitos ?? []).map((r) => {
                  const cat = requisitoPorId.get(r.requisitoId);
                  return (
                    <tr key={r.id}>
                      <td>{cat?.descripcion ?? cat?.codigo ?? '—'}</td>
                      <td>{cat?.categoria ?? '—'}</td>
                      <td>{r.valor}</td>
                      <td>{r.detalle ?? '—'}</td>
                      <td><button type="button" className="button button--small button--danger" disabled={!canDeactivate} onClick={() => handleQuitarRequisito(r.id)}>Quitar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h2>Marcas aceptables</h2>
          <ErrorMessage error={marcaError} />
          {canWrite && (
            <form className="form form--inline" onSubmit={handleAddMarca}>
              <label className="form__field">
                <span>Componente</span>
                <input type="text" maxLength={50} disabled={creandoMarca} value={nuevoComponente} onChange={(e) => setNuevoComponente(e.target.value)} placeholder="ej. manometro" />
              </label>
              <label className="form__field">
                <span>Fabricante</span>
                <CatalogSelect value={nuevaMarcaFabricanteId} onChange={setNuevaMarcaFabricanteId} options={(fabricantes ?? []).map((f) => ({ id: f.id, label: f.descripcion ?? f.codigo }))} />
              </label>
              <label className="form__field form__field--compact">
                <span>Preferente</span>
                <input type="checkbox" checked={nuevaMarcaPreferente} onChange={(e) => setNuevaMarcaPreferente(e.target.checked)} />
              </label>
              <button type="submit" className="button button--small" disabled={creandoMarca}>{creandoMarca ? 'Agregando…' : '+ Agregar'}</button>
            </form>
          )}
          {(marcas ?? []).length === 0 && <p className="physical-hint">Sin marcas cargadas.</p>}
          {(marcas ?? []).length > 0 && (
            <table className="table">
              <thead><tr><th>Componente</th><th>Fabricante</th><th>Preferente</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {(marcas ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{m.componente}</td>
                    <td>{fabricantePorId.get(m.fabricanteId) ?? '—'}</td>
                    <td>{m.preferente === null ? '—' : m.preferente ? 'Sí' : 'No'}</td>
                    <td><button type="button" className="button button--small button--danger" disabled={!canDeactivate} onClick={() => handleQuitarMarca(m.id)}>Quitar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Componentes</h2>
          <p className="physical-hint">Elegí el tipo para ver/cargar sus datos — solo se consultan al abrirlos.</p>
          <div className="tree">
            {COMPONENTES.map((spec) => (
              <ComponenteAccordion key={spec.slug} projectId={projectId} fichaId={fichaId} spec={spec} canWrite={canWrite} canDeactivate={canDeactivate} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
