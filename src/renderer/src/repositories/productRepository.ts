// src/renderer/src/repositories/productRepository.ts
import { supabase } from '../lib/supabaseClient'
export type { CreateProductPayload } from '../types/pos'
import type { CreateProductPayload } from '../types/pos'

type ProductDetails = {
  id: number
  sku: string
  name: string
  price: number
  cost: number
  profitPctBp: number
  stock: number
  stockMin: number
  stockMax: number
  imageUrl?: string | null
  imagePath?: string | null
  active?: boolean
  source?: 'local' | 'supabase'
}

type ProductsListArgs = {
  search?: string
  page?: number
  pageSize?: number
}

type ProductsListResult = {
  items: ProductDetails[]
  total: number
  page: number
  pageSize: number
}

type ProductsBridge = {
  create?: (payload: CreateProductPayload) => Promise<{ id: number }>
  update?: (id: number, payload: Partial<CreateProductPayload>) => Promise<void>
  get?: (id: number) => Promise<ProductDetails>
  getBySku?: (sku: string) => Promise<ProductDetails | null>
  list?: (args: ProductsListArgs) => Promise<ProductsListResult>
}

type SyncBridge = {
  pullAll?: () => Promise<unknown>
}

function getProductsBridge(): ProductsBridge | null {
  const w = window as unknown as { pos?: { products?: ProductsBridge } }
  return w.pos?.products ?? null
}

function getSyncBridge(): SyncBridge | null {
  const w = window as unknown as { pos?: { sync?: SyncBridge } }
  return w.pos?.sync ?? null
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function mapSupabaseProduct(row: Record<string, unknown>): ProductDetails {
  return {
    id: readNumber(row.id),
    sku: readString(row.sku ?? row.code),
    name: readString(row.name),
    price: readNumber(row.price),
    cost: readNumber(row.cost),
    profitPctBp: readNumber(row.profit_pct_bp ?? row.profitPctBp),
    stock: readNumber(row.stock),
    stockMin: readNumber(row.stock_min ?? row.stockMin),
    stockMax: readNumber(row.stock_max ?? row.stockMax),
    imageUrl: readNullableString(row.image_url ?? row.imageUrl),
    imagePath: readNullableString(row.image_path ?? row.imagePath),
    active: typeof row.active === 'boolean' ? row.active : true,
    source: 'supabase'
  }
}

function toSupabaseCreatePayload(payload: CreateProductPayload): Record<string, unknown> {
  return {
    sku: payload.sku,
    name: payload.name,
    stock: payload.stock,
    stockMin: payload.stockMin,
    stockMax: payload.stockMax,
    cost: payload.cost,
    price: payload.price,
    profitPctBp: payload.profitPctBp,
    imagePath: payload.imageDataUrl ?? null,
    active: true,
    categoryId: payload.categoryId ?? null
  }
}

function toSupabaseUpdatePayload(payload: Partial<CreateProductPayload>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (payload.sku !== undefined) out.sku = payload.sku
  if (payload.name !== undefined) out.name = payload.name
  if (payload.stock !== undefined) out.stock = payload.stock
  if (payload.stockMin !== undefined) out.stockMin = payload.stockMin
  if (payload.stockMax !== undefined) out.stockMax = payload.stockMax
  if (payload.cost !== undefined) out.cost = payload.cost
  if (payload.price !== undefined) out.price = payload.price
  if (payload.profitPctBp !== undefined) out.profitPctBp = payload.profitPctBp
  if (payload.imageDataUrl !== undefined) out.imagePath = payload.imageDataUrl
  if (payload.categoryId !== undefined) out.categoryId = payload.categoryId ?? null

  return out
}

async function createInSupabase(payload: CreateProductPayload): Promise<{ id: number } | null> {
  const { data, error } = await supabase
    .from('Product')
    .insert(toSupabaseCreatePayload(payload))
    .select('id')
    .single()

  if (error) {
    console.warn('[productRepository.create] No se pudo sincronizar en Supabase:', error.message)
    return null
  }

  return { id: readNumber(data?.id) }
}

async function updateInSupabase(id: number, payload: Partial<CreateProductPayload>): Promise<void> {
  const updatePayload = toSupabaseUpdatePayload(payload)
  if (Object.keys(updatePayload).length === 0) return

  const { error } = await supabase.from('Product').update(updatePayload).eq('id', id)

  if (error) {
    console.warn('[productRepository.update] No se pudo sincronizar en Supabase:', error.message)
  }
}

async function getFromSupabase(id: number): Promise<ProductDetails> {
  const { data, error } = await supabase.from('Product').select('*').eq('id', id).single()

  if (error || !data) {
    throw new Error(error?.message ?? 'No se pudo obtener el producto desde Supabase')
  }

  return mapSupabaseProduct(data as Record<string, unknown>)
}

async function getBySkuFromSupabase(sku: string): Promise<ProductDetails | null> {
  const { data, error } = await supabase.from('Product').select('*').eq('sku', sku).maybeSingle()

  if (error) {
    console.warn('[productRepository.getBySku] Falló búsqueda en Supabase:', error.message)
    return null
  }

  if (!data) return null
  return mapSupabaseProduct(data as Record<string, unknown>)
}

async function listFromSupabase(args: ProductsListArgs): Promise<ProductsListResult> {
  const page = args.page ?? 1
  const pageSize = args.pageSize ?? 10
  const search = (args.search ?? '').trim()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase.from('Product').select('*', { count: 'exact' }).eq('active', true)

  if (search) {
    query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
  }

  const { data, count, error } = await query.range(from, to)

  if (error) {
    throw new Error(error.message)
  }

  return {
    items: (data ?? []).map((row) => mapSupabaseProduct(row as Record<string, unknown>)),
    total: count ?? 0,
    page,
    pageSize
  }
}

export const productRepository = {
  async create(payload: CreateProductPayload): Promise<{ id: number }> {
    const remoteResult = await createInSupabase(payload)
    if (!remoteResult) {
      throw new Error('No se pudo guardar el producto en Supabase.')
    }

    await getSyncBridge()
      ?.pullAll?.()
      .catch(() => undefined)
    return remoteResult
  },

  async update(id: number, payload: Partial<CreateProductPayload>): Promise<void> {
    await updateInSupabase(id, payload)
    await getSyncBridge()
      ?.pullAll?.()
      .catch(() => undefined)
  },

  async get(id: number): Promise<ProductDetails> {
    const api = getProductsBridge()
    const get = api?.get

    if (typeof get === 'function') {
      try {
        const local = await get(id)
        return { ...local, source: 'local' }
      } catch {
        return await getFromSupabase(id)
      }
    }

    return await getFromSupabase(id)
  },

  async getBySku(sku: string): Promise<ProductDetails | null> {
    const normalized = sku.trim()
    if (!normalized) return null

    const api = getProductsBridge()
    const getBySku = api?.getBySku

    if (typeof getBySku === 'function') {
      try {
        const local = await getBySku(normalized)
        if (local) return { ...local, source: 'local' }
      } catch {
        // fallback a Supabase
      }
    }

    return await getBySkuFromSupabase(normalized)
  },

  async list(args: ProductsListArgs): Promise<ProductsListResult> {
    const api = getProductsBridge()
    const list = api?.list

    if (typeof list === 'function') {
      try {
        const local = await list(args)
        if (local.items.length > 0) {
          return {
            ...local,
            items: local.items.map((item) => ({ ...item, source: 'local' as const }))
          }
        }
      } catch {
        // fallback a Supabase
      }
    }

    return await listFromSupabase(args)
  }
}
