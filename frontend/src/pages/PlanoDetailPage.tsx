import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  associateCaja,
  associateGabinete,
  deactivatePlano,
  disassociateCaja,
  disassociateGabinete,
  getPlano,
  updatePlano
} from '../api/planos';
import { listGabinetes } from '../api/gabinetes';
import { listBoxes } from '../api/boxes';
import { useAsyncData } from '../lib/useAsyncData';
import { usePlanoFormOptions } from '../components/usePlanoFormOptions';
import type { Box, Gabinete, PlanoDetail, PlanoInput } from '../api/types';
import { PlanoForm } from '../components/PlanoForm';
import { CatalogSelect } from '../components/CatalogSelect';
import { ErrorMessage } from '../components/ErrorMessage';

function toInput(plano: PlanoDetail): PlanoInput {
  return {
    codigoPlano: plano.codigoPlano,
    codigoAnterior: plano.codigoAnterior,
    descripcion: plano.descripcion,
    tipoPlanoId: plano.tipoPlanoId ?? ''
  };
}

interface PermissionFlags {
  canWrite: boolean;
  canDeactivate: boolean;
}

/* ---- Sección "Gabinetes asociados": selector + Asociar, lista + Quitar ---- */

function GabinetesAsociadosSection({
  projectId,
  devUserEmail,
  plano,
  gabinetes,
  permissions,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  plano: PlanoDetail;
  gabinetes: Gabinete[];
  permissions: PermissionFlags;
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const asociados = new Set(plano.gabinetes.map((g) => g.gabineteId));
  const disponibles = gabinetes.filter((g) => !asociados.has(g.id));

  async function handleAssociate() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await associateGabinete(projectId, plano.id, selected, devUserEmail);
      setSelected(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(gabineteId: string) {
    if (!window.confirm('¿Quitar esta asociación?')) return;
    setRemovingId(gabineteId);
    setError(null);
    try {
      await disassociateGabinete(projectId, plano.id, gabineteId, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="form__section">
      <h2>Gabinetes asociados</h2>
      <ErrorMessage error={error} />

      {plano.gabinetes.length === 0 && <p className="physical-hint">Sin gabinetes asociados.</p>}

      {plano.gabinetes.map((g) => (
        <div key={g.gabineteId} className="physical-slot__module-actions">
          <span className="physical-slot__module">
            {g.tagGabinete} {g.tipoGabineteCodigo ? `(${g.tipoGabineteCodigo})` : ''}
          </span>
          <button
            type="button"
            className="button button--danger button--small"
            disabled={!permissions.canWrite || removingId === g.gabineteId}
            onClick={() => handleRemove(g.gabineteId)}
          >
            {removingId === g.gabineteId ? 'Quitando…' : 'Quitar'}
          </button>
        </div>
      ))}

      {permissions.canWrite && (
        <div className="physical-slot__install-form">
          <CatalogSelect
            disabled={submitting}
            value={selected}
            onChange={setSelected}
            options={disponibles.map((g) => ({ id: g.id, label: g.tagGabinete }))}
            emptyLabel="— elegir gabinete —"
          />
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={!selected || submitting}
            onClick={handleAssociate}
          >
            {submitting ? 'Asociando…' : 'Asociar'}
          </button>
        </div>
      )}
    </section>
  );
}

/* ---- Sección "Cajas asociadas": mismo patrón ---- */

function CajasAsociadasSection({
  projectId,
  devUserEmail,
  plano,
  cajas,
  permissions,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  plano: PlanoDetail;
  cajas: Box[];
  permissions: PermissionFlags;
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const asociadas = new Set(plano.cajas.map((c) => c.cajaId));
  const disponibles = cajas.filter((c) => !asociadas.has(c.id));

  async function handleAssociate() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await associateCaja(projectId, plano.id, selected, devUserEmail);
      setSelected(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(cajaId: string) {
    if (!window.confirm('¿Quitar esta asociación?')) return;
    setRemovingId(cajaId);
    setError(null);
    try {
      await disassociateCaja(projectId, plano.id, cajaId, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="form__section">
      <h2>Cajas asociadas</h2>
      <ErrorMessage error={error} />

      {plano.cajas.length === 0 && <p className="physical-hint">Sin cajas asociadas.</p>}

      {plano.cajas.map((c) => (
        <div key={c.cajaId} className="physical-slot__module-actions">
          <span className="physical-slot__module">{c.tagCaja}</span>
          <button
            type="button"
            className="button button--danger button--small"
            disabled={!permissions.canWrite || removingId === c.cajaId}
            onClick={() => handleRemove(c.cajaId)}
          >
            {removingId === c.cajaId ? 'Quitando…' : 'Quitar'}
          </button>
        </div>
      ))}

      {permissions.canWrite && (
        <div className="physical-slot__install-form">
          <CatalogSelect
            disabled={submitting}
            value={selected}
            onChange={setSelected}
            options={disponibles.map((c) => ({ id: c.id, label: c.tagCaja }))}
            emptyLabel="— elegir caja —"
          />
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={!selected || submitting}
            onClick={handleAssociate}
          >
            {submitting ? 'Asociando…' : 'Asociar'}
          </button>
        </div>
      )}
    </section>
  );
}

export function PlanoDetailPage() {
  const { projectId, planoId } = useParams<{ projectId: string; planoId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const permissions: PermissionFlags = {
    canWrite: project?.access.permissions.write ?? false,
    canDeactivate: project?.access.permissions.deactivate ?? false
  };

  const fetchPlano = useCallback(() => {
    if (!projectId || !planoId) return Promise.resolve<PlanoDetail | null>(null);
    return getPlano(projectId, planoId, devUser.email).then((response) => response.plano);
  }, [projectId, planoId, devUser.email]);

  const {
    data: plano,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<PlanoDetail | null>(fetchPlano);

  const fetchGabinetes = useCallback(() => {
    if (!projectId) return Promise.resolve<Gabinete[]>([]);
    return listGabinetes(projectId, devUser.email).then((response) => response.gabinetes);
  }, [projectId, devUser.email]);

  const { data: gabinetes } = useAsyncData<Gabinete[]>(fetchGabinetes);

  const fetchCajas = useCallback(() => {
    if (!projectId) return Promise.resolve<Box[]>([]);
    return listBoxes(projectId, devUser.email).then((response) => response.boxes);
  }, [projectId, devUser.email]);

  const { data: cajas } = useAsyncData<Box[]>(fetchCajas);

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  const { data: options, loading: optionsLoading } = usePlanoFormOptions(devUser.email);

  if (!projectId || !planoId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleUpdate(value: PlanoInput) {
    setSubmitting(true);
    setActionError(null);

    try {
      await updatePlano(projectId!, planoId!, value, devUser.email);
      setEditing(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!plano) return;

    const confirmed = window.confirm(`¿Desactivar el plano "${plano.codigoPlano ?? `#${plano.id}`}"?`);
    if (!confirmed) return;

    setDeactivating(true);
    setActionError(null);

    try {
      await deactivatePlano(projectId!, planoId!, devUser.email);
      navigate(`/projects/${projectId}/planos`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <h1>{plano ? (plano.codigoPlano ?? `Plano #${plano.id}`) : 'Plano'}</h1>

        {plano && !editing && (
          <div className="page-header__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!permissions.canWrite}
              title={permissions.canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
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
              onClick={handleDeactivate}
            >
              {deactivating ? 'Desactivando…' : 'Desactivar'}
            </button>
          </div>
        )}
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando plano…</p>}

      {!loading && plano && !editing && (
        <>
          <dl className="detail-list">
            <div>
              <dt>Código</dt>
              <dd>{plano.codigoPlano ?? '—'}</dd>
            </div>
            <div>
              <dt>Descripción</dt>
              <dd>{plano.descripcion}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              <dd>{plano.tipoPlanoCodigo ?? '—'}</dd>
            </div>
            <div>
              <dt>Código anterior</dt>
              <dd>{plano.codigoAnterior ?? '—'}</dd>
            </div>
            <div>
              <dt>Creado</dt>
              <dd>{new Date(plano.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Última actualización</dt>
              <dd>{plano.updatedAt ? new Date(plano.updatedAt).toLocaleString() : '—'}</dd>
            </div>
          </dl>

          <GabinetesAsociadosSection
            projectId={projectId}
            devUserEmail={devUser.email}
            plano={plano}
            gabinetes={gabinetes ?? []}
            permissions={permissions}
            onChange={load}
          />

          <CajasAsociadasSection
            projectId={projectId}
            devUserEmail={devUser.email}
            plano={plano}
            cajas={cajas ?? []}
            permissions={permissions}
            onChange={load}
          />
        </>
      )}

      {!loading && plano && editing && optionsLoading && <p>Cargando catálogos…</p>}

      {!loading && plano && editing && options && (
        <PlanoForm
          initialValue={toInput(plano)}
          options={options}
          submitLabel="Guardar cambios"
          submitting={submitting}
          disabled={!permissions.canWrite}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      )}
    </section>
  );
}
