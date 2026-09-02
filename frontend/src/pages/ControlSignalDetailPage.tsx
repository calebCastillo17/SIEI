import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getControlSignal } from '../api/controlOverview';
import { useAsyncData } from '../lib/useAsyncData';
import type { ControlSignalDetail } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const NODE_LABEL: Record<string, string> = {
  instrumento: 'Instrumento',
  equipo: 'Equipo',
  caja: 'Caja',
  gabinete: 'Gabinete',
  modulo: 'Módulo',
  desconocido: '—'
};

/**
 * Detalle de una señal CONTROL, en 4 secciones (ver CLAUDE.md, "Objetivo
 * de interfaz — módulo Control"): datos de señal, instrumento/equipo
 * dueño (leído por relación, nunca duplicado dentro de nucleo.senal),
 * asignación IO, y conexionado. El conexionado se muestra por etapas
 * (instrumento/equipo -> [caja] -> gabinete -> módulo) usando la cadena
 * de nodos ya resuelta por el backend — si la ruta todavía no existe, la
 * etapa se muestra como pendiente en vez de desaparecer la sección
 * entera. Las terminaciones finas (tramo_conductor/terminación) quedan
 * fuera de esta fase a propósito: solo se indica "pendiente de
 * configuración", nunca se inventa un detalle que el dato no da.
 */
export function ControlSignalDetailPage() {
  const { projectId, signalId } = useParams<{ projectId: string; signalId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();
  const project = findProject(projectId);

  const fetchSignal = useCallback(() => {
    if (!projectId || !signalId) return Promise.resolve<ControlSignalDetail | null>(null);
    return getControlSignal(projectId, signalId, devUser.email).then((r) => r.signal);
  }, [projectId, signalId, devUser.email]);

  const { data: signal, loading, error } = useAsyncData<ControlSignalDetail | null>(fetchSignal);

  if (!projectId || !signalId) return <p>Faltan datos en la URL.</p>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{signal ? (signal.tagSenal ?? signal.codigoSenal ?? `Señal #${signal.id}`) : 'Señal CONTROL'}</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" to={`/projects/${projectId}/signals/${signalId}`}>
            Editar (vista genérica)
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}/control`}>
            Volver a Control
          </Link>
        </div>
      </div>

      <ErrorMessage error={error} />
      {loading && <p>Cargando señal…</p>}

      {!loading && signal && (
        <>
          <h2>1. Datos de señal</h2>
          <dl className="detail-list">
            <div>
              <dt>Código (ID_SENAL)</dt>
              <dd>{signal.codigoSenal ?? '—'}</dd>
            </div>
            <div>
              <dt>TAG</dt>
              <dd>{signal.tagSenal ?? <em>— sin tag —</em>}</dd>
            </div>
            <div>
              <dt>Nombre corto</dt>
              <dd>{signal.nombreCorto ?? '—'}</dd>
            </div>
            <div>
              <dt>Tipo de E/S</dt>
              <dd>{signal.tipoIoCodigo ?? '—'}</dd>
            </div>
          </dl>

          <h2>2. Instrumento / equipo dueño</h2>
          {signal.duenoAusente && (
            <p className="error-message">
              ⚠ Esta señal quedó <strong>sin dueño</strong>: el instrumento que la tenía asignada fue
              eliminado definitivamente del proyecto. La señal se conservó activa a propósito, solo
              perdió la relación.
            </p>
          )}
          {signal.dueno ? (
            <dl className="detail-list">
              <div>
                <dt>Tipo</dt>
                <dd>{signal.dueno.tipo === 'instrumento' ? 'Instrumento' : 'Equipo'}</dd>
              </div>
              <div>
                <dt>TAG</dt>
                <dd>{signal.dueno.tag}</dd>
              </div>
              <div>
                <dt>Descripción</dt>
                <dd>{signal.dueno.descripcion ?? '—'}</dd>
              </div>
              {signal.dueno.tipo === 'instrumento' && (
                <>
                  <div>
                    <dt>Tipo de instrumento</dt>
                    <dd>{signal.dueno.tipoInstrumento ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Servicio</dt>
                    <dd>{signal.dueno.servicio ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>P&amp;ID / PnPID</dt>
                    <dd>
                      {signal.dueno.planoPnid ?? '—'} / {signal.dueno.pnpid ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Tecnología</dt>
                    <dd>{signal.dueno.tecnologia ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Funcionamiento</dt>
                    <dd>{signal.dueno.funcionamiento ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Cuerpo</dt>
                    <dd>{signal.dueno.cuerpoInstrumento ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Línea</dt>
                    <dd>{signal.dueno.linea ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Equipo asociado</dt>
                    <dd>{signal.dueno.equipoAsociadoTag ?? '—'}</dd>
                  </div>
                </>
              )}
              {signal.dueno.tipo === 'equipo' && (
                <div>
                  <dt>Panel</dt>
                  <dd>{signal.dueno.panel ?? '—'}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p>{signal.duenoAusente ? 'Sin dueño (ver aviso arriba).' : 'Sin dueño resuelto.'}</p>
          )}

          {signal.agrupador && (
            <p>
              <strong>Instrumento agrupador:</strong> {signal.agrupador.tag}
            </p>
          )}

          <h2>3. Asignación IO</h2>
          {signal.io ? (
            <dl className="detail-list">
              <div>
                <dt>Gabinete</dt>
                <dd>
                  {signal.io.tagGabinete} ({signal.io.tipoGabineteCodigo})
                </dd>
              </div>
              <div>
                <dt>Rack</dt>
                <dd>{signal.io.numeroRack}</dd>
              </div>
              <div>
                <dt>Slot</dt>
                <dd>SLOT-{String(signal.io.numeroSlot).padStart(2, '0')}</dd>
              </div>
              <div>
                <dt>Módulo</dt>
                <dd>
                  {signal.io.fabricante} {signal.io.modelo}
                </dd>
              </div>
              <div>
                <dt>Canal</dt>
                <dd>CH{String(signal.io.numeroCanal).padStart(2, '0')}</dd>
              </div>
            </dl>
          ) : (
            <p>IO pendiente — todavía no se asignó un canal a esta señal.</p>
          )}

          <h2>4. Conexionado</h2>
          {signal.rutaNodos.length > 0 ? (
            <div className="conexionado-flow">
              {signal.rutaNodos.map((node, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  {i > 0 && <span className="conexionado-flow__arrow">→</span>}
                  <div className="conexionado-flow__stage">
                    <span className="conexionado-flow__stage-tipo">{NODE_LABEL[node.tipo]}</span>
                    <span className="conexionado-flow__stage-tag">{node.tag}</span>
                    {node.extra && <span className="page-subtitle">{node.extra}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="conexionado-flow">
              <div className="conexionado-flow__stage">
                <span className="conexionado-flow__stage-tipo">{signal.dueno?.tipo ? NODE_LABEL[signal.dueno.tipo] : '—'}</span>
                <span className="conexionado-flow__stage-tag">{signal.dueno?.tag ?? '—'}</span>
              </div>
              <span className="conexionado-flow__arrow">→</span>
              <div className="conexionado-flow__stage conexionado-flow__stage--pendiente">
                <span className="conexionado-flow__stage-tipo">Ruta</span>
                <span className="conexionado-flow__stage-tag">PENDIENTE</span>
              </div>
            </div>
          )}
          {signal.cajaTag && <p>Caja en la ruta: {signal.cajaTag}</p>}
          <p className="page-subtitle">
            Terminaciones detalladas (conductor/terminal/posición): PENDIENTE DE CONFIGURACIÓN — se
            cargan en una fase posterior, no bloquean esta señal ni su ruta lógica.
          </p>
          {signal.rutaId && (
            <p>
              <Link to={`/projects/${projectId}/routes/${signal.rutaId}`}>Ver ruta en detalle →</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
