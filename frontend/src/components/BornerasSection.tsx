import { useCallback, useState } from 'react';

import {
  listBloquesTerminal,
  getBloqueTerminal,
  createBloqueTerminal,
  deactivateBloqueTerminal,
  createTerminal,
  deactivateTerminal,
  createPosicionTerminal,
  deactivatePosicionTerminal
} from '../api/terminaciones';
import type { BloqueTerminalConTerminales } from '../api/types';
import { useAsyncData } from '../lib/useAsyncData';
import { ErrorMessage } from './ErrorMessage';

/*
 * Sección "Borneras" reutilizada por CajaDetailPage y GabineteDetailPage
 * (migración 015) — nucleo.bloque_terminal + nucleo.terminal +
 * nucleo.posicion_terminal. Sin editor gráfico: tablas + formularios
 * simples, igual que el resto del frontend de SIEI. Un bloque de MODULO
 * nunca se crea aquí (se materializa solo, ver ModuloTerminalesSection) —
 * este componente solo maneja dueño = caja | gabinete.
 */
export function BornerasSection({
  projectId,
  devUserEmail,
  ownerType,
  ownerId,
  canWrite,
  canDeactivate
}: {
  projectId: string;
  devUserEmail: string;
  ownerType: 'caja' | 'gabinete';
  ownerId: string;
  canWrite: boolean;
  canDeactivate: boolean;
}) {
  const fetchBloques = useCallback(
    () =>
      listBloquesTerminal(
        projectId,
        devUserEmail,
        ownerType === 'caja' ? { cajaId: ownerId } : { gabineteId: ownerId }
      ).then((r) => r.bloquesTerminal),
    [projectId, devUserEmail, ownerType, ownerId]
  );

  const { data: bloques, loading, error, refresh } = useAsyncData(fetchBloques);

  const [newCodigo, setNewCodigo] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  async function handleCreateBloque() {
    if (!newCodigo.trim()) return;
    setCreating(true);
    setActionError(null);
    try {
      await createBloqueTerminal(
        projectId,
        ownerType === 'caja' ? { cajaId: ownerId, codigo: newCodigo.trim() } : { gabineteId: ownerId, codigo: newCodigo.trim() },
        devUserEmail
      );
      setNewCodigo('');
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDeactivateBloque(bloqueId: string) {
    if (!window.confirm('¿Desactivar este bloque de terminales?')) return;
    setActionError(null);
    try {
      await deactivateBloqueTerminal(projectId, bloqueId, devUserEmail);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  return (
    <section className="form__section">
      <h2>Borneras</h2>
      <ErrorMessage error={error ?? actionError} />

      {loading && <p>Cargando bloques de terminales…</p>}
      {!loading && bloques && bloques.length === 0 && (
        <p className="physical-hint">Sin bloques de terminales (TB) registrados.</p>
      )}

      {!loading &&
        bloques?.map((bloque) => (
          <BloqueTerminalCard
            key={bloque.id}
            projectId={projectId}
            devUserEmail={devUserEmail}
            bloqueId={bloque.id}
            bloqueCodigo={bloque.codigo}
            canWrite={canWrite}
            canDeactivate={canDeactivate}
            onDeactivateBloque={() => handleDeactivateBloque(bloque.id)}
          />
        ))}

      {canWrite && (
        <div className="physical-slot__install-form">
          <input
            type="text"
            placeholder="Código del bloque (ej. TB1)"
            value={newCodigo}
            onChange={(e) => setNewCodigo(e.target.value)}
            disabled={creating}
            maxLength={20}
          />
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={!newCodigo.trim() || creating}
            onClick={handleCreateBloque}
          >
            {creating ? 'Creando…' : 'Agregar bloque'}
          </button>
        </div>
      )}
    </section>
  );
}

/*
 * Una fila de bloque, con su propio detalle (terminales + posiciones)
 * cargado bajo demanda — evita N llamadas de detalle si el dueño tiene
 * muchos bloques que el usuario nunca expande.
 */
function BloqueTerminalCard({
  projectId,
  devUserEmail,
  bloqueId,
  bloqueCodigo,
  canWrite,
  canDeactivate,
  onDeactivateBloque
}: {
  projectId: string;
  devUserEmail: string;
  bloqueId: string;
  bloqueCodigo: string;
  canWrite: boolean;
  canDeactivate: boolean;
  onDeactivateBloque: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<BloqueTerminalConTerminales | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [newNumero, setNewNumero] = useState('');
  const [creatingTerminal, setCreatingTerminal] = useState(false);

  async function loadDetail() {
    setLoadingDetail(true);
    setError(null);
    try {
      const result = await getBloqueTerminal(projectId, bloqueId, devUserEmail);
      setDetail(result.bloqueTerminal);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setLoadingDetail(false);
    }
  }

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) loadDetail();
  }

  async function handleCreateTerminal() {
    if (!newNumero.trim()) return;
    setCreatingTerminal(true);
    setError(null);
    try {
      await createTerminal(projectId, bloqueId, newNumero.trim(), devUserEmail);
      setNewNumero('');
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreatingTerminal(false);
    }
  }

  async function handleDeactivateTerminal(terminalId: string) {
    if (!window.confirm('¿Desactivar este terminal?')) return;
    setError(null);
    try {
      await deactivateTerminal(projectId, bloqueId, terminalId, devUserEmail);
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  async function handleCreatePosicion(terminalId: string, codigo: string) {
    if (!codigo.trim()) return;
    setError(null);
    try {
      await createPosicionTerminal(projectId, bloqueId, terminalId, codigo.trim(), devUserEmail);
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  async function handleDeactivatePosicion(terminalId: string, posicionId: string) {
    if (!window.confirm('¿Desactivar esta posición?')) return;
    setError(null);
    try {
      await deactivatePosicionTerminal(projectId, bloqueId, terminalId, posicionId, devUserEmail);
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Error desconocido.'));
    }
  }

  return (
    <div className="physical-slot">
      <div className="physical-slot__module-actions">
        <button type="button" className="button button--secondary button--small" onClick={toggleExpanded}>
          {expanded ? '▾' : '▸'} Bloque {bloqueCodigo}
        </button>
        <button
          type="button"
          className="button button--danger button--small"
          disabled={!canDeactivate}
          onClick={onDeactivateBloque}
        >
          Desactivar bloque
        </button>
      </div>

      {expanded && (
        <div>
          <ErrorMessage error={error} />
          {loadingDetail && <p>Cargando terminales…</p>}

          {!loadingDetail && detail && (
            <table className="table">
              <thead>
                <tr>
                  <th>Terminal</th>
                  <th>Posiciones</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.terminales.length === 0 && (
                  <tr>
                    <td colSpan={3} className="physical-hint">Sin terminales.</td>
                  </tr>
                )}
                {detail.terminales.map((terminal) => (
                  <TerminalRow
                    key={terminal.id}
                    terminal={terminal}
                    canWrite={canWrite}
                    canDeactivate={canDeactivate}
                    onDeactivateTerminal={() => handleDeactivateTerminal(terminal.id)}
                    onCreatePosicion={(codigo) => handleCreatePosicion(terminal.id, codigo)}
                    onDeactivatePosicion={(posicionId) => handleDeactivatePosicion(terminal.id, posicionId)}
                  />
                ))}
              </tbody>
            </table>
          )}

          {canWrite && (
            <div className="physical-slot__install-form">
              <input
                type="text"
                placeholder="Número de terminal (ej. F1)"
                value={newNumero}
                onChange={(e) => setNewNumero(e.target.value)}
                disabled={creatingTerminal}
                maxLength={20}
              />
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={!newNumero.trim() || creatingTerminal}
                onClick={handleCreateTerminal}
              >
                {creatingTerminal ? 'Creando…' : 'Agregar terminal'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TerminalRow({
  terminal,
  canWrite,
  canDeactivate,
  onDeactivateTerminal,
  onCreatePosicion,
  onDeactivatePosicion
}: {
  terminal: { id: string; numero: string; posiciones?: Array<{ id: string; codigo: string; inUse: boolean }> };
  canWrite: boolean;
  canDeactivate: boolean;
  onDeactivateTerminal: () => void;
  onCreatePosicion: (codigo: string) => void;
  onDeactivatePosicion: (posicionId: string) => void;
}) {
  const [newCodigo, setNewCodigo] = useState('');

  return (
    <tr>
      <td>{terminal.numero}</td>
      <td>
        {(terminal.posiciones ?? []).map((pos) => (
          <span key={pos.id} className="physical-slot__module-actions">
            <span title={pos.inUse ? 'Ocupada' : 'Libre'}>
              {pos.codigo} {pos.inUse ? '🔒' : ''}
            </span>
            {canDeactivate && !pos.inUse && (
              <button
                type="button"
                className="button button--danger button--small"
                onClick={() => onDeactivatePosicion(pos.id)}
              >
                Quitar
              </button>
            )}
          </span>
        ))}
        {canWrite && (
          <span className="physical-slot__install-form">
            <input
              type="text"
              placeholder="código (ej. A)"
              value={newCodigo}
              onChange={(e) => setNewCodigo(e.target.value)}
              maxLength={10}
              style={{ width: '6rem' }}
            />
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={!newCodigo.trim()}
              onClick={() => {
                onCreatePosicion(newCodigo);
                setNewCodigo('');
              }}
            >
              + posición
            </button>
          </span>
        )}
      </td>
      <td>
        <button type="button" className="button button--danger button--small" disabled={!canDeactivate} onClick={onDeactivateTerminal}>
          Desactivar
        </button>
      </td>
    </tr>
  );
}
