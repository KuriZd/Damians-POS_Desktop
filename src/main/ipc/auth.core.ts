import type Database from 'better-sqlite3'

type AppRole = 'ADMIN' | 'CASHIER' | 'SUPERVISOR'

export type AuthUser = {
  id: number
  name: string
  username: string
  role: AppRole
  active: boolean
  source: 'local' | 'remote'
}

export function revalidateUserFromDb(db: Database.Database, stored: AuthUser): AuthUser | null {
  const row = db
    .prepare(
      `SELECT id, name, username, role, active
     FROM "User"
     WHERE id = ? AND active = 1 AND "deletedAt" IS NULL
     LIMIT 1`
    )
    .get(stored.id) as
    | { id: number; name: string; username: string; role: AppRole; active: number }
    | undefined

  if (!row) return null

  return { ...stored, role: row.role, active: Boolean(row.active) }
}
