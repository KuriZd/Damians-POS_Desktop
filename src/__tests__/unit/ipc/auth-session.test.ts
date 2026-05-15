import { describe, it, expect, beforeEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { createTestDb } from '../../helpers/test-db'
import { seedUser } from '../../helpers/seeds'
import { revalidateUserFromDb, type AuthUser } from '../../../main/ipc/auth.core'

let db: BetterSqlite3.Database

function makeStoredUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    name: 'Test User',
    username: 'testuser',
    role: 'CASHIER',
    active: true,
    source: 'remote',
    ...overrides
  }
}

beforeEach(() => {
  db = createTestDb()
})

describe('revalidateUserFromDb', () => {
  it('returns null when user id does not exist in DB', () => {
    const stored = makeStoredUser({ id: 999 })
    const result = revalidateUserFromDb(db, stored)
    expect(result).toBeNull()
  })

  it('returns null when user exists but is inactive (active = 0)', () => {
    const id = seedUser(db, { role: 'CASHIER', active: 0 })
    const stored = makeStoredUser({ id, role: 'CASHIER', active: true })
    const result = revalidateUserFromDb(db, stored)
    expect(result).toBeNull()
  })

  it('overrides tampered role from session with DB role', () => {
    const id = seedUser(db, { role: 'ADMIN', active: 1 })
    const stored = makeStoredUser({ id, role: 'CASHIER' })
    const result = revalidateUserFromDb(db, stored)
    expect(result).not.toBeNull()
    expect(result!.role).toBe('ADMIN')
  })

  it('returns validated user with active = true when DB is active', () => {
    const id = seedUser(db, { role: 'SUPERVISOR', active: 1 })
    const stored = makeStoredUser({ id, role: 'SUPERVISOR', active: true })
    const result = revalidateUserFromDb(db, stored)
    expect(result).not.toBeNull()
    expect(result!.active).toBe(true)
    expect(result!.role).toBe('SUPERVISOR')
  })

  it('preserves source and username from the stored session', () => {
    const id = seedUser(db, { username: 'cajero1', role: 'CASHIER', active: 1 })
    const stored = makeStoredUser({ id, username: 'cajero1', source: 'local' })
    const result = revalidateUserFromDb(db, stored)
    expect(result!.source).toBe('local')
    expect(result!.username).toBe('cajero1')
  })
})
