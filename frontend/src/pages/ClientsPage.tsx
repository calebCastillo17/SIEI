import { useCallback, useState } from 'react';

import { useDevUser } from '../auth/DevUserContext';
import { useMe } from '../auth/MeContext';
import { createClient, deactivateClient, listClients, updateClient } from '../api/clients';
import { useAsyncData } from '../lib/useAsyncData';
import { ClientForm } from '../components/ClientForm';
import { emptyClientInput } from '../components/clientFormDefaults';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Client, ClientInput } from '../api/types';

export function ClientsPage() {
  const { devUser } = useDevUser();
  const { me } = useMe();
  const isSystemAdmin = me?.user.esAdminSistema ?? false;

  const fetchClients = useCallback(
    () => listClients(devUser.email).then((r) => r.clients),
    [devUser.email]
  );
  const { data: clients, loading, error: loadError, refresh: load } = useAsyncData<Client[]>(
    fetchClients
  );

  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  async function handleCreate(value: ClientInput) {
    setCreating(true);
    setActionError(null);
    try {
      await createClient(value, devUser.email);
      setShowForm(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(clientId: string, value: ClientInput) {
    setSavingId(clientId);
    setActionError(null);
    try {
      await updateClient(clientId, value, devUser.email);
      setEditingId(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeactivate(client: Client) {
    if (!window.confirm(`¿Desactivar el cliente "${client.nombre}"?`)) return;
    setDeactivatingId(client.id);
    setActionError(null);
    try {
      await deactivateClient(client.id, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  const items = clients ?? [];
  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Clientes</h1>
          <p className="page-subtitle">Dueños de los proyectos de SIEI.</p>
        </div>

        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={load}>
            Actualizar
          </button>
          {!showForm && (
            <button
              type="button"
              className="button"
              disabled={!isSystemAdmin}
              title={isSystemAdmin ? undefined : 'Solo un administrador de sistema puede crear clientes.'}
              onClick={() => setShowForm(true)}
            >
              + Nuevo cliente
            </button>
          )}
        </div>
      </div>

      <ErrorMessage error={error} />

      {showForm && (
        <ClientForm
          initialValue={emptyClientInput()}
          submitLabel="Crear cliente"
          submitting={creating}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading && <p>Cargando clientes…</p>}

      {!loading && items.length === 0 && <p>Todavía no hay clientes activos.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código interno</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((client) =>
              editingId === client.id ? (
                <tr key={client.id}>
                  <td colSpan={3}>
                    <ClientForm
                      initialValue={{ nombre: client.nombre, codigoInterno: client.codigoInterno }}
                      submitLabel="Guardar cambios"
                      submitting={savingId === client.id}
                      onSubmit={(value) => handleSaveEdit(client.id, value)}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={client.id}>
                  <td>{client.nombre}</td>
                  <td>{client.codigoInterno ?? '—'}</td>
                  <td className="table__row-actions">
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={!isSystemAdmin}
                      title={isSystemAdmin ? undefined : 'Solo un administrador de sistema puede editar clientes.'}
                      onClick={() => setEditingId(client.id)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="button button--danger button--small"
                      disabled={!isSystemAdmin || deactivatingId === client.id}
                      title={isSystemAdmin ? undefined : 'Solo un administrador de sistema puede desactivar clientes.'}
                      onClick={() => handleDeactivate(client)}
                    >
                      {deactivatingId === client.id ? 'Desactivando…' : 'Desactivar'}
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
