import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { deactivateRoute, getRoute } from '../api/connectionRoutes';
import { getRouteConexionado, getModuloTerminales, getBloqueTerminal } from '../api/terminaciones';
import { getControlSignal, listControlSignals } from '../api/controlOverview';
import { getModule } from '../api/modules';
import { listInstruments } from '../api/instruments';
import { useAsyncData } from '../lib/useAsyncData';
import { useRouteFormOptions } from '../components/useRouteFormOptions';
import { connectionPointFullLabel } from '../components/connectionPointLabel';
import type {
  BloqueTerminalConTerminales,
  ConnectionRouteWithSegments,
  ControlSignal,
  ControlSignalDetail,
  ModuloTerminalesResponse,
  PhysicalModule,
  RouteConexionadoResponse
} from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/* ---- Íconos — mismo criterio que ControlHardwarePage/ControlCajasHardwarePage
 * (figura real del objeto, no genérica). Se duplican acá porque viven
 * como funciones locales en esos archivos, no exportadas. */

function IconGabinete() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="2" width="16" height="20" rx="1.5" />
      <line x1="7" y1="6" x2="13" y2="6" />
      <line x1="7" y1="9" x2="13" y2="9" />
      <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconCaja() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconSurge() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" strokeLinejoin="round" />
    </svg>
  );
}

function IconInstrumento() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7" x2="12" y2="12" />
      <line x1="12" y1="12" x2="15" y2="14" />
    </svg>
  );
}

type ModuloTerminalItem = ModuloTerminalesResponse['terminales'][number];

/** Un canal/señal ya resuelto, listo para mostrarse DENTRO de su módulo
 * (nunca como etapa propia — ver [[GabineteBox]]). */
interface CanalDelGrupo {
  senal: ControlSignal;
  numeroCanal: number;
  hilos: ModuloTerminalItem[];
  posiciones: { posicionId: string; conductorCodigo: string; cableTag: string }[];
}

interface ModuloDelGrupo {
  moduloId: string;
  modelo: string | null;
  numeroSlot: number | null;
  surgeProtectorTag: string | null;
  bloqueTerminalCodigo: string | null;
  canales: CanalDelGrupo[];
}

interface RackDelGrupo {
  numeroRack: number | null;
  modulos: ModuloDelGrupo[];
}

interface GabineteDelGrupo {
  gabineteId: string;
  tagGabinete: string;
  racks: RackDelGrupo[];
}

interface CajaDelGrupo {
  bloqueCajaId: string;
  bloqueCaja: BloqueTerminalConTerminales;
  cajaTag: string | null;
  posiciones: Map<string, { senal: ControlSignal; conductorCodigo: string; cableTag: string }>;
}

interface GrupoRecorrido {
  /** Tag del PADRE del grupo — null cuando el dueño es un equipo (los
   * equipos no tienen concepto de padre/hijo, ver instrumentGrouping). */
  padreTag: string | null;
  instrumentoDescripcion: string | null;
  gabinetes: GabineteDelGrupo[];
  cajas: CajaDelGrupo[];
  sinIo: ControlSignal[];
  sinRuta: ControlSignal[];
}

/**
 * Resuelve TODAS las señales del instrumento FÍSICO real, no solo la que
 * el usuario clickeó — pedido explícito del usuario: "esa es solo la
 * señal del instrumento, es en realidad un instrumento hijo, la idea es
 * hacer el recorrido de TODO el instrumento". Un instrumento hijo
 * (instrumento_asociado_id no nulo, ver CLAUDE.md "Instrumento
 * padre/hijo") no es un objeto físico aparte — HS/HYO/HYC/ZSO/ZSC-5084
 * son todos parte de UNA sola válvula real (620-HV-5084).
 *
 * Y no solo eso: cuando varias señales del grupo comparten el mismo
 * gabinete/rack/módulo o la misma caja, tienen que verse DENTRO del
 * mismo contenedor, no repetido una vez por señal — pedido explícito
 * del usuario ("si hay señales en el mismo rio vas a poner las señales
 * dentro del mismo rio... igual con las cajas... si hay señales en el
 * mismo rack y slot también"). Por eso el resultado no es una lista
 * plana de canales sino un árbol GABINETE -> RACK -> MÓDULO -> canales,
 * más una lista de cajas (bloque_terminal) separada, cada una con TODAS
 * las posiciones que ocupa cualquier señal del grupo — nunca una caja
 * repetida por señal.
 *
 * Reutiliza únicamente endpoints que ya existían — listInstruments (para
 * resolver el grupo por instrumento_asociado_id, igual que el
 * Master/LDI), listControlSignals (para encontrar las señales de cada
 * miembro del grupo por su tag "dueño"), getRouteConexionado, getModule,
 * getModuloTerminales, getBloqueTerminal — cero endpoints nuevos, y cada
 * módulo/bloque distinto se pide UNA sola vez aunque varias señales lo
 * compartan. Cuando el dueño es un equipo (sin concepto de grupo) o no
 * tiene instrumento asociado, el "grupo" es simplemente esa única señal.
 */
function useInstrumentoRecorrido(
  projectId: string,
  devUserEmail: string,
  signal: ControlSignalDetail
) {
  const duenoId = signal.dueno?.tipo === 'instrumento' ? signal.dueno.id : null;

  const fetchGrupo = useCallback(async (): Promise<GrupoRecorrido> => {
    let delGrupo: ControlSignal[];
    let padreTag: string | null;
    let instrumentoDescripcion = signal.dueno?.descripcion ?? null;

    if (!duenoId) {
      delGrupo = [signal];
      padreTag = null;
    } else {
      const { instruments } = await listInstruments(projectId, devUserEmail);
      const duenoRow = instruments.find((i) => i.id === duenoId) ?? null;
      const padreRow = duenoRow?.instrumentoAsociadoId
        ? instruments.find((i) => i.id === duenoRow.instrumentoAsociadoId) ?? duenoRow
        : duenoRow;

      const grupoTags = new Set<string>();
      if (padreRow) {
        grupoTags.add(padreRow.tagInstrumento);
        for (const t of (padreRow.hijosTags ?? '').split(',')) {
          const trimmed = t.trim();
          if (trimmed) grupoTags.add(trimmed);
        }
      }

      const { signals: todasLasSenales } = await listControlSignals(projectId, {}, devUserEmail);
      delGrupo = todasLasSenales.filter(
        (s) => s.dueno?.tipo === 'instrumento' && s.dueno.tag && grupoTags.has(s.dueno.tag)
      );
      padreTag = padreRow?.tagInstrumento ?? null;
      instrumentoDescripcion = padreRow?.descripcion ?? instrumentoDescripcion;
    }

    const sinIo = delGrupo.filter((s) => !s.io);
    const conIo = delGrupo.filter((s) => s.io);
    const sinRuta = conIo.filter((s) => !s.rutaId);
    const conRuta = conIo.filter((s) => s.rutaId);

    const conexionados = await Promise.all(
      conRuta.map(async (s) => ({
        senal: s,
        conexionado: await getRouteConexionado(projectId, s.rutaId!, devUserEmail)
      }))
    );

    // Cada módulo distinto se pide UNA sola vez, aunque varias señales
    // del grupo lo compartan (mismo rack/slot) — nunca N llamadas
    // redundantes por canal.
    const moduloIds = Array.from(
      new Set(conRuta.map((s) => s.io!.moduloId).filter((id): id is string => id !== null))
    );
    const modulosData = new Map<
      string,
      { modulo: PhysicalModule | null; terminales: ModuloTerminalesResponse | null }
    >();
    await Promise.all(
      moduloIds.map(async (moduloId) => {
        const [modulo, terminales] = await Promise.all([
          getModule(projectId, moduloId, devUserEmail).then((r) => r.module),
          getModuloTerminales(projectId, moduloId, devUserEmail)
        ]);
        modulosData.set(moduloId, { modulo, terminales });
      })
    );

    const canalPorSenalId = new Map<string, CanalDelGrupo>();
    const asociacionesPorBloqueCaja = new Map<
      string,
      { senal: ControlSignal; posicionId: string; conductorCodigo: string; cableTag: string }[]
    >();

    for (const { senal, conexionado } of conexionados) {
      const io = senal.io!;
      const tramoCampo = conexionado.conexionado.find((seg) => seg.numeroOrden === 1) ?? null;
      const conductoresCampo = tramoCampo?.conductores ?? [];
      // Terminaciones del lado CAJA (destino) del tramo de campo (cable
      // caja->instrumento, posición "A" del borne).
      const terminacionesCajaCampo = conductoresCampo.flatMap((c) =>
        c.terminaciones
          .filter((t) => t.extremo === 'DESTINO')
          .map((t) => ({
            posicionId: t.posicionTerminal.id,
            bloqueId: t.bloqueTerminal.id,
            conductorCodigo: c.conductorCodigo,
            cableTag: c.cableTag
          }))
      );

      // Terminaciones del lado CAJA (origen) del tramo del RIO (cable
      // RIO->caja, posición "B" del MISMO borne) — el otro landing del
      // mismo borne físico, pedido explícito del usuario ("un mismo
      // borne recibe DOS landings"). Sin esto, el bloque de la caja
      // mostraba esa posición como "ocupado por otra señal" en vez de
      // reconocerla como propia.
      const tramoRio = conexionado.conexionado.find((seg) => seg.numeroOrden === 2) ?? null;
      const conductoresRio = tramoRio?.conductores ?? [];
      const terminacionesCajaRio = conductoresRio.flatMap((c) =>
        c.terminaciones
          .filter((t) => t.extremo === 'ORIGEN')
          .map((t) => ({
            posicionId: t.posicionTerminal.id,
            bloqueId: t.bloqueTerminal.id,
            conductorCodigo: c.conductorCodigo,
            cableTag: c.cableTag
          }))
      );

      const terminacionesCaja = [...terminacionesCajaCampo, ...terminacionesCajaRio];

      const moduloInfo = io.moduloId ? modulosData.get(io.moduloId) : undefined;
      // Bornas del TB del módulo para ESTE canal únicamente — nunca los
      // demás canales del módulo. Una fila por HILO/terminal, no un
      // canal resumido en una sola fila.
      const hilos = (moduloInfo?.terminales?.terminales ?? [])
        .filter((t) => t.numeroCanal === io.numeroCanal)
        .sort((a, b) => (a.ordenTerminal ?? 0) - (b.ordenTerminal ?? 0));

      canalPorSenalId.set(senal.id, {
        senal,
        numeroCanal: io.numeroCanal,
        hilos,
        posiciones: terminacionesCaja.map((t) => ({
          posicionId: t.posicionId,
          conductorCodigo: t.conductorCodigo,
          cableTag: t.cableTag
        }))
      });

      for (const t of terminacionesCaja) {
        if (!asociacionesPorBloqueCaja.has(t.bloqueId)) asociacionesPorBloqueCaja.set(t.bloqueId, []);
        asociacionesPorBloqueCaja
          .get(t.bloqueId)!
          .push({ senal, posicionId: t.posicionId, conductorCodigo: t.conductorCodigo, cableTag: t.cableTag });
      }
    }

    // Árbol de contención real: mismo gabinete -> mismo Gabinete; mismo
    // rack -> mismo Rack; mismo módulo (rack+slot) -> mismo Módulo, con
    // TODOS sus canales de este grupo adentro.
    const gabinetesMap = new Map<string, GabineteDelGrupo>();
    for (const s of conRuta) {
      const io = s.io!;
      const canal = canalPorSenalId.get(s.id)!;
      if (!io.gabineteId) continue;

      let gabinete = gabinetesMap.get(io.gabineteId);
      if (!gabinete) {
        gabinete = { gabineteId: io.gabineteId, tagGabinete: io.tagGabinete ?? '—', racks: [] };
        gabinetesMap.set(io.gabineteId, gabinete);
      }

      let rack = gabinete.racks.find((r) => r.numeroRack === io.numeroRack);
      if (!rack) {
        rack = { numeroRack: io.numeroRack, modulos: [] };
        gabinete.racks.push(rack);
      }

      if (!io.moduloId) continue;
      let modulo = rack.modulos.find((m) => m.moduloId === io.moduloId);
      if (!modulo) {
        const moduloInfo = modulosData.get(io.moduloId);
        modulo = {
          moduloId: io.moduloId,
          modelo: io.modelo,
          numeroSlot: io.numeroSlot,
          surgeProtectorTag: moduloInfo?.modulo?.surgeProtectorTag ?? null,
          bloqueTerminalCodigo: moduloInfo?.terminales?.bloqueTerminal?.codigo ?? null,
          canales: []
        };
        rack.modulos.push(modulo);
      }
      modulo.canales.push(canal);
    }
    for (const gabinete of gabinetesMap.values()) {
      gabinete.racks.sort((a, b) => (a.numeroRack ?? 0) - (b.numeroRack ?? 0));
      for (const rack of gabinete.racks) {
        rack.modulos.sort((a, b) => (a.numeroSlot ?? 0) - (b.numeroSlot ?? 0));
        for (const modulo of rack.modulos) {
          modulo.canales.sort((a, b) => a.numeroCanal - b.numeroCanal);
        }
      }
    }

    // Misma caja/bloque -> UNA sola caja mostrada, con las posiciones de
    // TODAS las señales del grupo que aterrizan ahí (nunca una caja
    // repetida por señal).
    const cajas = await Promise.all(
      Array.from(asociacionesPorBloqueCaja.entries()).map(async ([bloqueCajaId, asociaciones]) => {
        const bloqueCaja = await getBloqueTerminal(projectId, bloqueCajaId, devUserEmail).then(
          (r) => r.bloqueTerminal
        );
        const posiciones = new Map<string, { senal: ControlSignal; conductorCodigo: string; cableTag: string }>();
        for (const a of asociaciones) {
          posiciones.set(a.posicionId, { senal: a.senal, conductorCodigo: a.conductorCodigo, cableTag: a.cableTag });
        }
        return { bloqueCajaId, bloqueCaja, cajaTag: asociaciones[0]?.senal.cajaTag ?? null, posiciones };
      })
    );

    return {
      padreTag,
      instrumentoDescripcion,
      gabinetes: Array.from(gabinetesMap.values()),
      cajas,
      sinIo,
      sinRuta
    };
  }, [projectId, devUserEmail, duenoId, signal]);

  return useAsyncData<GrupoRecorrido>(fetchGrupo);
}

/** GABINETE/RIO (contenedor) -> RACK (dentro del gabinete) -> MÓDULO
 * (dentro del rack), mostrando solo su modelo (nunca el fabricante) con
 * TODOS los canales de este grupo que le corresponden — nunca la señal
 * repetida como etapa propia, y nunca un módulo repetido si dos señales
 * comparten rack+slot. Las bornas de cada canal van junto a él — son
 * terminales del canal, no una etapa aparte. El SURGE (si el módulo
 * tiene uno) y el TB del módulo NO están dentro del rack, pero sí están
 * dentro del gabinete, así que se dibujan como hermanos de los racks —
 * uno por módulo distinto, aunque compartan rack. */
function GabineteBox({ gabinete }: { gabinete: GabineteDelGrupo }) {
  const modulos = gabinete.racks.flatMap((rack) => rack.modulos);

  return (
    <div className="physical-rack route-flow__stage route-flow__stage--gabinete">
      <div className="physical-rack__header">
        <span className="physical-rack__toggle">
          <IconGabinete /> Gabinete: {gabinete.tagGabinete}
        </span>
      </div>
      <div className="physical-rack__body physical-rack__body--horizontal">
        {gabinete.racks.map((rack) => (
          <div className="physical-rack" key={rack.numeroRack ?? 'sin-rack'}>
            <div className="physical-rack__header">
              <span className="physical-rack__toggle">Rack {rack.numeroRack ?? '—'}</span>
            </div>
            <div className="physical-rack__body">
              {rack.modulos.map((modulo) => (
                <div className="physical-slot" key={modulo.moduloId}>
                  <div className="physical-slot__header">
                    <span className="physical-slot__title">Slot {modulo.numeroSlot ?? '—'}</span>
                    <span className="physical-slot__module-desc">{modulo.modelo}</span>
                  </div>
                  <div className="hw-canales">
                    {modulo.canales.map((canal) => (
                      <div key={canal.senal.id} className="hw-canal hw-canal--seleccionado">
                        <span className="hw-canal__num">CH{canal.numeroCanal}</span>
                        <span className="hw-canal__label">
                          {canal.senal.tagSenal ?? canal.senal.codigoSenal} ·{' '}
                          {canal.hilos.length > 0
                            ? canal.hilos.map((t) => `Borne ${t.numero}`).join(' · ')
                            : 'sin bornes materializados'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {modulos.map((modulo) => (
          <div key={modulo.moduloId} className="route-flow__surge-tb">
            <div className="route-flow__connector">
              <span className="route-flow__connector-line">→</span>
            </div>
            {modulo.surgeProtectorTag && (
              <>
                <div className="conexionado-flow__stage route-flow__stage--chico">
                  <span className="conexionado-flow__stage-tipo">
                    <IconSurge /> Surge
                  </span>
                  <span className="conexionado-flow__stage-tag">{modulo.surgeProtectorTag}</span>
                </div>
                <div className="route-flow__connector">
                  <span className="route-flow__connector-line">→</span>
                </div>
              </>
            )}
            <div className="conexionado-flow__stage route-flow__stage--chico">
              <span className="conexionado-flow__stage-tipo">TB (Slot {modulo.numeroSlot ?? '—'})</span>
              <span className="conexionado-flow__stage-tag">{modulo.bloqueTerminalCodigo ?? '—'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Una sola caja por bloque_terminal real — nunca repetida por señal —
 * con TODAS sus posiciones (ocupadas por el grupo, por otra señal, o
 * libres), igual que ControlCajasHardwarePage. */
function CajaBox({ caja }: { caja: CajaDelGrupo }) {
  return (
    <div className="physical-rack route-flow__stage">
      <div className="physical-rack__header">
        <span className="physical-rack__toggle">
          <IconCaja /> Caja: {caja.cajaTag ?? '—'}
        </span>
        {/* El código YA es el tag real del TB (ej. "TB-01") — no se
         * antepone la palabra "TB" de nuevo. */}
        <span className="page-subtitle" title="TB (Terminal Block) propio de esta caja">
          {caja.bloqueCaja.codigo}
        </span>
      </div>
      <div className="physical-rack__body">
        <div className="hw-canales">
          {caja.bloqueCaja.terminales.map((t) =>
            (t.posiciones ?? []).map((p) => {
              const mia = caja.posiciones.get(p.id);
              return (
                <div
                  key={p.id}
                  className={`hw-canal ${mia ? 'hw-canal--seleccionado' : p.inUse ? 'hw-canal--ocupado' : 'hw-canal--reserva'}`}
                >
                  <span className="hw-canal__num">
                    Borne {t.numero}/{p.codigo}
                  </span>
                  {mia ? (
                    <>
                      <span className="hw-canal__label">{mia.senal.tagSenal ?? mia.senal.codigoSenal}</span>
                      <span className="hw-canal__dueno">
                        cond. {mia.conductorCodigo} · {mia.cableTag}
                      </span>
                    </>
                  ) : p.inUse ? (
                    <span className="hw-canal__label">ocupado (otra señal)</span>
                  ) : (
                    <span className="hw-canal__label hw-canal__label--reserva">LIBRE</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function InstrumentoRecorrido({
  projectId,
  devUserEmail,
  signal
}: {
  projectId: string;
  devUserEmail: string;
  signal: ControlSignalDetail;
}) {
  const { data: grupo, loading, error } = useInstrumentoRecorrido(projectId, devUserEmail, signal);

  return (
    <div>
      {grupo?.padreTag && <p className="page-subtitle">Instrumento: {grupo.padreTag}</p>}
      <ErrorMessage error={error} />
      {loading && <p>Cargando recorrido…</p>}

      {grupo && (
        <div className="route-flow">
          {grupo.gabinetes.map((gabinete) => (
            <GabineteBox key={gabinete.gabineteId} gabinete={gabinete} />
          ))}

          {grupo.cajas.length > 0 && (
            <div className="route-flow__connector route-flow__connector--largo">
              <span className="route-flow__connector-line">┄┄┄┄┄▶</span>
              <span>cableado interno</span>
            </div>
          )}

          {grupo.cajas.map((caja) => (
            <CajaBox key={caja.bloqueCajaId} caja={caja} />
          ))}

          {grupo.cajas.length > 0 && (
            <div className="route-flow__connector">
              <span className="route-flow__connector-line">→</span>
            </div>
          )}

          <div className="conexionado-flow__stage route-flow__stage">
            <span className="conexionado-flow__stage-tipo">
              <IconInstrumento /> {signal.dueno?.tipo === 'equipo' ? 'Equipo' : 'Instrumento'}
            </span>
            <span className="conexionado-flow__stage-tag">{grupo.padreTag ?? signal.dueno?.tag ?? '—'}</span>
            {grupo.instrumentoDescripcion && (
              <span className="page-subtitle">{grupo.instrumentoDescripcion}</span>
            )}
          </div>
        </div>
      )}

      {grupo && grupo.sinIo.length > 0 && (
        <p className="physical-hint">
          Sin canal asignado todavía: {grupo.sinIo.map((s) => s.tagSenal ?? s.codigoSenal).join(', ')}
        </p>
      )}
      {grupo && grupo.sinRuta.length > 0 && (
        <p className="physical-hint">
          Sin ruta asignada todavía: {grupo.sinRuta.map((s) => s.tagSenal ?? s.codigoSenal).join(', ')}
        </p>
      )}
    </div>
  );
}

export function RouteDetailPage() {
  const { projectId, routeId } = useParams<{ projectId: string; routeId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const navigate = useNavigate();

  const project = findProject(projectId);
  const canDeactivate = project?.access.permissions.deactivate ?? false;

  const fetchRoute = useCallback(() => {
    if (!projectId || !routeId) return Promise.resolve<ConnectionRouteWithSegments | null>(null);
    return getRoute(projectId, routeId, devUser.email).then((r) => r.route);
  }, [projectId, routeId, devUser.email]);

  const { data: route, loading, error: loadError } = useAsyncData<
    ConnectionRouteWithSegments | null
  >(fetchRoute);

  // Lado gabinete/instrumento del recorrido gráfico — reutiliza el mismo
  // GET /control/signals/:id que ya usa ControlSignalDetailPage. Todas las
  // rutas son de señales CONTROL (una señal COM nunca puede tener una
  // ruta activa, ver TR_ruta_conexion_validar_clase_senal / error 51010),
  // así que esto siempre debería resolver mientras exista route.senalId.
  const fetchSignal = useCallback(() => {
    if (!projectId || !route?.senalId) return Promise.resolve<ControlSignalDetail | null>(null);
    return getControlSignal(projectId, route.senalId, devUser.email).then((r) => r.signal);
  }, [projectId, route?.senalId, devUser.email]);

  const { data: signal } = useAsyncData<ControlSignalDetail | null>(fetchSignal);

  const { data: options, loading: optionsLoading, error: optionsError } = useRouteFormOptions(
    projectId ?? '',
    devUser.email
  );

  const fetchConexionado = useCallback(() => {
    if (!projectId || !routeId) return Promise.resolve<RouteConexionadoResponse | null>(null);
    return getRouteConexionado(projectId, routeId, devUser.email);
  }, [projectId, routeId, devUser.email]);

  const { data: conexionado, loading: conexionadoLoading, error: conexionadoError } = useAsyncData<
    RouteConexionadoResponse | null
  >(fetchConexionado);

  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId || !routeId) {
    return <p>Faltan datos en la URL.</p>;
  }

  async function handleDeactivate() {
    if (!route) return;
    if (
      !window.confirm(
        `¿Desactivar la ruta #${route.id}? Esto también desactiva en cascada sus tramos.`
      )
    )
      return;
    setDeactivating(true);
    setActionError(null);
    try {
      await deactivateRoute(projectId!, routeId!, devUser.email);
      navigate(`/projects/${projectId}/routes`);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
      setDeactivating(false);
    }
  }

  const signalTag = options?.signals.find((s) => s.id === route?.senalId)?.tagSenal;

  function pairLabel(parConductorId: string | null): string {
    // NULL desde 015: el tramo usa el modelo nuevo (conductores
    // individuales vía tramo-conductores) — ver la sección "Conexionado
    // detallado" más abajo, no un par_conductor legacy.
    if (parConductorId === null) return '— (ver conexionado detallado)';
    const pair = options?.conductorPairs.find((p) => p.id === parConductorId);
    if (!pair) return `#${parConductorId}`;
    const cable = options?.cables.find((c) => c.id === pair.cableId);
    return `${cable?.tagCable ?? `#${pair.cableId}`} · Par ${pair.numeroPar}`;
  }

  function pointLabel(pointId: string): string {
    const point = options?.connectionPoints.find((p) => p.id === pointId);
    if (!point || !options) return `#${pointId}`;
    return connectionPointFullLabel(point, options);
  }

  const error = actionError ?? loadError ?? optionsError;
  const isLoading = loading || optionsLoading;

  return (
    <section>
      <div className="page-header">
        <h1>{route ? `Ruta #${route.id}` : 'Ruta de conexión'}</h1>

        {route && (
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
            {deactivating ? 'Desactivando…' : 'Desactivar ruta'}
          </button>
        )}
      </div>

      {route && <p className="page-subtitle">Señal: {signalTag ?? `#${route.senalId}`}</p>}

      <ErrorMessage error={error} />

      {isLoading && <p>Cargando ruta…</p>}

      {!isLoading && route && signal && (
        <>
          <h2>Recorrido</h2>
          <InstrumentoRecorrido projectId={projectId} devUserEmail={devUser.email} signal={signal} />
        </>
      )}

      {!isLoading && route && (
        <>
          <h2>Tramos (tabla)</h2>
          <table className="table">
          <thead>
            <tr>
              <th>Tramo</th>
              <th>Par conductor</th>
              <th>Origen</th>
              <th>Destino</th>
            </tr>
          </thead>
          <tbody>
            {[...route.segments]
              .sort((a, b) => a.numeroOrden - b.numeroOrden)
              .map((segment) => (
                <tr key={segment.id}>
                  <td>{segment.numeroOrden}</td>
                  <td>{pairLabel(segment.parConductorId)}</td>
                  <td>{pointLabel(segment.puntoOrigenId)}</td>
                  <td>{pointLabel(segment.puntoDestinoId)}</td>
                </tr>
              ))}
          </tbody>
          </table>
        </>
      )}

      <h2>Conexionado detallado</h2>
      <ErrorMessage error={conexionadoError} />
      {conexionadoLoading && <p>Cargando conexionado…</p>}
      {!conexionadoLoading && conexionado && conexionado.conexionado.length === 0 && (
        <p className="physical-hint">Sin conductores/terminaciones registrados todavía para esta ruta.</p>
      )}
      {!conexionadoLoading &&
        conexionado?.conexionado.map((segmento) => (
          <div key={segmento.tramoConexionId} className="physical-slot">
            <div className="physical-slot__header">
              <span className="physical-slot__title">Tramo {segmento.numeroOrden}</span>
            </div>
            {segmento.conductores.length === 0 && (
              <p className="physical-hint">Sin conductores declarados en este tramo.</p>
            )}
            {segmento.conductores.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Conductor</th>
                    <th>Extremo</th>
                    <th>Terminal</th>
                    <th>Posición</th>
                    <th>Bloque</th>
                  </tr>
                </thead>
                <tbody>
                  {segmento.conductores.map((conductor) =>
                    conductor.terminaciones.length === 0 ? (
                      <tr key={conductor.tramoConductorId}>
                        <td>{conductor.conductorCodigo}</td>
                        <td colSpan={4} className="physical-hint">sin terminaciones registradas</td>
                      </tr>
                    ) : (
                      conductor.terminaciones.map((t) => (
                        <tr key={t.id}>
                          <td>{conductor.conductorCodigo}</td>
                          <td>{t.extremo}</td>
                          <td>{t.terminal.numero}</td>
                          <td>{t.posicionTerminal.codigo}</td>
                          <td>{t.bloqueTerminal.codigo}</td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            )}
          </div>
        ))}
    </section>
  );
}
