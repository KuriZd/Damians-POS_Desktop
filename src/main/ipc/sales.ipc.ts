import { ipcMain } from 'electron'
import { getLocalDb } from '../db/local-db'
import { pushSaleToSupabase } from './sync.ipc'
import {
  createSale,
  getSaleCorteData,
  confirmSaleCorte,
  type CreateSalePayload
} from './sales.core'

export function registerSalesIpc(): void {
  ipcMain.handle('sales:create', (_event, payload: CreateSalePayload) => {
    const db = getLocalDb()
    const result = createSale(db, payload, (id) =>
      pushSaleToSupabase(id).catch((err: unknown) =>
        console.error('[sales:create] Supabase sync failed, will retry via pushPending:', err)
      )
    )
    if (!result.ok) return result
    return { ok: true, folio: result.folio, salePublicId: result.salePublicId }
  })

  ipcMain.handle('sales:corte', (_event, cashierId: number) => {
    return getSaleCorteData(getLocalDb(), cashierId)
  })

  ipcMain.handle('sales:confirmCorte', (_event, cashierId: number, countedCash?: number) => {
    return confirmSaleCorte(getLocalDb(), cashierId, countedCash)
  })

  ipcMain.handle(
    'sales:cashMovement',
    (_event, payload: { type: 'IN' | 'OUT'; amount: number; reason?: string }) => {
      if (payload.type !== 'IN' && payload.type !== 'OUT') {
        return { ok: false as const, error: 'PAYLOAD_INVALIDO: type debe ser IN o OUT' }
      }
      if (!Number.isInteger(payload.amount) || payload.amount <= 0) {
        return {
          ok: false as const,
          error: 'PAYLOAD_INVALIDO: amount debe ser un entero positivo en centavos'
        }
      }

      const db = getLocalDb()
      const now = new Date().toISOString()

      const session = db
        .prepare(
          `
      SELECT id FROM "CashSession" WHERE "closedAt" IS NULL ORDER BY id DESC LIMIT 1
    `
        )
        .get() as { id: number } | undefined

      if (!session) {
        return { ok: false as const, error: 'No hay sesión de caja activa.' }
      }

      const { lastInsertRowid } = db
        .prepare(
          `
      INSERT INTO "CashMovement" ("sessionId", type, amount, reason, "createdAt")
      VALUES (?, ?, ?, ?, ?)
    `
        )
        .run(session.id, payload.type, payload.amount, payload.reason ?? null, now)

      return { ok: true as const, id: Number(lastInsertRowid) }
    }
  )

  ipcMain.handle('sales:recent', (_event, limit = 30) => {
    const db = getLocalDb()
    type Row = {
      id: number
      folio: string
      createdAt: string
      total: number
      subtotal: number
      status: string
      cashierName: string | null
      itemCount: number
      paymentMethod: string | null
    }
    const rows = db
      .prepare(
        `
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
    `
      )
      .all(limit) as Row[]

    return rows.map((r) => ({
      id: r.id,
      folio: r.folio,
      createdAt: r.createdAt,
      total: r.total,
      subtotal: r.subtotal,
      status: r.status,
      cashierName: r.cashierName ?? '—',
      itemCount: r.itemCount,
      paymentMethod: r.paymentMethod ?? '—'
    }))
  })
}
