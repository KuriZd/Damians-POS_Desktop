import { ipcMain } from 'electron'
import bcrypt from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
import { getLocalDb } from '../db/local-db'
import { supabaseAdmin } from '../supabase/client'

type AppRole = 'ADMIN' | 'CASHIER' | 'SUPERVISOR'

type RemoteUserRow = Record<string, unknown>

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function registerUsersIpc(): void {
  ipcMain.handle('users:list', async () => {
    const attempts = [
      'id, username, name, role, active, createdAt, updatedAt',
      'id, username, name, role, active'
    ]

    for (const select of attempts) {
      const { data, error } = await supabaseAdmin
        .from('User')
        .select(select)
        .order('id', { ascending: false })

      if (error) {
        console.warn(`[users:list] falló con select "${select}": ${error.message}`)
        continue
      }

      const rows = (data ?? []) as unknown as RemoteUserRow[]
      console.info(`[users:list] ok con select "${select}". Filas: ${rows.length}`)
      return rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username ?? ''),
        name: String(row.name ?? ''),
        role: String(row.role ?? 'CASHIER') as AppRole,
        active: Boolean(row.active),
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null
      }))
    }

    throw new Error('No se pudieron cargar los usuarios desde Supabase.')
  })

  ipcMain.handle(
    'users:create',
    async (
      _event,
      payload: { username: string; name: string; role: AppRole; password: string; active: boolean }
    ) => {
      const now = new Date().toISOString()
      const normalizedUsername = payload.username.trim().toLowerCase()
      const normalizedName = payload.name.trim()
      const remotePasswordHash = sha256Hex(payload.password)
      const passwordHashLocal = await bcrypt.hash(payload.password, 10)

      const { data, error } = await supabaseAdmin
        .from('User')
        .insert({
          name: normalizedName,
          username: normalizedUsername,
          pinHash: remotePasswordHash,
          role: payload.role,
          active: payload.active,
          createdAt: now,
          publicId: randomUUID(),
          updatedAt: now,
          passwordHash: remotePasswordHash
        })
        .select('id, username, name, role, active')
        .single()

      if (error) throw new Error(error.message)

      const db = getLocalDb()
      db.prepare(
        `INSERT INTO "User" (id, username, name, role, active, "passwordHashLocal", "createdAt", "updatedAt")
         VALUES (@id, @username, @name, @role, @active, @passwordHashLocal, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username, name = excluded.name, role = excluded.role,
           active = excluded.active, "passwordHashLocal" = excluded."passwordHashLocal",
           "updatedAt" = CURRENT_TIMESTAMP`
      ).run({
        id: data.id,
        username: data.username,
        name: data.name,
        role: data.role,
        active: data.active ? 1 : 0,
        passwordHashLocal
      })

      return { ok: true }
    }
  )

  ipcMain.handle(
    'users:update',
    async (
      _event,
      id: number,
      payload: { username?: string; name?: string; role?: AppRole; active?: boolean; password?: string }
    ) => {
      const remotePayload: Record<string, unknown> = {}
      if (payload.username !== undefined) remotePayload.username = payload.username.trim().toLowerCase()
      if (payload.name !== undefined) remotePayload.name = payload.name.trim()
      if (payload.role !== undefined) remotePayload.role = payload.role
      if (payload.active !== undefined) remotePayload.active = payload.active
      remotePayload.updatedAt = new Date().toISOString()

      let passwordHashLocal: string | undefined
      if (payload.password) {
        passwordHashLocal = await bcrypt.hash(payload.password, 10)
        const remotePasswordHash = sha256Hex(payload.password)
        remotePayload.pinHash = remotePasswordHash
        remotePayload.passwordHash = remotePasswordHash
      }

      const { error } = await supabaseAdmin.from('User').update(remotePayload).eq('id', id)
      if (error) throw new Error(error.message)

      const db = getLocalDb()
      const setClauses: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
      const params: Record<string, unknown> = { id }

      if (payload.username !== undefined) { setClauses.push('username = @username'); params.username = payload.username.trim().toLowerCase() }
      if (payload.name !== undefined) { setClauses.push('name = @name'); params.name = payload.name.trim() }
      if (payload.role !== undefined) { setClauses.push('role = @role'); params.role = payload.role }
      if (payload.active !== undefined) { setClauses.push('active = @active'); params.active = payload.active ? 1 : 0 }
      if (passwordHashLocal) { setClauses.push('"passwordHashLocal" = @passwordHashLocal'); params.passwordHashLocal = passwordHashLocal }

      db.prepare(`UPDATE "User" SET ${setClauses.join(', ')} WHERE id = @id`).run(params)

      return { ok: true }
    }
  )

  ipcMain.handle('users:delete', async (_event, id: number) => {
    const { error } = await supabaseAdmin.from('User').delete().eq('id', id)
    if (error) throw new Error(error.message)

    const db = getLocalDb()
    db.prepare(`DELETE FROM "User" WHERE id = @id`).run({ id })

    return { ok: true }
  })
}
