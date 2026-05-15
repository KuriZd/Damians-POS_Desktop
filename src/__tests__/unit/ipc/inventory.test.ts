import { describe, it, expect, beforeEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { createTestDb } from '../../helpers/test-db'
import { seedProduct, seedUser } from '../../helpers/seeds'
import { registerMovementCore } from '../../../main/ipc/inventory.core'

let db: BetterSqlite3.Database
let productId: number
let userId: number

beforeEach(() => {
  db = createTestDb()
  userId = seedUser(db, { role: 'ADMIN' })
  const { id } = seedProduct(db, { stock: 10, sku: 'PROD-001', name: 'Cuaderno' })
  productId = id
})

describe('registerMovementCore — validation', () => {
  it('rejects productId = 0', () => {
    const result = registerMovementCore(db, { productId: 0, type: 'entrada', qty: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('productId')
  })

  it('rejects negative productId', () => {
    const result = registerMovementCore(db, { productId: -5, type: 'entrada', qty: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('productId')
  })

  it('rejects invalid type', () => {
    const result = registerMovementCore(db, {
      productId,
      // @ts-expect-error intentional invalid type
      type: 'robo',
      qty: 1
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('type')
  })

  it('rejects qty = 0 for non-ajuste type', () => {
    const result = registerMovementCore(db, { productId, type: 'entrada', qty: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('qty')
  })

  it('rejects negative qty for non-ajuste type', () => {
    const result = registerMovementCore(db, { productId, type: 'merma', qty: -3 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('qty')
  })
})

describe('registerMovementCore — stock updates', () => {
  it('entrada increases stock', () => {
    const result = registerMovementCore(db, { productId, type: 'entrada', qty: 5, userId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stockBefore).toBe(10)
    expect(result.stockAfter).toBe(15)
    const row = db.prepare(`SELECT stock FROM "Product" WHERE id = ?`).get(productId) as {
      stock: number
    }
    expect(row.stock).toBe(15)
  })

  it('merma decreases stock', () => {
    const result = registerMovementCore(db, { productId, type: 'merma', qty: 3, userId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stockAfter).toBe(7)
  })

  it('devolucion increases stock', () => {
    const result = registerMovementCore(db, { productId, type: 'devolucion', qty: 2, userId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stockAfter).toBe(12)
  })

  it('creates an InventoryMovement row', () => {
    registerMovementCore(db, { productId, type: 'entrada', qty: 5, userId })
    const rows = db
      .prepare(`SELECT * FROM "InventoryMovement" WHERE "productId" = ?`)
      .all(productId)
    expect(rows).toHaveLength(1)
  })

  it('records correct stockBefore and stockAfter in the movement row', () => {
    registerMovementCore(db, { productId, type: 'entrada', qty: 4, userId })
    type MovRow = { stockBefore: number; stockAfter: number }
    const row = db
      .prepare(`SELECT "stockBefore", "stockAfter" FROM "InventoryMovement" WHERE "productId" = ?`)
      .get(productId) as MovRow
    expect(row.stockBefore).toBe(10)
    expect(row.stockAfter).toBe(14)
  })
})
