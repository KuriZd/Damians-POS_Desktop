import crypto from 'node:crypto'
import type Database from 'better-sqlite3'

export const VALID_PAYMENT_METHODS = new Set(['efectivo', 'tarjeta', 'transferencia'])

export type PaymentInput = {
  method: 'efectivo' | 'tarjeta' | 'transferencia'
  amount: number
}

export type SaleItemInput = {
  itemType: 'product' | 'service' | 'PRODUCT' | 'SERVICE'
  productPublicId: string | null
  servicePublicId: string | null
  qty: number
  price: number
  discount: number
  lineTotal: number
}

export type StockErrorItem = { sku: string; name: string; requested: number; available: number }

export type CreateSalePayload = {
  cashierId: number
  items: SaleItemInput[]
  discount?: number
  payments: PaymentInput[]
}

type ProductSnap = {
  id: number
  sku: string
  barcode: string | null
  name: string
  cost: number
  taxRateBp: number
  profitPctBp: number
  categoryName: string | null
}
type ServiceSnap = {
  id: number
  code: string
  name: string
  cost: number
  taxRateBp: number
  profitPctBp: number
}
type ServiceSupplySnap = {
  productId: number
  productPublicId: string
  sku: string
  name: string
  cost: number
  qty: number
}

type StockRequirement = { sku: string; name: string; needed: number }

function movementDir(sourceType: string): 'IN' | 'OUT' {
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

export function getOrCreateDeviceId(db: Database.Database): string {
  const row = db
    .prepare(`SELECT device_id as deviceId FROM device_config ORDER BY id LIMIT 1`)
    .get() as { deviceId: string } | undefined
  if (row?.deviceId) return row.deviceId
  const deviceId = crypto.randomUUID()
  db.prepare(`INSERT INTO device_config (device_id, device_name) VALUES (?, ?)`).run(
    deviceId,
    'Caja local'
  )
  return deviceId
}

export function generateFolio(salePublicId: string, createdAt: string, deviceId: string): string {
  const datePart = createdAt.slice(0, 10).replace(/-/g, '')
  const devicePart = deviceId.replace(/-/g, '').slice(0, 4).toUpperCase()
  const salePart = salePublicId.replace(/-/g, '').slice(0, 8).toUpperCase()
  return `VTA-${datePart}-${devicePart}-${salePart}`
}

export type CreateSaleResult =
  | { ok: true; folio: string; salePublicId: string; localSaleId: number }
  | { ok: false; error: string; items?: StockErrorItem[] }

export function createSale(
  db: Database.Database,
  payload: CreateSalePayload,
  afterPersist: (localSaleId: number) => Promise<void> = async () => {}
): CreateSaleResult {
  // ── Structural validation ────────────────────────────────────────────────
  if (!Number.isInteger(payload.cashierId) || payload.cashierId <= 0)
    return { ok: false, error: 'PAYLOAD_INVALIDO: cashierId inválido' }
  if (!Array.isArray(payload.items) || payload.items.length === 0)
    return { ok: false, error: 'PAYLOAD_INVALIDO: items vacíos' }
  for (const item of payload.items) {
    if (!['product', 'service', 'PRODUCT', 'SERVICE'].includes(item.itemType))
      return { ok: false, error: `PAYLOAD_INVALIDO: itemType inválido "${item.itemType}"` }
    if (!Number.isInteger(item.qty) || item.qty <= 0)
      return { ok: false, error: 'PAYLOAD_INVALIDO: qty debe ser entero positivo' }
    if (!Number.isInteger(item.price) || item.price < 0)
      return { ok: false, error: 'PAYLOAD_INVALIDO: price debe ser entero no negativo' }
    if (!Number.isInteger(item.discount) || item.discount < 0)
      return { ok: false, error: 'PAYLOAD_INVALIDO: discount debe ser entero no negativo' }
    if (!Number.isInteger(item.lineTotal) || item.lineTotal < 0)
      return { ok: false, error: 'PAYLOAD_INVALIDO: lineTotal debe ser entero no negativo' }
    if (item.lineTotal !== item.price * item.qty)
      return { ok: false, error: 'PAYLOAD_INVALIDO: lineTotal no coincide con price * qty' }
    if (item.discount > item.lineTotal)
      return { ok: false, error: 'PAYLOAD_INVALIDO: discount no puede exceder lineTotal' }
    if (item.itemType.toUpperCase() === 'PRODUCT' && !item.productPublicId)
      return { ok: false, error: 'PAYLOAD_INVALIDO: productPublicId requerido' }
    if (item.itemType.toUpperCase() === 'SERVICE' && !item.servicePublicId)
      return { ok: false, error: 'PAYLOAD_INVALIDO: servicePublicId requerido' }
  }
  if (
    payload.discount !== undefined &&
    (!Number.isInteger(payload.discount) || payload.discount < 0)
  ) {
    return { ok: false, error: 'PAYLOAD_INVALIDO: discount global debe ser entero no negativo' }
  }
  if (!Array.isArray(payload.payments) || payload.payments.length === 0)
    return { ok: false, error: 'PAGO_REQUERIDO: se requiere al menos un método de pago' }
  for (const pmt of payload.payments) {
    if (!VALID_PAYMENT_METHODS.has(pmt.method))
      return { ok: false, error: `METODO_INVALIDO: "${pmt.method}"` }
    if (!Number.isInteger(pmt.amount) || pmt.amount <= 0)
      return {
        ok: false,
        error: 'MONTO_INVALIDO: cada pago debe ser un entero positivo en centavos'
      }
  }

  const now = new Date().toISOString()
  const salePublicId = crypto.randomUUID()
  const deviceId = getOrCreateDeviceId(db)
  const folio = generateFolio(salePublicId, now, deviceId)
  const saleColumns = db.prepare(`PRAGMA table_info("Sale")`).all() as Array<{ name: string }>
  const hasLegacyTax = saleColumns.some((c) => c.name === 'tax')

  const productSnaps = new Map<string, ProductSnap>()
  const serviceSnaps = new Map<string, ServiceSnap>()
  const serviceSupplies = new Map<string, ServiceSupplySnap[]>()

  for (const item of payload.items) {
    const type = item.itemType.toUpperCase()
    if (type === 'PRODUCT' && item.productPublicId && !productSnaps.has(item.productPublicId)) {
      const row = db
        .prepare(
          `
        SELECT p.id, p.sku, p.barcode, p.name, p.cost, p."taxRateBp", p."profitPctBp",
               c.name AS categoryName
        FROM "Product" p
        LEFT JOIN "Category" c ON c.id = p."categoryId"
        WHERE p."publicId" = ? AND p.active = 1 AND p."deletedAt" IS NULL LIMIT 1
      `
        )
        .get(item.productPublicId) as ProductSnap | undefined
      if (row) productSnaps.set(item.productPublicId, row)
    }
    if (type === 'SERVICE' && item.servicePublicId && !serviceSnaps.has(item.servicePublicId)) {
      const row = db
        .prepare(
          `
        SELECT id, code, name, cost, "taxRateBp", "profitPctBp"
        FROM "Service" WHERE "publicId" = ? AND active = 1 AND "deletedAt" IS NULL LIMIT 1
      `
        )
        .get(item.servicePublicId) as ServiceSnap | undefined
      if (row) {
        serviceSnaps.set(item.servicePublicId, row)
        const supplies = db
          .prepare(
            `
          SELECT ss."productId" AS productId, p."publicId" AS productPublicId,
                 p.sku, p.name, p.cost, ss.qty
          FROM "ServiceSupply" ss
          JOIN "Product" p ON p.id = ss."productId"
          WHERE ss."serviceId" = ?
        `
          )
          .all(row.id) as ServiceSupplySnap[]
        serviceSupplies.set(item.servicePublicId, supplies)
      }
    }
  }

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
    const snap =
      type === 'PRODUCT'
        ? item.productPublicId
          ? productSnaps.get(item.productPublicId)
          : undefined
        : item.servicePublicId
          ? serviceSnaps.get(item.servicePublicId)
          : undefined
    if (!snap) {
      return {
        ok: false,
        error:
          type === 'PRODUCT'
            ? 'PRODUCTO_NO_DISPONIBLE: no se encontrÃ³ el producto activo'
            : 'SERVICIO_NO_DISPONIBLE: no se encontrÃ³ el servicio activo'
      }
    }
    const lineSubtotal = item.lineTotal - (item.discount ?? 0)
    const lineTax = 0
    const lineCostTotal = (snap?.cost ?? 0) * item.qty
    const lineProfit = lineSubtotal - lineCostTotal
    saleSubtotal += lineSubtotal
    lines.push({ item, type, snap, lineSubtotal, lineTax, lineCostTotal, lineProfit })
  }

  const saleTotal = saleSubtotal - (payload.discount ?? 0)
  if (saleTotal <= 0) return { ok: false, error: 'TOTAL_INVALIDO: el total debe ser positivo' }

  // ── Stock guard ─────────────────────────────────────────────────────────
  const requiredQtyMap = new Map<number, StockRequirement>()
  const addStockRequirement = (
    productId: number,
    itemInfo: { sku: string; name: string },
    needed: number
  ): void => {
    const entry = requiredQtyMap.get(productId)
    if (entry) entry.needed += needed
    else requiredQtyMap.set(productId, { sku: itemInfo.sku, name: itemInfo.name, needed })
  }

  for (const { type, snap, item } of lines) {
    if (type === 'PRODUCT') {
      const psnap = snap as ProductSnap
      addStockRequirement(psnap.id, psnap, item.qty)
      continue
    }

    const supplyRows = item.servicePublicId ? (serviceSupplies.get(item.servicePublicId) ?? []) : []
    for (const supply of supplyRows) {
      addStockRequirement(supply.productId, supply, item.qty * supply.qty)
    }
  }
  const stockErrors: StockErrorItem[] = []
  for (const [productId, requirement] of requiredQtyMap) {
    const row = db.prepare(`SELECT stock FROM "Product" WHERE id = ?`).get(productId) as {
      stock: number
    }
    if (row.stock < requirement.needed)
      stockErrors.push({
        sku: requirement.sku,
        name: requirement.name,
        requested: requirement.needed,
        available: row.stock
      })
  }
  if (stockErrors.length > 0) return { ok: false, error: 'STOCK_INSUFICIENTE', items: stockErrors }

  // ── Payment sum validation ───────────────────────────────────────────────
  const totalPagado = payload.payments.reduce((s, p) => s + p.amount, 0)
  if (totalPagado < saleTotal) return { ok: false, error: 'PAGO_INSUFICIENTE', items: [] }

  // ── Persist in a single transaction ─────────────────────────────────────
  db.transaction(() => {
    if (hasLegacyTax) {
      db.prepare(
        `
        INSERT INTO "Sale" ("publicId", folio, status, subtotal, tax, total,
          "cashierId", "originDeviceId", "createdAt", "updatedAt")
        VALUES (?, ?, 'COMPLETED', ?, 0, ?, ?, ?, ?, ?)
      `
      ).run(salePublicId, folio, saleSubtotal, saleTotal, payload.cashierId, deviceId, now, now)
    } else {
      db.prepare(
        `
        INSERT INTO "Sale" ("publicId", folio, status, subtotal, total,
          "cashierId", "originDeviceId", "createdAt", "updatedAt")
        VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?)
      `
      ).run(salePublicId, folio, saleSubtotal, saleTotal, payload.cashierId, deviceId, now, now)
    }

    const { id: saleId } = db
      .prepare(`SELECT id FROM "Sale" WHERE "publicId" = ?`)
      .get(salePublicId) as { id: number }

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
        reason, "stockBefore","stockAfter","userId","saleId","saleItemId",
        "productPublicIdSnapshot","productCodeSnapshot","productNameSnapshot",
        "unitCostSnapshot","originDeviceId","createdAt","updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSvcMove = db.prepare(`
      INSERT INTO "InventoryMovement" (
        "publicId", type, "productId","originalProductId","sourceType","sourceId",qty,
        reason, "stockBefore","stockAfter","userId","saleId","saleItemId",
        "relatedServiceId","relatedServiceOriginalId",
        "productPublicIdSnapshot","productCodeSnapshot","productNameSnapshot",
        "relatedServiceNameSnapshot","unitCostSnapshot","metaJson","originDeviceId","createdAt","updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateStock = db.prepare(
      `UPDATE "Product" SET stock = stock - ?, "updatedAt" = ? WHERE id = ?`
    )

    for (const { item, type, snap, lineSubtotal, lineTax, lineCostTotal, lineProfit } of lines) {
      const itemUid = crypto.randomUUID()
      if (type === 'PRODUCT' && item.productPublicId) {
        const psnap = snap as ProductSnap | undefined
        const { lastInsertRowid: saleItemId } = insertItem.run(
          itemUid,
          salePublicId,
          'PRODUCT',
          item.productPublicId,
          null,
          psnap?.id ?? null,
          null,
          item.qty,
          item.price,
          item.discount,
          item.lineTotal,
          lineSubtotal,
          lineTax,
          lineCostTotal,
          lineProfit,
          psnap?.sku ?? null,
          psnap?.name ?? null,
          psnap?.categoryName ?? null,
          psnap?.sku ?? null,
          psnap?.barcode ?? null,
          psnap?.cost ?? null,
          psnap?.taxRateBp ?? null,
          psnap?.profitPctBp ?? null,
          psnap ? 1 : 0,
          now,
          now
        )
        if (psnap) {
          const { stock: before } = db
            .prepare(`SELECT stock FROM "Product" WHERE id = ?`)
            .get(psnap.id) as { stock: number }
          updateStock.run(item.qty, now, psnap.id)
          const { stock: after } = db
            .prepare(`SELECT stock FROM "Product" WHERE id = ?`)
            .get(psnap.id) as { stock: number }
          insertMove.run(
            crypto.randomUUID(),
            movementDir('SALE'),
            psnap.id,
            psnap.id,
            'SALE',
            saleId,
            item.qty,
            'Venta',
            before,
            after,
            payload.cashierId,
            saleId,
            saleItemId,
            item.productPublicId,
            psnap.sku,
            psnap.name,
            psnap.cost,
            deviceId,
            now,
            now
          )
        }
      } else {
        const ssnap = snap as ServiceSnap | undefined
        const supplyRows =
          ssnap && item.servicePublicId ? (serviceSupplies.get(item.servicePublicId) ?? []) : []
        const { lastInsertRowid: saleItemId } = insertItem.run(
          itemUid,
          salePublicId,
          'SERVICE',
          null,
          item.servicePublicId,
          null,
          ssnap?.id ?? null,
          item.qty,
          item.price,
          item.discount,
          item.lineTotal,
          lineSubtotal,
          lineTax,
          lineCostTotal,
          lineProfit,
          ssnap?.code ?? null,
          ssnap?.name ?? null,
          null,
          null,
          null,
          ssnap?.cost ?? null,
          ssnap?.taxRateBp ?? null,
          ssnap?.profitPctBp ?? null,
          supplyRows.length > 0 ? 1 : 0,
          now,
          now
        )
        for (const supply of supplyRows) {
          const consumedQty = item.qty * supply.qty
          const { stock: before } = db
            .prepare(`SELECT stock FROM "Product" WHERE id = ?`)
            .get(supply.productId) as { stock: number }
          updateStock.run(consumedQty, now, supply.productId)
          const { stock: after } = db
            .prepare(`SELECT stock FROM "Product" WHERE id = ?`)
            .get(supply.productId) as { stock: number }
          insertSvcMove.run(
            crypto.randomUUID(),
            movementDir('SERVICE_CONSUMPTION'),
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
            deviceId,
            now,
            now
          )
        }
      }
    }

    const insertPayment = db.prepare(`
      INSERT INTO "Payment" ("publicId","salePublicId",method,amount,"createdAt","updatedAt")
      VALUES (?,?,?,?,?,?)
    `)
    for (const pmt of payload.payments) {
      insertPayment.run(crypto.randomUUID(), salePublicId, pmt.method, pmt.amount, now, now)
    }
  })()

  const { id: localSaleId } = db
    .prepare(`SELECT id FROM "Sale" WHERE "publicId" = ?`)
    .get(salePublicId) as { id: number }

  afterPersist(localSaleId).catch((err: unknown) =>
    console.error('[sales.core] afterPersist failed:', err)
  )

  return { ok: true, folio, salePublicId, localSaleId }
}

export type CorteData = {
  sessionId: number
  openedAt: string
  initialCash: number
  expected: number
  totalEfectivo: number
  totalEntradas: number
  totalSalidas: number
  movements: {
    id: number
    type: string
    amount: number
    reason: string | null
    createdAt: string
  }[]
  byMethod: Record<string, number>
  totalVentas: number
  tickets: number
  generatedAt: string
}

export function getSaleCorteData(db: Database.Database, cashierId: number): CorteData {
  const now = new Date().toISOString()

  let session = db
    .prepare(
      `
    SELECT id, "cashierId", "openedAt", "initialCash"
    FROM "CashSession" WHERE "closedAt" IS NULL ORDER BY id DESC LIMIT 1
  `
    )
    .get() as
    | { id: number; cashierId: number | null; openedAt: string; initialCash: number }
    | undefined

  if (!session) {
    const ins = db
      .prepare(
        `
      INSERT INTO "CashSession" ("cashierId", "openedAt", "initialCash", "createdAt", "updatedAt")
      VALUES (?, ?, 0, ?, ?)
    `
      )
      .run(cashierId, now, now, now)
    session = { id: Number(ins.lastInsertRowid), cashierId, openedAt: now, initialCash: 0 }
  }

  type MovRow = {
    id: number
    type: string
    amount: number
    reason: string | null
    createdAt: string
  }
  const movements = db
    .prepare(
      `
    SELECT id, type, amount, reason, "createdAt"
    FROM "CashMovement" WHERE "sessionId" = ? ORDER BY "createdAt" ASC
  `
    )
    .all(session.id) as MovRow[]

  const totalEntradas = movements.filter((m) => m.type === 'IN').reduce((s, m) => s + m.amount, 0)
  const totalSalidas = movements.filter((m) => m.type === 'OUT').reduce((s, m) => s + m.amount, 0)

  const scopedCashierId = session.cashierId ?? cashierId

  type SaleTotRow = { totalVentas: number | null; tickets: number }
  const saleTots = db
    .prepare(
      `
    SELECT SUM(total) AS totalVentas, COUNT(*) AS tickets
    FROM "Sale" WHERE status = 'COMPLETED' AND "createdAt" >= ? AND "cashierId" = ?
  `
    )
    .get(session.openedAt, scopedCashierId) as SaleTotRow

  type MethodRow = { method: string | null; metodTotal: number | null }
  const methodRows = db
    .prepare(
      `
    SELECT p.method, SUM(p.amount) AS metodTotal
    FROM "Sale" s
    JOIN "Payment" p ON p."salePublicId" = s."publicId"
    WHERE s.status = 'COMPLETED' AND s."createdAt" >= ? AND s."cashierId" = ?
    GROUP BY p.method
  `
    )
    .all(session.openedAt, scopedCashierId) as MethodRow[]

  const byMethod: Record<string, number> = {}
  for (const row of methodRows) {
    if (row.method) byMethod[row.method] = row.metodTotal ?? 0
  }

  const totalEfectivo = byMethod['efectivo'] ?? 0
  const expected = session.initialCash + totalEfectivo + totalEntradas - totalSalidas

  return {
    sessionId: session.id,
    openedAt: session.openedAt,
    initialCash: session.initialCash,
    expected,
    totalEfectivo,
    totalEntradas,
    totalSalidas,
    movements,
    byMethod,
    totalVentas: saleTots.totalVentas ?? 0,
    tickets: saleTots.tickets ?? 0,
    generatedAt: now
  }
}

export type ConfirmCorteResult = { ok: true; sessionId: number } | { ok: false; error: string }

export function confirmSaleCorte(
  db: Database.Database,
  cashierId: number,
  countedCash?: number
): ConfirmCorteResult {
  const now = new Date().toISOString()

  const session = db
    .prepare(
      `
    SELECT id, "cashierId", "openedAt", "initialCash"
    FROM "CashSession" WHERE "closedAt" IS NULL ORDER BY id DESC LIMIT 1
  `
    )
    .get() as
    | { id: number; cashierId: number | null; openedAt: string; initialCash: number }
    | undefined

  if (!session) return { ok: false, error: 'No hay sesión de caja activa.' }

  type MovRow = { type: string; amount: number }
  const movements = db
    .prepare(`SELECT type, amount FROM "CashMovement" WHERE "sessionId" = ?`)
    .all(session.id) as MovRow[]
  const totalEntradas = movements.filter((m) => m.type === 'IN').reduce((s, m) => s + m.amount, 0)
  const totalSalidas = movements.filter((m) => m.type === 'OUT').reduce((s, m) => s + m.amount, 0)

  const scopedCashierId = session.cashierId ?? cashierId

  type EffRow = { totalEfectivo: number | null }
  const eff = db
    .prepare(
      `
    SELECT SUM(p.amount) AS totalEfectivo
    FROM "Sale" s
    JOIN "Payment" p ON p."salePublicId" = s."publicId"
    WHERE s.status = 'COMPLETED' AND s."createdAt" >= ? AND s."cashierId" = ? AND p.method = 'efectivo'
  `
    )
    .get(session.openedAt, scopedCashierId) as EffRow

  const expected = session.initialCash + (eff.totalEfectivo ?? 0) + totalEntradas - totalSalidas
  const diff = countedCash !== undefined ? countedCash - expected : null

  db.prepare(
    `
    UPDATE "CashSession" SET "closedAt" = ?, "counted" = ?, "diff" = ?, "updatedAt" = ? WHERE id = ?
  `
  ).run(now, countedCash !== undefined ? countedCash : null, diff, now, session.id)

  return { ok: true, sessionId: session.id }
}
