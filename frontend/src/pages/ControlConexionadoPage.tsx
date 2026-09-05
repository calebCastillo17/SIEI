import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listGabinetes } from '../api/gabinetes';
import { listPlanos, associateGabinete, disassociateGabinete } from '../api/planos';
import { listControlPlanos } from '../api/controlOverview';
import { updateModule } from '../api/modules';
import { useAsyncData } from '../lib/useAsyncData';
import { usePhysicalTree } from '../components/usePhysicalTree';
import { CatalogSelect } from '../components/CatalogSelect';
import type { ControlPlanosResponse, Gabinete, PhysicalModule, Plano } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/** "código - descripción" — pedido explícito del usuario para elegir
 * mejor entre planos que solo muestran un código críptico. */
function planoLabel(p: Plano): string {
  return `${p.codigoPlano ?? `#${p.id}`} - ${p.descripcion}`;
}

const SIN_ASIGNAR = '__sin_asignar__';

/**
 * Vista visual "tablero -> planos -> módulos" (pedida por el usuario para
 * reemplazar el formulario plano por plano de PlanoDetailPage cuando lo
 * que hace falta es ver de un vistazo cómo está repartido UN gabinete
 * entero entre sus planos de conexionado): un rectángulo grande por el
 * gabinete elegido, un rectángulo por cada plano que ya tiene módulos de
 * ese gabinete (más un "Sin asignar"), y dentro cada módulo con un
 * selector para moverlo. No hay backend nuevo — usa el mismo PATCH
 * /modules/:id { planoId } y la misma validación de la migración 024
 * (TR_modulo_validar_plano_gabinete) que ya construimos para
 * PlanoDetailPage; esta página es una vista distinta sobre los mismos
 * datos, agrupados al revés (por gabinete en vez de por plano).
 *
 * El selector de "mover a" de cada módulo excluye, de entrada, los
 * planos que ya tienen módulos de OTRO gabinete — así el error nunca
 * llega a intentarse; el backend sigue siendo quien realmente lo
 * garantiza (ver migración 024), esto es solo para no hacer el intento
 * inútil.
 */
export function ControlConexionadoPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchGabinetes = useCallback(() => {
    if (!projectId) return Promise.resolve<Gabinete[]>([]);
    return listGabinetes(projectId, devUser.email).then((r) => r.gabinetes);
  }, [projectId, devUser.email]);
  const { data: gabinetes } = useAsyncData<Gabinete[]>(fetchGabinetes);

  const fetchPlanos = useCallback(() => {
    if (!projectId) return Promise.resolve<Plano[]>([]);
    return listPlanos(projectId, devUser.email).then((r) => r.planos);
  }, [projectId, devUser.email]);
  const { data: planos } = useAsyncData<Plano[]>(fetchPlanos);

  const fetchControlPlanos = useCallback(() => {
    if (!projectId) return Promise.resolve<ControlPlanosResponse>({ projectId: '', planos: [] });
    return listControlPlanos(projectId, devUser.email);
  }, [projectId, devUser.email]);
  const { data: controlPlanosData, refresh: refreshControlPlanos } = useAsyncData<ControlPlanosResponse>(fetchControlPlanos);

  const {
    data: tree,
    loading: treeLoading,
    error: treeError,
    refresh: refreshTree
  } = usePhysicalTree(projectId ?? '', devUser.email);

  const [selectedGabineteId, setSelectedGabineteId] = useState<string | null>(null);
  const [movingModuleId, setMovingModuleId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const gabineteId = selectedGabineteId ?? gabinetes?.[0]?.id ?? null;

  const rackById = useMemo(() => new Map((tree?.racks ?? []).map((r) => [r.id, r])), [tree]);
  const slotById = useMemo(() => new Map((tree?.slots ?? []).map((s) => [s.id, s])), [tree]);

  const gabineteDeModulo = useCallback(
    (m: PhysicalModule): string | null => {
      const slot = slotById.get(m.slotId);
      if (!slot) return null;
      const rack = rackById.get(slot.rackId);
      return rack ? rack.gabineteId : null;
    },
    [slotById, rackById]
  );

  // Planos que ya tienen al menos un módulo de OTRO gabinete — se
  // excluyen de las opciones de "mover a" del gabinete elegido.
  const planosDeOtroGabinete = useMemo(() => {
    const set = new Set<string>();
    for (const m of tree?.modules ?? []) {
      if (!m.active || !m.planoId) continue;
      if (gabineteDeModulo(m) !== gabineteId) set.add(m.planoId);
    }
    return set;
  }, [tree, gabineteDeModulo, gabineteId]);

  // Solo planos TIPO CONEXIONADO tienen sentido acá — un módulo/slot no se
  // dibuja en un LAYOUT, un UNIFILAR ni en el CONEXIONADO_INTERNO del
  // propio tablero (ese es harina de otro costal, ver el selector de
  // "Conexionado interno" más abajo).
  const opcionesPlano = useMemo(() => {
    return (planos ?? [])
      .filter((p) => p.tipoPlanoCodigo === 'CONEXIONADO' && !planosDeOtroGabinete.has(p.id))
      .map((p) => ({ id: p.id, label: planoLabel(p) }));
  }, [planos, planosDeOtroGabinete]);

  // Conexionado INTERNO del tablero mismo (documenta el cableado interno
  // del gabinete, no un módulo puntual) — se maneja aparte, vía la misma
  // asociación gabinete_plano de siempre (nucleo.gabinete_plano, migración
  // 014), no vía modulo.plano_id.
  const opcionesConexionadoInterno = useMemo(() => {
    return (planos ?? [])
      .filter((p) => p.tipoPlanoCodigo === 'CONEXIONADO_INTERNO')
      .map((p) => ({ id: p.id, label: planoLabel(p) }));
  }, [planos]);

  const conexionadoInternoActualId = useMemo(() => {
    const fila = (controlPlanosData?.planos ?? []).find(
      (p) => p.entidadTipo === 'gabinete' && p.entidadId === gabineteId && p.tipoPlanoCodigo === 'CONEXIONADO_INTERNO'
    );
    return fila?.planoId ?? null;
  }, [controlPlanosData, gabineteId]);

  const [savingInterno, setSavingInterno] = useState(false);

  async function handleAssignInterno(nuevoPlanoId: string | null) {
    if (!projectId || !gabineteId) return;
    setSavingInterno(true);
    setError(null);
    try {
      if (conexionadoInternoActualId && conexionadoInternoActualId !== nuevoPlanoId) {
        await disassociateGabinete(projectId, conexionadoInternoActualId, gabineteId, devUser.email);
      }
      if (nuevoPlanoId) {
        await associateGabinete(projectId, nuevoPlanoId, gabineteId, devUser.email);
      }
      await refreshControlPlanos();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSavingInterno(false);
    }
  }

  const modulosDelGabinete = useMemo(() => {
    return (tree?.modules ?? []).filter((m) => m.active && gabineteDeModulo(m) === gabineteId);
  }, [tree, gabineteDeModulo, gabineteId]);

  const grupos = useMemo(() => {
    const map = new Map<string, PhysicalModule[]>();
    for (const m of modulosDelGabinete) {
      const key = m.planoId ?? SIN_ASIGNAR;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    const entries = [...map.entries()].filter(([key]) => key !== SIN_ASIGNAR);
    entries.sort(([, a], [, b]) => (a[0].planoCodigoPlano ?? '').localeCompare(b[0].planoCodigoPlano ?? ''));
    const sinAsignar = map.get(SIN_ASIGNAR) ?? [];
    return { asignados: entries, sinAsignar };
  }, [modulosDelGabinete]);

  function labelModulo(m: PhysicalModule): string {
    const slot = slotById.get(m.slotId);
    const rack = slot ? rackById.get(slot.rackId) : undefined;
    const rackNum = rack?.numeroRack ?? '?';
    const slotNum = slot?.numeroSlot ?? '?';
    return `Rack ${rackNum} · Slot ${slotNum} · ${m.tag ?? m.modelo}`;
  }

  async function handleMove(modulo: PhysicalModule, nuevoPlanoId: string | null) {
    if (!projectId) return;
    setMovingModuleId(modulo.id);
    setError(null);
    try {
      await updateModule(projectId, modulo.id, { planoId: nuevoPlanoId }, devUser.email);
      await refreshTree();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setMovingModuleId(null);
    }
  }

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  const gabinete = (gabinetes ?? []).find((g) => g.id === gabineteId) ?? null;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control — Diseño de conexionado</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={refreshTree}>
            Actualizar
          </button>
        </div>
      </div>

      <p className="page-subtitle">
        Elige un gabinete y marca en qué plano queda cada slot/módulo — para no repetir uno que ya está en otro
        plano.
      </p>

      <ErrorMessage error={error ?? treeError} />

      <label className="form__field">
        <span>Gabinete</span>
        <CatalogSelect
          value={gabineteId}
          onChange={setSelectedGabineteId}
          options={(gabinetes ?? []).map((g) => ({ id: g.id, label: g.tagGabinete }))}
          emptyLabel="— elegir gabinete —"
        />
      </label>

      {treeLoading && <p>Cargando…</p>}

      {!treeLoading && !gabineteId && <p>Este proyecto todavía no tiene gabinetes.</p>}

      {!treeLoading && gabinete && (
        <div className="physical-rack">
          <div className="physical-rack__header">
            <span className="physical-rack__toggle">Tablero: {gabinete.tagGabinete}</span>
            <label className="physical-slot__module">
              Conexionado interno
              <CatalogSelect
                disabled={!canWrite || savingInterno}
                value={conexionadoInternoActualId}
                onChange={handleAssignInterno}
                options={opcionesConexionadoInterno}
                emptyLabel="— sin asignar —"
              />
            </label>
          </div>
          <div className="physical-rack__body">
            {grupos.asignados.length === 0 && grupos.sinAsignar.length === 0 && (
              <p className="physical-hint">Este gabinete todavía no tiene módulos instalados.</p>
            )}

            {grupos.asignados.map(([planoId, modulos]) => (
              <div key={planoId} className="physical-rack">
                <div className="physical-rack__header">
                  <span className="physical-rack__toggle">
                    <Link to={`/projects/${projectId}/planos/${planoId}`}>
                      {modulos[0].planoCodigoPlano ?? `Plano #${planoId}`}
                    </Link>
                  </span>
                  <span className="physical-hint">{modulos.length} módulo(s)</span>
                </div>
                <div className="physical-rack__body">
                  {modulos.map((m) => (
                    <div key={m.id} className="physical-slot">
                      <div className="physical-slot__header">
                        <span className="physical-slot__title">{labelModulo(m)}</span>
                        <CatalogSelect
                          disabled={!canWrite || movingModuleId === m.id}
                          value={m.planoId}
                          onChange={(value) => handleMove(m, value)}
                          options={opcionesPlano}
                          emptyLabel="— sin asignar —"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {grupos.sinAsignar.length > 0 && (
              <div className="physical-rack">
                <div className="physical-rack__header">
                  <span className="physical-rack__toggle">Sin asignar</span>
                  <span className="physical-hint">{grupos.sinAsignar.length} módulo(s)</span>
                </div>
                <div className="physical-rack__body">
                  {grupos.sinAsignar.map((m) => (
                    <div key={m.id} className="physical-slot">
                      <div className="physical-slot__header">
                        <span className="physical-slot__title">{labelModulo(m)}</span>
                        <CatalogSelect
                          disabled={!canWrite || movingModuleId === m.id}
                          value={m.planoId}
                          onChange={(value) => handleMove(m, value)}
                          options={opcionesPlano}
                          emptyLabel="— sin asignar —"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
