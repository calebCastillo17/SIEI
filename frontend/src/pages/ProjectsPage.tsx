import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useMe } from '../auth/MeContext';
import { useProjects } from '../projects/ProjectsContext';
import { archiveProject, createProject, updateProject } from '../api/projects';
import { listClients } from '../api/clients';
import { useAsyncData } from '../lib/useAsyncData';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Client, Project, ProjectUpdateInput } from '../api/types';

function EditRow({
  project,
  submitting,
  onSave,
  onCancel
}: {
  project: Project;
  submitting: boolean;
  onSave: (value: ProjectUpdateInput) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(project.code);
  const [name, setName] = useState(project.name);

  return (
    <tr>
      <td colSpan={4}>
        <form
          className="form form--inline"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ code: code.trim(), name: name.trim() });
          }}
        >
          <label className="form__field">
            <span>Código *</span>
            <input
              type="text"
              maxLength={30}
              required
              disabled={submitting}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Nombre *</span>
            <input
              type="text"
              maxLength={200}
              required
              disabled={submitting}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="form__actions">
            <button type="submit" className="button button--small" disabled={submitting}>
              {submitting ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={submitting}
              onClick={onCancel}
            >
              Cancelar
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

export function ProjectsPage() {
  const { devUser } = useDevUser();
  const { me } = useMe();
  const { projects, loading, error: loadError, refresh } = useProjects();
  const navigate = useNavigate();

  const isSystemAdmin = me?.user.esAdminSistema ?? false;

  const fetchClients = useCallback(
    () => listClients(devUser.email).then((r) => r.clients),
    [devUser.email]
  );
  const { data: clients } = useAsyncData<Client[]>(fetchClients);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!clientId) return;
    setCreating(true);
    setActionError(null);
    try {
      await createProject({ clientId, code: code.trim(), name: name.trim() }, devUser.email);
      setShowCreateForm(false);
      setClientId(null);
      setCode('');
      setName('');
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(projectId: string, value: ProjectUpdateInput) {
    setSavingId(projectId);
    setActionError(null);
    try {
      await updateProject(projectId, value, devUser.email);
      setEditingId(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSavingId(null);
    }
  }

  async function handleArchive(project: Project) {
    if (
      !window.confirm(
        `¿Archivar el proyecto "${project.code}"? Su información de ingeniería no se toca, pero nadie más va a poder acceder a él.`
      )
    )
      return;
    setArchivingId(project.id);
    setActionError(null);
    try {
      await archiveProject(project.id, devUser.email);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setArchivingId(null);
    }
  }

  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <h1>Proyectos</h1>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={refresh}>
            Actualizar
          </button>
          {!showCreateForm && (
            <button
              type="button"
              className="button"
              disabled={!isSystemAdmin}
              title={isSystemAdmin ? undefined : 'Solo un administrador de sistema puede crear proyectos.'}
              onClick={() => setShowCreateForm(true)}
            >
              + Nuevo proyecto
            </button>
          )}
        </div>
      </div>

      <ErrorMessage error={error} />

      {showCreateForm && (
        <form className="form form--inline" onSubmit={handleCreate}>
          <label className="form__field">
            <span>Cliente *</span>
            <CatalogSelect
              required
              disabled={creating}
              value={clientId}
              onChange={setClientId}
              options={(clients ?? []).map((c) => ({ id: c.id, label: c.nombre }))}
              emptyLabel="— elegir cliente —"
            />
          </label>
          <label className="form__field">
            <span>Código *</span>
            <input
              type="text"
              maxLength={30}
              required
              disabled={creating}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Nombre *</span>
            <input
              type="text"
              maxLength={200}
              required
              disabled={creating}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="form__actions">
            <button type="submit" className="button" disabled={creating || !clientId}>
              {creating ? 'Creando…' : 'Crear proyecto'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={creating}
              onClick={() => setShowCreateForm(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {loading && <p>Cargando proyectos…</p>}

      {!loading && !error && projects.length === 0 && (
        <p>No tenés acceso a ningún proyecto activo con este usuario.</p>
      )}

      {!loading && projects.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Tu rol</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) =>
              editingId === project.id ? (
                <EditRow
                  key={project.id}
                  project={project}
                  submitting={savingId === project.id}
                  onSave={(value) => handleSaveEdit(project.id, value)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <tr key={project.id}>
                  <td
                    className="table__row--clickable"
                    onClick={() => navigate(`/projects/${project.id}/instruments`)}
                  >
                    {project.code}
                  </td>
                  <td
                    className="table__row--clickable"
                    onClick={() => navigate(`/projects/${project.id}/instruments`)}
                  >
                    {project.name}
                  </td>
                  <td className="table__permissions">
                    <span className="badge">{project.access.role}</span>
                    {project.access.permissions.write && <span className="badge">escribir</span>}
                    {project.access.permissions.deactivate && (
                      <span className="badge">desactivar</span>
                    )}
                    {project.access.permissions.administer && (
                      <span className="badge">administrar</span>
                    )}
                  </td>
                  <td className="table__row-actions">
                    {project.access.permissions.administer && (
                      <>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setEditingId(project.id)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="button button--danger button--small"
                          disabled={archivingId === project.id}
                          onClick={() => handleArchive(project)}
                        >
                          {archivingId === project.id ? 'Archivando…' : 'Archivar'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
