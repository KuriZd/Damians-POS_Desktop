import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import type { AppRole, CreateUserPayload, UpdateUserPayload, UserListItem } from '../types/pos'
import styles from './UsersPage.module.css'

type UsersPageProps = {
  user: AuthUser
}

type FormState = {
  username: string
  name: string
  role: AppRole
  password: string
  active: boolean
}

const INITIAL_FORM: FormState = {
  username: '',
  name: '',
  role: 'CASHIER',
  password: '',
  active: true
}

function allowedManagedRoles(actorRole: AppRole): AppRole[] {
  return actorRole === 'ADMIN' ? ['ADMIN', 'SUPERVISOR', 'CASHIER'] : ['SUPERVISOR', 'CASHIER']
}

function canManageTarget(actorRole: AppRole, targetRole: AppRole): boolean {
  return allowedManagedRoles(actorRole).includes(targetRole)
}

async function listUsers(): Promise<UserListItem[]> {
  return window.pos.users.list()
}

async function createUser(payload: CreateUserPayload): Promise<void> {
  await window.pos.users.create(payload)
}

async function updateUser(id: number, payload: UpdateUserPayload): Promise<void> {
  await window.pos.users.update(id, payload)
}

async function deleteUser(id: number): Promise<void> {
  await window.pos.users.delete(id)
}

export default function UsersPage({ user }: UsersPageProps): JSX.Element {
  const [items, setItems] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const manageableRoles = useMemo(() => allowedManagedRoles(user.role), [user.role])

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const rows = await listUsers()
      const filtered = user.role === 'ADMIN' ? rows : rows.filter((item) => canManageTarget(user.role, item.role))
      console.info(`[users] Usuarios cargados: ${rows.length}. Visibles para ${user.role}: ${filtered.length}`)
      setItems(filtered)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los usuarios.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return items
    return items.filter((item) =>
      [item.username, item.name, item.role].some((value) => value.toLowerCase().includes(term))
    )
  }, [items, search])

  function openCreate(): void {
    setEditingUser(null)
    setForm({
      ...INITIAL_FORM,
      role: manageableRoles[0] ?? 'CASHIER'
    })
    setError(null)
    setIsModalOpen(true)
  }

  function openEdit(target: UserListItem): void {
    if (!canManageTarget(user.role, target.role)) return
    setEditingUser(target)
    setForm({
      username: target.username,
      name: target.name,
      role: target.role,
      password: '',
      active: target.active
    })
    setError(null)
    setIsModalOpen(true)
  }

  function closeModal(): void {
    setIsModalOpen(false)
    setEditingUser(null)
    setForm(INITIAL_FORM)
  }

  async function handleDelete(target: UserListItem): Promise<void> {
    if (target.id === user.id) {
      setError('No puedes eliminar tu propia cuenta.')
      return
    }
    if (!canManageTarget(user.role, target.role)) {
      setError('No tienes permiso para eliminar este usuario.')
      return
    }
    const confirmed = window.confirm(`¿Eliminar al usuario "${target.name}" (${target.username})? Esta acción no se puede deshacer.`)
    if (!confirmed) return

    try {
      setDeletingId(target.id)
      setError(null)
      await deleteUser(target.id)
      await load()
    } catch (delError) {
      setError(delError instanceof Error ? delError.message : 'No se pudo eliminar el usuario.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving) return

    const username = form.username.trim()
    const name = form.name.trim()

    if (!username || !name) {
      setError('Nombre y usuario son obligatorios.')
      return
    }

    if (!manageableRoles.includes(form.role)) {
      setError('No tienes permiso para asignar ese rol.')
      return
    }

    if (!editingUser && form.password.trim().length < 4) {
      setError('La contraseña debe tener al menos 4 caracteres.')
      return
    }

    if (editingUser && !canManageTarget(user.role, editingUser.role)) {
      setError('No tienes permiso para modificar este usuario.')
      return
    }

    try {
      setSaving(true)
      setError(null)

      if (!editingUser) {
        await createUser({
          username,
          name,
          role: form.role,
          password: form.password.trim(),
          active: form.active
        })
      } else {
        await updateUser(editingUser.id, {
          username,
          name,
          role: form.role,
          active: form.active,
          password: form.password.trim() || undefined
        })
      }

      closeModal()
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar el usuario.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.topbar}>
          <div className={styles.titleBlock}>
            <h2 className={styles.heading}>Control de usuarios</h2>
            <p className={styles.subtitle}>
              {user.role === 'ADMIN'
                ? 'Puedes crear y modificar administradores, supervisores y cajeros.'
                : 'Puedes crear y modificar supervisores y cajeros.'}
            </p>
          </div>

          <div className={styles.actions}>
            <div className={styles.searchWrap}>
              <input
                className={styles.searchInput}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar usuario, nombre o rol..."
              />
            </div>

            <button className={styles.primaryButton} type="button" onClick={openCreate}>
              Nuevo usuario
            </button>
          </div>
        </div>

        {error && !isModalOpen ? <div className={styles.errorBanner}>{error}</div> : null}

        <div className={styles.tableWrap}>
          <div className={styles.tableHeader}>
            <div>ID</div>
            <div>Usuario</div>
            <div>Nombre</div>
            <div>Rol</div>
            <div>Estado</div>
            <div />
          </div>

          {loading ? (
            <div className={styles.row}>
              <div className={styles.muted}>...</div>
              <div className={styles.muted}>Cargando usuarios...</div>
              <div />
              <div />
              <div />
              <div />
            </div>
          ) : visibleItems.length === 0 ? (
            <div className={styles.row}>
              <div className={styles.muted}>-</div>
              <div className={styles.muted}>No hay usuarios visibles para este rol.</div>
              <div />
              <div />
              <div />
              <div />
            </div>
          ) : (
            visibleItems.map((item) => (
              <div key={item.id} className={styles.row}>
                <div>{item.id}</div>
                <div>{item.username}</div>
                <div>{item.name}</div>
                <div>
                  <span className={styles.roleBadge}>{item.role}</span>
                </div>
                <div>
                  <span className={item.active ? styles.statusActive : styles.statusInactive}>
                    {item.active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className={styles.actionsCell}>
                  <button
                    className={styles.editButton}
                    type="button"
                    onClick={() => openEdit(item)}
                    disabled={!canManageTarget(user.role, item.role) || deletingId === item.id}
                  >
                    Editar
                  </button>
                  <button
                    className={styles.deleteButton}
                    type="button"
                    onClick={() => void handleDelete(item)}
                    disabled={!canManageTarget(user.role, item.role) || item.id === user.id || deletingId === item.id}
                  >
                    {deletingId === item.id ? '...' : 'Eliminar'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {isModalOpen ? (
        <div className={styles.backdrop}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3>{editingUser ? 'Editar usuario' : 'Nuevo usuario'}</h3>
              <button className={styles.closeButton} type="button" onClick={closeModal}>
                Cerrar
              </button>
            </div>

            <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
              <label className={styles.field}>
                <span>Usuario</span>
                <input
                  value={form.username}
                  onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                  disabled={saving}
                />
              </label>

              <label className={styles.field}>
                <span>Nombre</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  disabled={saving}
                />
              </label>

              <label className={styles.field}>
                <span>Rol</span>
                <select
                  value={form.role}
                  onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as AppRole }))}
                  disabled={saving}
                >
                  {manageableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>{editingUser ? 'Nueva contraseña (opcional)' : 'Contraseña'}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  disabled={saving}
                />
              </label>

              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
                  disabled={saving}
                />
                <span>Usuario activo</span>
              </label>

              {error ? <div className={styles.errorBanner}>{error}</div> : null}

              <div className={styles.modalActions}>
                <button className={styles.secondaryButton} type="button" onClick={closeModal} disabled={saving}>
                  Cancelar
                </button>
                <button className={styles.primaryButton} type="submit" disabled={saving}>
                  {saving ? 'Guardando...' : editingUser ? 'Guardar cambios' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}
