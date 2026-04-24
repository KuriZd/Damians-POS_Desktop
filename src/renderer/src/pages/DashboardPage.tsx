import { useState, useEffect, type ReactElement } from 'react'
import {
  FiShoppingCart, FiTrendingUp, FiPackage, FiAlertTriangle,
  FiRefreshCw, FiCalendar, FiX,
} from 'react-icons/fi'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import styles from './DashboardPage.module.css'
import { formatMXN } from '../lib/formatters'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => formatMXN(n, { decimals: 0 })

function greeting(name: string): string {
  const h = new Date().getHours()
  if (h < 12) return `Buenos días, ${name}`
  if (h < 19) return `Buenas tardes, ${name}`
  return `Buenas noches, ${name}`
}

function todayLabel(): string {
  return new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const WEEKS = 53

function buildGrid(heatmap: DashboardStats['heatmap']): { date: string; total: number }[][] {
  const byDate = new Map(heatmap.map(r => [r.date, r.total]))

  // Find the Sunday on or before 364 days ago
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - start.getDay()) // rewind to Sunday

  // Build WEEKS columns × 7 rows
  const grid: { date: string; total: number }[][] = []
  for (let w = 0; w < WEEKS; w++) {
    const col: { date: string; total: number }[] = []
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start)
      cur.setDate(start.getDate() + w * 7 + d)
      const iso = cur.toISOString().slice(0, 10)
      col.push({ date: iso, total: byDate.get(iso) ?? 0 })
    }
    grid.push(col)
  }
  return grid
}

function heatColor(total: number, max: number): string {
  if (total === 0 || max === 0) return '#ebedf0'
  const ratio = total / max
  if (ratio <= 0.33) return '#fde8cc'
  if (ratio <= 0.66) return '#f7a558'
  return '#e8650a'
}

type HeatmapProps = { heatmap: DashboardStats['heatmap'] }

function Heatmap({ heatmap }: HeatmapProps): ReactElement {
  const grid = buildGrid(heatmap)
  const max  = Math.max(...heatmap.map(r => r.total), 1)

  // Month labels: detect when month changes across weeks
  const monthLabels: { label: string; col: number }[] = []
  let lastMonth = -1
  grid.forEach((col, wi) => {
    const m = new Date(col[0].date).getMonth()
    if (m !== lastMonth) {
      monthLabels.push({ label: new Date(col[0].date).toLocaleDateString('es-MX', { month: 'short' }), col: wi })
      lastMonth = m
    }
  })

  return (
    <div className={styles.heatWrap}>
      {/* Month axis */}
      <div className={styles.heatMonths}>
        {monthLabels.map(({ label, col }) => (
          <span
            key={col}
            className={styles.heatMonth}
            style={{ gridColumnStart: col + 1 }}
          >
            {label}
          </span>
        ))}
      </div>

      <div className={styles.heatGrid}>
        {/* Day-of-week axis */}
        <div className={styles.heatDays}>
          {DAYS.map((d, i) => (
            <span key={d} className={styles.heatDay} style={{ gridRow: i + 1 }}>{d}</span>
          ))}
        </div>

        {/* Cells */}
        <div className={styles.heatCells}>
          {grid.map((col, wi) =>
            col.map((cell, di) => {
              const isFuture = new Date(cell.date) > new Date()
              return (
                <div
                  key={`${wi}-${di}`}
                  className={styles.heatCell}
                  style={{
                    gridColumn: wi + 1,
                    gridRow:    di + 1,
                    background: isFuture ? 'transparent' : heatColor(cell.total, max),
                  }}
                  title={
                    isFuture
                      ? ''
                      : cell.total > 0
                        ? `${cell.date}: ${fmt(cell.total)}`
                        : `${cell.date}: sin ventas`
                  }
                />
              )
            })
          )}
        </div>
      </div>

      {/* Legend */}
      <div className={styles.heatLegend}>
        <span className={styles.heatLegendLabel}>Menos</span>
        {['#ebedf0', '#fde8cc', '#f7a558', '#e8650a'].map(c => (
          <div key={c} className={styles.heatLegendCell} style={{ background: c }} />
        ))}
        <span className={styles.heatLegendLabel}>Más</span>
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

type KpiCardProps = {
  icon: ReactElement
  label: string
  value: string
  sub?: string
  accent?: string
  alert?: boolean
  onClick?: () => void
}

function KpiCard({ icon, label, value, sub, accent = '#5b79ff', alert, onClick }: KpiCardProps): ReactElement {
  return (
    <div
      className={`${styles.kpiCard} ${alert ? styles.kpiAlert : ''} ${onClick ? styles.kpiClickable : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={styles.kpiIcon} style={{ background: `${accent}18`, color: accent }}>
        {icon}
      </div>
      <div className={styles.kpiContent}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={styles.kpiValue}>{value}</span>
        {sub && <span className={styles.kpiSub}>{sub}</span>}
      </div>
    </div>
  )
}

// ─── Low Stock Modal ──────────────────────────────────────────────────────────

type StockItem = { id: number; name: string; sku: string; stock: number; stockMin: number; status: 'low' | 'out' }

function LowStockModal({ onClose }: { onClose: () => void }): ReactElement {
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void window.pos.inventory.products().then(prods => {
      setItems(prods.filter(p => p.status !== 'ok') as StockItem[])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  return (
    <div className={styles.lsOverlay} onClick={onClose}>
      <div className={styles.lsModal} onClick={e => e.stopPropagation()}>
        <div className={styles.lsHead}>
          <div className={styles.lsTitle}>
            <FiAlertTriangle size={16} />
            Productos con stock bajo o agotado
          </div>
          <button className={styles.lsClose} onClick={onClose}><FiX size={16} /></button>
        </div>
        <div className={styles.lsBody}>
          {loading ? (
            <div className={styles.lsLoading}>Cargando…</div>
          ) : items.length === 0 ? (
            <div className={styles.lsEmpty}>Todos los productos tienen stock suficiente.</div>
          ) : (
            <table className={styles.lsTable}>
              <thead>
                <tr>
                  <th>Producto</th><th>SKU</th>
                  <th className={styles.lsCenter}>Stock</th>
                  <th className={styles.lsCenter}>Mínimo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className={styles.lsSku}>{p.sku}</td>
                    <td className={`${styles.lsCenter} ${p.status === 'out' ? styles.lsStockOut : styles.lsStockLow}`}>{p.stock}</td>
                    <td className={`${styles.lsCenter} ${styles.lsMuted}`}>{p.stockMin}</td>
                    <td>
                      <span className={`${styles.lsBadge} ${p.status === 'out' ? styles.lsBadgeOut : styles.lsBadgeLow}`}>
                        {p.status === 'out' ? 'Agotado' : 'Stock bajo'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type ProductLookup = Awaited<ReturnType<typeof window.pos.products.findByCode>>

export default function DashboardPage({ user }: { user: AuthUser }): ReactElement {
  const [stats, setStats]         = useState<DashboardStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [syncing, setSyncing]     = useState(false)
  const [syncMsg, setSyncMsg]     = useState('')
  const [lastCode, setLastCode]   = useState('')
  const [product, setProduct]     = useState<ProductLookup>(null)
  const [lowStockOpen, setLowStockOpen] = useState(false)

  useEffect(() => {
    void window.pos.dashboard.stats().then(s => {
      setStats(s)
      setStatsLoading(false)
    }).catch(() => setStatsLoading(false))
  }, [])

  useBarcodeScanner(async (code) => {
    setLastCode(code)
    const found = await window.pos.products.findByCode(code).catch(() => null)
    setProduct(found)
  })

  const handleSync = async (): Promise<void> => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const r = await window.pos.sync.pullAll()
      setSyncMsg(`Sync OK — productos: ${r.counts.products}, servicios: ${r.counts.services}`)
    } catch {
      setSyncMsg('Error al sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className={styles.page}>
      {lowStockOpen && <LowStockModal onClose={() => setLowStockOpen(false)} />}

      {/* ── Greeting ── */}
      <div className={styles.greetingRow}>
        <div>
          <h1 className={styles.greeting}>{greeting(user.name)}</h1>
          <p className={styles.greetingSub}>
            <FiCalendar size={13} />
            {todayLabel()}
          </p>
        </div>
        <button
          className={styles.syncBtn}
          onClick={() => void handleSync()}
          disabled={syncing}
        >
          <FiRefreshCw size={14} style={syncing ? { animation: 'spin 1s linear infinite' } : {}} />
          {syncing ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </div>

      {syncMsg && <div className={styles.syncMsg}>{syncMsg}</div>}

      {/* ── KPIs ── */}
      {statsLoading ? (
        <div className={styles.kpiSkeleton}>
          {[0, 1, 2, 3].map(i => <div key={i} className={styles.kpiSkeletonCard} />)}
        </div>
      ) : stats ? (
        <div className={styles.kpiRow}>
          <KpiCard
            icon={<FiShoppingCart size={20} />}
            label="Ventas hoy"
            value={fmt(stats.today.total)}
            sub={`${stats.today.tickets} ticket${stats.today.tickets !== 1 ? 's' : ''}`}
            accent="#5b79ff"
          />
          <KpiCard
            icon={<FiTrendingUp size={20} />}
            label="Ganancia hoy"
            value={fmt(stats.todayProfit)}
            sub={stats.today.total > 0 ? `${Math.round((stats.todayProfit / stats.today.total) * 100)}% margen` : undefined}
            accent="#22c55e"
          />
          <KpiCard
            icon={<FiShoppingCart size={20} />}
            label="Ventas esta semana"
            value={fmt(stats.week.total)}
            sub={`${stats.week.tickets} ticket${stats.week.tickets !== 1 ? 's' : ''}`}
            accent="#f7a558"
          />
          <KpiCard
            icon={<FiAlertTriangle size={20} />}
            label="Stock bajo / agotado"
            value={String(stats.lowStock)}
            sub={stats.lowStock > 0 ? 'clic para ver detalle' : 'todo en orden'}
            accent={stats.lowStock > 0 ? '#ef4444' : '#22c55e'}
            alert={stats.lowStock > 0}
            onClick={stats.lowStock > 0 ? () => setLowStockOpen(true) : undefined}
          />
        </div>
      ) : null}

      {/* ── Activity heatmap ── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>
            <FiPackage size={15} />
            Monitor de actividad — últimas 52 semanas
          </span>
        </div>
        {stats
          ? <Heatmap heatmap={stats.heatmap} />
          : <div className={styles.heatEmpty}>Cargando datos…</div>
        }
      </div>

      {/* ── Bottom row ── */}
      <div className={styles.bottomRow}>
        {/* Scanner */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Escáner rápido</span>
          </div>
          <div className={styles.scannerArea}>
            <div className={styles.codeBox}>
              <span className={styles.codeLabel}>Último código</span>
              <span className={styles.codeValue}>{lastCode || '—'}</span>
            </div>
            {product ? (
              <div className={styles.productInfo}>
                <div className={styles.productRow}>
                  <span className={styles.productLabel}>Nombre</span>
                  <span className={styles.productValue}>{product.name}</span>
                </div>
                <div className={styles.productRow}>
                  <span className={styles.productLabel}>SKU</span>
                  <span className={styles.productValue}>{product.sku}</span>
                </div>
                <div className={styles.productRow}>
                  <span className={styles.productLabel}>Precio</span>
                  <span className={styles.productValue}>{fmt(product.price)}</span>
                </div>
                <div className={styles.productRow}>
                  <span className={styles.productLabel}>Stock</span>
                  <span className={`${styles.productValue} ${product.stock <= 0 ? styles.stockOut : product.stock <= 5 ? styles.stockLow : ''}`}>
                    {product.stock} pzas
                  </span>
                </div>
              </div>
            ) : lastCode ? (
              <p className={styles.notFound}>Producto no encontrado</p>
            ) : (
              <p className={styles.scanHint}>Escanea un código de barras para consultar el producto.</p>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
