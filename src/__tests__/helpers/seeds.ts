import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'

export type ProductSeed = {
  id?: number
  publicId?: string
  sku?: string
  name?: string
  price?: number
  cost?: number
  stock?: number
  active?: number
}

export function seedProduct(
  db: BetterSqlite3.Database,
  overrides: ProductSeed = {}
): { id: number; publicId: string } {
  const publicId = overrides.publicId ?? randomUUID()
  const now = new Date().toISOString()
  const info = db
    .prepare(
      `
    INSERT INTO "Product" ("publicId", sku, name, price, cost, stock, active, "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      publicId,
      overrides.sku ?? `SKU-${Date.now()}`,
      overrides.name ?? 'Producto test',
      overrides.price ?? 1000,
      overrides.cost ?? 500,
      overrides.stock ?? 10,
      overrides.active ?? 1,
      now,
      now
    )
  return { id: Number(info.lastInsertRowid), publicId }
}

export type ServiceSeed = {
  id?: number
  publicId?: string
  code?: string
  name?: string
  price?: number
  cost?: number
  active?: number
}

export function seedService(
  db: BetterSqlite3.Database,
  overrides: ServiceSeed = {}
): { id: number; publicId: string } {
  const publicId = overrides.publicId ?? randomUUID()
  const now = new Date().toISOString()
  const info = db
    .prepare(
      `
    INSERT INTO "Service" ("publicId", code, name, price, cost, active, "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      publicId,
      overrides.code ?? `SVC-${Date.now()}`,
      overrides.name ?? 'Servicio test',
      overrides.price ?? 1000,
      overrides.cost ?? 0,
      overrides.active ?? 1,
      now,
      now
    )
  return { id: Number(info.lastInsertRowid), publicId }
}

export function seedServiceSupply(
  db: BetterSqlite3.Database,
  serviceId: number,
  productId: number,
  qty: number
): void {
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO "ServiceSupply" ("serviceId", "productId", qty, "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(serviceId, productId, qty, now, now)
}

export type UserSeed = {
  id?: number
  username?: string
  name?: string
  role?: string
  active?: number
}

export function seedUser(db: BetterSqlite3.Database, overrides: UserSeed = {}): number {
  const now = new Date().toISOString()
  const info = db
    .prepare(
      `
    INSERT INTO "User" (username, name, role, active, "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
      overrides.name ?? 'Usuario test',
      overrides.role ?? 'CASHIER',
      overrides.active ?? 1,
      now,
      now
    )
  return Number(info.lastInsertRowid)
}

export type SaleSeed = {
  publicId?: string
  folio?: string
  cashierId: number
  total?: number
  subtotal?: number
  createdAt?: string
}

export function seedSale(
  db: BetterSqlite3.Database,
  seed: SaleSeed
): { id: number; publicId: string } {
  const publicId = seed.publicId ?? randomUUID()
  const now = seed.createdAt ?? new Date().toISOString()
  const info = db
    .prepare(
      `
    INSERT INTO "Sale" ("publicId", folio, status, subtotal, total, "cashierId", "createdAt", "updatedAt")
    VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?)
  `
    )
    .run(
      publicId,
      seed.folio ?? `VTA-TEST-${randomUUID().slice(0, 8)}`,
      seed.subtotal ?? seed.total ?? 1000,
      seed.total ?? 1000,
      seed.cashierId,
      now,
      now
    )
  return { id: Number(info.lastInsertRowid), publicId }
}

export function seedPayment(
  db: BetterSqlite3.Database,
  salePublicId: string,
  method: string,
  amount: number
): void {
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO "Payment" ("publicId", "salePublicId", method, amount, "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(randomUUID(), salePublicId, method, amount, now, now)
}

export function seedCashSession(
  db: BetterSqlite3.Database,
  cashierId: number,
  overrides: { initialCash?: number; openedAt?: string } = {}
): number {
  const now = new Date().toISOString()
  const info = db
    .prepare(
      `
    INSERT INTO "CashSession" ("cashierId", "openedAt", "initialCash", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?)
  `
    )
    .run(cashierId, overrides.openedAt ?? now, overrides.initialCash ?? 0, now, now)
  return Number(info.lastInsertRowid)
}
