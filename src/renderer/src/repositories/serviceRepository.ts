import { supabase } from '../lib/supabaseClient'

export type ServiceSupplyInput = {
  productId: number
  qty: number
}

export type CreateServicePayload = {
  code: string
  name: string
  durationMin: number
  cost: number
  price: number
  profitPctBp: number
  supplies: ServiceSupplyInput[]
}

export type DataSource = 'local' | 'supabase'

export type ServiceDetails = {
  id: number
  code: string
  name: string
  durationMin: number
  cost: number
  price: number
  profitPctBp: number
  supplies?: ServiceSupplyInput[]
  source?: DataSource
}

export type ServicesListArgs = {
  search: string
  page: number
  pageSize: number
}

export type ServicesListResult = {
  items: ServiceDetails[]
  total: number
  page: number
  pageSize: number
}

type ServicesBridge = {
  create?: (payload: CreateServicePayload) => Promise<{ id: number }>
  update?: (id: number, payload: Partial<CreateServicePayload>) => Promise<void>
  get?: (id: number) => Promise<ServiceDetails>
  getByCode?: (code: string) => Promise<ServiceDetails | null>
  list?: (args: ServicesListArgs) => Promise<ServicesListResult>
}

type SyncBridge = {
  pullAll?: () => Promise<unknown>
}

type UnknownRow = Record<string, unknown>

type SupabaseServiceRecord = {
  id: number
  code: string
  name: string
  durationMin: number
  cost: number
  price: number
  profitPctBp: number
}

function getServicesBridge(): ServicesBridge | null {
  const w = window as unknown as { pos?: { services?: ServicesBridge } }
  return w.pos?.services ?? null
}

function getSyncBridge(): SyncBridge | null {
  const w = window as unknown as { pos?: { sync?: SyncBridge } }
  return w.pos?.sync ?? null
}

function asRow(value: unknown): UnknownRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as UnknownRow
}

function pickString(row: UnknownRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function pickNumber(row: UnknownRow, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function mapSupabaseService(rowValue: unknown): SupabaseServiceRecord | null {
  const row = asRow(rowValue)
  if (!row) return null

  const id = pickNumber(row, 'id')
  const code = pickString(row, 'code')
  const name = pickString(row, 'name')
  const durationMin = pickNumber(row, 'duration_min', 'durationMin')
  const cost = pickNumber(row, 'cost')
  const price = pickNumber(row, 'price')
  const profitPctBp = pickNumber(row, 'profit_pct_bp', 'profitPctBp')

  if (
    id === null ||
    code === null ||
    name === null ||
    durationMin === null ||
    cost === null ||
    price === null ||
    profitPctBp === null
  ) {
    return null
  }

  return {
    id,
    code,
    name,
    durationMin,
    cost,
    price,
    profitPctBp
  }
}

function mapSupplies(rows: unknown[]): ServiceSupplyInput[] {
  const supplies: ServiceSupplyInput[] = []

  for (const rowValue of rows) {
    const row = asRow(rowValue)
    if (!row) continue

    const productId = pickNumber(row, 'product_id', 'productId')
    const qty = pickNumber(row, 'qty')

    if (productId === null || qty === null) continue
    supplies.push({ productId, qty })
  }

  return supplies
}

function buildServiceDetails(
  record: SupabaseServiceRecord,
  supplies?: ServiceSupplyInput[],
  source: DataSource = 'supabase'
): ServiceDetails {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    durationMin: record.durationMin,
    cost: record.cost,
    price: record.price,
    profitPctBp: record.profitPctBp,
    supplies,
    source
  }
}

function buildServiceRowCamel(
  payload: Partial<CreateServicePayload>,
  forInsert = false
): UnknownRow {
  const row: UnknownRow = {}

  if (typeof payload.code === 'string') row.code = payload.code.trim()
  if (typeof payload.name === 'string') row.name = payload.name.trim()
  if (typeof payload.durationMin === 'number') row.durationMin = payload.durationMin
  if (typeof payload.cost === 'number') row.cost = payload.cost
  if (typeof payload.price === 'number') row.price = payload.price
  if (typeof payload.profitPctBp === 'number') row.profitPctBp = payload.profitPctBp
  if (forInsert) row.active = true

  return row
}

function buildSuppliesRowsCamel(serviceId: number, supplies: ServiceSupplyInput[]): UnknownRow[] {
  const now = new Date().toISOString()
  return supplies.map((supply) => ({
    serviceId,
    productId: supply.productId,
    qty: supply.qty,
    createdAt: now,
    updatedAt: now
  }))
}

async function tryAlternatives<T>(attempts: Array<() => Promise<T>>): Promise<T> {
  let lastError: unknown = null

  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Operación no disponible en Supabase.')
}

function assertSupabaseOk(error: unknown, fallbackMessage: string): void {
  if (!error) return
  if (error instanceof Error) throw error
  throw new Error(fallbackMessage)
}

async function getSupabaseServiceById(id: number): Promise<SupabaseServiceRecord | null> {
  const attempts = [
    async () => {
      const { data, error } = await supabase.from('Service').select('*').eq('id', id).maybeSingle()
      assertSupabaseOk(error, 'No se pudo consultar el servicio en Supabase.')
      return mapSupabaseService(data)
    }
  ]

  return await tryAlternatives(attempts)
}

async function getSupabaseServiceByCode(code: string): Promise<SupabaseServiceRecord | null> {
  const normalized = code.trim()
  if (!normalized) return null

  const attempts = [
    async () => {
      const { data, error } = await supabase
        .from('Service')
        .select('*')
        .eq('code', normalized)
        .maybeSingle()
      assertSupabaseOk(error, 'No se pudo consultar el servicio por código en Supabase.')
      return mapSupabaseService(data)
    }
  ]

  return await tryAlternatives(attempts)
}

async function getSupabaseServiceSupplies(serviceId: number): Promise<ServiceSupplyInput[]> {
  const attempts = [
    async () => {
      const { data, error } = await supabase
        .from('ServiceSupply')
        .select('*')
        .eq('serviceId', serviceId)
      assertSupabaseOk(error, 'No se pudieron consultar los insumos del servicio en Supabase.')
      return mapSupplies((data ?? []) as unknown[])
    },
    async () => {
      const { data, error } = await supabase
        .from('ServiceSupply')
        .select('*')
        .eq('serviceId', serviceId)
      assertSupabaseOk(error, 'No se pudieron consultar los insumos del servicio en Supabase.')
      return mapSupplies((data ?? []) as unknown[])
    }
  ]

  return await tryAlternatives(attempts)
}

async function insertSupabaseService(payload: CreateServicePayload): Promise<number> {
  const row = buildServiceRowCamel(payload, true)

  const { data, error } = await supabase.from('Service').insert(row).select('*').single()
  assertSupabaseOk(error, 'No se pudo crear el servicio en Supabase.')

  const inserted = mapSupabaseService(data)
  if (!inserted) throw new Error('Supabase devolvió un servicio inválido.')

  await replaceSupabaseServiceSupplies(inserted.id, payload.supplies)
  return inserted.id
}

async function replaceSupabaseServiceSupplies(
  serviceId: number,
  supplies: ServiceSupplyInput[] | undefined
): Promise<void> {
  const safeSupplies = supplies ?? []

  const { error: deleteError } = await supabase
    .from('ServiceSupply')
    .delete()
    .eq('serviceId', serviceId)
  assertSupabaseOk(deleteError, 'No se pudieron actualizar los insumos del servicio en Supabase.')

  if (safeSupplies.length === 0) return

  const { error: insertError } = await supabase
    .from('ServiceSupply')
    .insert(buildSuppliesRowsCamel(serviceId, safeSupplies))
  assertSupabaseOk(insertError, 'No se pudieron guardar los insumos del servicio en Supabase.')
}

async function updateSupabaseServiceByLocator(
  id: number,
  payload: Partial<CreateServicePayload>,
  codeFallback?: string | null
): Promise<void> {
  const camelRow = buildServiceRowCamel(payload)

  const targetById = await getSupabaseServiceById(id)
  const target = targetById ?? (codeFallback ? await getSupabaseServiceByCode(codeFallback) : null)

  if (!target) {
    if (
      typeof payload.code === 'string' &&
      typeof payload.name === 'string' &&
      typeof payload.durationMin === 'number' &&
      typeof payload.cost === 'number' &&
      typeof payload.price === 'number' &&
      typeof payload.profitPctBp === 'number'
    ) {
      await insertSupabaseService({
        code: payload.code,
        name: payload.name,
        durationMin: payload.durationMin,
        cost: payload.cost,
        price: payload.price,
        profitPctBp: payload.profitPctBp,
        supplies: payload.supplies ?? []
      })
      return
    }

    throw new Error('No se encontró el servicio en Supabase para actualizarlo.')
  }

  const { error } = await supabase.from('Service').update(camelRow).eq('id', target.id)
  assertSupabaseOk(error, 'No se pudo actualizar el servicio en Supabase.')

  if (payload.supplies) {
    await replaceSupabaseServiceSupplies(target.id, payload.supplies)
  }
}

function normalizeSearch(search: string): string {
  return search.trim()
}

async function listSupabaseServices(args: ServicesListArgs): Promise<ServicesListResult> {
  const search = normalizeSearch(args.search)
  const page = Math.max(1, args.page)
  const pageSize = Math.max(1, args.pageSize)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase.from('Service').select('*', { count: 'exact' })

  if (search) {
    const safeSearch = search.replace(/,/g, ' ')
    query = query.or(`name.ilike.%${safeSearch}%,code.ilike.%${safeSearch}%`)
  }

  const { data, error, count } = await query.range(from, to).order('id', { ascending: false })
  assertSupabaseOk(error, 'No se pudo listar los servicios desde Supabase.')

  const items = (
    ((data ?? []) as unknown[]).map(mapSupabaseService).filter(Boolean) as SupabaseServiceRecord[]
  ).map((item) => buildServiceDetails(item, undefined, 'supabase'))

  return {
    items,
    total: count ?? items.length,
    page,
    pageSize
  }
}

async function getLocalService(id: number): Promise<ServiceDetails | null> {
  const api = getServicesBridge()
  const get = api?.get
  if (typeof get !== 'function') return null

  try {
    const result = await get(id)
    return { ...result, source: 'local' }
  } catch {
    return null
  }
}

async function getLocalServiceByCode(code: string): Promise<ServiceDetails | null> {
  const api = getServicesBridge()
  const getByCode = api?.getByCode
  if (typeof getByCode !== 'function') return null

  try {
    const result = await getByCode(code)
    return result ? { ...result, source: 'local' } : null
  } catch {
    return null
  }
}

async function listLocalServices(args: ServicesListArgs): Promise<ServicesListResult | null> {
  const api = getServicesBridge()
  const list = api?.list
  if (typeof list !== 'function') return null

  try {
    const result = await list(args)
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, source: 'local' as const }))
    }
  } catch {
    return null
  }
}

export const serviceRepository = {
  async create(payload: CreateServicePayload): Promise<{ id: number }> {
    try {
      const supabaseId = await insertSupabaseService(payload)
      await getSyncBridge()
        ?.pullAll?.()
        .catch(() => undefined)
      return { id: supabaseId }
    } catch (error) {
      console.warn('No se pudo sincronizar el servicio en Supabase.', error)
      if (error instanceof Error) throw error
      throw new Error('No se pudo crear el servicio.')
    }
  },

  async update(id: number, payload: Partial<CreateServicePayload>): Promise<void> {
    const existingCode = typeof payload.code === 'string' ? payload.code : null

    try {
      await updateSupabaseServiceByLocator(id, payload, existingCode)
      await getSyncBridge()
        ?.pullAll?.()
        .catch(() => undefined)
    } catch (error) {
      console.warn('No se pudo sincronizar la actualización del servicio en Supabase.', error)
      if (error instanceof Error) throw error
      throw new Error('No se pudo actualizar el servicio.')
    }
  },

  async get(id: number): Promise<ServiceDetails> {
    const local = await getLocalService(id)
    if (local) return local

    const supabaseRecord = await getSupabaseServiceById(id)
    if (!supabaseRecord) throw new Error('No se encontró el servicio.')

    const supplies = await getSupabaseServiceSupplies(supabaseRecord.id).catch(() => [])
    return buildServiceDetails(supabaseRecord, supplies, 'supabase')
  },

  async getByCode(code: string): Promise<ServiceDetails | null> {
    const local = await getLocalServiceByCode(code)
    if (local) return local

    const supabaseRecord = await getSupabaseServiceByCode(code)
    if (!supabaseRecord) return null

    const supplies = await getSupabaseServiceSupplies(supabaseRecord.id).catch(() => [])
    return buildServiceDetails(supabaseRecord, supplies, 'supabase')
  },

  async list(args: ServicesListArgs): Promise<ServicesListResult> {
    const local = await listLocalServices(args)
    if (local && local.items.length > 0) return local
    return await listSupabaseServices(args)
  }
}
