import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { listBoxes } from '../api/boxes';
import { listPlanos } from '../api/planos';
import { listBloquesTerminal, updateBloqueTerminal } from '../api/terminaciones';
import { useAsyncData } from '../lib/useAsyncData';
import { CatalogSelect } from '../components/CatalogSelect';
import type { BloqueTerminal, Box, Plano } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

/** "código - descripción" — mismo criterio que ControlConexionadoPage. */
function planoLabel(p: Plano): string {
  return `${p.codigoPlano ?? `#${p.id}`} - ${p.descripcion}`;
}

const SIN_ASIGNAR = '__sin_asignar__';

/** Un tablero por caja — apilados todos a la vez en la página (pedido
 * explícito del usuario: con 12 cajas reales, elegir de a una con un
 * selector era incómodo). Cada instancia calcula su propia exclusión de
 * planos "ya usados por otra caja" — el backend sigue siendo quien
 * realmente lo garantiza (TR_bloque_terminal_validar_plano_dueno,
 * migración 025), esto es solo para no ofrecer un intento inútil. */
function CajaTablero({
  projectId,
  devUserEmail,
  caja,
  bloquesTodos,
  planos,
  canWrite,
  onChange
}: {
  projectId: string;
  devUserEmail: string;
  caja: Box;
  bloquesTodos: BloqueTerminal[];
  planos: Plano[];
  canWrite: boolean;
  onChange: () => void;
}) {
  const [movingBloqueId, setMovingBloqueId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const planosDeOtroDueno = useMemo(() => {
    const set = new Set<string>();
    for (const b of bloquesTodos) {
      if (!b.active || !b.planoId) continue;
      if (b.cajaId !== caja.id) set.add(b.planoId);
    }
    return set;
  }, [bloquesTodos, caja.id]);

  const opcionesPlano = useMemo(() => {
    return planos
      .filter((p) => p.tipoPlanoCodigo === 'CONEXIONADO' && !planosDeOtroDueno.has(p.id))
      .map((p) => ({ id: p.id, label: planoLabel(p) }));
  }, [planos, planosDeOtroDueno]);

  const bloquesDeCaja = useMemo(
    () => bloquesTodos.filter((b) => b.active && b.cajaId === caja.id),
    [bloquesTodos, caja.id]
  );

  const grupos = useMemo(() => {
    const map = new Map<string, BloqueTerminal[]>();
    for (const b of bloquesDeCaja) {
      const key = b.planoId ?? SIN_ASIGNAR;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    const entries = [...map.entries()].filter(([key]) => key !== SIN_ASIGNAR);
    entries.sort(([, a], [, b]) => (a[0].planoCodigoPlano ?? '').localeCompare(b[0].planoCodigoPlano ?? ''));
    const sinAsignar = map.get(SIN_ASIGNAR) ?? [];
    return { asignados: entries, sinAsignar };
  }, [bloquesDeCaja]);

  async function handleMove(bloque: BloqueTerminal, nuevoPlanoId: string | null) {
    setMovingBloqueId(bloque.id);
    setError(null);
    try {
      await updateBloqueTerminal(projectId, bloque.id, { planoId: nuevoPlanoId }, devUserEmail);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setMovingBloqueId(null);
    }
  }

  return (
    <div className="physical-rack">
      <div className="physical-rack__header">
        <span className="physical-rack__toggle">Caja: {caja.tagCaja}</span>
      </div>
      <div className="physical-rack__body">
        <ErrorMessage error={error} />

        {grupos.asignados.length === 0 && grupos.sinAsignar.length === 0 && (
          <p className="physical-hint">Esta caja todavía no tiene bloques de bornas.</p>
        )}

        {grupos.asignados.map(([planoId, bloquesDelPlano]) => (
          <div key={planoId} className="physical-rack">
            <div className="physical-rack__header">
              <span className="physical-rack__toggle">
                <Link to={`/projects/${projectId}/planos/${planoId}`}>
                  {bloquesDelPlano[0].planoCodigoPlano ?? `Plano #${planoId}`}
                </Link>
              </span>
              <span className="physical-hint">{bloquesDelPlano.length} bloque(s)</span>
            </div>
            <div className="physical-rack__body">
              {bloquesDelPlano.map((b) => (
                <div key={b.id} className="physical-slot">
                  <div className="physical-slot__header">
                    <span className="physical-slot__title">
                      {b.codigo}
                      {b.descripcion ? ` — ${b.descripcion}` : ''}
                    </span>
                    <CatalogSelect
                      disabled={!canWrite || movingBloqueId === b.id}
                      value={b.planoId}
                      onChange={(value) => handleMove(b, value)}
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
              <span className="physical-hint">{grupos.sinAsignar.length} bloque(s)</span>
            </div>
            <div className="physical-rack__body">
              {grupos.sinAsignar.map((b) => (
                <div key={b.id} className="physical-slot">
                  <div className="physical-slot__header">
                    <span className="physical-slot__title">
                      {b.codigo}
                      {b.descripcion ? ` — ${b.descripcion}` : ''}
                    </span>
                    <CatalogSelect
                      disabled={!canWrite || movingBloqueId === b.id}
                      value={b.planoId}
                      onChange={(value) => handleMove(b, value)}
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
  );
}

/**
 * Vista visual "caja -> planos -> bloques de bornas" — segunda etapa de la
 * ruta de Control (Gabinete/RIO -> Cajas -> Instrumento), mismo patrón que
 * ControlConexionadoPage.tsx pero sin la jerarquía rack/slot: acá la
 * unidad que se reparte entre planos es el BLOQUE_TERMINAL de la caja
 * (migración 025, bloque_terminal.plano_id), no el módulo. Muestra las
 * 12 cajas apiladas a la vez (pedido explícito del usuario, a diferencia
 * de ControlConexionadoPage que elige un gabinete a la vez con un
 * selector — con solo 3 gabinetes eso no molestaba, con una docena de
 * cajas sí). No hay backend nuevo de lógica — usa el mismo PATCH
 * /bloques-terminal/:id { planoId } y la misma validación
 * TR_bloque_terminal_validar_plano_dueno que ya probamos.
 */
export function ControlCajasConexionadoPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchCajas = useCallback(() => {
    if (!projectId) return Promise.resolve<Box[]>([]);
    return listBoxes(projectId, devUser.email).then((r) => r.boxes);
  }, [projectId, devUser.email]);
  const { data: cajas } = useAsyncData<Box[]>(fetchCajas);

  const fetchPlanos = useCallback(() => {
    if (!projectId) return Promise.resolve<Plano[]>([]);
    return listPlanos(projectId, devUser.email).then((r) => r.planos);
  }, [projectId, devUser.email]);
  const { data: planos } = useAsyncData<Plano[]>(fetchPlanos);

  const fetchBloques = useCallback(() => {
    if (!projectId) return Promise.resolve<BloqueTerminal[]>([]);
    return listBloquesTerminal(projectId, devUser.email).then((r) => r.bloquesTerminal);
  }, [projectId, devUser.email]);
  const {
    data: bloques,
    loading: bloquesLoading,
    error: bloquesError,
    refresh: refreshBloques
  } = useAsyncData<BloqueTerminal[]>(fetchBloques);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  const cajasOrdenadas = [...(cajas ?? [])].sort((a, b) => a.tagCaja.localeCompare(b.tagCaja, 'es'));

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control — Diseño de conexionado (cajas)</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={refreshBloques}>
            Actualizar
          </button>
        </div>
      </div>

      <p className="page-subtitle">
        Marca en qué plano queda cada bloque de bornas de cada caja — para no repetir uno que ya está en otro plano.
      </p>

      <ErrorMessage error={bloquesError} />

      {bloquesLoading && <p>Cargando…</p>}

      {!bloquesLoading && cajasOrdenadas.length === 0 && <p>Este proyecto todavía no tiene cajas.</p>}

      {!bloquesLoading &&
        cajasOrdenadas.map((caja) => (
          <CajaTablero
            key={caja.id}
            projectId={projectId}
            devUserEmail={devUser.email}
            caja={caja}
            bloquesTodos={bloques ?? []}
            planos={planos ?? []}
            canWrite={canWrite}
            onChange={refreshBloques}
          />
        ))}
    </section>
  );
}
