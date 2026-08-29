import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateGabinete, getGabinete } from '../api/gabinetes';
import { createRack, deactivateRack } from '../api/racks';
import { createSlot, deactivateSlot } from '../api/slots';
import { createModule, deactivateModule, updateModule } from '../api/modules';
import { listChannels } from '../api/channels';
import { useAsyncData } from '../lib/useAsyncData';
import { usePhysicalTree } from '../components/usePhysicalTree';
import type { Channel, Gabinete, ModuleType, PhysicalModule, Rack, Slot } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

interface PermissionFlags {
  canWrite: boolean;
  canDeactivate: boolean;
}

/* ---- Canales de un módulo, cargados solo cuando se expande ---- */

function ChannelsView({
  projectId,
  devUserEmail,
  moduloId
}: {
  projectId: string;
  devUserEmail: string;
  moduloId: string;
}) {
  const fetchChannels = useCallback(
    () => listChannels(projectId, devUserEmail, moduloId).then((r) => r.channels),
    [projectId, devUserEmail, moduloId]
  );
  const { data: channels, loading, error } = useAsyncData<Channel[]>(fetchChannels);

  if (loading) return <p className="physical-hint">Cargando canales…</p>;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="physical-channels">
      {(channels ?? []).map((channel) => (
        <span
          key={channel.id}
          className={`badge ${channel.active ? 'badge--control' : 'badge--com'}`}
        >
          CH{channel.numeroCanal}
        </span>
      ))}
    </div>
  );
}

/* ---- Un slot: su módulo (si tiene) o el formulario para instalar uno ---- */

function SlotBlock({
  projectId,
  devUserEmail,
  slot,
  module,
  moduleTypes,
  permissions,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  slot: Slot;
  module: PhysicalModule | undefined;
  moduleTypes: ModuleType[];
  permissions: PermissionFlags;
  onChange: () => void;
}) {
  const [showChannels, setShowChannels] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleInstall(event: FormEvent) {
    event.preventDefault();
    if (!selectedType) return;
    setSubmitting(true);
    setError(null);
    try {
      await createModule(projectId, { slotId: slot.id, catalogoModuloId: selectedType }, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangeType(newTypeId: string) {
    if (!module || !newTypeId) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateModule(projectId, module.id, newTypeId, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivateModule() {
    if (!module) return;
    if (!window.confirm(`¿Desactivar el módulo del slot ${slot.numeroSlot}?`)) return;
    setSubmitting(true);
    setError(null);
    try {
      await deactivateModule(projectId, module.id, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivateSlot() {
    if (!window.confirm(`¿Desactivar el slot ${slot.numeroSlot}?`)) return;
    setSubmitting(true);
    setError(null);
    try {
      await deactivateSlot(projectId, slot.id, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="physical-slot">
      <div className="physical-slot__header">
        <span className="physical-slot__title">Slot {slot.numeroSlot}</span>

        {module ? (
          <span className="physical-slot__module">
            {module.fabricante} {module.modelo} ({module.canalesMax} canales)
          </span>
        ) : (
          <span className="physical-hint">sin módulo</span>
        )}

        <button
          type="button"
          className="button button--danger button--small"
          disabled={!permissions.canDeactivate || submitting}
          onClick={handleDeactivateSlot}
        >
          Desactivar slot
        </button>
      </div>

      <ErrorMessage error={error} />

      {module ? (
        <div className="physical-slot__module-actions">
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setShowChannels((v) => !v)}
          >
            {showChannels ? 'Ocultar canales' : 'Ver canales'}
          </button>

          {permissions.canWrite && (
            <select
              disabled={submitting}
              value=""
              onChange={(event) => handleChangeType(event.target.value)}
            >
              <option value="">— cambiar tipo de módulo —</option>
              {moduleTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.fabricante} {type.modelo} ({type.canalesMax}ch)
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="button button--danger button--small"
            disabled={!permissions.canDeactivate || submitting}
            onClick={handleDeactivateModule}
          >
            Desactivar módulo
          </button>

          {showChannels && (
            <ChannelsView projectId={projectId} devUserEmail={devUserEmail} moduloId={module.id} />
          )}
        </div>
      ) : (
        permissions.canWrite && (
          <form className="physical-slot__install-form" onSubmit={handleInstall}>
            <select
              required
              disabled={submitting}
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
            >
              <option value="">— elegir tipo de módulo —</option>
              {moduleTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.fabricante} {type.modelo} ({type.canalesMax}ch, {type.tipoIoCodigo})
                </option>
              ))}
            </select>
            <button type="submit" className="button button--small" disabled={submitting}>
              Instalar módulo
            </button>
          </form>
        )
      )}
    </div>
  );
}

/* ---- Un rack: sus slots, expandible ---- */

function RackBlock({
  projectId,
  devUserEmail,
  rack,
  slots,
  modulesBySlot,
  moduleTypes,
  permissions,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  rack: Rack;
  slots: Slot[];
  modulesBySlot: Map<string, PhysicalModule>;
  moduleTypes: ModuleType[];
  permissions: PermissionFlags;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [numeroSlot, setNumeroSlot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleAddSlot(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createSlot(projectId, { rackId: rack.id, numeroSlot: Number(numeroSlot) }, devUserEmail);
      setNumeroSlot('');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivateRack() {
    if (!window.confirm(`¿Desactivar el rack ${rack.numeroRack}?`)) return;
    setSubmitting(true);
    setError(null);
    try {
      await deactivateRack(projectId, rack.id, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  const sortedSlots = [...slots].sort((a, b) => a.numeroSlot - b.numeroSlot);

  return (
    <div className="physical-rack">
      <div className="physical-rack__header">
        <button
          type="button"
          className="physical-rack__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '▾' : '▸'} Rack {rack.numeroRack}
        </button>
        <span className="physical-hint">{slots.length} slot(s)</span>
        <button
          type="button"
          className="button button--danger button--small"
          disabled={!permissions.canDeactivate || submitting}
          onClick={handleDeactivateRack}
        >
          Desactivar rack
        </button>
      </div>

      {expanded && (
        <div className="physical-rack__body">
          <ErrorMessage error={error} />

          {sortedSlots.map((slot) => (
            <SlotBlock
              key={slot.id}
              projectId={projectId}
              devUserEmail={devUserEmail}
              slot={slot}
              module={modulesBySlot.get(slot.id)}
              moduleTypes={moduleTypes}
              permissions={permissions}
              onChange={onChange}
            />
          ))}

          {permissions.canWrite && (
            <form className="form form--inline" onSubmit={handleAddSlot}>
              <label className="form__field">
                <span>N.º de slot</span>
                <input
                  type="number"
                  min={0}
                  required
                  disabled={submitting}
                  value={numeroSlot}
                  onChange={(event) => setNumeroSlot(event.target.value)}
                />
              </label>
              <button type="submit" className="button button--small" disabled={submitting}>
                + Agregar slot
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function GabineteDetailPage() {
  const { projectId, gabineteId } = useParams<{ projectId: string; gabineteId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const permissions: PermissionFlags = {
    canWrite: project?.access.permissions.write ?? false,
    canDeactivate: project?.access.permissions.deactivate ?? false
  };

  const fetchGabinete = useCallback(() => {
    if (!projectId || !gabineteId) return Promise.resolve<Gabinete | null>(null);
    return getGabinete(projectId, gabineteId, devUser.email).then((r) => r.gabinete);
  }, [projectId, gabineteId, devUser.email]);

  const { data: gabinete, loading: gabineteLoading, error: gabineteError, refresh: refreshGabinete } = useAsyncData<
    Gabinete | null
  >(fetchGabinete);

  const {
    data: tree,
    loading: treeLoading,
    error: treeError,
    refresh: refreshTree
  } = usePhysicalTree(projectId ?? '', devUser.email);

  const [numeroRack, setNumeroRack] = useState('');
  const [addingRack, setAddingRack] = useState(false);
  const [addRackError, setAddRackError] = useState<Error | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  if (!projectId || !gabineteId) {
    return <p>Faltan datos en la URL.</p>;
  }

  function refreshAll() {
    refreshGabinete();
    refreshTree();
  }

  async function handleAddRack(event: FormEvent) {
    event.preventDefault();
    setAddingRack(true);
    setAddRackError(null);
    try {
      await createRack(projectId!, { gabineteId: gabineteId!, numeroRack: Number(numeroRack) }, devUser.email);
      setNumeroRack('');
      refreshTree();
    } catch (err) {
      setAddRackError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setAddingRack(false);
    }
  }

  async function handleDeactivateGabinete() {
    if (!gabinete) return;
    if (!window.confirm(`¿Desactivar el gabinete "${gabinete.tagGabinete}"?`)) return;
    setDeactivating(true);
    try {
      await deactivateGabinete(projectId!, gabineteId!, devUser.email);
      navigate(`/projects/${projectId}/gabinetes`);
    } catch (err) {
      setAddRackError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const racksForGabinete = (tree?.racks ?? [])
    .filter((r) => r.gabineteId === gabineteId)
    .sort((a, b) => a.numeroRack - b.numeroRack);

  const slotsByRack = new Map<string, Slot[]>();
  for (const slot of tree?.slots ?? []) {
    const list = slotsByRack.get(slot.rackId) ?? [];
    list.push(slot);
    slotsByRack.set(slot.rackId, list);
  }

  const modulesBySlot = new Map<string, PhysicalModule>();
  for (const mod of tree?.modules ?? []) {
    modulesBySlot.set(mod.slotId, mod);
  }

  const error = addRackError ?? gabineteError ?? treeError;
  const loading = gabineteLoading || treeLoading;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{gabinete ? gabinete.tagGabinete : 'Gabinete'}</h1>
          {gabinete && (
            <p className="page-subtitle">
              {gabinete.tipoGabineteNombre ?? '—'}
              {gabinete.tagAnterior && ` · Tag anterior: ${gabinete.tagAnterior}`}
            </p>
          )}
        </div>
        {gabinete && (
          <button
            type="button"
            className="button button--danger"
            disabled={!permissions.canDeactivate || deactivating}
            title={
              permissions.canDeactivate
                ? undefined
                : 'Tu rol no tiene permiso de desactivación en este proyecto.'
            }
            onClick={handleDeactivateGabinete}
          >
            {deactivating ? 'Desactivando…' : 'Desactivar gabinete'}
          </button>
        )}
      </div>

      {gabinete?.descripcion && <p className="page-subtitle">{gabinete.descripcion}</p>}

      <ErrorMessage error={error} />

      {loading && <p>Cargando…</p>}

      {!loading && tree && (
        <>
          {permissions.canWrite && (
            <form className="form form--inline" onSubmit={handleAddRack}>
              <label className="form__field">
                <span>N.º de rack</span>
                <input
                  type="number"
                  min={0}
                  required
                  disabled={addingRack}
                  value={numeroRack}
                  onChange={(event) => setNumeroRack(event.target.value)}
                />
              </label>
              <button type="submit" className="button button--small" disabled={addingRack}>
                + Agregar rack
              </button>
            </form>
          )}

          {racksForGabinete.length === 0 && <p>Este gabinete todavía no tiene racks activos.</p>}

          <div className="physical-tree">
            {racksForGabinete.map((rack) => (
              <RackBlock
                key={rack.id}
                projectId={projectId}
                devUserEmail={devUser.email}
                rack={rack}
                slots={slotsByRack.get(rack.id) ?? []}
                modulesBySlot={modulesBySlot}
                moduleTypes={tree.moduleTypes}
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
