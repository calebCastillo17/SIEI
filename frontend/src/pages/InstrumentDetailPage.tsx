import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import {
  deactivateInstrument,
  deleteInstrumentDefinitivamente,
  getInstrument,
  updateInstrument
} from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import type { Instrument, InstrumentInput } from '../api/types';
import { InstrumentForm } from '../components/InstrumentForm';
import { useInstrumentFormOptions } from '../components/useInstrumentFormOptions';
import { PnidEstadoBadge } from '../components/PnidEstadoBadge';
import { ErrorMessage } from '../components/ErrorMessage';
import { usePnidEstados } from '../components/usePnidEstados';
import { useProjectUserDirectory } from '../components/useProjectUserDirectory';

/** `createdBy`/`updatedBy` son solo un id — se muestra el nombre si el
 * directorio de miembros del proyecto lo resuelve, o el id crudo como
 * respaldo (ej. un es_admin_sistema sin asignación explícita en este
 * proyecto, ver useProjectUserDirectory). */
function formatUser(
  userId: string | null,
  directory: Map<string, { email: string; nombre: string }>
): string {
  if (userId === null) return '—';
  const entry = directory.get(userId);
  return entry ? `${entry.nombre} (${entry.email})` : `Usuario #${userId}`;
}

function toInput(instrument: Instrument): InstrumentInput {
  return {
    tagInstrumento: instrument.tagInstrumento,
    descripcion: instrument.descripcion,
    tipoInstrumento: instrument.tipoInstrumento,
    servicio: instrument.servicio,
    sistema: instrument.sistema,
    ubicacion: instrument.ubicacion,
    nodo: instrument.nodo,
    tagAnterior: instrument.tagAnterior,
    tecnologia: instrument.tecnologia,
    funcionamiento: instrument.funcionamiento,
    cuerpoInstrumento: instrument.cuerpoInstrumento,
    conexionProceso: instrument.conexionProceso,
    planoPnid: instrument.planoPnid,
    lineaPnid: instrument.lineaPnid,
    tipoSenalPnid: instrument.tipoSenalPnid,
    equipoAsociadoId: instrument.equipoAsociadoId,
    equipoAsociadoTag: instrument.equipoAsociadoTag,
    instrumentoAsociadoId: instrument.instrumentoAsociadoId,
    instrumentoAsociadoTag: instrument.instrumentoAsociadoTag
  };
}

export function InstrumentDetailPage() {
  const { projectId, instrumentId } = useParams<{
    projectId: string;
    instrumentId: string;
  }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;
  const canDeactivate = project?.access.permissions.deactivate ?? false;
  const canAdminister = project?.access.permissions.administer ?? false;

  const fetchInstrument = useCallback(() => {
    if (!projectId || !instrumentId) return Promise.resolve<Instrument | null>(null);
    return getInstrument(projectId, instrumentId, devUser.email).then(
      (response) => response.instrument
    );
  }, [projectId, instrumentId, devUser.email]);

  const {
    data: instrument,
    loading,
    error: loadError,
    refresh: load
  } = useAsyncData<Instrument | null>(fetchInstrument);

  const {
    data: formOptions,
    loading: optionsLoading,
    error: optionsError
  } = useInstrumentFormOptions(projectId ?? '', devUser.email);

  const { itemsById: pnidEstadosById } = usePnidEstados(devUser.email);
  const userDirectory = useProjectUserDirectory(projectId ?? '', devUser.email);

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deletingDefinitivamente, setDeletingDefinitivamente] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId || !instrumentId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleUpdate(value: InstrumentInput) {
    setSubmitting(true);
    setActionError(null);

    try {
      await updateInstrument(projectId!, instrumentId!, value, devUser.email);
      setEditing(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!instrument) return;

    const confirmed = window.confirm(
      `¿Desactivar el instrumento "${instrument.tagInstrumento}"?`
    );
    if (!confirmed) return;

    setDeactivating(true);
    setActionError(null);

    try {
      await deactivateInstrument(projectId!, instrumentId!, devUser.email);
      navigate(`/projects/${projectId}/instruments`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  /** Borrado físico real (migración 011 + 016) — SOLO habilitado cuando el
   * estado P&ID es NO_EXISTE_EN_PNID. Las señales que tenían a este
   * instrumento como dueño sobreviven activas marcadas "sin dueño"; solo
   * puntos de conexión/lazos/enlaces de comunicación reales siguen
   * bloqueando (409 `instrument_in_use`), igual que antes de la 016. */
  async function handleDeleteDefinitivamente() {
    if (!instrument) return;

    const confirmed = window.confirm(
      `¿ELIMINAR DEFINITIVAMENTE el instrumento "${instrument.tagInstrumento}"? ` +
        'Esto lo borra de forma permanente — no hay forma de deshacerlo. ' +
        'Las señales que dependían de él quedarán activas pero marcadas "sin dueño". ' +
        'Si tiene puntos de conexión, lazos o enlaces de comunicación reales, la operación se rechaza.'
    );
    if (!confirmed) return;

    setDeletingDefinitivamente(true);
    setActionError(null);

    try {
      await deleteInstrumentDefinitivamente(projectId!, instrumentId!, devUser.email);
      navigate(`/projects/${projectId}/instruments`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeletingDefinitivamente(false);
    }
  }

  const error = actionError ?? loadError ?? optionsError;
  const estadoPnidCodigo = instrument?.estadoPnidId
    ? (pnidEstadosById.get(instrument.estadoPnidId)?.codigo ?? null)
    : null;
  const elegibleParaEliminacion = estadoPnidCodigo === 'NO_EXISTE_EN_PNID';

  return (
    <section>
      <div className="page-header">
        <h1>{instrument ? instrument.tagInstrumento : 'Instrumento'}</h1>

        {instrument && !editing && (
          <div className="page-header__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!canWrite}
              title={canWrite ? undefined : 'Tu rol no tiene permiso de escritura en este proyecto.'}
              onClick={() => setEditing(true)}
            >
              Editar
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={!canDeactivate || deactivating}
              title={
                canDeactivate
                  ? undefined
                  : 'Tu rol no tiene permiso de desactivación en este proyecto.'
              }
              onClick={handleDeactivate}
            >
              {deactivating ? 'Desactivando…' : 'Desactivar'}
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={!canAdminister || !elegibleParaEliminacion || deletingDefinitivamente}
              title={
                !canAdminister
                  ? 'Eliminar definitivamente un instrumento requiere permiso de administración en el proyecto.'
                  : !elegibleParaEliminacion
                    ? 'Solo se puede eliminar definitivamente un instrumento cuyo estado P&ID sea "No existe en P&ID".'
                    : 'Borra el instrumento de forma permanente.'
              }
              onClick={handleDeleteDefinitivamente}
            >
              {deletingDefinitivamente ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          </div>
        )}
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando instrumento…</p>}

      {!loading && instrument && !editing && (
        <>
          <dl className="detail-list">
            <div>
              <dt>Tipo</dt>
              <dd>{instrument.tipoInstrumento ?? '—'}</dd>
            </div>
            <div>
              <dt>Servicio</dt>
              <dd>{instrument.servicio ?? '—'}</dd>
            </div>
            <div>
              <dt>Sistema</dt>
              <dd>{instrument.sistema ?? '—'}</dd>
            </div>
            <div>
              <dt>Ubicación</dt>
              <dd>{instrument.ubicacion ?? '—'}</dd>
            </div>
            <div>
              <dt>Nodo</dt>
              <dd>{instrument.nodo ?? '—'}</dd>
            </div>
            <div>
              <dt>Descripción</dt>
              <dd>{instrument.descripcion ?? '—'}</dd>
            </div>
            <div>
              <dt>Creado</dt>
              <dd>{new Date(instrument.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Creado por</dt>
              <dd>{formatUser(instrument.createdBy, userDirectory)}</dd>
            </div>
            <div>
              <dt>Última actualización</dt>
              <dd>
                {instrument.updatedAt
                  ? new Date(instrument.updatedAt).toLocaleString()
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Última actualización por</dt>
              <dd>{formatUser(instrument.updatedBy, userDirectory)}</dd>
            </div>
          </dl>

          <h2>Datos P&amp;ID</h2>
          <p className="form__note">
            PNPID, fuente PNPID y estado P&amp;ID los administra la
            importación P&amp;ID (Instrumentos → Importar P&amp;ID) — no son
            editables desde este formulario.
          </p>
          <dl className="detail-list">
            <div>
              <dt>PNPID</dt>
              <dd>{instrument.pnpid ?? '—'}</dd>
            </div>
            <div>
              <dt>Fuente PNPID</dt>
              <dd>{instrument.fuentePnpid ?? '—'}</dd>
            </div>
            <div>
              <dt>Estado P&amp;ID</dt>
              <dd>
                <PnidEstadoBadge codigo={estadoPnidCodigo} />
              </dd>
            </div>
            <div>
              <dt>TAG anterior</dt>
              <dd>{instrument.tagAnterior ?? '—'}</dd>
            </div>
            <div>
              <dt>Tecnología</dt>
              <dd>{instrument.tecnologia ?? '—'}</dd>
            </div>
            <div>
              <dt>Funcionamiento</dt>
              <dd>{instrument.funcionamiento ?? '—'}</dd>
            </div>
            <div>
              <dt>Cuerpo del instrumento</dt>
              <dd>{instrument.cuerpoInstrumento ?? '—'}</dd>
            </div>
            <div>
              <dt>Conexión a proceso</dt>
              <dd>{instrument.conexionProceso ?? '—'}</dd>
            </div>
            <div>
              <dt>Plano P&amp;ID</dt>
              <dd>{instrument.planoPnid ?? '—'}</dd>
            </div>
            <div>
              <dt>Línea P&amp;ID</dt>
              <dd>{instrument.lineaPnid ?? '—'}</dd>
            </div>
            <div>
              <dt>Tipo de señal (P&amp;ID)</dt>
              <dd>{instrument.tipoSenalPnid ?? '—'}</dd>
            </div>
            <div>
              <dt>Equipo asociado (tag libre)</dt>
              <dd>{instrument.equipoAsociadoTag ?? '—'}</dd>
            </div>
            <div>
              <dt>Instrumento asociado</dt>
              <dd>
                {instrument.instrumentoAsociadoId ? (
                  <Link to={`/projects/${projectId}/instruments/${instrument.instrumentoAsociadoId}`}>
                    Ver instrumento
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Instrumento asociado (tag libre)</dt>
              <dd>{instrument.instrumentoAsociadoTag ?? '—'}</dd>
            </div>
            <div>
              <dt>Fecha agregado</dt>
              <dd>{instrument.fechaAgregado ?? '—'}</dd>
            </div>
            <div>
              <dt>Fecha última revisión</dt>
              <dd>{instrument.fechaUltimaRevision ?? '—'}</dd>
            </div>
          </dl>
        </>
      )}

      {!loading && instrument && editing && (
        <>
          {optionsLoading && <p>Cargando opciones del formulario…</p>}
          {formOptions && (
            <InstrumentForm
              initialValue={toInput(instrument)}
              options={formOptions}
              currentInstrumentId={instrument.id}
              submitLabel="Guardar cambios"
              submitting={submitting}
              disabled={!canWrite}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
