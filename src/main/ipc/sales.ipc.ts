import { ipcMain } from 'electron'
import crypto from 'node:crypto'
import { getLocalDb } from '../db/local-db'
import { pushSaleToSupabase } from './sync.ipc'

type SaleItemInput = {
  itemType: 'product' | 'service' | 'PRODUCT' | 'SERVICE'
  productPublicId: string | null
  servicePublicId: string | null
  qty: number
  price: number
  discount: number
  lineTotal: number
}

type CreateSalePayload = {
  cashierId: number
  items: SaleItemInput[]
  discount?: number
  payment: { method: string; amount: number }
}

type ProductSnap = {
  id: number; sku: string; barcode: string | null; name: string
  cost: number; taxRateBp: number; profitPctBp: number; categoryName: string | null
}
type ServiceSnap = {
  id: number; code: string; name: string
  cost: number; taxRateBp: number; profitPctBp: number
}
type ServiceSupplySnap = {
  productId: number
  productPublicId: string
  sku: string
  name: string
  cost: number
  qty: number
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

function generateFolio(db: ReturnType<typeof getLocalDb>): string {
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM "Sale"`).get() as { count: number }
  return `VTA-${String(count + 1).padStart(5, '0')}`
}

export function registerSalesIpc(): void {
  ipcMain.handle('sales:create', (_event, payload: CreateSalePayload) => {
    const db = getLocalDb()
    const now = new Date().toISOString()
    const salePublicId = crypto.randomUUID()
    const folio = generateFolio(db)
    const saleColumns = db.prepare(`PRAGMA table_info("Sale")`).all() as Array<{ name: string }>
    const hasLegacyTaxColumn = saleColumns.some((column) => column.name === 'tax')

    const productSnaps = new Map<string, ProductSnap>()
    const serviceSnaps = new Map<string, ServiceSnap>()
    const serviceSupplies = new Map<string, ServiceSupplySnap[]>()

    for (const item of payload.items) {
      const type = item.itemType.toUpperCase()
      if (type === 'PRODUCT' && item.productPublicId && !productSnaps.has(item.productPublicId)) {
        const row = db.prepare(`
          SELECT p.id, p.sku, p.barcode, p.name, p.cost, p."taxRateBp", p."profitPctBp",
                 c.name AS categoryName
          FROM "Product" p
          LEFT JOIN "Category" c ON c.id = p."categoryId"
          WHERE p."publicId" = ? LIMIT 1
        `).get(item.productPublicId) as ProductSnap | undefined
        if (row) productSnaps.set(item.productPublicId, row)
      }
      if (type === 'SERVICE' && item.servicePublicId && !serviceSnaps.has(item.servicePublicId)) {
        const row = db.prepare(`
          SELECT id, code, name, cost, "taxRateBp", "profitPctBp"
          FROM "Service" WHERE "publicId" = ? LIMIT 1
        `).get(item.servicePublicId) as ServiceSnap | undefined
        if (row) {
          serviceSnaps.set(item.servicePublicId, row)

          const supplies = db.prepare(`
            SELECT
              ss."productId" AS productId,
              p."publicId"   AS productPublicId,
              p.sku          AS sku,
              p.name         AS name,
              p.cost         AS cost,
              ss.qty         AS qty
            FROM "ServiceSupply" ss
            JOIN "Product" p ON p.id = ss."productId"
            WHERE ss."serviceId" = ?
          `).all(row.id) as ServiceSupplySnap[]

          serviceSupplies.set(item.servicePublicId, supplies)
        }
      }
    }

    // ── Pre-compute all line values (puntos 2, 3, 4) ─────────────────────────
    type ComputedLine = {
      item: SaleItemInput
      type: 'PRODUCT' | 'SERVICE'
      snap: ProductSnap | ServiceSnap | undefined
      lineSubtotal: number
      lineTax: number
      lineCostTotal: number
      lineProfit: number
    }

    let saleSubtotal = 0
    const lines: ComputedLine[] = []

    for (const item of payload.items) {
      const type = item.itemType.toUpperCase() as 'PRODUCT' | 'SERVICE'
      const snap: ProductSnap | ServiceSnap | undefined =
        type === 'PRODUCT'
          ? (item.productPublicId ? productSnaps.get(item.productPublicId) : undefined)
          : (item.servicePublicId ? serviceSnaps.get(item.servicePublicId) : undefined)

      const lineSubtotal  = item.lineTotal - (item.discount ?? 0)
      const lineTax       = 0
      const lineCostTotal = (snap?.cost ?? 0) * item.qty
      const lineProfit    = lineSubtotal - lineCostTotal

      saleSubtotal += lineSubtotal
      lines.push({ item, type, snap, lineSubtotal, lineTax, lineCostTotal, lineProfit })
    }

    const saleTotal = saleSubtotal - (payload.discount ?? 0)

    // ── Persist in a single transaction ──────────────────────────────────────
    db.transaction(() => {
      if (hasLegacyTaxColumn) {
        db.prepare(`
          INSERT INTO "Sale" ("publicId", folio, status, subtotal, tax, total,
            "cashierId", "createdAt", "updatedAt")
          VALUES (?, ?, 'COMPLETED', ?, 0, ?, ?, ?, ?)
        `).run(salePublicId, folio, saleSubtotal, saleTotal, payload.cashierId, now, now)
      } else {
        db.prepare(`
          INSERT INTO "Sale" ("publicId", folio, status, subtotal, total,
            "cashierId", "createdAt", "updatedAt")
          VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?)
        `).run(salePublicId, folio, saleSubtotal, saleTotal, payload.cashierId, now, now)
      }

      const { id: saleId } = db.prepare(
        `SELECT id FROM "Sale" WHERE "publicId" = ?`
      ).get(salePublicId) as { id: number }

      const insertItem = db.prepare(`
        INSERT INTO "SaleItem" (
          "publicId","salePublicId","itemType",
          "productPublicId","servicePublicId","originalProductId","originalServiceId",
          qty,"unitPrice",discount,"lineTotal",
          "lineSubtotal","lineTax","lineCostTotal","lineProfit",
          "itemCodeSnapshot","itemNameSnapshot","itemCategorySnapshot",
          "itemSkuSnapshot","itemBarcodeSnapshot",
          "unitCostSnapshot","unitTaxRateBpSnapshot","unitProfitPctBpSnapshot",
          "inventoryTracked","createdAt","updatedAt"
        ) VALUES (?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?,?, ?,?,?)
      `)

      const insertMove = db.prepare(`
        INSERT INTO "InventoryMovement" (
          "publicId", type, "productId","originalProductId","sourceType","sourceId",qty,
          reason,
          "stockBefore","stockAfter","userId","saleId","saleItemId",
          "productPublicIdSnapshot","productCodeSnapshot","productNameSnapshot",
          "unitCostSnapshot","originDeviceId","createdAt","updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertServiceConsumptionMove = db.prepare(`
        INSERT INTO "InventoryMovement" (
          "publicId", type, "productId","originalProductId","sourceType","sourceId",qty,
          reason,
          "stockBefore","stockAfter","userId","saleId","saleItemId","relatedServiceId",
          "relatedServiceOriginalId",
          "productPublicIdSnapshot","productCodeSnapshot","productNameSnapshot",
          "relatedServiceNameSnapshot",
          "unitCostSnapshot","metaJson","originDeviceId","createdAt","updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const updateStock = db.prepare(
        `UPDATE "Product" SET stock = MAX(0, stock - ?), "updatedAt" = ? WHERE id = ?`
      )

      for (const { item, type, snap, lineSubtotal, lineTax, lineCostTotal, lineProfit } of lines) {
        const itemUid = crypto.randomUUID()

        if (type === 'PRODUCT' && item.productPublicId) {
          const psnap = snap as ProductSnap | undefined

          const { lastInsertRowid: saleItemId } = insertItem.run(
            itemUid, salePublicId, 'PRODUCT',
            item.productPublicId, null, psnap?.id ?? null, null,
            item.qty, item.price, item.discount, item.lineTotal,
            lineSubtotal, lineTax, lineCostTotal, lineProfit,
            psnap?.sku ?? null, psnap?.name ?? null, psnap?.categoryName ?? null,
            psnap?.sku ?? null, psnap?.barcode ?? null,
            psnap?.cost ?? null, psnap?.taxRateBp ?? null, psnap?.profitPctBp ?? null,
            psnap ? 1 : 0, now, now
          )

          if (psnap) {
            const { stock: before } = db.prepare(
              `SELECT stock FROM "Product" WHERE id = ?`
            ).get(psnap.id) as { stock: number }

            updateStock.run(item.qty, now, psnap.id)

            const { stock: after } = db.prepare(
              `SELECT stock FROM "Product" WHERE id = ?`
            ).get(psnap.id) as { stock: number }

            insertMove.run(
              crypto.randomUUID(),
              movementTypeFromSource('SALE'),
              psnap.id,
              psnap.id,
              'SALE',
              saleId,
              item.qty,
              'Venta',
              before, after, payload.cashierId, saleId, saleItemId,
              item.productPublicId, psnap.sku, psnap.name,
              psnap.cost, null, now, now
            )
          }
        } else {
          const ssnap = snap as ServiceSnap | undefined
          const serviceSupplyRows =
            ssnap && item.servicePublicId ? (serviceSupplies.get(item.servicePublicId) ?? []) : []

          const { lastInsertRowid: saleItemId } = insertItem.run(
            itemUid, salePublicId, 'SERVICE',
            null, item.servicePublicId, null, ssnap?.id ?? null,
            item.qty, item.price, item.discount, item.lineTotal,
            lineSubtotal, lineTax, lineCostTotal, lineProfit,
            ssnap?.code ?? null, ssnap?.name ?? null, null,
            null, null,
            ssnap?.cost ?? null, ssnap?.taxRateBp ?? null, ssnap?.profitPctBp ?? null,
            serviceSupplyRows.length > 0 ? 1 : 0, now, now
          )

          for (const supply of serviceSupplyRows) {
            const consumedQty = item.qty * supply.qty
            const { stock: before } = db.prepare(
              `SELECT stock FROM "Product" WHERE id = ?`
            ).get(supply.productId) as { stock: number }

            updateStock.run(consumedQty, now, supply.productId)

            const { stock: after } = db.prepare(
              `SELECT stock FROM "Product" WHERE id = ?`
            ).get(supply.productId) as { stock: number }

            insertServiceConsumptionMove.run(
              crypto.randomUUID(),
              movementTypeFromSource('SERVICE_CONSUMPTION'),
              supply.productId,
              supply.productId,
              'SERVICE_CONSUMPTION',
              saleId,
              consumedQty,
              `Consumo por servicio: ${ssnap?.name ?? 'Servicio'}`,
              before,
              after,
              payload.cashierId,
              saleId,
              saleItemId,
              ssnap?.id ?? null,
              ssnap?.id ?? null,
              supply.productPublicId,
              supply.sku,
              supply.name,
              ssnap?.name ?? null,
              supply.cost,
              JSON.stringify({
                servicePublicId: item.servicePublicId,
                serviceCode: ssnap?.code ?? null,
                serviceName: ssnap?.name ?? null,
                unitsSold: item.qty,
                supplyQtyPerService: supply.qty
              }),
              null,
              now,
              now
            )
          }
        }
      }

      db.prepare(`
        INSERT INTO "Payment" ("publicId","salePublicId",method,amount,"createdAt","updatedAt")
        VALUES (?,?,?,?,?,?)
      `).run(crypto.randomUUID(), salePublicId,
             payload.payment.method, payload.payment.amount, now, now)
    })()

    // Background push — does not block the response; retryable via sync:pushPending
    const { id: localSaleId } = db.prepare(
      `SELECT id FROM "Sale" WHERE "publicId" = ?`
    ).get(salePublicId) as { id: number }
    pushSaleToSupabase(localSaleId).catch(err =>
      console.error('[sales:create] Supabase sync failed, will retry via pushPending:', err)
    )

    return { ok: true as const, folio, salePublicId }
  })

  ipcMain.handle('sales:recent', (_event, limit = 30) => {
    const db = getLocalDb()
    type Row = {
      id: number; folio: string; createdAt: string
      total: number; subtotal: number; status: string
      cashierName: string | null; itemCount: number; paymentMethod: string | null
    }
    const rows = db.prepare(`
      SELECT
        s.id, s.folio, s."createdAt" AS createdAt,
        s.total, s.subtotal, s.status,
        u.name          AS cashierName,
        COUNT(si.id)    AS itemCount,
        p.method        AS paymentMethod
      FROM "Sale" s
      LEFT JOIN "User"     u  ON u.id  = s."cashierId"
      LEFT JOIN "SaleItem" si ON si."salePublicId" = s."publicId"
      LEFT JOIN "Payment"  p  ON p."salePublicId"  = s."publicId"
      GROUP BY s.id
      ORDER BY s."createdAt" DESC
      LIMIT ?
    `).all(limit) as Row[]

    return rows.map(r => ({
      id:            r.id,
      folio:         r.folio,
      createdAt:     r.createdAt,
      total:         r.total,
      subtotal:      r.subtotal,
      status:        r.status,
      cashierName:   r.cashierName ?? '—',
      itemCount:     r.itemCount,
      paymentMethod: r.paymentMethod ?? '—',
    }))
  })
}
