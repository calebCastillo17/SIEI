import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getControlHardware } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlCanalSenal, ControlGabinete, ControlHardwareResponse, ControlRack } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const ESTADO_DOT: Record<string, string> = {
  IO_PENDIENTE: '○',
  RUTA_PENDIENTE: '◐',
  RUTA_CARGADA: '●'
};

/* ---- Íconos — representan la figura real del objeto, no genéricos ---- */

function IconGabinete() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="2" width="16" height="20" rx="1.5" />
      <line x1="7" y1="6" x2="13" y2="6" />
      <line x1="7" y1="9" x2="13" y2="9" />
      <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconRack() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="7.5" x2="21" y2="7.5" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="16.5" x2="21" y2="16.5" />
    </svg>
  );
}

function IconModulo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <line x1="9" y1="1" x2="9" y2="3" />
      <line x1="15" y1="1" x2="15" y2="3" />
      <line x1="9" y1="21" x2="9" y2="23" />
      <line x1="15" y1="21" x2="15" y2="23" />
    </svg>
  );
}

function Toggle({ expanded }: { expanded: boolean }) {
  return <span className={`tree__toggle ${expanded ? 'tree__toggle--open' : ''}`}>▸</span>;
}

/** Fila de canal — se usa apilada verticalmente, como los bornes reales de un módulo. */
function CanalRow({ numeroCanal, senal, projectId }: { numeroCanal: number; senal: ControlCanalSenal | null; projectId: string }) {
  const ocupado = Boolean(senal);
  return (
    <Link
      to={senal ? `/projects/${projectId}/control/signals/${senal.id}` : '#'}
      className={`hw-canal ${ocupado ? 'hw-canal--ocupado' : 'hw-canal--reserva'}`}
      onClick={(e) => { if (!senal) e.preventDefault(); }}
    >
      <span className="hw-canal__num">CH{String(numeroCanal).padStart(2, '0')}</span>
      {senal ? (
        <>
          <span className="hw-canal__estado">{ESTADO_DOT[senal.estadoConexionado]}</span>
          <span className="hw-canal__label">{senal.tagSenal ?? senal.codigoSenal}</span>
          <span className="hw-canal__dueno">
            {senal.duenoAusente ? '⚠ sin dueño' : (senal.duenoTag ?? '—')}
          </span>
        </>
      ) : (
        <span className="hw-canal__label hw-canal__label--reserva">RESERVA</span>
      )}
    </Link>
  );
}

/**
 * Vista de hardware pensada para calcar cómo se ve un gabinete real:
 *
 *   GABINETE (lista vertical, expandible)
 *     -> RACKS del gabinete elegido: fila HORIZONTAL de tarjetas — así se
 *        ven los chasis uno junto a otro en un gabinete real.
 *     -> SLOTS del rack elegido: fila HORIZONTAL de tarjetas — así se ven
 *        los slots de izquierda a derecha en un chasis real.
 *     -> CANALES del slot elegido: lista VERTICAL — así se leen los
 *        bornes/canales de arriba hacia abajo en la cara de un módulo real.
 *
 * Un solo rack y un solo slot "seleccionados" a la vez por gabinete (no
 * acordeón anidado) — el usuario navega el gabinete como si lo tuviera
 * enfrente, no como una lista de listas.
 */
export function ControlHardwarePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);

  const fetchHardware = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlHardwareResponse>({ projectId: '', gabinetes: [] });
    return getControlHardware(projectId, devUser.email);
  }, [projectId, devUser.email]);

  const { data, loading, error, refresh } = useAsyncData<ControlHardwareResponse>(fetchHardware);
  const gabinetes = data?.gabinetes ?? [];

  const [openGabinete, setOpenGabinete] = useState<string | null>(null);
  const [selectedRack, setSelectedRack] = useState<Record<string, string>>({}); // gabineteId -> rackId
  const [selectedSlot, setSelectedSlot] = useState<Record<string, string>>({}); // rackId -> slotId

  const toggleGabinete = (g: ControlGabinete) => {
    const isOpening = openGabinete !== g.id;
    setOpenGabinete(isOpening ? g.id : null);
    // Al abrir por primera vez, selecciona el primer rack y su primer slot
    // con módulo — para que el gabinete "se vea" de inmediato, no vacío.
    if (isOpening && !selectedRack[g.id] && g.racks.length > 0) {
      const firstRack = g.racks[0];
      setSelectedRack((prev) => ({ ...prev, [g.id]: firstRack.id }));
      const firstSlotWithModulo = firstRack.slots.find((s) => s.modulo);
      if (firstSlotWithModulo && !selectedSlot[firstRack.id]) {
        setSelectedSlot((prev) => ({ ...prev, [firstRack.id]: firstSlotWithModulo.id }));
      }
    }
  };

  const chooseRack = (gabineteId: string, rack: ControlRack) => {
    setSelectedRack((prev) => ({ ...prev, [gabineteId]: rack.id }));
    if (!selectedSlot[rack.id]) {
      const firstSlotWithModulo = rack.slots.find((s) => s.modulo);
      if (firstSlotWithModulo) setSelectedSlot((prev) => ({ ...prev, [rack.id]: firstSlotWithModulo.id }));
    }
  };

  const chooseSlot = (rackId: string, slotId: string) => {
    setSelectedSlot((prev) => ({ ...prev, [rackId]: slotId }));
  };

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control — Hardware</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={refresh}>
            Actualizar
          </button>
          <Link className="button button--secondary" to={`/projects/${projectId}/control`}>
            Ver señales
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}/control/groups`}>
            Ver agrupaciones
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}/control/planos`}>
            Ver planos
          </Link>
        </div>
      </div>

      <p className="page-subtitle">
        ● ruta cargada &nbsp; ◐ ruta pendiente &nbsp; ○ IO pendiente &nbsp; — click en un canal ocupado abre el detalle de la señal.
      </p>

      <ErrorMessage error={error} />

      {loading && <p>Cargando hardware…</p>}

      {!loading && gabinetes.length === 0 && <p>Este proyecto todavía no tiene gabinetes cargados.</p>}

      {!loading && (
        <div className="tree">
          {gabinetes.map((g) => {
            const gOpen = openGabinete === g.id;
            const nSlots = g.racks.reduce((n, r) => n + r.slots.length, 0);
            const activeRackId = selectedRack[g.id];
            const activeRack = g.racks.find((r) => r.id === activeRackId);
            const activeSlotId = activeRack ? selectedSlot[activeRack.id] : undefined;
            const activeSlot = activeRack?.slots.find((s) => s.id === activeSlotId);

            return (
              <div key={g.id} className="tree__node">
                <button type="button" className="tree__row tree__row--gabinete" onClick={() => toggleGabinete(g)}>
                  <Toggle expanded={gOpen} />
                  <span className="tree__icon"><IconGabinete /></span>
                  <span className={`badge ${g.tipoGabineteCodigo === 'CONTROL' ? 'badge--control' : 'badge--com'}`}>
                    {g.tipoGabineteCodigo}
                  </span>
                  <strong>{g.tagGabinete}</strong>
                  <span className="page-subtitle">
                    {g.racks.length} rack(s), {nSlots} slot(s)
                  </span>
                </button>

                {gOpen && (
                  <div className="hw-panel">
                    {/* Fila 1: racks, horizontal, como chasis uno junto al otro */}
                    <div className="hw-row">
                      {g.racks.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className={`hw-card ${r.id === activeRackId ? 'hw-card--selected' : ''}`}
                          onClick={() => chooseRack(g.id, r)}
                        >
                          <IconRack />
                          <span>Rack {r.numeroRack}</span>
                          <span className="page-subtitle">{r.slots.length} slot(s)</span>
                        </button>
                      ))}
                    </div>

                    {/* Fila 2: slots del rack elegido, horizontal, izquierda a derecha */}
                    {activeRack && (
                      <div className="hw-row hw-row--slots">
                        {activeRack.slots.map((sl) => (
                          <button
                            key={sl.id}
                            type="button"
                            className={`hw-card hw-card--slot ${sl.id === activeSlotId ? 'hw-card--selected' : ''} ${!sl.modulo ? 'hw-card--vacio' : ''}`}
                            onClick={() => sl.modulo && chooseSlot(activeRack.id, sl.id)}
                            disabled={!sl.modulo}
                          >
                            <IconModulo />
                            <span>SLOT-{String(sl.numeroSlot).padStart(2, '0')}</span>
                            {sl.modulo ? (
                              <span className="page-subtitle">{sl.modulo.modelo} · {sl.modulo.tipoIoCodigo}</span>
                            ) : (
                              <span className="page-subtitle">vacío</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Canales del slot elegido, vertical, como la cara real del módulo */}
                    {activeSlot?.modulo && (
                      <div className="hw-canales">
                        <div className="hw-canales__header">
                          <strong>SLOT-{String(activeSlot.numeroSlot).padStart(2, '0')}</strong>
                          <span className="page-subtitle">
                            {activeSlot.modulo.fabricante} {activeSlot.modulo.modelo} — {activeSlot.modulo.tipoIoCodigo}
                          </span>
                        </div>
                        {activeSlot.modulo.canales.map((c) => (
                          <CanalRow key={c.id} numeroCanal={c.numeroCanal} senal={c.senal} projectId={projectId} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
