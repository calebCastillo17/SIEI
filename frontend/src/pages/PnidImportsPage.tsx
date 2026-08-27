import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listPnidImports, previewPnidImport } from '../api/pnidImports';
import { useAsyncData } from '../lib/useAsyncData';
import type { PnidImport } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const ESTADO_LABELS: Record<string, string> = {
  PREVISUALIZADO: 'Previsualizado',
  APLICADO: 'Aplicado',
  DESCARTADO: 'Descartado',
  ERROR: 'Error'
};

export function PnidImportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchImports = useCallback(() => {
    if (!projectId) return Promise.resolve<PnidImport[]>([]);
    return listPnidImports(projectId, devUser.email).then((response) => response.imports);
  }, [projectId, devUser.email]);

  const {
    data: imports,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<PnidImport[]>(fetchImports);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null);
  }

  async function handleGeneratePreview() {
    if (!selectedFile || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await previewPnidImport(projectId!, selectedFile, devUser.email);
      navigate(`/projects/${projectId}/instruments/pnid-imports/${response.import.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err : new Error('Error desconocido.'));
      setSubmitting(false);
    }
  }

  const items = imports ?? [];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Importaciones P&amp;ID</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={load}>
            Actualizar
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => navigate(`/projects/${projectId}/instruments`)}
          >
            Volver a Instrumentos
          </button>
        </div>
      </div>

      <fieldset className="form__section" disabled={!canWrite}>
        <legend>Nueva importación</legend>

        <label className="form__field">
          <span>Archivo (.xlsx)</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            disabled={!canWrite || submitting}
            onChange={handleFileChange}
          />
        </label>

        {selectedFile && (
          <p className="form__note">
            Archivo seleccionado: <strong>{selectedFile.name}</strong>
          </p>
        )}

        {!canWrite && (
          <p className="form__note">
            Tu rol no tiene permiso de escritura en este proyecto — podés
            consultar el historial, pero no generar una importación nueva.
          </p>
        )}

        <div className="form__actions form__field--wide">
          <button
            type="button"
            className="button"
            disabled={!canWrite || !selectedFile || submitting}
            onClick={handleGeneratePreview}
          >
            {submitting ? 'Generando preview…' : 'Generar preview'}
          </button>
        </div>
      </fieldset>

      <ErrorMessage error={submitError} />

      <h2>Historial de importaciones</h2>

      <ErrorMessage error={loadError} />

      {loading && <p>Cargando historial…</p>}

      {!loading && !loadError && items.length === 0 && (
        <p>Este proyecto todavía no tiene importaciones P&amp;ID.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Fecha de carga</th>
                <th>Estado</th>
                <th>Usuario</th>
                <th>Total filas</th>
                <th>Listado = True</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="table__row--clickable">
                  <td>
                    <Link to={`/projects/${projectId}/instruments/pnid-imports/${item.id}`}>
                      {item.nombreArchivo}
                    </Link>
                  </td>
                  <td>{new Date(item.fechaCarga).toLocaleString()}</td>
                  <td>{ESTADO_LABELS[item.estado] ?? item.estado}</td>
                  {/*
                    El backend solo expone el ID numérico del usuario acá
                    (createdBy), no su nombre/email — /api/users que sí
                    tiene el nombre requiere es_admin_sistema. Mostramos el
                    ID tal cual en vez de inventar una resolución a nombre.
                  */}
                  <td>{item.createdBy ? `Usuario #${item.createdBy}` : '—'}</td>
                  <td>{item.totalFilas}</td>
                  <td>{item.totalListadoTrue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
