import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateSwitch, getSwitch, updateSwitch } from '../api/switches';
import { createPort, deactivatePort, listPorts } from '../api/ports';
import { createCommLink, deactivateCommLink, listCommLinks } from '../api/commLinks';
import { useAsyncData } from '../lib/useAsyncData';
import { useCommLinkFormOptions } from '../components/useCommLinkFormOptions';
import type { CommLink, CommLinkInput, Port, SwitchEntity, SwitchInput } from '../api/types';
import type { CommLinkFormOptions } from '../components/useCommLinkFormOptions';
import { SwitchForm } from '../components/SwitchForm';
import { CommLinkForm } from '../components/CommLinkForm';
import { emptyCommLinkInput } from '../components/commLinkFormDefaults';
import { ErrorMessage } from '../components/ErrorMessage';

function toInput(sw: SwitchEntity): SwitchInput {
  return {
    tagSwitch: sw.tagSwitch,
    descripcion: sw.descripcion,
    marcaModelo: sw.marcaModelo,
    gabineteId: sw.gabineteId
  };
}

interface PermissionFlags {
  canWrite: boolean;
  canDeactivate: boolean;
}

function ownerLabel(link: CommLink, options: CommLinkFormOptions): string {
  if (link.instrumentoId) {
    const instrument = options.instruments.find((i) => i.id === link.instrumentoId);
    return `Instrumento ${instrument?.tagInstrumento ?? `#${link.instrumentoId}`}`;
  }
  if (link.equipoId) {
    const equipment = options.equipment.find((e) => e.id === link.equipoId);
    return `Equipo ${equipment?.tagEquipo ?? `#${link.equipoId}`}`;
  }
  return '—';
}

/* ---- Enlaces de comunicación de un puerto, mostrados al expandirlo ---- */

function CommLinksView({
  projectId,
  devUserEmail,
  port,
  commLinks,
  options,
  permissions,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  port: Port;
  commLinks: CommLink[];
  options: CommLinkFormOptions;
  permissions: PermissionFlags;
  onChange: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function handleCreate(value: CommLinkInput) {
    setSubmitting(true);
    setError(null);
    try {
      await createCommLink(projectId, value, devUserEmail);
      setShowForm(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(link: CommLink) {
    if (!window.confirm('¿Desactivar este enlace de comunicación?')) return;
    setDeactivatingId(link.id);
    setError(null);
    try {
      await deactivateCommLink(projectId, link.id, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  return (
    <div className="physical-slot__comm-links">
      <ErrorMessage error={error} />

      {commLinks.length === 0 && <p className="physical-hint">Sin enlaces activos.</p>}

      {commLinks.map((link) => (
        <div key={link.id} className="physical-slot__module-actions">
          <span className="physical-slot__module">
            {ownerLabel(link, options)}
            {link.tagMedio ? ` — ${link.tagMedio}` : ''}
          </span>
          <button
            type="button"
            className="button button--danger button--small"
            disabled={!permissions.canDeactivate || deactivatingId === link.id}
            onClick={() => handleDeactivate(link)}
          >
            {deactivatingId === link.id ? 'Desactivando…' : 'Desactivar'}
          </button>
        </div>
      ))}

      {permissions.canWrite && !showForm && (
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => setShowForm(true)}
        >
          + Agregar enlace
        </button>
      )}

      {permissions.canWrite && showForm && (
        <CommLinkForm
          initialValue={emptyCommLinkInput(port.id)}
          options={options}
          submitLabel="Crear enlace"
          submitting={submitting}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

/* ---- Un puerto: expandible para ver/crear sus enlaces ---- */

function PortBlock({
  projectId,
  devUserEmail,
  port,
  commLinks,
  options,
  permissions,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  port: Port;
  commLinks: CommLink[];
  options: CommLinkFormOptions;
  permissions: PermissionFlags;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleDeactivatePort() {
    if (!window.confirm(`¿Desactivar el puerto ${port.numeroPuerto}?`)) return;
    setSubmitting(true);
    setError(null);
    try {
      await deactivatePort(projectId, port.id, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  const portCommLinks = commLinks.filter((link) => link.puertoId === port.id);

  return (
    <div className="physical-slot">
      <div className="physical-slot__header">
        <button
          type="button"
          className="physical-rack__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '▾' : '▸'} Puerto {port.numeroPuerto}
        </button>
        <span className="physical-hint">{portCommLinks.length} enlace(s)</span>
        <button
          type="button"
          className="button button--danger button--small"
          disabled={!permissions.canDeactivate || submitting}
          onClick={handleDeactivatePort}
        >
          Desactivar puerto
        </button>
      </div>

      <ErrorMessage error={error} />

      {expanded && (
        <CommLinksView
          projectId={projectId}
          devUserEmail={devUserEmail}
          port={port}
          commLinks={portCommLinks}
          options={options}
          permissions={permissions}
          onChange={onChange}
        />
      )}
    </div>
  );
}

export function SwitchDetailPage() {
  const { projectId, switchId } = useParams<{ projectId: string; switchId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const permissions: PermissionFlags = {
    canWrite: project?.access.permissions.write ?? false,
    canDeactivate: project?.access.permissions.deactivate ?? false
  };

  const fetchSwitch = useCallback(() => {
    if (!projectId || !switchId) return Promise.resolve<SwitchEntity | null>(null);
    return getSwitch(projectId, switchId, devUser.email).then((r) => r.switch);
  }, [projectId, switchId, devUser.email]);

  const { data: sw, loading: swLoading, error: swError, refresh: refreshSwitch } = useAsyncData<
    SwitchEntity | null
  >(fetchSwitch);

  const fetchPorts = useCallback(() => {
    if (!projectId || !switchId) return Promise.resolve<Port[]>([]);
    return listPorts(projectId, devUser.email, switchId).then((r) => r.ports);
  }, [projectId, switchId, devUser.email]);

  const { data: ports, loading: portsLoading, error: portsError, refresh: refreshPorts } =
    useAsyncData<Port[]>(fetchPorts);

  const fetchCommLinks = useCallback(() => {
    if (!projectId) return Promise.resolve<CommLink[]>([]);
    return listCommLinks(projectId, devUser.email).then((r) => r.commLinks);
  }, [projectId, devUser.email]);

  const {
    data: commLinks,
    loading: commLinksLoading,
    error: commLinksError,
    refresh: refreshCommLinks
  } = useAsyncData<CommLink[]>(fetchCommLinks);

  const { data: options, loading: optionsLoading, error: optionsError } = useCommLinkFormOptions(
    projectId ?? '',
    devUser.email
  );

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  const [numeroPuerto, setNumeroPuerto] = useState('');
  const [addingPort, setAddingPort] = useState(false);
  const [addPortError, setAddPortError] = useState<Error | null>(null);

  if (!projectId || !switchId) {
    return <p>Faltan datos en la URL.</p>;
  }

  function refreshAll() {
    refreshPorts();
    refreshCommLinks();
  }

  async function handleUpdate(value: SwitchInput) {
    setSubmitting(true);
    setActionError(null);
    try {
      await updateSwitch(projectId!, switchId!, value, devUser.email);
      setEditing(false);
      refreshSwitch();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivateSwitch() {
    if (!sw) return;
    if (!window.confirm(`¿Desactivar el switch "${sw.tagSwitch}"?`)) return;
    setDeactivating(true);
    setActionError(null);
    try {
      await deactivateSwitch(projectId!, switchId!, devUser.email);
      navigate(`/projects/${projectId}/switches`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  async function handleAddPort(event: FormEvent) {
    event.preventDefault();
    setAddingPort(true);
    setAddPortError(null);
    try {
      await createPort(
        projectId!,
        { switchId: switchId!, numeroPuerto: Number(numeroPuerto) },
        devUser.email
      );
      setNumeroPuerto('');
      refreshPorts();
    } catch (err) {
      setAddPortError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setAddingPort(false);
    }
  }

  const sortedPorts = [...(ports ?? [])].sort((a, b) => a.numeroPuerto - b.numeroPuerto);
  const error = actionError ?? addPortError ?? swError ?? portsError ?? commLinksError ?? optionsError;
  const loading = swLoading || portsLoading || commLinksLoading || optionsLoading;

  return (
    <section>
      <div className="page-header">
        <h1>{sw ? sw.tagSwitch : 'Switch'}</h1>

        {sw && !editing && (
          <div className="page-header__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!permissions.canWrite}
              title={
                permissions.canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'
              }
              onClick={() => setEditing(true)}
            >
              Editar
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={!permissions.canDeactivate || deactivating}
              title={
                permissions.canDeactivate
                  ? undefined
                  : 'Tu rol no tiene permiso de desactivación en este proyecto.'
              }
              onClick={handleDeactivateSwitch}
            >
              {deactivating ? 'Desactivando…' : 'Desactivar switch'}
            </button>
          </div>
        )}
      </div>

      {sw?.marcaModelo && <p className="page-subtitle">{sw.marcaModelo}</p>}

      <ErrorMessage error={error} />

      {loading && <p>Cargando…</p>}

      {!loading && sw && editing && (
        <SwitchForm
          initialValue={toInput(sw)}
          submitLabel="Guardar cambios"
          submitting={submitting}
          disabled={!permissions.canWrite}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      )}

      {!loading && sw && !editing && options && (
        <>
          {permissions.canWrite && (
            <form className="form form--inline" onSubmit={handleAddPort}>
              <label className="form__field">
                <span>N.º de puerto</span>
                <input
                  type="number"
                  min={0}
                  max={32767}
                  required
                  disabled={addingPort}
                  value={numeroPuerto}
                  onChange={(event) => setNumeroPuerto(event.target.value)}
                />
              </label>
              <button type="submit" className="button button--small" disabled={addingPort}>
                + Agregar puerto
              </button>
            </form>
          )}

          {sortedPorts.length === 0 && <p>Este switch todavía no tiene puertos activos.</p>}

          <div className="physical-tree">
            {sortedPorts.map((port) => (
              <PortBlock
                key={port.id}
                projectId={projectId}
                devUserEmail={devUser.email}
                port={port}
                commLinks={commLinks ?? []}
                options={options}
                permissions={permissions}
                onChange={refreshAll}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
