import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getControlRuteo } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlRuteoResponse, RuteoCable, RuteoCanal, RuteoGabinete, RuteoModulo, RuteoRack } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/**
 * "Ruteo" de Control — el árbol completo RIO -> rack -> módulo -> canal ->
 * caja -> instrumento/equipo, calcado del esquema de la hoja SENALES del
 * Excel maestro del usuario (columnas A:AK, sin lo de planos): ahí RIO,
 * CHASIS y el bloque del módulo son celdas combinadas que abarcan todas
 * las filas de canal que les corresponden. Acá se reproduce con
 * `rowSpan` real de HTML — misma idea, sin depender de Excel.
 *
 * Dos tratamientos deliberadamente DISTINTOS al Excel original, pedido
 * explícito del usuario ("usa tu creatividad, así como lo hice no me
 * parece tan chevere"):
 *   - Los "hilos" del canal (terminales propios del módulo) y los
 *     "bornes" de la caja (BORNE_JB) ya NO son una fila por hilo — son
 *     chips en línea dentro de la MISMA fila del canal. El Excel
 *     necesitaba una fila nueva por hilo porque una celda de Excel no
 *     lista bien varios valores; una fila de HTML sí. Cada borne muestra
 *     además dos marcas (campo/RIO) para no tener que adivinar cuál lado
 *     está aterrizado con solo el número.
 *   - Un canal en RESERVA no repite celdas vacías columna por columna —
 *     colapsa todo lo de la derecha (cable/caja/bornes/instrumento) en
 *     una sola celda atenuada "— libre —", una fila visualmente más
 *     liviana que una ocupada en vez de una fila idéntica con casilleros
 *     vacíos.
 *
 * La "reserva" de un cable (columna R_CABLE del Excel) es SIEMPRE
 * calculada por el backend (capacidad - conductores en uso) — nunca un
 * número importado, ver controlOverview.ts.
 */
export function ControlRuteoPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);

  const fetchRuteo = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlRuteoResponse | null>(null);
    return getControlRuteo(projectId, devUser.email);
  }, [projectId, devUser.email]);

  const { data, loading, error, refresh } = useAsyncData<ControlRuteoResponse | null>(fetchRuteo);

  // Default true — pedido explícito del usuario: "no es necesario que
  // salga la reserva en el ruteo". El toggle queda disponible por si
  // igual quiere verlas puntualmente, pero ya no es el estado inicial.
  const [soloOcupados, setSoloOcupados] = useState(true);

  // Un RIO/gabinete abierto a la vez — mismo criterio de acordeón que
  // ControlCajasHardwarePage/ControlHardwarePage (nada abierto al
  // cargar) — pedido explícito del usuario: "puede ser tipo desplegable
  // por rio". Con varios RIOs, cada uno con su propia tabla ancha
  // (columnas sin wrap, pedido de la corrección anterior), mostrarlos
  // todos a la vez era demasiado.
  const [gabineteAbiertoId, setGabineteAbiertoId] = useState<string | null>(null);

  const gabinetes = useMemo(() => {
    const todos = data?.gabinetes ?? [];
    if (!soloOcupados) return todos;
    // Filtra canales en RESERVA sin tocar la estructura del árbol — un
    // módulo/rack que se queda sin canales simplemente no se dibuja.
    return todos
      .map((g) => ({
        ...g,
        racks: g.racks
          .map((r) => ({
            ...r,
            slots: r.slots
              .map((sl) =>
                sl.modulo
                  ? { ...sl, modulo: { ...sl.modulo, canales: sl.modulo.canales.filter((c) => c.estado === 'OCUPADO') } }
                  : sl
              )
              .filter((sl) => sl.modulo && sl.modulo.canales.length > 0)
          }))
          .filter((r) => r.slots.length > 0)
      }))
      .filter((g) => g.racks.length > 0);
  }, [data, soloOcupados]);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Ruteo</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <label className="ruteo-toggle">
            <input type="checkbox" checked={soloOcupados} onChange={(e) => setSoloOcupados(e.target.checked)} />
            Solo ocupados
          </label>
          <button type="button" className="button button--secondary" onClick={refresh}>
            Actualizar
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />
      {loading && <p>Cargando ruteo…</p>}

      {!loading && gabinetes.length === 0 && <p className="physical-hint">No hay nada que mostrar.</p>}

      {!loading && gabinetes.length > 0 && (
        <div className="tree">
          {gabinetes.map((g) => (
            <GabineteTabla
              key={g.id}
              gabinete={g}
              abierto={gabineteAbiertoId === g.id}
              onToggle={() => setGabineteAbiertoId((prev) => (prev === g.id ? null : g.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ---- Aplanado del árbol a filas de tabla con su rowSpan ya resuelto —
 * se calcula UNA vez por gabinete en vez de arrastrar contadores
 * mutables dentro del JSX (mucho más fácil de seguir y de no romper). */

interface FilaAplanada {
  key: string;
  canal: RuteoCanal;
  rack: RuteoRack;
  modulo: RuteoModulo;
  numeroSlot: number;
  gabineteRowSpan: number; // > 0 solo en la primera fila del gabinete
  rackRowSpan: number; // > 0 solo en la primera fila de ese rack
  moduloRowSpan: number; // > 0 solo en la primera fila de ese módulo
}

function aplanarGabinete(gabinete: RuteoGabinete): FilaAplanada[] {
  const filas: FilaAplanada[] = [];

  for (const rack of gabinete.racks) {
    for (const slot of rack.slots) {
      const modulo = slot.modulo;
      if (!modulo || modulo.canales.length === 0) continue;

      modulo.canales.forEach((canal, idxEnModulo) => {
        filas.push({
          key: canal.id,
          canal,
          rack,
          modulo,
          numeroSlot: slot.numeroSlot,
          gabineteRowSpan: 0,
          rackRowSpan: 0,
          moduloRowSpan: idxEnModulo === 0 ? modulo.canales.length : 0
        });
      });
    }
  }

  // rowSpan de RACK: se asigna a la primera fila de cada rack, contando
  // cuántas filas totales le corresponden — ya están todas en `filas` en
  // orden (un rack nunca aparece en dos tramos separados), así que basta
  // un recorrido lineal.
  let i = 0;
  for (const rack of gabinete.racks) {
    const inicio = i;
    let cuenta = 0;
    while (i < filas.length && filas[i].rack.id === rack.id) {
      cuenta++;
      i++;
    }
    if (cuenta > 0) filas[inicio].rackRowSpan = cuenta;
  }

  if (filas.length > 0) filas[0].gabineteRowSpan = filas.length;

  return filas;
}

function GabineteTabla({
  gabinete,
  abierto,
  onToggle
}: {
  gabinete: RuteoGabinete;
  abierto: boolean;
  onToggle: () => void;
}) {
  const filas = useMemo(() => aplanarGabinete(gabinete), [gabinete]);
  if (filas.length === 0) return null;

  return (
    <div className="tree__node">
      <button type="button" className="tree__row tree__row--gabinete" onClick={onToggle}>
        <span className={`tree__toggle ${abierto ? 'tree__toggle--open' : ''}`}>▸</span>
        <strong>{gabinete.tagGabinete}</strong>
        <span className="page-subtitle">{filas.length} fila(s)</span>
      </button>

      {abierto && (
        <div className="ruteo-gabinete">
          <div className="ruteo-table-wrap">
            <table className="ruteo-table">
              <thead>
                <tr>
                  <th>RIO</th>
                  <th>Rack</th>
                  <th>Módulo</th>
                  <th>Canal</th>
                  <th>Bornera (gabinete)</th>
                  <th>Cable RIO</th>
                  <th>Caja / Panel</th>
                  <th>Bornes</th>
                  <th>Cable campo</th>
                  <th>Señal</th>
                  <th>Destino</th>
                  <th>Dueño</th>
                  <th>Nodo</th>
                  <th>Servicio</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <FilaCanal key={fila.key} fila={fila} gabineteTag={gabinete.tagGabinete} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaCanal({ fila, gabineteTag }: { fila: FilaAplanada; gabineteTag: string }) {
  const { canal, rack, modulo, numeroSlot, gabineteRowSpan, rackRowSpan, moduloRowSpan } = fila;
  const senal = canal.senal;
  const ocupado = canal.estado === 'OCUPADO' && senal;

  return (
    <tr className={ocupado ? undefined : 'ruteo-fila--libre'}>
      {gabineteRowSpan > 0 && (
        <td className="ruteo-celda-combinada" rowSpan={gabineteRowSpan}>
          <IconGabinete /> {gabineteTag}
        </td>
      )}
      {rackRowSpan > 0 && (
        <td className="ruteo-celda-combinada" rowSpan={rackRowSpan}>
          Rack {rack.numeroRack}
        </td>
      )}
      {moduloRowSpan > 0 && (
        <td className="ruteo-celda-combinada" rowSpan={moduloRowSpan}>
          <div className="ruteo-modulo">
            <strong>{modulo.tag ?? modulo.modelo}</strong>
            <span className="page-subtitle">
              Slot {numeroSlot} · {modulo.modelo}
            </span>
            {modulo.surgeProtectorTag && <span className="ruteo-chip ruteo-chip--surge">⚡ {modulo.surgeProtectorTag}</span>}
            {/* TB = Terminal Block (el bloque completo); cada "hilo" de
             * abajo es un BORNE individual dentro de este TB — no
             * confundir los dos conceptos, pedido explícito del usuario.
             * El código YA es el tag real del TB (ej. "TB-01") — no se le
             * antepone la palabra "TB" de nuevo (quedaba "TB TB-01"). */}
            {modulo.bloqueTerminalCodigo && (
              <span className="ruteo-chip" title="TB (Terminal Block) propio del módulo">
                {modulo.bloqueTerminalCodigo}
              </span>
            )}
          </div>
        </td>
      )}

      <td>
        <div className="ruteo-canal">
          <span className="ruteo-canal__num">CH{canal.numeroCanal}</span>
          <span className="ruteo-chips">
            {canal.hilos.map((h) => (
              <span key={h.numero} className="ruteo-chip ruteo-chip--hilo" title={`Borne ${h.numero} (del TB del módulo)`}>
                {h.numero}
              </span>
            ))}
          </span>
        </div>
      </td>

      <td>
        <span className="ruteo-chips">
          {canal.bornera.map((b) => (
            <span key={b.numero} className="ruteo-chip" title={`Borne ${b.numero} (TB del gabinete, calculado por tipo de señal)`}>
              {b.numero}
            </span>
          ))}
        </span>
      </td>

      {ocupado ? (
        <>
          <td>
            <CableCelda cable={senal.cableRio} />
          </td>
          <td className="ruteo-col--ancho">
            {senal.cajaTag ? (
              <>
                <div>{senal.cajaTag}</div>
                {/* El código YA es el tag real del TB (ej. "TB-01") — no
                 * se antepone la palabra "TB" de nuevo. */}
                {senal.bloqueCajaCodigo && (
                  <span className="page-subtitle" title="TB (Terminal Block) propio de la caja">
                    {senal.bloqueCajaCodigo}
                  </span>
                )}
              </>
            ) : senal.equipoPanelTag ? (
              <div>{senal.equipoPanelTag}</div>
            ) : (
              <span className="page-subtitle">—</span>
            )}
          </td>
          <td>
            <span className="ruteo-chips">
              {senal.bornes.length > 0 ? (
                senal.bornes.map((b) => (
                  // Un borne "estimado" (agregado por el backend porque el
                  // tipo de señal necesita más bornes de los que ya tiene
                  // terminación real cargada) se ve IGUAL que uno real —
                  // mismo número, mismos puntitos — solo semitransparente
                  // (pedido explícito del usuario: "no le pongas
                  // pendiente, solo ponlos... pero medio transparentes").
                  <span
                    key={b.numero}
                    className={`ruteo-borne ${b.estimado ? 'ruteo-borne--estimado' : ''}`}
                    title={b.estimado ? `Borne ${b.numero} (estimado — todavía sin cablear)` : `Borne ${b.numero}`}
                  >
                    {b.numero}
                    <span className="ruteo-borne__lados">
                      <span
                        className={`ruteo-borne__lado ${b.campoOcupado ? 'ruteo-borne__lado--activo' : ''}`}
                        title="Cable de campo"
                      />
                      <span
                        className={`ruteo-borne__lado ${b.rioOcupado ? 'ruteo-borne__lado--activo' : ''}`}
                        title="Cable del RIO"
                      />
                    </span>
                  </span>
                ))
              ) : (
                <span className="page-subtitle">sin bornas</span>
              )}
            </span>
          </td>
          <td>
            <CableCelda cable={senal.cableCampo} />
          </td>
          <td className="ruteo-col--ancho">{senal.tagSenal ?? senal.codigoSenal}</td>
          <td className="ruteo-col--ancho">{senal.destino ?? <span className="page-subtitle">—</span>}</td>
          <td className="ruteo-col--ancho">
            {senal.duenoAusente ? <span className="ruteo-chip ruteo-chip--alerta">sin dueño</span> : (senal.duenoTag ?? '—')}
          </td>
          <td>
            {/* Nodo del INSTRUMENTO dueño únicamente — un equipo no tiene
             * nodo, así que queda vacío ahí (pedido explícito del
             * usuario). Columna propia, separada de Servicio — son campos
             * distintos y van en la MISMA fila, no uno debajo del otro. */}
            {senal.duenoNodo ?? <span className="page-subtitle">—</span>}
          </td>
          <td>
            {senal.duenoServicio ? (
              <span className="ruteo-col--servicio" title={senal.duenoServicio}>
                {senal.duenoServicio}
              </span>
            ) : (
              <span className="page-subtitle">—</span>
            )}
          </td>
        </>
      ) : (
        <td colSpan={9} className="ruteo-libre">
          — libre —
        </td>
      )}
    </tr>
  );
}

function CableCelda({ cable }: { cable: RuteoCable | null }) {
  if (!cable) return <span className="page-subtitle">—</span>;
  return (
    <div className="ruteo-cable">
      <span>{cable.tag}</span>
      {/* Pedido explícito del usuario: la reserva no va encerrada en un
       * chip/pill — texto suelto, pegado al tag, solo resaltado en color
       * cuando ya no queda reserva. */}
      {cable.reserva !== null && (
        <span
          className={`ruteo-reserva ${cable.reserva <= 0 ? 'ruteo-reserva--baja' : ''}`}
          title={`${cable.enUso} en uso de ${cable.capacidad} · tipo ${cable.tipoCable ?? '—'}`}
        >
          res. {cable.reserva}
        </span>
      )}
    </div>
  );
}

function IconGabinete() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ verticalAlign: -2 }}>
      <rect x="4" y="2" width="16" height="20" rx="1.5" />
      <line x1="7" y1="6" x2="13" y2="6" />
      <line x1="7" y1="9" x2="13" y2="9" />
      <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
