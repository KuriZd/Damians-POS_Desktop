import BetterSqlite3 from 'better-sqlite3'
import { localSchema } from '../../main/db/local-schema'

export function createTestDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(localSchema)
  return db
}
