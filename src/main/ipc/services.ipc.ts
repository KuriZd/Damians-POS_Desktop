import { ipcMain } from 'electron'
import { getLocalDb } from '../db/local-db'

type ServiceRow = {
  id: number
  code: string
  name: string
  durationMin: number
  cost: number
  price: number
  profitPctBp: number
  active: number
  createdAt: string | null
}

type SupplyRow = {
  productId: number
  qty: number
}

type ServiceSupplyInput = {
  productId: number
  qty: number
}

type CreateServicePayload = {
  code: string
  name: string
  durationMin: number
  cost: number
  price: number
  profitPctBp: number
  supplies: ServiceSupplyInput[]
}

function mapService(row: ServiceRow, supplies: SupplyRow[]) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    durationMin: row.durationMin,
    cost: row.cost,
    price: row.price,
    profitPctBp: row.profitPctBp,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    supplies
  }
}

function getSupplies(db: ReturnType<typeof getLocalDb>, serviceId: number): SupplyRow[] {
  return db.prepare(
    `SELECT "productId", qty FROM "ServiceSupply" WHERE "serviceId" = ?`
  ).all(serviceId) as SupplyRow[]
}

export function registerServicesIpc(): void {
  ipcMain.handle('services:get', (_event, id: number) => {
    const db = getLocalDb()
    const row = db.prepare(
      `SELECT id, code, name, "durationMin" as durationMin, cost, price,
              "profitPctBp" as profitPctBp, active, "createdAt" as createdAt
       FROM "Service" WHERE id = ? AND "deletedAt" IS NULL LIMIT 1`
    ).get(id) as ServiceRow | undefined

    if (!row) return null
    return mapService(row, getSupplies(db, row.id))
  })

  ipcMain.handle('services:getByCode', (_event, code: string) => {
    const db = getLocalDb()
    const row = db.prepare(
      `SELECT id, code, name, "durationMin" as durationMin, cost, price,
              "profitPctBp" as profitPctBp, active, "createdAt" as createdAt
       FROM "Service" WHERE code = ? AND "deletedAt" IS NULL LIMIT 1`
    ).get(code) as ServiceRow | undefined

    if (!row) return null
    return mapService(row, getSupplies(db, row.id))
  })

  ipcMain.handle('services:list', (_event, args: { page: number; pageSize: number; search?: string; active?: boolean }) => {
    const db = getLocalDb()
    const page = Math.max(1, args.page ?? 1)
    const pageSize = Math.max(1, args.pageSize ?? 20)
    const offset = (page - 1) * pageSize

    const conditions: string[] = ['"deletedAt" IS NULL']
    const params: Record<string, unknown> = { pageSize, offset }

    if (args.search?.trim()) {
      conditions.push(`(name LIKE '%' || @search || '%' OR code LIKE '%' || @search || '%')`)
      params.search = args.search.trim()
    }
    if (args.active !== undefined) {
      conditions.push('active = @active')
      params.active = args.active ? 1 : 0
    }

    const where = conditions.join(' AND ')
    const { count } = db.prepare(
      `SELECT COUNT(*) as count FROM "Service" WHERE ${where}`
    ).get(params) as { count: number }

    const items = db.prepare(
      `SELECT id, "publicId", code, name, "durationMin" as durationMin, cost, price,
              "profitPctBp" as profitPctBp, active, "createdAt" as createdAt
       FROM "Service" WHERE ${where} ORDER BY id DESC LIMIT @pageSize OFFSET @offset`
    ).all(params) as ServiceRow[]

    return {
      items: items.map((s) => ({ ...s, active: Boolean(s.active) })),
      total: count,
      page,
      pageSize
    }
  })

  ipcMain.handle('services:create', (_event, payload: CreateServicePayload) => {
    void payload
    throw new Error('La BD local de servicios es de solo lectura. Crea servicios en Supabase.')
  })

  ipcMain.handle('services:update', (_event, id: number, payload: Partial<CreateServicePayload>) => {
    void id
    void payload
    throw new Error('La BD local de servicios es de solo lectura. Actualiza servicios en Supabase.')
  })

  ipcMain.handle('services:remove', (_event, id: number) => {
    void id
    throw new Error('La BD local de servicios es de solo lectura. Elimina servicios en Supabase.')
  })
}
