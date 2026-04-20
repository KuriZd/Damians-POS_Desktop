import { ipcMain } from 'electron'
import { getLocalDb } from '../db/local-db'
import { supabase } from '../supabase/client'

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
}

export async function pushPending(): Promise<{ pushed: number; failed: number }> {
  void MAX_RETRIES
  return { pushed: 0, failed: 0 }
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
      "profitPctBp", active, "createdAt", "updatedAt", "deletedAt"
    ) VALUES (
      @id, @publicId, @code, @name, @durationMin, @cost, @price,
      @profitPctBp, @active, @createdAt, @updatedAt, @deletedAt
    )
  `)

  const insertServiceSupply = db.prepare(`
    INSERT OR IGNORE INTO "ServiceSupply" ("serviceId", "productId", qty)
    VALUES (@serviceId, @productId, @qty)
  `)

  db.transaction(() => {
    db.prepare(`DELETE FROM sync_queue WHERE entity_name IN ('Category', 'Product', 'Service', 'ServiceSupply')`).run()
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
      insertServiceSupply.run({ serviceId, productId, qty: row.qty })
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
    const counts = await pullRemoteCatalog()

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      push: { pushed: 0, failed: 0, skipped: true },
      conflictCount: 0,
      counts
    }
  })
}
