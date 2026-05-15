import { describe, it, expect, beforeEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { createTestDb } from '../../helpers/test-db'
import { seedProduct, seedUser } from '../../helpers/seeds'
import { createSale } from '../../../main/ipc/sales.core'
import type { CreateSalePayload, SaleItemInput } from '../../../main/ipc/sales.core'

let db: BetterSqlite3.Database
let cashierId: number
let product: { id: number; publicId: string }

function makeItem(publicId: string, qty: number, price: number): SaleItemInput {
  return {
    itemType: 'PRODUCT' as const,
    productPublicId: publicId,
    servicePublicId: null,
    qty,
    price,
    discount: 0,
    lineTotal: price * qty
  }
}

function makePayload(overrides: Partial<CreateSalePayload> = {}): CreateSalePayload {
  return {
    cashierId,
    items: [makeItem(product.publicId, 1, 1000)],
    payments: [{ method: 'efectivo', amount: 1000 }],
    ...overrides
  }
}

beforeEach(() => {
  db = createTestDb()
  cashierId = seedUser(db, { role: 'CASHIER' })
  product = seedProduct(db, { stock: 5, price: 1000, cost: 400 })
})

describe('sales:create — valid sale', () => {
  it('creates a sale and returns ok: true with folio', () => {
    const result = createSale(db, makePayload())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.folio).toMatch(/^VTA-/)
    expect(result.salePublicId).toBeTruthy()
  })

  it('decrements stock by sold qty', () => {
    createSale(
      db,
      makePayload({
        items: [makeItem(product.publicId, 2, 1000)],
        payments: [{ method: 'efectivo', amount: 2000 }]
      })
    )
    const row = db.prepare(`SELECT stock FROM "Product" WHERE id = ?`).get(product.id) as {
      stock: number
    }
    expect(row.stock).toBe(3)
  })

  it('inserts a Payment row per payment entry', () => {
    createSale(db, makePayload({ items: [makeItem(product.publicId, 1, 1000)] }))
    const rows = db.prepare(`SELECT * FROM "Payment"`).all()
    expect(rows).toHaveLength(1)
  })

  it('overpayment is accepted', () => {
    const result = createSale(
      db,
      makePayload({
        payments: [{ method: 'efectivo', amount: 5000 }]
      })
    )
    expect(result.ok).toBe(true)
  })
})

describe('sales:create — stock guard', () => {
  it('rejects when requested qty exceeds stock', () => {
    const result = createSale(
      db,
      makePayload({
        items: [makeItem(product.publicId, 10, 1000)],
        payments: [{ method: 'efectivo', amount: 10000 }]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('STOCK_INSUFICIENTE')
    expect(result.items).toHaveLength(1)
    expect(result.items![0].available).toBe(5)
    expect(result.items![0].requested).toBe(10)
  })

  it('accumulates qty for duplicate product in items before checking stock', () => {
    const result = createSale(
      db,
      makePayload({
        items: [makeItem(product.publicId, 3, 1000), makeItem(product.publicId, 3, 1000)],
        payments: [{ method: 'efectivo', amount: 6000 }]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('STOCK_INSUFICIENTE')
    expect(result.items![0].requested).toBe(6)
  })

  it('does not decrement stock when sale is rejected', () => {
    createSale(
      db,
      makePayload({
        items: [makeItem(product.publicId, 10, 1000)],
        payments: [{ method: 'efectivo', amount: 10000 }]
      })
    )
    const row = db.prepare(`SELECT stock FROM "Product" WHERE id = ?`).get(product.id) as {
      stock: number
    }
    expect(row.stock).toBe(5)
  })
})

describe('sales:create — payment validation', () => {
  it('rejects payment below total', () => {
    const result = createSale(
      db,
      makePayload({
        payments: [{ method: 'efectivo', amount: 500 }]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('PAGO_INSUFICIENTE')
  })

  it('rejects zero-amount payment', () => {
    const result = createSale(
      db,
      makePayload({
        payments: [{ method: 'efectivo', amount: 0 }]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('MONTO_INVALIDO')
  })

  it('rejects negative-amount payment', () => {
    const result = createSale(
      db,
      makePayload({
        payments: [{ method: 'efectivo', amount: -100 }]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('MONTO_INVALIDO')
  })

  it('rejects invalid payment method', () => {
    const result = createSale(
      db,
      makePayload({
        // @ts-expect-error intentional invalid method
        payments: [{ method: 'bitcoin', amount: 1000 }]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('METODO_INVALIDO')
  })

  it('accepts mixed payments (efectivo + tarjeta) summing to total', () => {
    const result = createSale(
      db,
      makePayload({
        payments: [
          { method: 'efectivo', amount: 600 },
          { method: 'tarjeta', amount: 400 }
        ]
      })
    )
    expect(result.ok).toBe(true)
    const rows = db.prepare(`SELECT * FROM "Payment"`).all()
    expect(rows).toHaveLength(2)
  })
})

describe('sales:create — structural payload validation', () => {
  it('rejects cashierId = 0', () => {
    const result = createSale(db, makePayload({ cashierId: 0 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('cashierId')
  })

  it('rejects empty items array', () => {
    const result = createSale(db, makePayload({ items: [] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('items')
  })

  it('rejects qty <= 0', () => {
    const result = createSale(
      db,
      makePayload({
        items: [makeItem(product.publicId, 0, 1000)]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('qty')
  })

  it('rejects negative price', () => {
    const result = createSale(
      db,
      makePayload({
        items: [
          {
            itemType: 'PRODUCT',
            productPublicId: product.publicId,
            servicePublicId: null,
            qty: 1,
            price: -1,
            discount: 0,
            lineTotal: 0
          }
        ]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('price')
  })
})
