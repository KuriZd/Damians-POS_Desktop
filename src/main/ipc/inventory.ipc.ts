import { ipcMain } from 'electron'
import crypto from 'node:crypto'
import { getLocalDb } from '../db/local-db'
import { pushMovementToSupabase } from './sync.ipc'

type Period   = 'today' | 'week' | 'month'
type UiMoveType = 'entrada' | 'venta' | 'ajuste' | 'merma' | 'devolucion'

// Map UI labels ↔ Supabase enum values
const UI_TO_SOURCE: Record<string, string> = {
  entrada:   'PURCHASE',
  ajuste:    'ADJUSTMENT',
  merma:     'MANUAL',
  devolucion:'RETURN',
}
const SOURCE_TO_UI: Record<string, UiMoveType> = {
  SALE:                'venta',
  SALE_CANCEL:         'devolucion',
  SERVICE_CONSUMPTION: 'merma',
  PURCHASE:            'entrada',
  OPENING_STOCK:       'entrada',
  ADJUSTMENT:          'ajuste',
  RETURN:              'devolucion',
  MANUAL:              'merma',
}

function movementTypeFromSource(sourceType: string): 'IN' | 'OUT' {
  switch (sourceType) {
    case 'PURCHASE':
    case 'OPENING_STOCK':
    case 'RETURN':
    case 'SALE_CANCEL':
      return 'IN'
    default:
      return 'OUT'
  }
}

function periodDates(period: Period): { current: string; previous: string; prevTo: string } {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const today = fmt(now)

  if (period === 'today') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    return { current: today, previous: fmt(y), prevTo: fmt(y) }
  }
  if (period === 'week') {
    const start = new Date(now); start.setDate(start.getDate() - 6)
    const pStart = new Date(now); pStart.setDate(pStart.getDate() - 13)
    const pEnd   = new Date(now); pEnd.setDate(pEnd.getDate() - 7)
    return { current: fmt(start), previous: fmt(pStart), prevTo: fmt(pEnd) }
  }
  const start  = new Date(now); start.setDate(start.getDate() - 29)
  const pStart = new Date(now); pStart.setDate(pStart.getDate() - 59)
  const pEnd   = new Date(now); pEnd.setDate(pEnd.getDate() - 30)
  return { current: fmt(start), previous: fmt(pStart), prevTo: fmt(pEnd) }
}

function pct(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0
  return Math.round(((curr - prev) / prev) * 100)
}

export function registerInventoryIpc(): void {

  // ── Products with category, 30-day consumption, stock status ──────────────
  ipcMain.handle('inventory:products', () => {
    const db = getLocalDb()

    type Row = {
      id: number; name: string; sku: string; category: string | null
      stock: number; stockMin: number; stockMax: number
      cost: number; price: number; consumption: number | null
      lastMove: string | null; active: number
    }

    const rows = db.prepare(`
      SELECT
        p.id, p.name, p.sku,
        c.name               AS category,
        p.stock,
        p."stockMin"         AS stockMin,
        p."stockMax"         AS stockMax,
        p.cost, p.price,
        COALESCE(SUM(si.qty), 0)   AS consumption,
        MAX(im."createdAt")         AS lastMove,
        p.active
      FROM "Product" p
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN "SaleItem" si
             ON si."originalProductId" = p.id
            AND si."itemType" = 'PRODUCT'
            AND DATE(si."createdAt") >= DATE('now', '-30 days')
      LEFT JOIN "InventoryMovement" im ON im."productId" = p.id
      WHERE p."deletedAt" IS NULL
      GROUP BY p.id
      ORDER BY p.name ASC
    `).all() as Row[]

    return rows.map(p => ({
      id:          p.id,
      name:        p.name,
      sku:         p.sku,
      category:    p.category ?? 'Sin categoría',
      stock:       p.stock,
      stockMin:    p.stockMin,
      stockMax:    p.stockMax,
      cost:        p.cost,
      price:       p.price,
      consumption: p.consumption ?? 0,
      lastMove:    p.lastMove
        ? new Date(p.lastMove).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
        : '—',
      active: Boolean(p.active),
      status: p.stock === 0 ? 'out' : p.stock <= p.stockMin ? 'low' : 'ok',
    }))
  })

  // ── KPI stats by period ───────────────────────────────────────────────────
  ipcMain.handle('inventory:stats', (_event, period: Period) => {
    const db = getLocalDb()
    const today = new Date().toISOString().slice(0, 10)
    const { current, previous, prevTo } = periodDates(period)

    type SaleRow = { total: number | null; tickets: number; units: number | null }
    type CostRow = { totalCost: number | null; totalProfit: number | null }

    function querySales(from: string, to: string): SaleRow {
      return db.prepare(`
        SELECT SUM(s.total) AS total, COUNT(DISTINCT s.id) AS tickets,
               SUM(si.qty)  AS units
        FROM "Sale" s
        LEFT JOIN "SaleItem" si ON si."salePublicId" = s."publicId"
                                AND si."itemType" = 'PRODUCT'
        WHERE s.status = 'COMPLETED'
          AND DATE(s."createdAt") >= ? AND DATE(s."createdAt") <= ?
      `).get(from, to) as SaleRow
    }

    // Use pre-computed lineCostTotal / lineProfit when available, fall back to product cost join
    function queryCost(from: string, to: string): CostRow {
      return db.prepare(`
        SELECT
          SUM(COALESCE(si."lineCostTotal", si.qty * p.cost, 0)) AS totalCost,
          SUM(COALESCE(si."lineProfit",
            si."lineTotal" - COALESCE(si."lineCostTotal", si.qty * COALESCE(p.cost, 0)), 0
          )) AS totalProfit
        FROM "SaleItem" si
        JOIN "Sale" s ON s."publicId" = si."salePublicId"
                      AND s.status = 'COMPLETED'
                      AND DATE(s."createdAt") >= ?
                      AND DATE(s."createdAt") <= ?
        LEFT JOIN "Product" p ON p."publicId" = si."productPublicId"
        WHERE si."itemType" = 'PRODUCT'
      `).get(from, to) as CostRow
    }

    const cs = querySales(current, today)
    const ps = querySales(previous, prevTo)
    const cc = queryCost(current, today)
    const pc = queryCost(previous, prevTo)

    const currVentas   = cs.total    ?? 0
    const prevVentas   = ps.total    ?? 0
    const currCosto    = cc.totalCost   ?? 0
    const prevCosto    = pc.totalCost   ?? 0
    const currGanancia = cc.totalProfit ?? (currVentas - currCosto)
    const prevGanancia = pc.totalProfit ?? (prevVentas - prevCosto)
    const currMargen   = currVentas > 0 ? Math.round((currGanancia / currVentas) * 100) : 0
    const prevMargen   = prevVentas > 0 ? Math.round((prevGanancia / prevVentas) * 100) : 0

    type StockRow = { stock: number; stockMin: number }
    const prods = db.prepare(
      `SELECT stock, "stockMin" AS stockMin FROM "Product" WHERE "deletedAt" IS NULL AND active = 1`
    ).all() as StockRow[]

    const low = prods.filter(p => p.stock > 0 && p.stock <= p.stockMin).length
    const out = prods.filter(p => p.stock === 0).length

    type MoveCount = { cnt: number }
    const currMoves = (db.prepare(
      `SELECT COUNT(*) AS cnt FROM "InventoryMovement" WHERE "sourceType" != 'SALE' AND DATE("createdAt") >= ?`
    ).get(current) as MoveCount).cnt

    const prevMoves = (db.prepare(
      `SELECT COUNT(*) AS cnt FROM "InventoryMovement" WHERE "sourceType" != 'SALE' AND DATE("createdAt") >= ? AND DATE("createdAt") <= ?`
    ).get(previous, prevTo) as MoveCount).cnt

    return {
      ventas:      currVentas,
      ganancia:    currGanancia,
      costo:       currCosto,
      margen:      currMargen,
      tickets:     cs.tickets ?? 0,
      unidades:    cs.units   ?? 0,
      bajos:       low + out,
      movimientos: currMoves,
      changes: {
        ventas:      pct(currVentas,   prevVentas),
        ganancia:    pct(currGanancia, prevGanancia),
        costo:       pct(currCosto,    prevCosto),
        margen:      currMargen - prevMargen,
        tickets:     pct(cs.tickets ?? 0, ps.tickets ?? 0),
        unidades:    pct(cs.units   ?? 0, ps.units   ?? 0),
        bajos:       0,
        movimientos: pct(currMoves, prevMoves),
      },
    }
  })

  // ── Chart: last 7 days (ventas + ganancia reales) ────────────────────────
  ipcMain.handle('inventory:chart', () => {
    const db = getLocalDb()

    type DayRow = { day: string; sales: number | null; profit: number | null }

    const rows = db.prepare(`
      SELECT
        DATE(s."createdAt") AS day,
        SUM(s.total)        AS sales,
        SUM(COALESCE(si."lineProfit",
          si."lineTotal" - COALESCE(si."lineCostTotal", si.qty * COALESCE(p.cost, 0)), 0
        )) AS profit
      FROM "Sale" s
      LEFT JOIN "SaleItem"  si ON si."salePublicId" = s."publicId"
                               AND si."itemType" = 'PRODUCT'
      LEFT JOIN "Product"   p  ON p."publicId" = si."productPublicId"
      WHERE s.status = 'COMPLETED'
        AND DATE(s."createdAt") >= DATE('now', '-6 days')
      GROUP BY DATE(s."createdAt")
      ORDER BY day ASC
    `).all() as DayRow[]

    const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    const result: { label: string; sales: number; profit: number }[] = []

    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const dayStr = d.toISOString().slice(0, 10)
      const found  = rows.find(r => r.day === dayStr)
      result.push({
        label:  DAY_LABELS[d.getDay()],
        sales:  found?.sales  ?? 0,
        profit: Math.max(0, found?.profit ?? 0),
      })
    }
    return result
  })

  // ── Movements: InventoryMovement (all types) ──────────────────────────────
  ipcMain.handle('inventory:movements', (_event, typeFilter?: string) => {
    const db = getLocalDb()

    // Map UI filter to sourceType value(s)
    let sourceFilter = ''
    if (typeFilter && typeFilter !== 'all') {
      if (typeFilter === 'venta') {
        sourceFilter = `AND im."sourceType" IN ('SALE','SALE_CANCEL')`
      } else if (typeFilter === 'entrada') {
        sourceFilter = `AND im."sourceType" IN ('PURCHASE','OPENING_STOCK')`
      } else if (typeFilter === 'ajuste') {
        sourceFilter = `AND im."sourceType" = 'ADJUSTMENT'`
      } else if (typeFilter === 'merma') {
        sourceFilter = `AND im."sourceType" IN ('MANUAL','SERVICE_CONSUMPTION')`
      } else if (typeFilter === 'devolucion') {
        sourceFilter = `AND im."sourceType" IN ('RETURN','SALE_CANCEL')`
      }
    }

    type MoveRow = {
      id: number; createdAt: string
      productName: string | null; sourceType: string; qty: number
      stockBefore: number | null; stockAfter: number | null
      userName: string | null; note: string | null
    }

    const rows = db.prepare(`
      SELECT
        im.id,
        im."createdAt"          AS createdAt,
        COALESCE(im."productNameSnapshot", p.name) AS productName,
        im."sourceType"         AS sourceType,
        im.qty,
        im."stockBefore"        AS stockBefore,
        im."stockAfter"         AS stockAfter,
        u.name                  AS userName,
        COALESCE(im.reason, im.note, s.folio) AS note
      FROM "InventoryMovement" im
      LEFT JOIN "Product" p ON p.id = im."productId"
      LEFT JOIN "User"    u ON u.id = im."userId"
      LEFT JOIN "Sale"    s ON s.id = im."saleId"
      WHERE 1=1 ${sourceFilter}
      ORDER BY im."createdAt" DESC
      LIMIT 100
    `).all() as MoveRow[]

    return rows.map(r => ({
      id:          `m-${r.id}`,
      date:        new Date(r.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      time:        new Date(r.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      product:     r.productName ?? '—',
      type:        SOURCE_TO_UI[r.sourceType] ?? ('ajuste' as UiMoveType),
      qty:         r.qty,
      stockBefore: r.stockBefore,
      stockAfter:  r.stockAfter,
      user:        r.userName ?? '—',
      note:        r.note ?? '',
    }))
  })

  // ── Register a manual movement ────────────────────────────────────────────
  ipcMain.handle(
    'inventory:registerMovement',
    (_event, payload: {
      productId: number
      type: 'entrada' | 'ajuste' | 'merma' | 'devolucion'
      qty: number
      realQty?: number
      userId?: number
      note?: string
    }) => {
      const db = getLocalDb()

      type ProdRow = { stock: number; sku: string | null; name: string; publicId: string | null; cost: number }
      const product = db.prepare(
        `SELECT stock, sku, name, "publicId", cost FROM "Product" WHERE id = ?`
      ).get(payload.productId) as ProdRow | undefined

      if (!product) throw new Error('Producto no encontrado.')

      const sourceType   = UI_TO_SOURCE[payload.type] ?? 'MANUAL'
      const stockBefore  = product.stock

      // For ajuste with realQty: set stock directly, derive recorded qty from the difference
      let stockAfter: number
      let recordedQty: number
      if (payload.type === 'ajuste' && payload.realQty !== undefined) {
        stockAfter  = Math.max(0, payload.realQty)
        recordedQty = Math.abs(stockAfter - stockBefore)
      } else {
        recordedQty = payload.qty
        stockAfter  = payload.type === 'entrada' || payload.type === 'devolucion'
          ? stockBefore + recordedQty
          : Math.max(0, stockBefore - recordedQty)
      }

      const movementType = stockAfter >= stockBefore ? 'IN' : 'OUT'
      const now = new Date().toISOString()

      db.transaction(() => {
        db.prepare(`
          INSERT INTO "InventoryMovement" (
            "publicId", type, "productId", "originalProductId", "sourceType", "sourceId", qty,
            reason,
            "stockBefore", "stockAfter",
            "userId", note,
            "productPublicIdSnapshot", "productCodeSnapshot", "productNameSnapshot",
            "unitCostSnapshot", "originDeviceId", "createdAt", "updatedAt"
          ) VALUES (?,?,?,?,?,?,?, ?, ?,?, ?,?, ?,?,?, ?,?,?,?)
        `).run(
          crypto.randomUUID(), movementType, payload.productId, payload.productId, sourceType, null, recordedQty,
          payload.note ?? null,
          stockBefore, stockAfter,
          payload.userId ?? null, payload.note ?? null,
          product.publicId ?? null, product.sku ?? null, product.name,
          product.cost, null, now, now
        )

        db.prepare(`UPDATE "Product" SET stock = ?, "updatedAt" = ? WHERE id = ?`)
          .run(stockAfter, now, payload.productId)
      })()

      // Get local movement id and push in background
      const { id: movId } = db.prepare(
        `SELECT id FROM "InventoryMovement" WHERE "productId" = ? AND "sourceType" = ? ORDER BY id DESC LIMIT 1`
      ).get(payload.productId, sourceType) as { id: number }
      pushMovementToSupabase(movId).catch(err =>
        console.error('[inventory:registerMovement] Supabase sync failed, will retry via pushPending:', err)
      )

      return { ok: true, stockBefore, stockAfter }
    }
  )
}
