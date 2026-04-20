import { useState, useMemo, type JSX } from 'react'
import {
  FiSearch, FiDownload, FiPlus, FiTrendingUp, FiTrendingDown,
  FiAlertTriangle, FiPackage, FiDollarSign, FiBarChart2,
  FiActivity, FiArrowUp, FiArrowDown, FiEye, FiEdit2,
  FiX, FiFilter, FiBox, FiClock, FiShoppingBag,
  FiRefreshCw, FiChevronDown
} from 'react-icons/fi'
import styles from './InventoryPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'today' | 'week' | 'month'
type ChartMode = 'sales' | 'profit' | 'both'
type MoveType = 'entrada' | 'venta' | 'ajuste' | 'merma' | 'devolucion'
type StockStatus = 'ok' | 'low' | 'out'

type ChartPoint = { label: string; sales: number; profit: number }
type Movement = {
  id: number; date: string; time: string; product: string
  type: MoveType; qty: number; stockBefore: number; stockAfter: number
  user: string; note: string
}
type ProductRow = {
  id: number; name: string; sku: string; category: string
  stock: number; stockMin: number; stockMax: number
  cost: number; price: number; consumption: number
  lastMove: string; status: StockStatus
}
type AlertItem = { id: number; level: 'critical' | 'warning' | 'info'; message: string; product: string }

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const CHART_DATA: ChartPoint[] = [
  { label: 'L', sales: 3240, profit: 1180 },
  { label: 'M', sales: 2890, profit: 1040 },
  { label: 'X', sales: 4120, profit: 1490 },
  { label: 'J', sales: 3780, profit: 1360 },
  { label: 'V', sales: 5230, profit: 1920 },
  { label: 'S', sales: 6140, profit: 2280 },
  { label: 'H', sales: 2100, profit: 780 },
]

const MOVEMENTS: Movement[] = [
  { id: 1, date: '15 ene', time: '10:42', product: 'Pluma azul BIC', type: 'venta', qty: 5, stockBefore: 13, stockAfter: 8, user: 'Cajero 1', note: 'Venta #VTA-0091' },
  { id: 2, date: '15 ene', time: '09:15', product: 'Cuaderno profesional 100h', type: 'entrada', qty: 30, stockBefore: 18, stockAfter: 48, user: 'Admin', note: 'Compra proveedor' },
  { id: 3, date: '14 ene', time: '17:30', product: 'Lápiz HB #2', type: 'venta', qty: 12, stockBefore: 12, stockAfter: 0, user: 'Cajero 2', note: 'Venta #VTA-0088' },
  { id: 4, date: '14 ene', time: '15:20', product: 'Folder tamaño carta', type: 'venta', qty: 8, stockBefore: 42, stockAfter: 34, user: 'Cajero 1', note: 'Venta #VTA-0085' },
  { id: 5, date: '14 ene', time: '11:05', product: 'Cartulina blanca', type: 'ajuste', qty: 4, stockBefore: 10, stockAfter: 6, user: 'Admin', note: 'Conteo físico corregido' },
  { id: 6, date: '13 ene', time: '16:45', product: 'Tijeras escolares', type: 'merma', qty: 2, stockBefore: 6, stockAfter: 4, user: 'Admin', note: 'Defecto de fábrica' },
  { id: 7, date: '13 ene', time: '14:20', product: 'Marcador permanente negro', type: 'entrada', qty: 24, stockBefore: 0, stockAfter: 24, user: 'Admin', note: 'Compra proveedor' },
  { id: 8, date: '13 ene', time: '10:10', product: 'Cinta adhesiva (rollo)', type: 'venta', qty: 3, stockBefore: 31, stockAfter: 28, user: 'Cajero 1', note: 'Venta #VTA-0079' },
]

const PRODUCTS: ProductRow[] = [
  { id: 1,  name: 'Cuaderno profesional 100h', sku: 'CUA-100', category: 'Cuadernos',    stock: 48, stockMin: 20, stockMax: 100, cost: 1800,  price: 3500,  consumption: 23, lastMove: '15 ene', status: 'ok'  },
  { id: 2,  name: 'Pluma azul BIC (pza)',       sku: 'PLU-AZU', category: 'Escritura',    stock: 8,  stockMin: 50, stockMax: 200, cost: 200,   price: 500,   consumption: 87, lastMove: '15 ene', status: 'low' },
  { id: 3,  name: 'Lápiz HB #2 (pza)',          sku: 'LAP-HB2', category: 'Escritura',    stock: 0,  stockMin: 30, stockMax: 150, cost: 150,   price: 350,   consumption: 65, lastMove: '14 ene', status: 'out' },
  { id: 4,  name: 'Hojas blancas (resma 500)',  sku: 'HOJ-500', category: 'Papel',        stock: 22, stockMin: 10, stockMax: 50,  cost: 8500,  price: 13000, consumption: 12, lastMove: '14 ene', status: 'ok'  },
  { id: 5,  name: 'Cartulina blanca (pza)',      sku: 'CAR-BLA', category: 'Papel',        stock: 6,  stockMin: 15, stockMax: 60,  cost: 600,   price: 1200,  consumption: 18, lastMove: '14 ene', status: 'low' },
  { id: 6,  name: 'Folder tamaño carta (pza)',  sku: 'FOL-CAR', category: 'Organización', stock: 34, stockMin: 20, stockMax: 80,  cost: 400,   price: 800,   consumption: 31, lastMove: '14 ene', status: 'ok'  },
  { id: 7,  name: 'Pegamento en barra (pza)',   sku: 'PEG-BAR', category: 'Adhesivos',    stock: 15, stockMin: 10, stockMax: 40,  cost: 500,   price: 1200,  consumption: 9,  lastMove: '12 ene', status: 'ok'  },
  { id: 8,  name: 'Tijeras escolares (pza)',    sku: 'TIJ-ESC', category: 'Herramientas', stock: 4,  stockMin: 10, stockMax: 30,  cost: 1200,  price: 2500,  consumption: 7,  lastMove: '13 ene', status: 'low' },
  { id: 9,  name: 'Marcador permanente negro',  sku: 'MAR-NEG', category: 'Escritura',    stock: 24, stockMin: 15, stockMax: 60,  cost: 600,   price: 1500,  consumption: 14, lastMove: '13 ene', status: 'ok'  },
  { id: 10, name: 'Colores madera (caja 12)',   sku: 'COL-12C', category: 'Arte',         stock: 12, stockMin: 8,  stockMax: 40,  cost: 2200,  price: 4500,  consumption: 8,  lastMove: '14 ene', status: 'ok'  },
  { id: 11, name: 'Engrapadora escritorio',     sku: 'ENG-MED', category: 'Herramientas', stock: 3,  stockMin: 5,  stockMax: 15,  cost: 8000,  price: 18000, consumption: 2,  lastMove: '28 dic', status: 'low' },
  { id: 12, name: 'Cinta adhesiva (rollo)',     sku: 'CIN-TRA', category: 'Adhesivos',    stock: 28, stockMin: 15, stockMax: 60,  cost: 300,   price: 700,   consumption: 22, lastMove: '13 ene', status: 'ok'  },
]

const ALERTS: AlertItem[] = [
  { id: 1, level: 'critical', product: 'Pluma azul BIC',          message: 'Stock crítico — 8 uds (mínimo 50). Requiere reabastecimiento urgente.' },
  { id: 2, level: 'critical', product: 'Lápiz HB #2',             message: 'Sin existencias. Artículo agotado desde el 14 de enero.' },
  { id: 3, level: 'warning',  product: 'Cartulina blanca',         message: 'Stock bajo — 6 uds (mínimo 15). Considera reabastecer pronto.' },
  { id: 4, level: 'warning',  product: 'Tijeras escolares',        message: 'Stock bajo — 4 uds (mínimo 10). Última merma: 2 pzas defectuosas.' },
  { id: 5, level: 'warning',  product: 'Engrapadora escritorio',   message: 'Stock bajo — 3 uds (mínimo 5). Sin movimiento en 18 días.' },
  { id: 6, level: 'info',     product: 'Pluma azul BIC',           message: 'Consumo acelerado: 87 unidades vendidas esta semana (+40% vs semana anterior).' },
  { id: 7, level: 'info',     product: 'Cuaderno profesional 100h',message: 'Reabastecimiento reciente: +30 unidades ingresadas hoy por compra a proveedor.' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(centavos: number): string {
  return `$${(centavos / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtShort(pesos: number): string {
  if (pesos >= 1000) return `$${(pesos / 1000).toFixed(1)}k`
  return `$${pesos.toFixed(0)}`
}

function margin(cost: number, price: number): number {
  if (price === 0) return 0
  return Math.round(((price - cost) / price) * 100)
}

// ─── KpiCard ──────────────────────────────────────────────────────────────────

type KpiCardProps = { label: string; value: string; change: number; icon: JSX.Element; accent: string }

function KpiCard({ label, value, change, icon, accent }: KpiCardProps): JSX.Element {
  const up = change >= 0
  return (
    <div className={styles.kpiCard} style={{ borderTop: `3px solid ${accent}` }}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={styles.kpiIconWrap} style={{ background: `${accent}18`, color: accent }}>{icon}</span>
      </div>
      <div className={styles.kpiValue}>{value}</div>
      <div className={`${styles.kpiChange} ${up ? styles.kpiUp : styles.kpiDown}`}>
        {up ? <FiArrowUp size={10} /> : <FiArrowDown size={10} />}
        <span>{Math.abs(change)}% vs período anterior</span>
      </div>
    </div>
  )
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function MoveBadge({ type }: { type: MoveType }): JSX.Element {
  const map: Record<MoveType, string> = {
    entrada: 'Entrada', venta: 'Venta', ajuste: 'Ajuste', merma: 'Merma', devolucion: 'Devolución'
  }
  return <span className={`${styles.badge} ${styles[`move_${type}`]}`}>{map[type]}</span>
}

function StatusBadge({ status }: { status: StockStatus }): JSX.Element {
  const map: Record<StockStatus, [string, string]> = {
    ok:  ['Disponible', styles.statusOk],
    low: ['Stock bajo', styles.statusLow],
    out: ['Agotado',    styles.statusOut],
  }
  const [label, cls] = map[status]
  return <span className={`${styles.statusBadge} ${cls}`}>{label}</span>
}

// ─── BarChart (SVG) ───────────────────────────────────────────────────────────

function BarChart({ data, mode }: { data: ChartPoint[]; mode: ChartMode }): JSX.Element {
  const W = 520, H = 160, PL = 40, PR = 12, PT = 12, PB = 24
  const cW = W - PL - PR
  const cH = H - PT - PB
  const n = data.length
  const slotW = cW / n
  const bW = Math.floor(slotW * 0.52)
  const maxVal = Math.max(...data.flatMap(d =>
    mode === 'profit' ? [d.profit] : mode === 'sales' ? [d.sales] : [d.sales, d.profit]
  )) || 1

  const bH = (v: number) => (v / maxVal) * cH
  const bX = (i: number) => PL + i * slotW + (slotW - bW) / 2
  const bY = (v: number) => PT + cH - bH(v)

  const ticks = [0, 0.33, 0.66, 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg}>
      {ticks.map((f, i) => {
        const y = PT + cH * (1 - f)
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#edf0f8" strokeWidth="1" />
            {f > 0 && <text x={PL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="#9ca3af">{fmtShort(maxVal * f)}</text>}
          </g>
        )
      })}

      {data.map((d, i) => {
        const isToday = i === data.length - 1
        const x = bX(i)
        const half = Math.floor(bW * 0.46)
        return (
          <g key={i}>
            {(mode === 'sales' || mode === 'both') && (
              <rect x={mode === 'both' ? x : x} y={bY(d.sales)}
                width={mode === 'both' ? half : bW} height={Math.max(2, bH(d.sales))}
                rx="3" fill={isToday ? '#818cf8' : '#4f6ef7'} opacity="0.88" />
            )}
            {(mode === 'profit' || mode === 'both') && (
              <rect x={mode === 'both' ? x + half + 2 : x} y={bY(d.profit)}
                width={mode === 'both' ? half : bW} height={Math.max(2, bH(d.profit))}
                rx="3" fill={isToday ? '#6ee7b7' : '#10b981'} opacity="0.88" />
            )}
            <text x={x + bW / 2} y={H - 6} textAnchor="middle" fontSize="9"
              fill={isToday ? '#4f6ef7' : '#9ca3af'} fontWeight={isToday ? 700 : 400}>
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InventoryPage(): JSX.Element {
  const [period, setPeriod] = useState<Period>('week')
  const [chartMode, setChartMode] = useState<ChartMode>('both')
  const [search, setSearch] = useState('')
  const [moveFilter, setMoveFilter] = useState<MoveType | 'all'>('all')
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null)

  // KPI values keyed by period
  const kpiRows = useMemo((): KpiCardProps[] => {
    const byPeriod: Record<Period, KpiCardProps[]> = {
      today: [
        { label: 'Ventas hoy',          value: '$2,100.00',  change: 8.3,   icon: <FiShoppingBag size={16} />, accent: '#4f6ef7' },
        { label: 'Ganancia hoy',         value: '$780.00',    change: 6.1,   icon: <FiDollarSign size={16} />,  accent: '#10b981' },
        { label: 'Costo mercancía hoy',  value: '$1,320.00',  change: 9.0,   icon: <FiBox size={16} />,         accent: '#f59e0b' },
        { label: 'Margen promedio hoy',  value: '37.1%',      change: -1.4,  icon: <FiBarChart2 size={16} />,   accent: '#8b5cf6' },
        { label: 'Tickets del día',      value: '14',         change: 16.7,  icon: <FiActivity size={16} />,    accent: '#06b6d4' },
        { label: 'Unidades vendidas',    value: '38',         change: 5.6,   icon: <FiPackage size={16} />,     accent: '#ec4899' },
        { label: 'Productos stock bajo', value: '4',          change: 0,     icon: <FiAlertTriangle size={16}/>,accent: '#ef4444' },
        { label: 'Movimientos hoy',      value: '12',         change: 33.3,  icon: <FiRefreshCw size={16} />,   accent: '#64748b' },
      ],
      week: [
        { label: 'Ventas semana',        value: '$24,530.00', change: 12.1,  icon: <FiShoppingBag size={16} />, accent: '#4f6ef7' },
        { label: 'Ganancia semana',      value: '$8,940.00',  change: 9.8,   icon: <FiDollarSign size={16} />,  accent: '#10b981' },
        { label: 'Costo mercancía',      value: '$15,590.00', change: 13.8,  icon: <FiBox size={16} />,         accent: '#f59e0b' },
        { label: 'Margen promedio',      value: '36.4%',      change: -1.1,  icon: <FiBarChart2 size={16} />,   accent: '#8b5cf6' },
        { label: 'Tickets semana',       value: '81',         change: 8.0,   icon: <FiActivity size={16} />,    accent: '#06b6d4' },
        { label: 'Unidades vendidas',    value: '214',        change: 10.2,  icon: <FiPackage size={16} />,     accent: '#ec4899' },
        { label: 'Productos stock bajo', value: '4',          change: 33.3,  icon: <FiAlertTriangle size={16}/>,accent: '#ef4444' },
        { label: 'Movimientos semana',   value: '47',         change: 4.4,   icon: <FiRefreshCw size={16} />,   accent: '#64748b' },
      ],
      month: [
        { label: 'Ventas mes',           value: '$98,450.00', change: 4.7,   icon: <FiShoppingBag size={16} />, accent: '#4f6ef7' },
        { label: 'Ganancia mes',         value: '$36,210.00', change: 3.2,   icon: <FiDollarSign size={16} />,  accent: '#10b981' },
        { label: 'Costo mercancía',      value: '$62,240.00', change: 5.7,   icon: <FiBox size={16} />,         accent: '#f59e0b' },
        { label: 'Margen promedio',      value: '36.8%',      change: -0.6,  icon: <FiBarChart2 size={16} />,   accent: '#8b5cf6' },
        { label: 'Tickets mes',          value: '312',        change: 2.6,   icon: <FiActivity size={16} />,    accent: '#06b6d4' },
        { label: 'Unidades vendidas',    value: '841',        change: 6.3,   icon: <FiPackage size={16} />,     accent: '#ec4899' },
        { label: 'Productos stock bajo', value: '4',          change: 33.3,  icon: <FiAlertTriangle size={16}/>,accent: '#ef4444' },
        { label: 'Movimientos mes',      value: '184',        change: -6.1,  icon: <FiRefreshCw size={16} />,   accent: '#64748b' },
      ],
    }
    return byPeriod[period]
  }, [period])

  const filteredMovements = useMemo(() =>
    MOVEMENTS.filter(m => moveFilter === 'all' || m.type === moveFilter),
    [moveFilter]
  )

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return PRODUCTS
    return PRODUCTS.filter(p =>
      p.name.toLowerCase().includes(term) ||
      p.sku.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term)
    )
  }, [search])

  const statusCounts = useMemo(() => ({
    total: PRODUCTS.length,
    ok:  PRODUCTS.filter(p => p.status === 'ok').length,
    low: PRODUCTS.filter(p => p.status === 'low').length,
    out: PRODUCTS.filter(p => p.status === 'out').length,
  }), [])

  const consumption = useMemo(() => {
    const sorted = [...PRODUCTS].sort((a, b) => b.consumption - a.consumption).slice(0, 8)
    const max = sorted[0]?.consumption || 1
    return sorted.map(p => ({ name: p.name, units: p.consumption, pct: Math.round((p.consumption / max) * 100) }))
  }, [])

  const moveSummary = useMemo(() => ({
    entradas:   MOVEMENTS.filter(m => m.type === 'entrada').length,
    ventas:     MOVEMENTS.filter(m => m.type === 'venta').length,
    ajustes:    MOVEMENTS.filter(m => m.type === 'ajuste').length,
    mermas:     MOVEMENTS.filter(m => m.type === 'merma').length,
  }), [])

  return (
    <section className={styles.page}>
      <div className={styles.panel}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.heading}>Panel de inventario</h2>
            <p className={styles.subheading}>Control, análisis y movimientos del almacén</p>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.searchBox}>
              <FiSearch size={14} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                placeholder="Buscar producto, SKU o código…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className={styles.periodTabs}>
              {(['today', 'week', 'month'] as Period[]).map(p => (
                <button key={p} type="button"
                  className={`${styles.periodTab} ${period === p ? styles.periodTabActive : ''}`}
                  onClick={() => setPeriod(p)}>
                  {p === 'today' ? 'Hoy' : p === 'week' ? 'Semana' : 'Mes'}
                </button>
              ))}
            </div>
            <button type="button" className={styles.btnOutline}><FiDownload size={14} /> Exportar</button>
            <button type="button" className={styles.btnPrimary}><FiPlus size={14} /> Nuevo movimiento</button>
          </div>
        </div>

        {/* ── Scroll area ────────────────────────────────────── */}
        <div className={styles.scroll}>

          {/* ── KPIs ─────────────────────────────────────────── */}
          <div className={styles.kpiGrid}>
            {kpiRows.map((k, i) => <KpiCard key={i} {...k} />)}
          </div>

          {/* ── Analytics + Movement summary ─────────────────── */}
          <div className={styles.analyticsRow}>

            {/* Chart card */}
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.cardTitle}>Ventas y ganancias</div>
                  <div className={styles.cardSub}>Últimos 7 días</div>
                </div>
                <div className={styles.chartTabs}>
                  {(['both', 'sales', 'profit'] as ChartMode[]).map(m => (
                    <button key={m} type="button"
                      className={`${styles.chartTab} ${chartMode === m ? styles.chartTabActive : ''}`}
                      onClick={() => setChartMode(m)}>
                      {m === 'both' ? 'Ambos' : m === 'sales' ? 'Ventas' : 'Ganancia'}
                    </button>
                  ))}
                </div>
              </div>
              <BarChart data={CHART_DATA} mode={chartMode} />
              {chartMode !== 'profit' && (
                <div className={styles.chartLegend}>
                  <span className={styles.legendDot} style={{ background: '#4f6ef7' }} /> Ventas
                  {chartMode === 'both' && <><span className={styles.legendDot} style={{ background: '#10b981' }} /> Ganancia</>}
                </div>
              )}
              {chartMode === 'profit' && (
                <div className={styles.chartLegend}>
                  <span className={styles.legendDot} style={{ background: '#10b981' }} /> Ganancia
                </div>
              )}
            </div>

            {/* Movement summary */}
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>Resumen de movimientos</div>
                <div className={styles.cardSub}>Semana actual</div>
              </div>
              <div className={styles.moveSummaryGrid}>
                <div className={`${styles.moveSummaryCard} ${styles.moveCardEntrada}`}>
                  <FiArrowDown size={18} />
                  <div className={styles.moveSummaryVal}>{moveSummary.entradas}</div>
                  <div className={styles.moveSummaryLabel}>Entradas</div>
                </div>
                <div className={`${styles.moveSummaryCard} ${styles.moveCardVenta}`}>
                  <FiShoppingBag size={18} />
                  <div className={styles.moveSummaryVal}>{moveSummary.ventas}</div>
                  <div className={styles.moveSummaryLabel}>Ventas</div>
                </div>
                <div className={`${styles.moveSummaryCard} ${styles.moveCardAjuste}`}>
                  <FiRefreshCw size={18} />
                  <div className={styles.moveSummaryVal}>{moveSummary.ajustes}</div>
                  <div className={styles.moveSummaryLabel}>Ajustes</div>
                </div>
                <div className={`${styles.moveSummaryCard} ${styles.moveCardMerma}`}>
                  <FiAlertTriangle size={18} />
                  <div className={styles.moveSummaryVal}>{moveSummary.mermas}</div>
                  <div className={styles.moveSummaryLabel}>Mermas</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Recent movements table ────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Movimientos recientes</div>
                <div className={styles.cardSub}>{filteredMovements.length} registros</div>
              </div>
              <div className={styles.moveFilterRow}>
                <FiFilter size={13} style={{ color: '#9ca3af' }} />
                {(['all', 'entrada', 'venta', 'ajuste', 'merma'] as const).map(t => (
                  <button key={t} type="button"
                    className={`${styles.moveFilterBtn} ${moveFilter === t ? styles.moveFilterActive : ''}`}
                    onClick={() => setMoveFilter(t)}>
                    {t === 'all' ? 'Todos' : t === 'entrada' ? 'Entradas' : t === 'venta' ? 'Ventas' : t === 'ajuste' ? 'Ajustes' : 'Mermas'}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.tableWrap}>
              <div className={`${styles.tableRow} ${styles.tableHead}`}>
                <div>Fecha</div><div>Producto</div><div>Tipo</div>
                <div className={styles.tCenter}>Cant.</div>
                <div className={styles.tCenter}>Antes</div>
                <div className={styles.tCenter}>Después</div>
                <div>Usuario</div><div>Nota</div>
              </div>
              {filteredMovements.map(m => (
                <div key={m.id} className={styles.tableRow}>
                  <div className={styles.cellDate}><span>{m.date}</span><span className={styles.cellTime}>{m.time}</span></div>
                  <div className={styles.cellName}>{m.product}</div>
                  <div><MoveBadge type={m.type} /></div>
                  <div className={`${styles.tCenter} ${m.type === 'entrada' ? styles.qtyIn : styles.qtyOut}`}>
                    {m.type === 'entrada' ? '+' : '-'}{m.qty}
                  </div>
                  <div className={`${styles.tCenter} ${styles.muted}`}>{m.stockBefore}</div>
                  <div className={`${styles.tCenter} ${styles.muted}`}>{m.stockAfter}</div>
                  <div className={styles.muted}>{m.user}</div>
                  <div className={`${styles.muted} ${styles.cellNote}`}>{m.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Consumption + Inventory status ───────────────── */}
          <div className={styles.twoColRow}>

            {/* Consumption */}
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.cardTitle}>Consumo de productos</div>
                  <div className={styles.cardSub}>Últimos 30 días · top 8</div>
                </div>
                <FiTrendingUp size={16} style={{ color: '#4f6ef7' }} />
              </div>
              <div className={styles.consumList}>
                {consumption.map((c, i) => (
                  <div key={i} className={styles.consumRow}>
                    <span className={styles.consumRank}>{i + 1}</span>
                    <div className={styles.consumInfo}>
                      <div className={styles.consumName}>{c.name}</div>
                      <div className={styles.consumTrack}>
                        <div className={styles.consumFill} style={{ width: `${c.pct}%` }} />
                      </div>
                    </div>
                    <span className={styles.consumUnits}>{c.units} uds</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Inventory status */}
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.cardTitle}>Estado del inventario</div>
                  <div className={styles.cardSub}>{statusCounts.total} productos registrados</div>
                </div>
                <FiPackage size={16} style={{ color: '#4f6ef7' }} />
              </div>

              <div className={styles.statusStat}>
                <div className={styles.statusStatItem}>
                  <span className={styles.statusBigVal} style={{ color: '#10b981' }}>{statusCounts.ok}</span>
                  <span className={styles.statusStatLabel}>Disponibles</span>
                </div>
                <div className={styles.statusStatItem}>
                  <span className={styles.statusBigVal} style={{ color: '#f59e0b' }}>{statusCounts.low}</span>
                  <span className={styles.statusStatLabel}>Stock bajo</span>
                </div>
                <div className={styles.statusStatItem}>
                  <span className={styles.statusBigVal} style={{ color: '#ef4444' }}>{statusCounts.out}</span>
                  <span className={styles.statusStatLabel}>Agotados</span>
                </div>
              </div>

              {/* Visual bar distribution */}
              <div className={styles.statusBar}>
                <div className={styles.statusBarOk}
                  style={{ flex: statusCounts.ok }}
                  title={`${statusCounts.ok} disponibles`} />
                <div className={styles.statusBarLow}
                  style={{ flex: statusCounts.low }}
                  title={`${statusCounts.low} stock bajo`} />
                <div className={styles.statusBarOut}
                  style={{ flex: Math.max(statusCounts.out, 0.3) }}
                  title={`${statusCounts.out} agotados`} />
              </div>
              <div className={styles.statusBarLabels}>
                <span style={{ color: '#10b981' }}>Disponible {Math.round((statusCounts.ok / statusCounts.total) * 100)}%</span>
                <span style={{ color: '#f59e0b' }}>Bajo {Math.round((statusCounts.low / statusCounts.total) * 100)}%</span>
                <span style={{ color: '#ef4444' }}>Agotado {Math.round((statusCounts.out / statusCounts.total) * 100)}%</span>
              </div>

              <div className={styles.statusList}>
                {PRODUCTS.filter(p => p.status !== 'ok').map(p => (
                  <div key={p.id} className={styles.statusListItem}>
                    <StatusBadge status={p.status} />
                    <span className={styles.statusListName}>{p.name}</span>
                    <span className={styles.statusListStock}>{p.stock} uds</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Products table ────────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Productos en inventario</div>
                <div className={styles.cardSub}>{filteredProducts.length} de {PRODUCTS.length} productos</div>
              </div>
              <div className={styles.tableActions}>
                <button type="button" className={styles.btnOutline}><FiFilter size={13} /> Filtros</button>
                <button type="button" className={styles.btnOutline}><FiChevronDown size={13} /> Categoría</button>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <div className={`${styles.productRow} ${styles.tableHead}`}>
                <div>Producto</div><div>SKU</div><div>Categoría</div>
                <div className={styles.tCenter}>Stock</div>
                <div className={styles.tCenter}>Mínimo</div>
                <div>Costo</div><div>Precio</div>
                <div className={styles.tCenter}>Margen</div>
                <div className={styles.tCenter}>Consumo</div>
                <div>Último mov.</div>
                <div>Estado</div>
                <div />
              </div>
              {filteredProducts.map(p => (
                <div key={p.id} className={`${styles.productRow} ${p.status === 'out' ? styles.rowOut : p.status === 'low' ? styles.rowLow : ''}`}>
                  <div className={styles.cellName}>{p.name}</div>
                  <div className={styles.cellSku}>{p.sku}</div>
                  <div className={styles.muted}>{p.category}</div>
                  <div className={`${styles.tCenter} ${p.status === 'out' ? styles.stockZero : p.status === 'low' ? styles.stockLow : styles.stockOk}`}>
                    {p.stock}
                  </div>
                  <div className={`${styles.tCenter} ${styles.muted}`}>{p.stockMin}</div>
                  <div className={styles.muted}>{fmt(p.cost)}</div>
                  <div>{fmt(p.price)}</div>
                  <div className={styles.tCenter}>
                    <span className={styles.marginBadge}>{margin(p.cost, p.price)}%</span>
                  </div>
                  <div className={`${styles.tCenter} ${styles.muted}`}>{p.consumption}</div>
                  <div className={styles.muted}>{p.lastMove}</div>
                  <div><StatusBadge status={p.status} /></div>
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.rowBtn} title="Ver detalle" onClick={() => setSelectedProduct(p)}>
                      <FiEye size={13} />
                    </button>
                    <button type="button" className={styles.rowBtn} title="Editar">
                      <FiEdit2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Alerts ───────────────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Alertas e insights</div>
                <div className={styles.cardSub}>{ALERTS.length} avisos activos</div>
              </div>
              <FiAlertTriangle size={16} style={{ color: '#f59e0b' }} />
            </div>
            <div className={styles.alertList}>
              {ALERTS.map(a => (
                <div key={a.id} className={`${styles.alertItem} ${styles[`alert_${a.level}`]}`}>
                  <div className={styles.alertDot} />
                  <div className={styles.alertBody}>
                    <span className={styles.alertProduct}>{a.product}</span>
                    <span className={styles.alertMsg}>{a.message}</span>
                  </div>
                  {a.level === 'critical' && <span className={styles.alertTag}>Urgente</span>}
                  {a.level === 'warning' && <span className={styles.alertTagWarn}>Atención</span>}
                </div>
              ))}
            </div>
          </div>

        </div>{/* end .scroll */}
      </div>{/* end .panel */}

      {/* ── Product Detail Drawer ─────────────────────────── */}
      {selectedProduct && (
        <div className={styles.drawerBackdrop} onClick={() => setSelectedProduct(null)}>
          <div className={styles.drawer} onClick={e => e.stopPropagation()}>
            <div className={styles.drawerHead}>
              <div>
                <div className={styles.drawerTitle}>{selectedProduct.name}</div>
                <div className={styles.drawerSku}>{selectedProduct.sku} · {selectedProduct.category}</div>
              </div>
              <button type="button" className={styles.drawerClose} onClick={() => setSelectedProduct(null)}>
                <FiX size={18} />
              </button>
            </div>

            <StatusBadge status={selectedProduct.status} />

            <div className={styles.drawerGrid}>
              <div className={styles.drawerStat}>
                <div className={styles.drawerStatLabel}>Stock actual</div>
                <div className={`${styles.drawerStatVal} ${selectedProduct.status === 'out' ? styles.stockZero : selectedProduct.status === 'low' ? styles.stockLow : styles.stockOk}`}>
                  {selectedProduct.stock} uds
                </div>
              </div>
              <div className={styles.drawerStat}>
                <div className={styles.drawerStatLabel}>Stock mínimo</div>
                <div className={styles.drawerStatVal}>{selectedProduct.stockMin} uds</div>
              </div>
              <div className={styles.drawerStat}>
                <div className={styles.drawerStatLabel}>Stock máximo</div>
                <div className={styles.drawerStatVal}>{selectedProduct.stockMax} uds</div>
              </div>
              <div className={styles.drawerStat}>
                <div className={styles.drawerStatLabel}>Costo unitario</div>
                <div className={styles.drawerStatVal}>{fmt(selectedProduct.cost)}</div>
              </div>
              <div className={styles.drawerStat}>
                <div className={styles.drawerStatLabel}>Precio de venta</div>
                <div className={styles.drawerStatVal}>{fmt(selectedProduct.price)}</div>
              </div>
              <div className={styles.drawerStat}>
                <div className={styles.drawerStatLabel}>Margen estimado</div>
                <div className={styles.drawerStatVal} style={{ color: '#10b981' }}>
                  {margin(selectedProduct.cost, selectedProduct.price)}%
                </div>
              </div>
            </div>

            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Consumo (últimos 30 días)</div>
              <div className={styles.drawerConsum}>
                <div className={styles.drawerConsumVal}>{selectedProduct.consumption}</div>
                <span className={styles.muted}>unidades vendidas</span>
              </div>
              <div className={styles.drawerTrack}>
                <div className={styles.drawerTrackFill}
                  style={{ width: `${Math.round((selectedProduct.consumption / 87) * 100)}%` }} />
              </div>
            </div>

            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Movimientos recientes</div>
              {MOVEMENTS.filter(m => m.product.toLowerCase().includes(selectedProduct.name.toLowerCase().split(' ')[0])).slice(0, 3).map(m => (
                <div key={m.id} className={styles.drawerMoveRow}>
                  <MoveBadge type={m.type} />
                  <span className={styles.muted}>{m.date} {m.time}</span>
                  <span className={`${m.type === 'entrada' ? styles.qtyIn : styles.qtyOut}`}>
                    {m.type === 'entrada' ? '+' : '-'}{m.qty} uds
                  </span>
                </div>
              ))}
              {MOVEMENTS.filter(m => m.product.toLowerCase().includes(selectedProduct.name.toLowerCase().split(' ')[0])).length === 0 && (
                <p className={styles.muted}>Sin movimientos recientes registrados.</p>
              )}
            </div>

            {selectedProduct.status !== 'ok' && (
              <div className={styles.drawerAlert}>
                <FiAlertTriangle size={14} />
                <span>
                  {selectedProduct.status === 'out'
                    ? 'Producto agotado. Requiere reabastecimiento urgente.'
                    : `Stock por debajo del mínimo (${selectedProduct.stockMin} uds). Considera reabastecer.`}
                </span>
              </div>
            )}

            <div className={styles.drawerFooter}>
              <button type="button" className={styles.btnOutline}><FiEdit2 size={13} /> Editar producto</button>
              <button type="button" className={styles.btnPrimary}><FiPlus size={13} /> Registrar movimiento</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
