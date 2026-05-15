import { ipcMain } from 'electron'
import { getLocalDb } from '../db/local-db'

export function registerDashboardIpc(): void {
  ipcMain.handle('dashboard:stats', () => {
    const db = getLocalDb()
    const todayStr = new Date().toISOString().slice(0, 10)

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 6)
    const weekStr = weekStart.toISOString().slice(0, 10)

    const yearStart = new Date()
    yearStart.setDate(yearStart.getDate() - 364)
    const yearStr = yearStart.toISOString().slice(0, 10)

    type SaleAgg = { total: number | null; tickets: number; units: number | null }
    type ProfitAgg = { profit: number | null }
    type HeatRow = { date: string; total: number; tickets: number }

    const todayRow = db
      .prepare(
        `
      SELECT SUM(s.total) AS total, COUNT(*) AS tickets, SUM(si.qty) AS units
      FROM "Sale" s
      LEFT JOIN "SaleItem" si ON si."salePublicId" = s."publicId"
                              AND si."itemType" = 'PRODUCT'
      WHERE s.status = 'COMPLETED' AND DATE(s."createdAt") = ?
    `
      )
      .get(todayStr) as SaleAgg

    const profitRow = db
      .prepare(
        `
      SELECT SUM(COALESCE(si."lineProfit",
        si."lineTotal" - COALESCE(si."lineCostTotal", 0), 0)) AS profit
      FROM "SaleItem" si
      JOIN "Sale" s ON s."publicId" = si."salePublicId"
      WHERE s.status = 'COMPLETED'
        AND DATE(s."createdAt") = ?
        AND si."itemType" = 'PRODUCT'
    `
      )
      .get(todayStr) as ProfitAgg

    const weekRow = db
      .prepare(
        `
      SELECT SUM(total) AS total, COUNT(*) AS tickets
      FROM "Sale"
      WHERE status = 'COMPLETED' AND DATE("createdAt") >= ?
    `
      )
      .get(weekStr) as { total: number | null; tickets: number }

    const { lowStock } = db
      .prepare(
        `
      SELECT COUNT(*) AS lowStock
      FROM "Product"
      WHERE "deletedAt" IS NULL AND active = 1 AND stock <= "stockMin"
    `
      )
      .get() as { lowStock: number }

    const heatmap = db
      .prepare(
        `
      SELECT DATE("createdAt") AS date,
             SUM(total)        AS total,
             COUNT(*)          AS tickets
      FROM "Sale"
      WHERE status = 'COMPLETED' AND DATE("createdAt") >= ?
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `
      )
      .all(yearStr) as HeatRow[]

    return {
      today: {
        total: todayRow.total ?? 0,
        tickets: todayRow.tickets ?? 0,
        units: todayRow.units ?? 0
      },
      todayProfit: profitRow.profit ?? 0,
      week: {
        total: weekRow.total ?? 0,
        tickets: weekRow.tickets ?? 0
      },
      lowStock,
      heatmap
    }
  })
}
