import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listPlantillas, uploadPlantilla } from '../api/plantillasEntregable';
import { listTiposEntregable } from '../api/tiposEntregable';
import { useAsyncData } from '../lib/useAsyncData';
import { useProjectUserDirectory } from '../components/useProjectUserDirectory';
import type { PlantillaEntregable, TipoEntregable } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

interface PlantillasData {
  plantillas: PlantillaEntregable[];
  tipos: TipoEntregable[];
}

export function ProjectPlantillasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const project = findProject(projectId);
  const canAdminister = project?.access.permissions.administer ?? false;

  const fetchData = useCallback(async (): Promise<PlantillasData> => {
    if (!projectId) return { plantillas: [], tipos: [] };
    const [plantillasResp, tiposResp] = await Promise.all([
      listPlantillas(projectId, devUser.email),
      listTiposEntregable(devUser.email)
    ]);
    return { plantillas: plantillasResp.plantillas, tipos: tiposResp.items };
  }, [projectId, devUser.email]);

  const { data, loading, error: loadError, refresh: load } = useAsyncData<PlantillasData>(fetchData);
  const usersById = useProjectUserDirectory(projectId ?? '', devUser.email);

  const [tipoEntregableId, setTipoEntregableId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [uploaded, setUploaded] = useState(false);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null);
  }

  async function handleUpload() {
    if (!selectedFile || !tipoEntregableId || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setUploaded(false);

    try {
      await uploadPlantilla(projectId!, selectedFile, tipoEntregableId, devUser.email);
      setUploaded(true);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  const tipos = data?.tipos ?? [];
  const plantillas = data?.plantillas ?? [];
  const activasPorTipo = new Map(plantillas.filter((p) => p.active).map((p) => [p.tipoEntregableId, p]));
  const historicas = plantillas.filter((p) => !p.active);
  const error = submitError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Plantillas de entregables</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <button type="button" className="button button--secondary" onClick={load}>
          Actualizar
        </button>
      </div>

      <ErrorMessage error={error} />

      {uploaded && (
        <div className="notice">
          <h3>✓ Plantilla cargada</h3>
          <p>Queda como la vigente para ese tipo de entregable a partir de ahora.</p>
        </div>
      )}

      <div className="notice">
        <h3>ℹ Reemplazar una plantilla solo afecta revisiones futuras</h3>
        <p>
          Cada revisión congela, al crearse, la plantilla vigente en ese momento
          (<code>revision_entregable.plantilla_id</code>) — las revisiones ya emitidas
          conservan para siempre la plantilla con la que se generaron, aunque después se
          suba una nueva.
        </p>
      </div>

      {loading && <p>Cargando plantillas…</p>}

      {!loading && (
        <>
          <h2>Vigentes por tipo</h2>
          {tipos.length === 0 && <p>No hay tipos de entregable configurados.</p>}
          {tipos.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Archivo activo</th>
                    <th>Fecha de carga</th>
                    <th>Cargado por</th>
                  </tr>
                </thead>
                <tbody>
                  {tipos.map((tipo) => {
                    const activa = activasPorTipo.get(tipo.id);
                    const autor = activa?.createdBy ? usersById.get(activa.createdBy) : undefined;
                    return (
                      <tr key={tipo.id}>
                        <td>
                          {tipo.codigo} — {tipo.descripcion}
                        </td>
                        <td>{activa?.nombreArchivo ?? '— sin plantilla cargada —'}</td>
                        <td>{activa ? new Date(activa.createdAt).toLocaleString() : '—'}</td>
                        <td>{autor?.nombre ?? autor?.email ?? (activa?.createdBy ? `Usuario #${activa.createdBy}` : '—')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {historicas.length > 0 && (
            <>
              <h2>Históricas</h2>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Archivo</th>
                      <th>Fecha de carga</th>
                      <th>Cargado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historicas.map((plantilla) => {
                      const tipo = tipos.find((t) => t.id === plantilla.tipoEntregableId);
                      const autor = plantilla.createdBy ? usersById.get(plantilla.createdBy) : undefined;
                      return (
                        <tr key={plantilla.id}>
                          <td>{tipo ? `${tipo.codigo} — ${tipo.descripcion}` : plantilla.tipoEntregableId}</td>
                          <td>{plantilla.nombreArchivo}</td>
                          <td>{new Date(plantilla.createdAt).toLocaleString()}</td>
                          <td>{autor?.nombre ?? autor?.email ?? (plantilla.createdBy ? `Usuario #${plantilla.createdBy}` : '—')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <fieldset className="form__section" disabled={!canAdminister || submitting}>
            <legend>Reemplazar / subir plantilla</legend>

            <label className="form__field">
              <span>Tipo de entregable *</span>
              <select value={tipoEntregableId} onChange={(event) => setTipoEntregableId(event.target.value)}>
                <option value="" disabled>
                  Elegir…
                </option>
                {tipos.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>
                    {tipo.codigo} — {tipo.descripcion}
                  </option>
                ))}
              </select>
            </label>

            <label className="form__field">
              <span>Archivo (.xlsx/.xlsm)</span>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm" onChange={handleFileChange} />
            </label>

            {selectedFile && (
              <p className="form__note form__field--wide">
                Archivo seleccionado: <strong>{selectedFile.name}</strong>
              </p>
            )}

            {!canAdminister && (
              <p className="form__note form__field--wide">
                Tu rol no tiene permiso de administración en este proyecto — no podés
                reemplazar la plantilla.
              </p>
            )}

            <div className="form__actions form__field--wide">
              <button
                type="button"
                className="button"
                disabled={!canAdminister || !selectedFile || !tipoEntregableId || submitting}
                onClick={handleUpload}
              >
                {submitting ? 'Subiendo…' : 'Subir plantilla'}
              </button>
            </div>
          </fieldset>
        </>
      )}
    </section>
  );
}
