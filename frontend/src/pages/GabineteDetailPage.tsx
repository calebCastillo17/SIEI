import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateGabinete, getGabinete } from '../api/gabinetes';
import { createRack, deactivateRack, updateRack } from '../api/racks';
import { createSlot, deleteSlot } from '../api/slots';
import { createModule, deleteModule, updateModule } from '../api/modules';
import { listChannels } from '../api/channels';
import { getModuloTerminales, syncModuloTerminales, listBloquesTerminal, updateBloqueTerminal } from '../api/terminaciones';
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

/*
 * Terminales de un módulo (migración 015) — solo lectura: se
 * materializan solos (TR_modulo_generar_terminales), esta vista solo
 * los lista. "Sincronizar" invoca sp_sincronizar_terminales_modulo,
 * necesario cuando se agregan filas nuevas a cat.cat_modulo_io_terminal
 * después de instalar el módulo (agregar una fila de catálogo no
 * dispara ningún trigger de nucleo.modulo).
 */
function ModuloTerminalesView({
  projectId,
  devUserEmail,
  moduloId
}: {
  projectId: string;
  devUserEmail: string;
  moduloId: string;
}) {
  const fetchTerminales = useCallback(
    () => getModuloTerminales(projectId, moduloId, devUserEmail),
    [projectId, devUserEmail, moduloId]
  );
  const { data, loading, error, refresh } = useAsyncData(fetchTerminales);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<Error | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await syncModuloTerminales(projectId, moduloId, devUserEmail);
      refresh();
    } catch (err) {
      setSyncError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <p className="physical-hint">Cargando terminales…</p>;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="physical-channels">
      <ErrorMessage error={syncError} />
      {(data?.terminales ?? []).length === 0 && <span className="physical-hint">Sin terminales materializados.</span>}
      {data?.terminales.map((t) => (
        <span key={t.id} className="badge badge--control" title={`Canal ${t.numeroCanal ?? '—'}`}>
          {t.numero}
        </span>
      ))}
      <button type="button" className="button button--secondary button--small" disabled={syncing} onClick={handleSync}>
        {syncing ? 'Sincronizando…' : 'Sincronizar con catálogo'}
      </button>
    </div>
  );
}

/* ---- Tag (codigo) del Terminal Block (bloque_terminal) de un módulo —
 * se materializa solo (TR_modulo_generar_terminales) con codigo="MODULO"
 * como centinela de "todavía sin tag real" (migración 015); acá se le
 * pone el nombre real, ej. "TB-01" (pedido del usuario, migración 017 —
 * la columna en sí ya existía, solo faltaba esta edición). */
const TB_SIN_ASIGNAR = 'MODULO';

function TerminalBlockTagEditor({
  projectId,
  devUserEmail,
  moduloId,
  canWrite
}: {
  projectId: string;
  devUserEmail: string;
  moduloId: string;
  canWrite: boolean;
}) {
  const fetchBloque = useCallback(
    () => listBloquesTerminal(projectId, devUserEmail, { moduloId }).then((r) => r.bloquesTerminal[0] ?? null),
    [projectId, devUserEmail, moduloId]
  );
  const { data: bloque, loading, error, refresh } = useAsyncData(fetchBloque);
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);

  if (loading) return <span className="physical-hint">TB…</span>;
  if (error) return <ErrorMessage error={error} />;
  if (!bloque) return null;

  const sinAsignar = bloque.codigo === TB_SIN_ASIGNAR;

  async function handleSave() {
    if (!bloque || !value.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateBloqueTerminal(projectId, bloque.id, { codigo: value.trim() }, devUserEmail);
      setEditing(false);
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="physical-inline-edit">
        <ErrorMessage error={saveError} />
        <input
          type="text"
          placeholder="TB-01"
          maxLength={20}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
        />
        <button type="button" className="button button--small" disabled={saving || !value.trim()} onClick={handleSave}>
          Guardar
        </button>
        <button type="button" className="button button--secondary button--small" disabled={saving} onClick={() => setEditing(false)}>
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <span className="physical-hint">
      TB: {sinAsignar ? 'sin asignar' : bloque.codigo}
      {canWrite && (
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => {
            setValue(sinAsignar ? '' : bloque.codigo);
            setEditing(true);
          }}
        >
          {sinAsignar ? 'Asignar' : 'Editar'}
        </button>
      )}
    </span>
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
  const [showTerminales, setShowTerminales] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [installTag, setInstallTag] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [editingSurge, setEditingSurge] = useState(false);
  const [surgeValue, setSurgeValue] = useState('');

  async function handleInstall(event: FormEvent) {
    event.preventDefault();
    if (!selectedType) return;
    setSubmitting(true);
    setError(null);
    try {
      // tag en blanco = dejar que el backend sugiera el default
      // (TIPO-orden, migración 017) — no se manda "" literal.
      await createModule(
        projectId,
        { slotId: slot.id, catalogoModuloId: selectedType, tag: installTag.trim() || null },
        devUserEmail
      );
      setInstallTag('');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveSurgeTag() {
    if (!module) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateModule(projectId, module.id, { surgeProtectorTag: surgeValue.trim() || null }, devUserEmail);
      setEditingSurge(false);
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
      await updateModule(projectId, module.id, { catalogoModuloId: newTypeId }, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivateModule() {
    if (!module) return;
    if (
      !window.confirm(
        `¿Eliminar el módulo del slot ${slot.numeroSlot}? Se borra de verdad (no queda como historial) — el slot queda vacío.`
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await deleteModule(projectId, module.id, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivateSlot() {
    if (
      !window.confirm(
        `¿Eliminar el slot ${slot.numeroSlot}? Se borra de verdad, junto con su módulo si tiene uno. ` +
          'Los slots siguientes de este rack bajan un número cada uno, para no dejar huecos.'
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await deleteSlot(projectId, slot.id, devUserEmail);
      if (result.advertenciaRetagear) {
        window.alert(
          'El módulo de este slot tenía tag, Terminal Block y/o Surge Protector asignados. ' +
            'Al bajar de número los slots siguientes, esa numeración (TB-XX/DISPR-XX) puede haber quedado ' +
            'desalineada — revísala a mano si hace falta.'
        );
      }
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  // "Cambiar tipo" solo ofrece tipos del MISMO tipo de E/S que el actual —
  // el backend ya rechaza (409) un cambio de tipo con canales en uso
  // (migración 018), esto solo evita ofrecer en el desplegable una opción
  // que de todos modos nunca tendría sentido con señales ya wireadas.
  const sameIoTypeOptions = module
    ? moduleTypes.filter((t) => t.tipoIoCodigo === module.tipoIoCodigo && t.id !== module.catalogoModuloId)
    : [];

  return (
    <div className="physical-slot">
      <div className="physical-slot__header">
        <span className="physical-slot__title">Slot {slot.numeroSlot}</span>

        {module ? (
          <span className="physical-slot__module">
            {module.tag && <span className="badge badge--control">{module.tag}</span>}
            <span className="physical-slot__module-desc">
              {module.fabricante} {module.modelo} ({module.canalesMax} canales)
            </span>
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
          Eliminar slot
        </button>
      </div>

      <ErrorMessage error={error} />

      {module ? (
        <>
          <div className="physical-slot__meta">
            <TerminalBlockTagEditor
              projectId={projectId}
              devUserEmail={devUserEmail}
              moduloId={module.id}
              canWrite={permissions.canWrite}
            />

            {permissions.canWrite && (
              editingSurge ? (
                <span className="physical-inline-edit">
                  <input
                    type="text"
                    placeholder="DISPR01"
                    maxLength={20}
                    value={surgeValue}
                    onChange={(event) => setSurgeValue(event.target.value)}
                    disabled={submitting}
                  />
                  <button type="button" className="button button--small" disabled={submitting} onClick={handleSaveSurgeTag}>
                    Guardar
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={submitting}
                    onClick={() => setEditingSurge(false)}
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <span className="physical-hint">
                  Surge: {module.surgeProtectorTag ?? 'sin asignar'}
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => {
                      setSurgeValue(module.surgeProtectorTag ?? '');
                      setEditingSurge(true);
                    }}
                  >
                    {module.surgeProtectorTag ? 'Editar' : 'Asignar'}
                  </button>
                </span>
              )
            )}
          </div>

          <div className="physical-slot__views">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setShowChannels((v) => !v)}
            >
              {showChannels ? 'Ocultar canales' : 'Ver canales'}
            </button>

            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setShowTerminales((v) => !v)}
            >
              {showTerminales ? 'Ocultar terminales' : 'Ver terminales'}
            </button>

            {showChannels && (
              <ChannelsView projectId={projectId} devUserEmail={devUserEmail} moduloId={module.id} />
            )}
            {showTerminales && (
              <ModuloTerminalesView projectId={projectId} devUserEmail={devUserEmail} moduloId={module.id} />
            )}
          </div>

          {permissions.canWrite && (
            <div className="physical-slot__danger">
              {sameIoTypeOptions.length > 0 && (
                <select
                  disabled={submitting}
                  value=""
                  onChange={(event) => handleChangeType(event.target.value)}
                  title="Solo se ofrecen modelos del mismo tipo de E/S — un cambio a otro tipo con señales ya asignadas se rechaza."
                >
                  <option value="">— cambiar de modelo (mismo tipo) —</option>
                  {sameIoTypeOptions.map((type) => (
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
                Eliminar módulo
              </button>
            </div>
          )}
        </>
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
            <input
              type="text"
              placeholder="Tag (vacío = sugerido automático)"
              maxLength={20}
              disabled={submitting}
              value={installTag}
              onChange={(event) => setInstallTag(event.target.value)}
            />
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
  const [editingLimite, setEditingLimite] = useState(false);
  const [limiteValue, setLimiteValue] = useState('');

  async function handleSaveLimite() {
    setSubmitting(true);
    setError(null);
    try {
      await updateRack(
        projectId,
        rack.id,
        { limiteSlots: limiteValue.trim() === '' ? null : Number(limiteValue) },
        devUserEmail
      );
      setEditingLimite(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

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
        <span className="physical-hint">
          {slots.length}{rack.limiteSlots !== null ? `/${rack.limiteSlots}` : ''} slot(s)
        </span>

        {editingLimite ? (
          <span className="physical-inline-edit">
            <input
              type="number"
              min={1}
              placeholder="sin límite"
              value={limiteValue}
              onChange={(event) => setLimiteValue(event.target.value)}
              disabled={submitting}
            />
            <button type="button" className="button button--small" disabled={submitting} onClick={handleSaveLimite}>
              Guardar
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={submitting}
              onClick={() => setEditingLimite(false)}
            >
              Cancelar
            </button>
          </span>
        ) : (
          permissions.canWrite && (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                setLimiteValue(rack.limiteSlots !== null ? String(rack.limiteSlots) : '');
                setEditingLimite(true);
              }}
            >
              {rack.limiteSlots !== null ? 'Editar límite' : '+ Límite de slots'}
            </button>
          )
        )}

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
              <p className="physical-hint physical-hint--block">
                El número de slot que elijas se colocará en ese orden, y los demás órdenes se modificarán.
              </p>
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
  const [limiteSlotsNuevoRack, setLimiteSlotsNuevoRack] = useState('');
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
      await createRack(
        projectId!,
        {
          gabineteId: gabineteId!,
          numeroRack: Number(numeroRack),
          limiteSlots: limiteSlotsNuevoRack.trim() === '' ? null : Number(limiteSlotsNuevoRack)
        },
        devUser.email
      );
      setNumeroRack('');
      setLimiteSlotsNuevoRack('');
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

      {loading && !tree && <p>Cargando…</p>}

      {tree && (
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
              <label className="form__field">
                <span>Límite de slots (opcional)</span>
                <input
                  type="number"
                  min={1}
                  placeholder="sin límite"
                  disabled={addingRack}
                  value={limiteSlotsNuevoRack}
                  onChange={(event) => setLimiteSlotsNuevoRack(event.target.value)}
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
