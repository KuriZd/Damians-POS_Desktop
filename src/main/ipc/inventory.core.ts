import crypto from 'node:crypto'
import type Database from 'better-sqlite3'

const UI_TO_SOURCE: Record<string, string> = {
  entrada: 'PURCHASE',
  ajuste: 'ADJUSTMENT',
  merma: 'MANUAL',
  devolucion: 'RETURN'
}

const VALID_MOVE_TYPES = new Set(['entrada', 'ajuste', 'merma', 'devolucion'])

export type MovementPayload = {
  productId: number
  type: 'entrada' | 'ajuste' | 'merma' | 'devolucion'
  qty: number
  realQty?: number
  userId?: number
  note?: string
}

export type MovementResult =
  | { ok: true; stockBefore: number; stockAfter: number }
  | { ok: false; stockBefore: 0; stockAfter: 0; error: string }

export function registerMovementCore(
  db: Database.Database,
  payload: MovementPayload,
  afterPersist: (movId: number) => Promise<void> = async () => {}
): MovementResult {
  if (!Number.isInteger(payload.productId) || payload.productId <= 0)
    return {
      ok: false,
      stockBefore: 0,
      stockAfter: 0,
      error: 'PAYLOAD_INVALIDO: productId inválido'
    }
  if (!VALID_MOVE_TYPES.has(payload.type))
    return {
      ok: false,
      stockBefore: 0,
      stockAfter: 0,
      error: `PAYLOAD_INVALIDO: type inválido "${payload.type}"`
    }
  if (payload.type !== 'ajuste' && (!Number.isInteger(payload.qty) || payload.qty <= 0))
    return {
      ok: false,
      stockBefore: 0,
      stockAfter: 0,
      error: 'PAYLOAD_INVALIDO: qty debe ser entero positivo'
    }
  if (payload.userId !== undefined && (!Number.isInteger(payload.userId) || payload.userId <= 0))
    return { ok: false, stockBefore: 0, stockAfter: 0, error: 'PAYLOAD_INVALIDO: userId inválido' }

  type ProdRow = {
    stock: number
    sku: string | null
    name: string
    publicId: string | null
    cost: number
  }
  const product = db
    .prepare(`SELECT stock, sku, name, "publicId", cost FROM "Product" WHERE id = ?`)
    .get(payload.productId) as ProdRow | undefined

  if (!product) throw new Error('Producto no encontrado.')

  const sourceType = UI_TO_SOURCE[payload.type] ?? 'MANUAL'
  const stockBefore = product.stock

  let stockAfter: number
  let recordedQty: number
  if (payload.type === 'ajuste' && payload.realQty !== undefined) {
    stockAfter = Math.max(0, payload.realQty)
    recordedQty = Math.abs(stockAfter - stockBefore)
  } else {
    recordedQty = payload.qty
    stockAfter =
      payload.type === 'entrada' || payload.type === 'devolucion'
        ? stockBefore + recordedQty
        : Math.max(0, stockBefore - recordedQty)
  }

  const movementType = stockAfter >= stockBefore ? 'IN' : 'OUT'
  const now = new Date().toISOString()

  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO "InventoryMovement" (
        "publicId", type, "productId", "originalProductId", "sourceType", "sourceId", qty,
        reason, "stockBefore", "stockAfter", "userId", note,
        "productPublicIdSnapshot", "productCodeSnapshot", "productNameSnapshot",
        "unitCostSnapshot", "originDeviceId", "createdAt", "updatedAt"
      ) VALUES (?,?,?,?,?,?,?, ?, ?,?, ?,?, ?,?,?, ?,?,?,?)
    `
    ).run(
      crypto.randomUUID(),
      movementType,
      payload.productId,
      payload.productId,
      sourceType,
      null,
      recordedQty,
      payload.note ?? null,
      stockBefore,
      stockAfter,
      payload.userId ?? null,
      payload.note ?? null,
      product.publicId ?? null,
      product.sku ?? null,
      product.name,
      product.cost,
      null,
      now,
      now
    )
    db.prepare(`UPDATE "Product" SET stock = ?, "updatedAt" = ? WHERE id = ?`).run(
      stockAfter,
      now,
      payload.productId
    )
  })()

  const { id: movId } = db
    .prepare(
      `SELECT id FROM "InventoryMovement" WHERE "productId" = ? AND "sourceType" = ? ORDER BY id DESC LIMIT 1`
    )
    .get(payload.productId, sourceType) as { id: number }

  afterPersist(movId).catch((err: unknown) =>
    console.error('[inventory.core] afterPersist failed:', err)
  )

  return { ok: true, stockBefore, stockAfter }
}
