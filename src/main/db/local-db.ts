import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { localSchema, localMigrations } from './local-schema'

let db: Database.Database | null = null

export function getLocalDb(): Database.Database {
  if (db) return db

  const dataDir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDir, { recursive: true })

  db = new Database(path.join(dataDir, 'pos-local.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Column renames must happen before db.exec(localSchema) because the schema
  // creates indexes on the new column names (e.g. sourceType, unitPrice).
  applyPreSchemaMigrations(db)

  db.exec(localSchema)

  applyPostSchemaMigrations(db)

  return db
}

function applyPreSchemaMigrations(db: Database.Database): void {
  // Remove legacy Sale.tax column for existing databases.
  try {
    const saleCols = db.prepare(`PRAGMA table_info("Sale")`).all() as { name: string }[]
    const hasTax = saleCols.some((c) => c.name === 'tax')
    if (hasTax) {
      db.exec(`ALTER TABLE "Sale" DROP COLUMN tax`)
    }
  } catch (e) {
    console.warn('[migration] Sale tax drop failed silently:', e)
  }
  // Rename SaleItem.price → unitPrice for existing databases
  try {
    const cols = db.prepare(`PRAGMA table_info("SaleItem")`).all() as { name: string }[]
    const hasPrice = cols.some((c) => c.name === 'price')
    const hasUnitPrice = cols.some((c) => c.name === 'unitPrice')
    if (hasPrice && !hasUnitPrice) {
      db.exec(`ALTER TABLE "SaleItem" RENAME COLUMN "price" TO "unitPrice"`)
    }
  } catch (e) {
    console.warn('[migration] SaleItem price rename failed silently:', e)
  }

  // Rename InventoryMovement.type → sourceType for existing databases
  try {
    const cols = db.prepare(`PRAGMA table_info("InventoryMovement")`).all() as { name: string }[]
    const hasType = cols.some((c) => c.name === 'type')
    const hasSourceType = cols.some((c) => c.name === 'sourceType')
    if (hasType && !hasSourceType) {
      db.exec(`ALTER TABLE "InventoryMovement" RENAME COLUMN "type" TO "sourceType"`)
    }
  } catch (e) {
    console.warn('[migration] InventoryMovement type rename failed silently:', e)
  }

  // ADD COLUMN migrations must also run before db.exec(localSchema) because the
  // schema creates indexes on these new columns; existing tables won't be recreated.
  for (const stmt of localMigrations
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('ALTER'))) {
    try {
      db.exec(stmt)
    } catch {
      /* column already exists — safe to ignore */
    }
  }
}

function applyPostSchemaMigrations(db: Database.Database): void {
  // Backfill sourceType values from old human-readable names to enum values
  try {
    db.exec(`
      UPDATE "InventoryMovement" SET "sourceType" = 'PURCHASE'   WHERE "sourceType" = 'entrada';
      UPDATE "InventoryMovement" SET "sourceType" = 'ADJUSTMENT' WHERE "sourceType" = 'ajuste';
      UPDATE "InventoryMovement" SET "sourceType" = 'MANUAL'     WHERE "sourceType" = 'merma';
      UPDATE "InventoryMovement" SET "sourceType" = 'RETURN'     WHERE "sourceType" = 'devolucion';
      UPDATE "InventoryMovement" SET type = "sourceType" WHERE type IS NULL AND "sourceType" IS NOT NULL;
      UPDATE "InventoryMovement" SET reason = note WHERE reason IS NULL AND note IS NOT NULL;
      UPDATE "InventoryMovement" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
      UPDATE "InventoryMovement" SET "publicId" = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
        substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) ||
        substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
      WHERE "publicId" IS NULL;
    `)
  } catch {
    /* no-op */
  }

  try {
    db.exec(`
      UPDATE "ServiceSupply" SET "createdAt" = CURRENT_TIMESTAMP WHERE "createdAt" IS NULL;
      UPDATE "ServiceSupply" SET "updatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP);
    `)
  } catch {
    /* no-op */
  }

  // Backfill itemType to uppercase
  try {
    db.exec(`
      UPDATE "SaleItem" SET "itemType" = 'PRODUCT' WHERE lower("itemType") = 'product';
      UPDATE "SaleItem" SET "itemType" = 'SERVICE' WHERE lower("itemType") = 'service';
    `)
  } catch {
    /* no-op */
  }
}
