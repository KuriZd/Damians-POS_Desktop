import { ipcMain } from 'electron'
import { getLocalDb } from '../db/local-db'
import { supabase, supabaseAdmin } from '../supabase/client'

const MAX_RETRIES = 3

export type SyncConflict = {
  entityName: string
  publicId: string
  localUpdatedAt: string
  remoteUpdatedAt: string
  detectedAt: string
}

let lastConflicts: SyncConflict[] = []

type ProductRemote = {
  id: number
  publicId?: string
  sku: string
  barcode: string | null
  name: string
  price: number
  cost: number
  profitPctBp: number
  stock: number
  stockMin: number
  stockMax: number
  imagePath: string | null
  taxRateBp: number
  active: boolean
  categoryId: number | null
  createdAt: string
  updatedAt?: string
  deletedAt?: string | null
}

type CategoryRemote = {
  id: number
  publicId?: string
  name: string
  createdAt: string
  updatedAt?: string
  deletedAt?: string | null
}

type ServiceRemote = {
  id: number
  publicId?: string
  code: string
  name: string
  durationMin?: number
  duration_min?: number
  cost: number
  price: number
  taxRateBp?: number
  tax_rate_bp?: number
  profitPctBp?: number
  profit_pct_bp?: number
  active?: boolean
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
}

type ServiceSupplyRemote = {
  id?: number
  serviceId?: number
  service_id?: number
  productId?: number
  product_id?: number
  qty: number
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

// ─── Type helpers ────────────────────────────────────────────────────────────

type SaleRow = {
  id: number
  publicId: string
  folio: string
  status: string
  subtotal: number
  total: number
  cashierId: number
  originDeviceId: string | null
  createdAt: string
  updatedAt: string
}
type SaleItemRow = {
  id: number
  publicId: string
  salePublicId: string
  itemType: string
  productPublicId: string | null
  servicePublicId: string | null
  originalProductId: number | null
  originalServiceId: number | null
  qty: number
  unitPrice: number
  discount: number
  lineTotal: number
  lineSubtotal: number | null
  lineTax: number
  lineCostTotal: number | null
  lineProfit: number | null
  itemCodeSnapshot: string | null
  itemNameSnapshot: string | null
  itemCategorySnapshot: string | null
  itemSkuSnapshot: string | null
  itemBarcodeSnapshot: string | null
  unitCostSnapshot: number | null
  unitTaxRateBpSnapshot: number | null
  unitProfitPctBpSnapshot: number | null
  inventoryTracked: number
  createdAt: string
  updatedAt: string
}
type MovementRow = {
  id: number
  publicId: string | null
  type: string | null
  productId: number | null
  originalProductId: number | null
  sourceType: string
  sourceId: number | null
  qty: number
  reason: string | null
  stockBefore: number | null
  stockAfter: number | null
  userId: number | null
  saleId: number | null
  saleItemId: number | null
  relatedServiceId: number | null
  relatedServiceOriginalId: number | null
  productPublicIdSnapshot: string | null
  productCodeSnapshot: string
  productNameSnapshot: string
  relatedServiceNameSnapshot: string | null
  unitCostSnapshot: number | null
  metaJson: string
  originDeviceId: string | null
  createdAt: string
  updatedAt: string | null
}
type PaymentRow = {
  publicId: string
  salePublicId: string
  method: string
  amount: number
  createdAt: string
  updatedAt: string
}

function toInventoryMovementType(sourceType: string): 'IN' | 'OUT' {
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

function toPaymentMethod(method: string): string {
  switch (method.trim().toLowerCase()) {
    case 'efectivo':
      return 'CASH'
    case 'tarjeta':
      return 'CARD'
    case 'transferencia':
      return 'TRANSFER'
    case 'mixto':
      return 'MIXED'
    default:
      return method.trim().toUpperCase()
  }
}

// ─── Push a single sale (and its items, movements, payment) to Supabase ──────

function isDuplicateSaleFolioError(message: string): boolean {
  return message.includes('Sale_folio_key') || message.toLowerCase().includes('duplicate key')
}

function fallbackFolioForSale(sale: SaleRow): string {
  const datePart = sale.createdAt.slice(0, 10).replace(/-/g, '')
  const devicePart = (sale.originDeviceId ?? 'LOCAL').replace(/-/g, '').slice(0, 4).toUpperCase()
  const salePart = sale.publicId.replace(/-/g, '').slice(0, 8).toUpperCase()

  return `VTA-${datePart}-${devicePart}-${salePart}`
}

async function upsertSaleRecord(sale: SaleRow): Promise<void> {
  const STATUS_MAP: Record<string, string> = {
    COMPLETED: 'PAID',
    CANCELLED: 'CANCELED',
    OPEN: 'OPEN',
    REFUNDED: 'REFUNDED'
  }

  const { error } = await supabaseAdmin.from('Sale').upsert(
    {
      publicId: sale.publicId,
      folio: sale.folio,
      status: STATUS_MAP[sale.status] ?? 'PAID',
      subtotal: sale.subtotal,
      total: sale.total,
      cashierId: sale.cashierId,
      createdAt: sale.createdAt,
      updatedAt: sale.updatedAt
    },
    { onConflict: 'publicId' }
  )

  if (error) throw new Error(`[push:Sale] ${error.message}`)
}

export async function pushSaleToSupabase(localSaleId: number): Promise<void> {
  const db = getLocalDb()

  const sale = db.prepare(`SELECT * FROM "Sale" WHERE id = ?`).get(localSaleId) as
    | SaleRow
    | undefined
  if (!sale) return

  // 1. Upsert Sale
  try {
    await upsertSaleRecord(sale)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isDuplicateSaleFolioError(message)) throw err

    const updatedAt = new Date().toISOString()
    const newFolio = fallbackFolioForSale(sale)
    db.prepare(`UPDATE "Sale" SET folio = ?, "updatedAt" = ? WHERE id = ?`).run(
      newFolio,
      updatedAt,
      localSaleId
    )

    sale.folio = newFolio
    sale.updatedAt = updatedAt
    await upsertSaleRecord(sale)
  }

  // Resolve Supabase integer id (needed as FK for InventoryMovement)
  const { data: saleRemote, error: saleIdErr } = await supabaseAdmin
    .from('Sale')
    .select('id')
    .eq('publicId', sale.publicId)
    .single()
  if (saleIdErr || !saleRemote) throw new Error(`[push:Sale.id] ${saleIdErr?.message}`)
  const remoteSaleId: number = (saleRemote as { id: number }).id

  // 2. Upsert SaleItems
  const items = db
    .prepare(`SELECT * FROM "SaleItem" WHERE "salePublicId" = ?`)
    .all(sale.publicId) as SaleItemRow[]

  for (const item of items) {
    const { error: itemErr } = await supabaseAdmin.from('SaleItem').upsert(
      {
        publicId: item.publicId,
        saleId: remoteSaleId,
        itemType: item.itemType,
        productId: item.originalProductId ?? null,
        serviceId: item.originalServiceId ?? null,
        originalProductId: item.originalProductId,
        originalServiceId: item.originalServiceId,
        catalogPublicId: item.productPublicId ?? item.servicePublicId ?? null,
        qty: item.qty,
        unitPrice: item.unitPrice,
        discount: item.discount,
        lineTotal: item.lineTotal,
        lineSubtotal: item.lineSubtotal ?? item.lineTotal - item.discount,
        lineTax: item.lineTax,
        lineCostTotal: item.lineCostTotal ?? 0,
        lineProfit: item.lineProfit ?? 0,
        itemCodeSnapshot: item.itemCodeSnapshot ?? 'SIN-CODIGO',
        itemNameSnapshot: item.itemNameSnapshot ?? 'ITEM SIN NOMBRE',
        itemCategorySnapshot: item.itemCategorySnapshot ?? null,
        itemSkuSnapshot: item.itemSkuSnapshot ?? null,
        itemBarcodeSnapshot: item.itemBarcodeSnapshot ?? null,
        unitCostSnapshot: item.unitCostSnapshot ?? null,
        unitTaxRateBpSnapshot: item.unitTaxRateBpSnapshot ?? null,
        unitProfitPctBpSnapshot: item.unitProfitPctBpSnapshot ?? null,
        inventoryTracked: Boolean(item.inventoryTracked),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      },
      { onConflict: 'publicId' }
    )
    if (itemErr) throw new Error(`[push:SaleItem ${item.publicId}] ${itemErr.message}`)
  }

  // 3. Push InventoryMovements — skip if already pushed (idempotency guard)
  const movements = db
    .prepare(`SELECT * FROM "InventoryMovement" WHERE "saleId" = ?`)
    .all(sale.id) as MovementRow[]

  if (movements.length > 0) {
    const { count } = await supabaseAdmin
      .from('InventoryMovement')
      .select('id', { count: 'exact', head: true })
      .eq('saleId', remoteSaleId)

    if ((count ?? 0) === 0) {
      for (const move of movements) {
        // Resolve remote SaleItem id via publicId
        let remoteSaleItemId: number | null = null
        if (move.saleItemId != null) {
          const localItem = items.find((i) => i.id === move.saleItemId)
          if (localItem) {
            const { data: ri } = await supabaseAdmin
              .from('SaleItem')
              .select('id')
              .eq('publicId', localItem.publicId)
              .single()
            remoteSaleItemId = (ri as { id: number } | null)?.id ?? null
          }
        }

        const { error: moveErr } = await supabaseAdmin.from('InventoryMovement').insert({
          publicId: move.publicId ?? crypto.randomUUID(),
          type: toInventoryMovementType(move.sourceType),
          productId: move.productId ?? null,
          originalProductId: move.originalProductId ?? null,
          sourceType: move.sourceType,
          sourceId: move.sourceId ?? null,
          qty: move.qty,
          reason: move.reason ?? null,
          stockBefore: move.stockBefore ?? null,
          stockAfter: move.stockAfter ?? null,
          saleId: remoteSaleId,
          saleItemId: remoteSaleItemId,
          relatedServiceId: move.relatedServiceId ?? null,
          relatedServiceOriginalId: move.relatedServiceOriginalId ?? null,
          productPublicIdSnapshot: move.productPublicIdSnapshot ?? null,
          productCodeSnapshot: move.productCodeSnapshot,
          productNameSnapshot: move.productNameSnapshot,
          relatedServiceNameSnapshot: move.relatedServiceNameSnapshot ?? null,
          unitCostSnapshot: move.unitCostSnapshot ?? null,
          metaJson: JSON.parse(move.metaJson || '{}'),
          createdAt: move.createdAt,
          updatedAt: move.updatedAt ?? move.createdAt,
          originDeviceId: move.originDeviceId ?? null
        })
        if (moveErr) throw new Error(`[push:InventoryMovement] ${moveErr.message}`)
      }
      // Mark sale movements as synced locally
      db.prepare(`UPDATE "InventoryMovement" SET "syncedAt" = ? WHERE "saleId" = ?`).run(
        new Date().toISOString(),
        sale.id
      )
    }
  }

  // 4. Upsert Payment
  const payment = db
    .prepare(`SELECT * FROM "Payment" WHERE "salePublicId" = ?`)
    .get(sale.publicId) as PaymentRow | undefined

  if (payment) {
    const { error: payErr } = await supabaseAdmin.from('Payment').upsert(
      {
        publicId: payment.publicId,
        saleId: remoteSaleId,
        method: toPaymentMethod(payment.method),
        amount: payment.amount,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt
      },
      { onConflict: 'publicId' }
    )
    if (payErr) throw new Error(`[push:Payment] ${payErr.message}`)
  }

  // 5. Mark sale as synced locally
  db.prepare(`UPDATE "Sale" SET "syncedAt" = ? WHERE id = ?`).run(
    new Date().toISOString(),
    localSaleId
  )
}

// ─── Push a single manual InventoryMovement (non-sale) to Supabase ───────────

export async function pushMovementToSupabase(localMovId: number): Promise<void> {
  const db = getLocalDb()

  type MovRow = {
    id: number
    publicId: string | null
    type: string | null
    productId: number | null
    originalProductId: number | null
    sourceType: string
    sourceId: number | null
    qty: number
    reason: string | null
    stockBefore: number | null
    stockAfter: number | null
    userId: number | null
    note: string | null
    relatedServiceId: number | null
    relatedServiceOriginalId: number | null
    productPublicIdSnapshot: string | null
    productCodeSnapshot: string | null
    productNameSnapshot: string | null
    relatedServiceNameSnapshot: string | null
    unitCostSnapshot: number | null
    metaJson: string
    originDeviceId: string | null
    createdAt: string
    updatedAt: string | null
  }

  const mov = db.prepare(`SELECT * FROM "InventoryMovement" WHERE id = ?`).get(localMovId) as
    | MovRow
    | undefined
  if (!mov) return

  const { error } = await supabaseAdmin.from('InventoryMovement').insert({
    publicId: mov.publicId ?? crypto.randomUUID(),
    type: toInventoryMovementType(mov.sourceType),
    productId: mov.productId ?? null,
    originalProductId: mov.originalProductId ?? null,
    sourceType: mov.sourceType,
    sourceId: mov.sourceId ?? null,
    qty: mov.qty,
    reason: mov.reason ?? mov.note ?? null,
    stockBefore: mov.stockBefore ?? null,
    stockAfter: mov.stockAfter ?? null,
    relatedServiceId: mov.relatedServiceId ?? null,
    relatedServiceOriginalId: mov.relatedServiceOriginalId ?? null,
    productPublicIdSnapshot: mov.productPublicIdSnapshot ?? null,
    productCodeSnapshot: mov.productCodeSnapshot ?? null,
    productNameSnapshot: mov.productNameSnapshot ?? null,
    relatedServiceNameSnapshot: mov.relatedServiceNameSnapshot ?? null,
    unitCostSnapshot: mov.unitCostSnapshot ?? null,
    metaJson: JSON.parse(mov.metaJson || '{}'),
    createdAt: mov.createdAt,
    updatedAt: mov.updatedAt ?? mov.createdAt,
    originDeviceId: mov.originDeviceId ?? null
  })

  if (error) throw new Error(`[push:InventoryMovement] ${error.message}`)

  db.prepare(`UPDATE "InventoryMovement" SET "syncedAt" = ? WHERE id = ?`).run(
    new Date().toISOString(),
    localMovId
  )
}

// ─── Push all locally unsynced sales and manual movements ────────────────────

export async function pushPending(): Promise<{ pushed: number; failed: number }> {
  void MAX_RETRIES
  const db = getLocalDb()

  let pushed = 0
  let failed = 0

  // Unsynced sales
  const pendingSales = db
    .prepare(`SELECT id FROM "Sale" WHERE "syncedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 50`)
    .all() as { id: number }[]

  for (const { id } of pendingSales) {
    try {
      await pushSaleToSupabase(id)
      pushed++
    } catch (err) {
      console.error(`[pushPending] Sale id=${id}:`, err)
      failed++
    }
  }

  // Unsynced non-sale movements (PURCHASE, ADJUSTMENT, RETURN, MANUAL, etc.)
  const pendingMoves = db
    .prepare(
      `SELECT id FROM "InventoryMovement"
     WHERE "syncedAt" IS NULL AND "saleId" IS NULL
     ORDER BY "createdAt" ASC LIMIT 100`
    )
    .all() as { id: number }[]

  for (const { id } of pendingMoves) {
    try {
      await pushMovementToSupabase(id)
      pushed++
    } catch (err) {
      console.error(`[pushPending] Movement id=${id}:`, err)
      failed++
    }
  }

  return { pushed, failed }
}

async function fetchRemoteCategories(): Promise<CategoryRemote[]> {
  const { data, error } = await supabase
    .from('Category')
    .select('id, publicId, name, createdAt, updatedAt, deletedAt')

  if (error) throw new Error(`[sync:categories] ${error.message}`)
  return data ?? []
}

async function fetchRemoteProducts(): Promise<ProductRemote[]> {
  const { data, error } = await supabase.from('Product').select(`
    id, publicId, sku, barcode, name, price, cost, profitPctBp, stock,
    stockMin, stockMax, imagePath, taxRateBp, active, categoryId,
    createdAt, updatedAt, deletedAt
  `)

  if (error) throw new Error(`[sync:products] ${error.message}`)
  return data ?? []
}

async function fetchRemoteServices(): Promise<ServiceRemote[]> {
  const { data, error } = await supabase.from('Service').select('*')

  if (error) throw new Error(`[sync:services] ${error.message}`)
  return data ?? []
}

async function fetchRemoteServiceSupplies(): Promise<ServiceSupplyRemote[]> {
  const { data, error } = await supabase.from('ServiceSupply').select('*')

  if (error) throw new Error(`[sync:serviceSupplies] ${error.message}`)
  return data ?? []
}

function replaceLocalCatalogFromRemote(snapshot: {
  categories: CategoryRemote[]
  products: ProductRemote[]
  services: ServiceRemote[]
  serviceSupplies: ServiceSupplyRemote[]
}): void {
  const db = getLocalDb()
  const now = new Date().toISOString()

  const insertCategory = db.prepare(`
    INSERT INTO "Category" (id, "publicId", name, "createdAt", "updatedAt", "deletedAt")
    VALUES (@id, @publicId, @name, @createdAt, @updatedAt, @deletedAt)
  `)

  const insertProduct = db.prepare(`
    INSERT INTO "Product" (
      id, "publicId", sku, barcode, name, price, cost, "profitPctBp", stock,
      "stockMin", "stockMax", "imagePath", "taxRateBp", active,
      "categoryId", "createdAt", "updatedAt", "deletedAt"
    ) VALUES (
      @id, @publicId, @sku, @barcode, @name, @price, @cost, @profitPctBp, @stock,
      @stockMin, @stockMax, @imagePath, @taxRateBp, @active,
      @categoryId, @createdAt, @updatedAt, @deletedAt
    )
  `)

  const insertService = db.prepare(`
    INSERT INTO "Service" (
      id, "publicId", code, name, "durationMin", cost, price,
      "taxRateBp", "profitPctBp", active, "createdAt", "updatedAt", "deletedAt"
    ) VALUES (
      @id, @publicId, @code, @name, @durationMin, @cost, @price,
      @taxRateBp, @profitPctBp, @active, @createdAt, @updatedAt, @deletedAt
    )
  `)

  const insertServiceSupply = db.prepare(`
    INSERT OR IGNORE INTO "ServiceSupply" ("serviceId", "productId", qty, "createdAt", "updatedAt")
    VALUES (@serviceId, @productId, @qty, @createdAt, @updatedAt)
  `)

  db.transaction(() => {
    db.prepare(
      `DELETE FROM sync_queue WHERE entity_name IN ('Category', 'Product', 'Service', 'ServiceSupply')`
    ).run()
    db.prepare('DELETE FROM "ServiceSupply"').run()
    db.prepare('DELETE FROM "Service"').run()
    db.prepare('DELETE FROM "Product"').run()
    db.prepare('DELETE FROM "Category"').run()

    for (const row of snapshot.categories) {
      insertCategory.run({
        id: row.id,
        publicId: row.publicId ?? crypto.randomUUID(),
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? row.createdAt,
        deletedAt: row.deletedAt ?? null
      })
    }

    for (const row of snapshot.products) {
      insertProduct.run({
        id: row.id,
        publicId: row.publicId ?? crypto.randomUUID(),
        sku: row.sku,
        barcode: row.barcode,
        name: row.name,
        price: row.price,
        cost: row.cost,
        profitPctBp: row.profitPctBp,
        stock: row.stock,
        stockMin: row.stockMin,
        stockMax: row.stockMax,
        imagePath: row.imagePath,
        taxRateBp: row.taxRateBp,
        active: row.active ? 1 : 0,
        categoryId: row.categoryId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? row.createdAt,
        deletedAt: row.deletedAt ?? null
      })
    }

    for (const row of snapshot.services) {
      insertService.run({
        id: row.id,
        publicId: row.publicId ?? crypto.randomUUID(),
        code: row.code,
        name: row.name,
        durationMin: row.durationMin ?? row.duration_min ?? 0,
        cost: row.cost,
        price: row.price,
        taxRateBp: row.taxRateBp ?? row.tax_rate_bp ?? 0,
        profitPctBp: row.profitPctBp ?? row.profit_pct_bp ?? 0,
        active: (row.active ?? true) ? 1 : 0,
        createdAt: row.createdAt ?? now,
        updatedAt: row.updatedAt ?? row.createdAt ?? now,
        deletedAt: row.deletedAt ?? null
      })
    }

    for (const row of snapshot.serviceSupplies) {
      const serviceId = row.serviceId ?? row.service_id
      const productId = row.productId ?? row.product_id
      if (serviceId == null || productId == null) continue
      insertServiceSupply.run({
        serviceId,
        productId,
        qty: row.qty,
        createdAt: row.createdAt ?? row.created_at ?? now,
        updatedAt: row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? now
      })
    }
  })()
}

async function pullRemoteCatalog(): Promise<{
  categories: number
  products: number
  services: number
  serviceSupplies: number
}> {
  const [categories, products, services, serviceSupplies] = await Promise.all([
    fetchRemoteCategories(),
    fetchRemoteProducts(),
    fetchRemoteServices(),
    fetchRemoteServiceSupplies()
  ])

  replaceLocalCatalogFromRemote({ categories, products, services, serviceSupplies })

  return {
    categories: categories.length,
    products: products.length,
    services: services.length,
    serviceSupplies: serviceSupplies.length
  }
}

export function registerSyncIpc(): void {
  ipcMain.handle('sync:diagnose', async () => {
    const db = getLocalDb()
    const checkedAt = new Date().toISOString()

    // ── Supabase URL ────────────────────────────────────────────
    const supabaseUrl: string =
      (supabaseAdmin as unknown as { supabaseUrl?: string }).supabaseUrl ??
      (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ??
      'desconocido'

    // ── Test conexión anon ───────────────────────────────────────
    let anonOk = false
    let anonMs = 0
    let anonError: string | undefined
    try {
      const t0 = Date.now()
      const { error } = await supabase.from('Product').select('id').limit(1)
      anonMs = Date.now() - t0
      if (error) {
        anonError = error.message
      } else {
        anonOk = true
      }
    } catch (e) {
      anonError = e instanceof Error ? e.message : String(e)
    }

    // ── Test conexión admin (service role) ───────────────────────
    let adminOk = false
    let adminMs = 0
    let adminError: string | undefined
    try {
      const t0 = Date.now()
      const { error } = await supabaseAdmin.from('Sale').select('id').limit(1)
      adminMs = Date.now() - t0
      if (error) {
        adminError = error.message
      } else {
        adminOk = true
      }
    } catch (e) {
      adminError = e instanceof Error ? e.message : String(e)
    }

    // ── Estadísticas locales ─────────────────────────────────────
    const { salesTotal } = db.prepare(`SELECT COUNT(*) AS salesTotal FROM "Sale"`).get() as {
      salesTotal: number
    }

    const { salesUnsynced } = db
      .prepare(`SELECT COUNT(*) AS salesUnsynced FROM "Sale" WHERE "syncedAt" IS NULL`)
      .get() as { salesUnsynced: number }

    const { movementsUnsynced } = db
      .prepare(
        `SELECT COUNT(*) AS movementsUnsynced FROM "InventoryMovement" WHERE "syncedAt" IS NULL AND "saleId" IS NULL`
      )
      .get() as { movementsUnsynced: number }

    const lastSynced = db
      .prepare(`SELECT MAX("syncedAt") AS ts FROM "Sale" WHERE "syncedAt" IS NOT NULL`)
      .get() as { ts: string | null }

    // ── Estadísticas remotas ─────────────────────────────────────
    let remoteSales: number | null = null
    let remoteProducts: number | null = null
    let remoteError: string | undefined

    if (adminOk) {
      try {
        const [salesRes, productsRes] = await Promise.all([
          supabaseAdmin.from('Sale').select('id', { count: 'exact', head: true }),
          supabaseAdmin.from('Product').select('id', { count: 'exact', head: true })
        ])
        if (salesRes.error) {
          remoteError = salesRes.error.message
        } else {
          remoteSales = salesRes.count ?? 0
        }
        if (!productsRes.error) {
          remoteProducts = productsRes.count ?? 0
        }
      } catch (e) {
        remoteError = e instanceof Error ? e.message : String(e)
      }
    }

    // ── Últimas 5 ventas sin sincronizar ─────────────────────────
    type UnsyncedRow = { id: number; folio: string; total: number; createdAt: string }
    const unsyncedSales = db
      .prepare(
        `SELECT id, folio, total, "createdAt" FROM "Sale" WHERE "syncedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 5`
      )
      .all() as UnsyncedRow[]

    return {
      supabaseUrl,
      checkedAt,
      connection: {
        anon: { ok: anonOk, ms: anonMs, error: anonError },
        admin: { ok: adminOk, ms: adminMs, error: adminError }
      },
      local: {
        salesTotal,
        salesUnsynced,
        movementsUnsynced,
        lastSyncedAt: lastSynced.ts ?? null
      },
      remote: {
        sales: remoteSales,
        products: remoteProducts,
        error: remoteError
      },
      unsyncedSales
    }
  })

  ipcMain.handle('sync:pullProducts', async () => {
    const counts = await pullRemoteCatalog()
    return { ok: true, count: counts.products }
  })

  ipcMain.handle('sync:pushPending', async () => {
    const { pushed, failed } = await pushPending()
    return { ok: true, pushed, failed }
  })

  ipcMain.handle('sync:conflicts', () => lastConflicts)

  ipcMain.handle('sync:pullAll', async () => {
    lastConflicts = []
    const [counts, push] = await Promise.all([pullRemoteCatalog(), pushPending()])

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      push,
      conflictCount: 0,
      counts
    }
  })
}
