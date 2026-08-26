import { useCallback, useState } from 'react';

import { useDevUser } from '../auth/DevUserContext';
import { createUser, deactivateUser, listUsers, updateUser } from '../api/users';
import { useAsyncData } from '../lib/useAsyncData';
import { UserForm } from '../components/UserForm';
import { emptyUserInput } from '../components/userFormDefaults';
import { ErrorMessage } from '../components/ErrorMessage';
import type { AppUser, UserInput } from '../api/types';

/**
 * Todo /api/users requiere es_admin_sistema (incluso GET) — a diferencia de
 * /api/clients. Esta pantalla solo administra el registro global del
 * usuario (email/nombre); asignar roles por proyecto es "Miembros", en
 * cada proyecto (ver ProjectMembersPage). Nunca expone esAdminSistema:
 * ese privilegio no tiene un endpoint genérico (CLAUDE.md).
 */
export function UsersPage() {
  const { devUser } = useDevUser();

  const fetchUsers = useCallback(() => listUsers(devUser.email).then((r) => r.users), [
    devUser.email
  ]);
  const { data: users, loading, error: loadError, refresh: load } = useAsyncData<AppUser[]>(
    fetchUsers
  );

  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  async function handleCreate(value: UserInput) {
    setCreating(true);
    setActionError(null);
    try {
      await createUser(value, devUser.email);
      setShowForm(false);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(userId: string, value: UserInput) {
    setSavingId(userId);
    setActionError(null);
    try {
      await updateUser(userId, value, devUser.email);
      setEditingId(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeactivate(user: AppUser) {
    if (
      !window.confirm(
        `¿Desactivar a "${user.email}"? Pierde acceso a TODOS sus proyectos, no solo a uno.`
      )
    )
      return;
    setDeactivatingId(user.id);
    setActionError(null);
    try {
      await deactivateUser(user.id, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  const items = users ?? [];
  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Usuarios</h1>
          <p className="page-subtitle">
            Registro global. Los roles por proyecto se administran en "Miembros", dentro de
            cada proyecto.
          </p>
        </div>

        <div className="page-header__actions">
          <button type="button" className="button button--secondary" onClick={load}>
            Actualizar
          </button>
          {!showForm && (
            <button type="button" className="button" onClick={() => setShowForm(true)}>
              + Nuevo usuario
            </button>
          )}
        </div>
      </div>

      <ErrorMessage error={error} />

      {showForm && (
        <UserForm
          initialValue={emptyUserInput()}
          submitLabel="Crear usuario"
          submitting={creating}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading && <p>Cargando usuarios…</p>}

      {!loading && items.length === 0 && <p>Todavía no hay usuarios activos.</p>}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((user) =>
              editingId === user.id ? (
                <tr key={user.id}>
                  <td colSpan={4}>
                    <UserForm
                      initialValue={{ email: user.email, nombre: user.nombre }}
                      submitLabel="Guardar cambios"
                      submitting={savingId === user.id}
                      onSubmit={(value) => handleSaveEdit(user.id, value)}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{user.nombre}</td>
                  <td className="table__permissions">
                    {user.esAdminSistema && <span className="badge badge--admin">admin de sistema</span>}
                    <span className="badge">{user.hasSignedIn ? 'ya inició sesión' : 'pre-registrado'}</span>
                  </td>
                  <td className="table__row-actions">
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setEditingId(user.id)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="button button--danger button--small"
                      disabled={deactivatingId === user.id}
                      onClick={() => handleDeactivate(user)}
                    >
                      {deactivatingId === user.id ? 'Desactivando…' : 'Desactivar'}
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
