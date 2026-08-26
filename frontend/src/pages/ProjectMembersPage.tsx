import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { addMember, listMembers, removeMember, updateMemberRole } from '../api/members';
import { useAsyncData } from '../lib/useAsyncData';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Member, ProjectRole } from '../api/types';

const ROLES: ProjectRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

export function ProjectMembersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canAdminister = project?.access.permissions.administer ?? false;

  const fetchMembers = useCallback(() => {
    if (!projectId) return Promise.resolve<Member[]>([]);
    return listMembers(projectId, devUser.email).then((r) => r.members);
  }, [projectId, devUser.email]);

  const { data: members, loading, error: loadError, refresh: load } = useAsyncData<Member[]>(
    fetchMembers
  );

  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<ProjectRole>('VIEWER');
  const [adding, setAdding] = useState(false);
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  if (!projectId) {
    return <p>Falta el proyecto en la URL.</p>;
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setActionError(null);
    try {
      await addMember(
        projectId!,
        { email: email.trim(), nombre: nombre.trim().length > 0 ? nombre.trim() : null, rol },
        devUser.email
      );
      setEmail('');
      setNombre('');
      setRol('VIEWER');
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(member: Member, newRole: ProjectRole) {
    if (newRole === member.role) return;
    setRoleChangingId(member.usuarioId);
    setActionError(null);
    try {
      await updateMemberRole(projectId!, member.usuarioId, newRole, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setRoleChangingId(null);
    }
  }

  async function handleRemove(member: Member) {
    if (!window.confirm(`¿Quitar a "${member.email}" de este proyecto?`)) return;
    setRemovingId(member.usuarioId);
    setActionError(null);
    try {
      await removeMember(projectId!, member.usuarioId, devUser.email);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setRemovingId(null);
    }
  }

  const items = members ?? [];
  const error = actionError ?? loadError;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Miembros</h1>
          {project && (
            <p className="page-subtitle">
              Proyecto {project.code} — {project.name}
            </p>
          )}
        </div>
        <button type="button" className="button button--secondary" onClick={load}>
          Actualizar
        </button>
      </div>

      <ErrorMessage error={error} />

      {canAdminister && (
        <form className="form form--inline" onSubmit={handleAdd}>
          <label className="form__field">
            <span>Email *</span>
            <input
              type="email"
              maxLength={320}
              required
              disabled={adding}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Nombre (si el usuario todavía no existe)</span>
            <input
              type="text"
              maxLength={200}
              disabled={adding}
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
            />
          </label>
          <label className="form__field">
            <span>Rol *</span>
            <select
              disabled={adding}
              value={rol}
              onChange={(event) => setRol(event.target.value as ProjectRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button" disabled={adding}>
            {adding ? 'Agregando…' : '+ Agregar miembro'}
          </button>
        </form>
      )}

      {loading && <p>Cargando miembros…</p>}

      {!loading && items.length === 0 && (
        <p>Este proyecto todavía no tiene miembros con acceso activo.</p>
      )}

      {!loading && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((member) => (
              <tr key={member.usuarioId}>
                <td>{member.email}</td>
                <td>{member.nombre}</td>
                <td>
                  {canAdminister ? (
                    <select
                      disabled={roleChangingId === member.usuarioId}
                      value={member.role}
                      onChange={(event) => handleRoleChange(member, event.target.value as ProjectRole)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    member.role
                  )}
                </td>
                <td className="table__row-actions">
                  <button
                    type="button"
                    className="button button--danger button--small"
                    disabled={!canAdminister || removingId === member.usuarioId}
                    title={
                      canAdminister
                        ? undefined
                        : 'Tu rol no tiene permiso de administración en este proyecto.'
                    }
                    onClick={() => handleRemove(member)}
                  >
                    {removingId === member.usuarioId ? 'Quitando…' : 'Quitar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
