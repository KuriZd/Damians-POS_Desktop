import { describe, it, expect, beforeEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { createTestDb } from '../../helpers/test-db'
import { seedUser, seedSale, seedPayment, seedCashSession } from '../../helpers/seeds'
import { getSaleCorteData, confirmSaleCorte } from '../../../main/ipc/sales.core'

let db: BetterSqlite3.Database
let cashierA: number
let cashierB: number
let sessionOpenedAt: string

beforeEach(() => {
  db = createTestDb()
  cashierA = seedUser(db, { role: 'CASHIER' })
  cashierB = seedUser(db, { role: 'CASHIER' })
  sessionOpenedAt = new Date(Date.now() - 3600 * 1000).toISOString()
  seedCashSession(db, cashierA, { openedAt: sessionOpenedAt })
})

describe('sales:corte — scope to cashier', () => {
  it('counts only sales from cashier A, not cashier B', () => {
    const t1 = new Date(Date.now() - 1000).toISOString()
    const saleA1 = seedSale(db, { cashierId: cashierA, total: 1000, createdAt: t1 })
    const saleA2 = seedSale(db, { cashierId: cashierA, total: 2000, createdAt: t1 })
    const saleB = seedSale(db, { cashierId: cashierB, total: 5000, createdAt: t1 })

    seedPayment(db, saleA1.publicId, 'efectivo', 1000)
    seedPayment(db, saleA2.publicId, 'efectivo', 2000)
    seedPayment(db, saleB.publicId, 'efectivo', 5000)

    const corte = getSaleCorteData(db, cashierA)
    expect(corte.tickets).toBe(2)
    expect(corte.totalVentas).toBe(3000)
  })

  it('byMethod totals only include cashier A payments', () => {
    const t = new Date(Date.now() - 1000).toISOString()
    const saleA = seedSale(db, { cashierId: cashierA, total: 1500, createdAt: t })
    const saleB = seedSale(db, { cashierId: cashierB, total: 9999, createdAt: t })

    seedPayment(db, saleA.publicId, 'tarjeta', 1500)
    seedPayment(db, saleB.publicId, 'tarjeta', 9999)

    const corte = getSaleCorteData(db, cashierA)
    expect(corte.byMethod['tarjeta']).toBe(1500)
    expect(corte.byMethod['tarjeta']).not.toBe(9999 + 1500)
  })

  it('returns tickets = 0 when cashier A has no sales', () => {
    const t = new Date(Date.now() - 1000).toISOString()
    const saleB = seedSale(db, { cashierId: cashierB, total: 500, createdAt: t })
    seedPayment(db, saleB.publicId, 'efectivo', 500)

    const corte = getSaleCorteData(db, cashierA)
    expect(corte.tickets).toBe(0)
    expect(corte.totalVentas).toBe(0)
  })
})

describe('sales:confirmCorte — efectivo total scoped', () => {
  it('expected cash includes only cashier A efectivo', () => {
    const t = new Date(Date.now() - 1000).toISOString()
    const saleA = seedSale(db, { cashierId: cashierA, total: 1000, createdAt: t })
    const saleB = seedSale(db, { cashierId: cashierB, total: 4000, createdAt: t })

    seedPayment(db, saleA.publicId, 'efectivo', 1000)
    seedPayment(db, saleB.publicId, 'efectivo', 4000)

    const corte = getSaleCorteData(db, cashierA)
    expect(corte.totalEfectivo).toBe(1000)
    expect(corte.expected).toBe(1000)
  })

  it('confirmCorte closes the session', () => {
    const result = confirmSaleCorte(db, cashierA, 500)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const session = db
      .prepare(`SELECT "closedAt" FROM "CashSession" WHERE id = ?`)
      .get(result.sessionId) as { closedAt: string | null }
    expect(session.closedAt).not.toBeNull()
  })

  it('confirmCorte returns error when no active session', () => {
    confirmSaleCorte(db, cashierA)
    const result = confirmSaleCorte(db, cashierA)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('sesión')
  })
})
