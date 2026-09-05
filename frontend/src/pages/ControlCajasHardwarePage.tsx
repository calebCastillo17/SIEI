import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getControlCajas } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlCajasResponse, ControlPanelUnificado, ControlPosicionSenal } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/* ---- Íconos — mismo criterio que ControlHardwarePage (figura real, no genérica) ---- */

/** CAJA: un TB real, con la línea horizontal que sugiere bornes. */
function IconCaja() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/** EQUIPO (panel eléctrico) — distinto de una caja a propósito (sin la
 * línea horizontal que sugiere un TB con bornas): un rayo dentro del
 * recuadro, no un TB. */
function IconPanel() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M13 8 9 13h3l-1 4 4-5h-3l1-4z" strokeLinejoin="round" />
    </svg>
  );
}

function IconBloque() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="7" width="16" height="10" rx="1" />
      <line x1="8" y1="7" x2="8" y2="17" />
      <line x1="12" y1="7" x2="12" y2="17" />
      <line x1="16" y1="7" x2="16" y2="17" />
    </svg>
  );
}

function Toggle({ expanded }: { expanded: boolean }) {
  return <span className={`tree__toggle ${expanded ? 'tree__toggle--open' : ''}`}>▸</span>;
}

/** Fila de posición — mismo patrón visual que CanalRow (ControlHardwarePage),
 * porque acá la unidad ocupable no es un canal sino una posición dentro de
 * un terminal (migración 015). Solo aplica a paneles tipo CAJA. */
function PosicionRow({
  terminalNumero,
  posicionCodigo,
  senal,
  estado,
  projectId
}: {
  terminalNumero: string;
  posicionCodigo: string;
  senal: ControlPosicionSenal | null;
  estado: 'OCUPADO' | 'RESERVA';
  projectId: string;
}) {
  const ocupado = estado === 'OCUPADO';
  return (
    <Link
      to={senal ? `/projects/${projectId}/control/signals/${senal.id}` : '#'}
      className={`hw-canal ${ocupado ? 'hw-canal--ocupado' : 'hw-canal--reserva'}`}
      onClick={(e) => { if (!senal) e.preventDefault(); }}
    >
      <span className="hw-canal__num">
        T{terminalNumero}/{posicionCodigo}
      </span>
      {senal ? (
        <>
          <span className="hw-canal__estado" aria-hidden="true" />
          <span className="hw-canal__label">{senal.tagSenal ?? senal.codigoSenal}</span>
          <span className="hw-canal__dueno">
            {senal.duenoAusente ? '⚠ sin dueño' : (senal.duenoTag ?? '—')}
          </span>
          <span className="hw-canal__ruta">
            {senal.tagCable ? `${senal.tagCable} · cond. ${senal.conductorCodigo}` : ''}
            {senal.destinoGabineteTag ? ` · hacia ${senal.destinoGabineteTag}` : ''}
          </span>
        </>
      ) : (
        <span className="hw-canal__label hw-canal__label--reserva">LIBRE</span>
      )}
    </Link>
  );
}

const FILTROS_TIPO = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'CAJA', label: 'Cajas' },
  { value: 'EQUIPO', label: 'Paneles eléctricos' }
] as const;

/**
 * Vista de hardware de PANELES — la contraparte de ControlHardwarePage
 * (que cubre Gabinete/RIO -> rack/slot/módulo), pero para el segundo nodo
 * de la ruta física (instrumento/equipo -> PANEL -> gabinete -> módulo).
 *
 * Unifica lo que antes eran dos secciones separadas (una caja real, con
 * TB/bornes; un panel eléctrico, un EQUIPO sin bornes modelados) en una
 * sola lista — pedido explícito del usuario: "ya no lo llamaremos cajas
 * sino panel... dentro de los paneles pueden ir cajas, o estos paneles
 * eléctricos". Cada fila trae una insignia de tipo (Caja / Panel
 * eléctrico) y un resumen común (señales, cables, gabinetes hacia los que
 * continúa) para poder escanear/filtrar sin entrar al detalle — solo una
 * fila de tipo CAJA es expandible (bloques/TB/bornes); una de tipo EQUIPO
 * ya muestra sus señales directamente, no tiene nada más que expandir.
 */
export function ControlCajasHardwarePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);

  const fetchCajas = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlCajasResponse>({ projectId: '', paneles: [] });
    return getControlCajas(projectId, devUser.email);
  }, [projectId, devUser.email]);

  const { data, loading, error, refresh } = useAsyncData<ControlCajasResponse>(fetchCajas);
  const paneles = data?.paneles ?? [];

  const [filtroTipo, setFiltroTipo] = useState<(typeof FILTROS_TIPO)[number]['value']>('TODOS');
  const [filtroGabinete, setFiltroGabinete] = useState<string>('TODOS');
  const [busqueda, setBusqueda] = useState('');

  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [selectedBloque, setSelectedBloque] = useState<Record<string, string>>({}); // panelId -> bloqueId

  const gabinetesDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const p of paneles) for (const g of p.gabinetesTags) set.add(g);
    return [...set].sort();
  }, [paneles]);

  const panelesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return paneles.filter((p) => {
      if (filtroTipo !== 'TODOS' && p.tipo !== filtroTipo) return false;
      if (filtroGabinete !== 'TODOS' && !p.gabinetesTags.includes(filtroGabinete)) return false;
      if (q) {
        const enTag = p.tag.toLowerCase().includes(q);
        const enSenales = p.senales.some((s) => (s.tagSenal ?? s.codigoSenal ?? '').toLowerCase().includes(q));
        if (!enTag && !enSenales) return false;
      }
      return true;
    });
  }, [paneles, filtroTipo, filtroGabinete, busqueda]);

  const togglePanel = (p: ControlPanelUnificado) => {
    const isOpening = openPanel !== p.id;
    setOpenPanel(isOpening ? p.id : null);
    if (isOpening && p.tipo === 'CAJA' && !selectedBloque[p.id] && p.bloques && p.bloques.length > 0) {
      setSelectedBloque((prev) => ({ ...prev, [p.id]: p.bloques![0].id }));
    }
  };

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control — Hardware (paneles)</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          {/* Esta vista es de solo lectura (hardware/routing) — crear o
           * editar una caja real sigue viviendo en el CRUD de nucleo.caja,
           * un click más adentro, no acá. */}
          <Link to={`/projects/${projectId}/boxes`} className="button button--secondary">
            Crear / editar cajas
          </Link>
          <button type="button" className="button button--secondary" onClick={refresh}>
            Actualizar
          </button>
        </div>
      </div>

      <p className="page-subtitle">
        Un panel es el nodo de la ruta que recibe el cable de campo antes del gabinete — puede ser una caja real (con
        TB/bornes) o el panel eléctrico propio de un equipo (sin bornes modelados). Click en una caja para ver sus
        bloques de bornas; click en un bloque para ver sus terminales — una posición ocupada abre el detalle de la
        señal.
      </p>

      <div className="filter-bar">
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)}>
          {FILTROS_TIPO.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <select value={filtroGabinete} onChange={(e) => setFiltroGabinete(e.target.value)}>
          <option value="TODOS">Todos los gabinetes</option>
          {gabinetesDisponibles.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Buscar por tag de panel o de señal…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <ErrorMessage error={error} />

      {loading && <p>Cargando hardware…</p>}

      {!loading && paneles.length === 0 && <p>Este proyecto todavía no tiene paneles cargados.</p>}
      {!loading && paneles.length > 0 && panelesFiltrados.length === 0 && <p>Ningún panel coincide con los filtros.</p>}

      {!loading && panelesFiltrados.length > 0 && (
        <div className="tree">
          {panelesFiltrados.map((p) => {
            const pOpen = openPanel === p.id;
            const activeBloqueId = selectedBloque[p.id];
            const activeBloque = p.bloques?.find((b) => b.id === activeBloqueId);
            const esCaja = p.tipo === 'CAJA';

            return (
              <div key={p.id} className="tree__node">
                <button type="button" className="tree__row tree__row--gabinete" onClick={() => togglePanel(p)}>
                  <Toggle expanded={pOpen} />
                  <span className="tree__icon">{esCaja ? <IconCaja /> : <IconPanel />}</span>
                  <strong>{p.tag}</strong>
                  <span className={`badge ${esCaja ? 'badge--caja' : 'badge--panel'}`}>
                    {esCaja ? 'Caja' : 'Panel eléctrico'}
                  </span>
                  <span className="page-subtitle">
                    {p.cantidadSenales} señal(es) · {p.cantidadCables} cable(s)
                    {p.gabinetesTags.length > 0 ? ` · hacia ${p.gabinetesTags.join(', ')}` : ''}
                  </span>
                </button>

                {pOpen && esCaja && (
                  <div className="hw-panel">
                    {/* Fila: bloques de bornas, horizontal, como los TB uno junto al otro */}
                    <div className="hw-row">
                      {p.bloques!.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          className={`hw-card ${b.id === activeBloqueId ? 'hw-card--selected' : ''}`}
                          onClick={() => setSelectedBloque((prev) => ({ ...prev, [p.id]: b.id }))}
                        >
                          <IconBloque />
                          <span>{b.codigo}</span>
                          <span className="page-subtitle">{b.planoCodigoPlano ?? 'sin plano'}</span>
                        </button>
                      ))}
                    </div>

                    {/* Terminales/posiciones del bloque elegido, vertical, como las bornas reales */}
                    {activeBloque && (
                      <div className="hw-canales">
                        <div className="hw-canales__header">
                          <strong>{activeBloque.codigo}</strong>
                          <span className="page-subtitle">
                            {activeBloque.planoCodigoPlano ? `Plano ${activeBloque.planoCodigoPlano}` : 'Sin plano asignado'}
                          </span>
                        </div>
                        {activeBloque.terminales.map((t) =>
                          t.posiciones.map((pos) => (
                            <PosicionRow
                              key={pos.id}
                              terminalNumero={t.numero}
                              posicionCodigo={pos.codigo}
                              senal={pos.senal}
                              estado={pos.estado}
                              projectId={projectId}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Panel eléctrico: sin bloques/TB que expandir, muestra sus
                 * señales directamente (mismas tarjetas planas de antes). */}
                {pOpen && !esCaja && (
                  <div className="hw-panel">
                    <div className="hw-canales">
                      {p.senales.map((s) => (
                        <Link
                          key={s.id}
                          to={`/projects/${projectId}/control/signals/${s.id}`}
                          className="hw-canal hw-canal--ocupado"
                        >
                          <span className="hw-canal__num">{s.tagSenal ?? s.codigoSenal}</span>
                          <span className="hw-canal__label">
                            {s.duenoAusente ? 'sin dueño' : (s.duenoTag ?? '—')}
                          </span>
                          <span className="hw-canal__ruta">
                            {s.tagCable ? `cable ${s.tagCable}` : ''}
                            {s.destinoGabineteTag ? ` · hacia ${s.destinoGabineteTag}` : ''}
                          </span>
                        </Link>
                      ))}
                    </div>
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
