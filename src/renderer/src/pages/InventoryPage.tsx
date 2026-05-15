import { useEffect, useMemo, useState, type JSX } from 'react'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import {
  FiSearch,
  FiPlus,
  FiTrendingUp,
  FiAlertTriangle,
  FiPackage,
  FiDollarSign,
  FiBarChart2,
  FiActivity,
  FiArrowUp,
  FiArrowDown,
  FiEye,
  FiX,
  FiFilter,
  FiBox,
  FiShoppingBag,
  FiRefreshCw,
  FiChevronDown,
  FiSave
} from 'react-icons/fi'
import styles from './InventoryPage.module.css'
import { formatMXN } from '../lib/formatters'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'today' | 'week' | 'month'
type ChartMode = 'sales' | 'profit' | 'both'
type MoveType = 'entrada' | 'venta' | 'ajuste' | 'merma' | 'devolucion'
type StockStatus = 'ok' | 'low' | 'out'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (centavos: number): string => formatMXN(centavos)

function fmtShort(centavos: number): string {
  const pesos = centavos / 100
  if (pesos >= 1_000_000) return `$${(pesos / 1_000_000).toFixed(1)}M`
  if (pesos >= 1_000) return `$${(pesos / 1_000).toFixed(1)}k`
  return `$${pesos.toFixed(0)}`
}

function margin(cost: number, price: number): number {
  if (price === 0) return 0
  return Math.round(((price - cost) / price) * 100)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type KpiCardProps = {
  label: string
  value: string
  change: number
  icon: JSX.Element
  accent: string
  onClick?: () => void
}

function KpiCard({ label, value, change, icon, accent, onClick }: KpiCardProps): JSX.Element {
  const up = change >= 0
  return (
    <div
      className={`${styles.kpiCard} ${onClick ? styles.kpiClickable : ''}`}
      style={{ borderTop: `3px solid ${accent}` }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={styles.kpiTop}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={styles.kpiIconWrap} style={{ background: `${accent}18`, color: accent }}>
          {icon}
        </span>
      </div>
      <div className={styles.kpiValue}>{value}</div>
      <div className={`${styles.kpiChange} ${up ? styles.kpiUp : styles.kpiDown}`}>
        {up ? <FiArrowUp size={10} /> : <FiArrowDown size={10} />}
        <span>{Math.abs(change)}% vs período anterior</span>
      </div>
    </div>
  )
}

// ─── Low Stock Modal ──────────────────────────────────────────────────────────

function LowStockModal({
  products,
  onClose
}: {
  products: InventoryProduct[]
  onClose: () => void
}): JSX.Element {
  const items = products.filter((p) => p.status !== 'ok')

  return (
    <div className={styles.moveOverlay} onClick={onClose}>
      <div className={styles.lsModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.moveModalHead}>
          <div className={styles.moveModalTitle}>
            <FiAlertTriangle size={16} />
            Productos con stock bajo o agotado ({items.length})
          </div>
          <button className={styles.drawerClose} onClick={onClose}>
            <FiX size={16} />
          </button>
        </div>
        <div className={styles.lsBody}>
          {items.length === 0 ? (
            <div className={styles.lsEmpty}>Todos los productos tienen stock suficiente.</div>
          ) : (
            <table className={styles.lsTable}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th className={styles.lsCenter}>Stock</th>
                  <th className={styles.lsCenter}>Mínimo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className={styles.lsSku}>{p.sku}</td>
                    <td
                      className={`${styles.lsCenter} ${p.status === 'out' ? styles.lsStockOut : styles.lsStockLow}`}
                    >
                      {p.stock}
                    </td>
                    <td className={`${styles.lsCenter} ${styles.muted}`}>{p.stockMin}</td>
                    <td>
                      <span
                        className={`${styles.lsBadge} ${p.status === 'out' ? styles.lsBadgeOut : styles.lsBadgeLow}`}
                      >
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

function MoveBadge({ type }: { type: MoveType }): JSX.Element {
  const map: Record<MoveType, string> = {
    entrada: 'Entrada',
    venta: 'Venta',
    ajuste: 'Ajuste',
    merma: 'Merma',
    devolucion: 'Devolución'
  }
  return <span className={`${styles.badge} ${styles[`move_${type}`]}`}>{map[type]}</span>
}

function StatusBadge({ status }: { status: StockStatus }): JSX.Element {
  const map: Record<StockStatus, [string, string]> = {
    ok: ['Disponible', styles.statusOk],
    low: ['Stock bajo', styles.statusLow],
    out: ['Agotado', styles.statusOut]
  }
  const [label, cls] = map[status]
  return <span className={`${styles.statusBadge} ${cls}`}>{label}</span>
}

function BarChart({ data, mode }: { data: InventoryChartPoint[]; mode: ChartMode }): JSX.Element {
  const W = 520,
    H = 160,
    PL = 40,
    PR = 12,
    PT = 12,
    PB = 24
  const cW = W - PL - PR
  const cH = H - PT - PB
  const n = data.length || 1
  const slotW = cW / n
  const bW = Math.floor(slotW * 0.52)
  const maxVal = Math.max(
    ...data.flatMap((d) =>
      mode === 'profit' ? [d.profit] : mode === 'sales' ? [d.sales] : [d.sales, d.profit]
    ),
    1
  )
  const bH = (v: number): number => (v / maxVal) * cH
  const bX = (i: number): number => PL + i * slotW + (slotW - bW) / 2
  const bY = (v: number): number => PT + cH - bH(v)
  const ticks = [0, 0.33, 0.66, 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg}>
      {ticks.map((f, i) => {
        const y = PT + cH * (1 - f)
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#edf0f8" strokeWidth="1" />
            {f > 0 && (
              <text x={PL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="#9ca3af">
                {fmtShort(maxVal * f)}
              </text>
            )}
          </g>
        )
      })}
      {data.map((d, i) => {
        const isLast = i === data.length - 1
        const x = bX(i)
        const half = Math.floor(bW * 0.46)
        return (
          <g key={i}>
            {(mode === 'sales' || mode === 'both') && (
              <rect
                x={mode === 'both' ? x : x}
                y={bY(d.sales)}
                width={mode === 'both' ? half : bW}
                height={Math.max(2, bH(d.sales))}
                rx="3"
                fill={isLast ? '#818cf8' : '#4f6ef7'}
                opacity="0.88"
              />
            )}
            {(mode === 'profit' || mode === 'both') && (
              <rect
                x={mode === 'both' ? x + half + 2 : x}
                y={bY(d.profit)}
                width={mode === 'both' ? half : bW}
                height={Math.max(2, bH(d.profit))}
                rx="3"
                fill={isLast ? '#6ee7b7' : '#10b981'}
                opacity="0.88"
              />
            )}
            <text
              x={x + bW / 2}
              y={H - 6}
              textAnchor="middle"
              fontSize="10"
              fill={isLast ? '#4f6ef7' : '#9ca3af'}
              fontWeight={isLast ? 700 : 400}
            >
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Movement modal ───────────────────────────────────────────────────────────

const MOVE_TYPES = [
  { value: 'entrada', label: 'Entrada', sub: 'Reabastecimiento / compra' },
  { value: 'ajuste', label: 'Ajuste', sub: 'Conteo físico / corrección' },
  { value: 'merma', label: 'Merma', sub: 'Daño o pérdida' },
  { value: 'devolucion', label: 'Devolución', sub: 'Regreso de cliente' }
] as const

type MovementModalProps = {
  products: InventoryProduct[]
  userId: number
  onClose: () => void
  onSaved: () => void
}

function MovementModal({ products, userId, onClose, onSaved }: MovementModalProps): JSX.Element {
  const [search, setSearch] = useState('')
  const [productId, setProductId] = useState<number | null>(null)
  const [type, setType] = useState<'entrada' | 'ajuste' | 'merma' | 'devolucion'>('entrada')
  const [qty, setQty] = useState(1)
  const [realQty, setRealQty] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    )
  }, [products, search])

  const selected = products.find((p) => p.id === productId) ?? null

  // Preview for ajuste
  const isAjuste = type === 'ajuste'
  const realQtyNum = typeof realQty === 'number' ? realQty : NaN
  const ajusteDelta = selected && !isNaN(realQtyNum) ? realQtyNum - selected.stock : null

  async function handleSave(): Promise<void> {
    if (!productId) {
      setError('Selecciona un producto.')
      return
    }
    if (isAjuste) {
      if (realQty === '' || isNaN(realQtyNum) || realQtyNum < 0) {
        setError('Ingresa la cantidad real en inventario (mínimo 0).')
        return
      }
    } else if (qty < 1) {
      setError('La cantidad debe ser mayor a 0.')
      return
    }
    try {
      setSaving(true)
      await window.pos.inventory.registerMovement({
        productId,
        type,
        qty,
        ...(isAjuste ? { realQty: realQtyNum } : {}),
        userId,
        note: note.trim() || undefined
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al registrar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.moveOverlay} onClick={onClose}>
      <div className={styles.moveModal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.moveModalHead}>
          <div className={styles.moveModalTitle}>
            <FiPlus size={17} />
            Nuevo movimiento
          </div>
          <button type="button" className={styles.drawerClose} onClick={onClose}>
            <FiX size={17} />
          </button>
        </div>

        <div className={styles.moveModalBody}>
          {/* Left: product picker */}
          <div className={styles.movePickerCol}>
            <div className={styles.movePickerLabel}>Producto</div>

            {/* Search */}
            <div className={styles.moveSearchWrap}>
              <FiSearch size={14} className={styles.moveSearchIcon} />
              <input
                className={styles.moveSearchInput}
                placeholder="Buscar por nombre o SKU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button className={styles.moveSearchClear} onClick={() => setSearch('')}>
                  <FiX size={12} />
                </button>
              )}
            </div>

            {/* Product list */}
            <div className={styles.moveProductList}>
              {filtered.length === 0 ? (
                <div className={styles.moveNoResults}>Sin resultados</div>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.moveProductItem} ${productId === p.id ? styles.moveProductItemActive : ''}`}
                    onClick={() => setProductId(p.id)}
                  >
                    <div className={styles.moveProductName}>{p.name}</div>
                    <div className={styles.moveProductMeta}>
                      <span className={styles.moveProductSku}>{p.sku}</span>
                      <span
                        className={`${styles.moveProductStock} ${p.status === 'out' ? styles.moveStockOut : p.status === 'low' ? styles.moveStockLow : styles.moveStockOk}`}
                      >
                        {p.stock} uds
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: form */}
          <div className={styles.moveFormCol}>
            {/* Selected product chip */}
            <div className={styles.moveSelectedChip}>
              {selected ? (
                <>
                  <span className={styles.moveSelectedName}>{selected.name}</span>
                  <span
                    className={`${styles.moveSelectedStock} ${selected.status === 'out' ? styles.moveStockOut : selected.status === 'low' ? styles.moveStockLow : styles.moveStockOk}`}
                  >
                    Stock: {selected.stock}
                  </span>
                </>
              ) : (
                <span className={styles.moveSelectHint}>← Selecciona un producto</span>
              )}
            </div>

            {/* Type */}
            <div className={styles.moveFieldLabel}>Tipo de movimiento</div>
            <div className={styles.moveTypeGrid}>
              {MOVE_TYPES.map((mt) => (
                <button
                  key={mt.value}
                  type="button"
                  className={`${styles.moveTypeBtn} ${type === mt.value ? styles.moveTypeBtnActive : ''}`}
                  onClick={() => setType(mt.value)}
                  disabled={saving}
                >
                  <span className={styles.moveTypeBtnLabel}>{mt.label}</span>
                  <span className={styles.moveTypeBtnSub}>{mt.sub}</span>
                </button>
              ))}
            </div>

            {/* Qty */}
            {isAjuste ? (
              <>
                <div className={styles.moveFieldLabel}>Cantidad real en inventario</div>
                <div className={styles.moveQtyWrap}>
                  <input
                    type="number"
                    min={0}
                    value={realQty}
                    placeholder={selected ? String(selected.stock) : '0'}
                    onChange={(e) =>
                      setRealQty(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                    }
                    onFocus={(e) => e.target.select()}
                    disabled={saving}
                    className={`${styles.moveQtyInput} ${styles.moveQtyInputFull}`}
                  />
                </div>
                {selected && ajusteDelta !== null && !isNaN(ajusteDelta) && (
                  <div
                    className={`${styles.ajustePreview} ${ajusteDelta > 0 ? styles.ajustePos : ajusteDelta < 0 ? styles.ajusteNeg : styles.ajusteEqual}`}
                  >
                    <span>
                      Stock actual: <strong>{selected.stock}</strong>
                    </span>
                    <span>→</span>
                    <span>
                      Nuevo stock: <strong>{realQtyNum}</strong>
                    </span>
                    <span className={styles.ajusteDelta}>
                      {ajusteDelta > 0
                        ? `+${ajusteDelta}`
                        : ajusteDelta < 0
                          ? `${ajusteDelta}`
                          : 'Sin cambio'}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.moveFieldLabel}>Cantidad</div>
                <div className={styles.moveQtyWrap}>
                  <button
                    type="button"
                    className={styles.moveQtyBtn}
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={saving}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                    disabled={saving}
                    className={styles.moveQtyInput}
                  />
                  <button
                    type="button"
                    className={styles.moveQtyBtn}
                    onClick={() => setQty((q) => q + 1)}
                    disabled={saving}
                  >
                    +
                  </button>
                </div>
              </>
            )}

            {/* Note */}
            <div className={styles.moveFieldLabel}>
              Nota <span className={styles.moveFieldOptional}>(opcional)</span>
            </div>
            <input
              className={styles.moveNoteInput}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              placeholder="Proveedor, razón, folio…"
            />

            {error && <div className={styles.errorBanner}>{error}</div>}

            {/* Footer */}
            <div className={styles.moveFooter}>
              <button
                type="button"
                className={styles.btnOutline}
                onClick={onClose}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => void handleSave()}
                disabled={saving || !productId}
              >
                <FiSave size={13} />
                {saving ? 'Guardando…' : 'Registrar movimiento'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type InventoryPageProps = { user: AuthUser }

export default function InventoryPage({ user }: InventoryPageProps): JSX.Element {
  const [period, setPeriod] = useState<Period>('week')
  const [chartMode, setChartMode] = useState<ChartMode>('both')
  const [search, setSearch] = useState('')
  const [moveFilter, setMoveFilter] = useState<MoveType | 'all'>('all')
  const [selectedProduct, setSelectedProduct] = useState<InventoryProduct | null>(null)
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [lowStockOpen, setLowStockOpen] = useState(false)

  // ── Data state ──
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [stats, setStats] = useState<InventoryStats | null>(null)
  const [chart, setChart] = useState<InventoryChartPoint[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadAll(p: Period): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const [prods, st, ch, moves] = await Promise.all([
        window.pos.inventory.products(),
        window.pos.inventory.stats(p),
        window.pos.inventory.chart(),
        window.pos.inventory.movements()
      ])
      setProducts(prods)
      setStats(st)
      setChart(ch)
      setMovements(moves)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar inventario.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll(period)
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  async function reloadMovements(filter: MoveType | 'all'): Promise<void> {
    const moves = await window.pos.inventory.movements(filter === 'all' ? undefined : filter)
    setMovements(moves)
  }

  function handleFilterChange(f: MoveType | 'all'): void {
    setMoveFilter(f)
    void reloadMovements(f)
  }

  // ── Derived ──
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
    )
  }, [products, search])

  const statusCounts = useMemo(
    () => ({
      total: products.length,
      ok: products.filter((p) => p.status === 'ok').length,
      low: products.filter((p) => p.status === 'low').length,
      out: products.filter((p) => p.status === 'out').length
    }),
    [products]
  )

  const consumption = useMemo(() => {
    const sorted = [...products].sort((a, b) => b.consumption - a.consumption).slice(0, 8)
    const max = sorted[0]?.consumption || 1
    return sorted.map((p) => ({
      name: p.name,
      units: p.consumption,
      pct: Math.round((p.consumption / max) * 100)
    }))
  }, [products])

  const moveSummary = useMemo(
    () => ({
      entradas: movements.filter((m) => m.type === 'entrada').length,
      ventas: movements.filter((m) => m.type === 'venta').length,
      ajustes: movements.filter((m) => m.type === 'ajuste').length,
      mermas: movements.filter((m) => m.type === 'merma').length
    }),
    [movements]
  )

  const alerts = useMemo(
    () =>
      products
        .filter((p) => p.status !== 'ok')
        .map((p) => ({
          id: p.id,
          level: p.status === 'out' ? ('critical' as const) : ('warning' as const),
          product: p.name,
          message:
            p.status === 'out'
              ? `Sin existencias. Requiere reabastecimiento urgente.`
              : `Stock bajo — ${p.stock} uds (mínimo ${p.stockMin}). Considera reabastecer.`
        })),
    [products]
  )

  const kpiRows = useMemo((): KpiCardProps[] => {
    if (!stats) return []
    const c = stats.changes
    const periodLabel = period === 'today' ? 'hoy' : period === 'week' ? 'semana' : 'mes'
    return [
      {
        label: `Ventas ${periodLabel}`,
        value: fmt(stats.ventas),
        change: c.ventas,
        icon: <FiShoppingBag size={16} />,
        accent: '#4f6ef7'
      },
      {
        label: `Ganancia ${periodLabel}`,
        value: fmt(stats.ganancia),
        change: c.ganancia,
        icon: <FiDollarSign size={16} />,
        accent: '#10b981'
      },
      {
        label: 'Costo mercancía',
        value: fmt(stats.costo),
        change: c.costo,
        icon: <FiBox size={16} />,
        accent: '#f59e0b'
      },
      {
        label: 'Margen promedio',
        value: `${stats.margen}%`,
        change: c.margen,
        icon: <FiBarChart2 size={16} />,
        accent: '#8b5cf6'
      },
      {
        label: `Tickets ${periodLabel}`,
        value: String(stats.tickets),
        change: c.tickets,
        icon: <FiActivity size={16} />,
        accent: '#06b6d4'
      },
      {
        label: 'Unidades vendidas',
        value: String(stats.unidades),
        change: c.unidades,
        icon: <FiPackage size={16} />,
        accent: '#ec4899'
      },
      {
        label: 'Productos stock bajo',
        value: String(stats.bajos),
        change: 0,
        icon: <FiAlertTriangle size={16} />,
        accent: '#ef4444'
      },
      {
        label: 'Movimientos manuales',
        value: String(stats.movimientos),
        change: c.movimientos,
        icon: <FiRefreshCw size={16} />,
        accent: '#64748b'
      }
    ]
  }, [stats, period])

  const canManage = user.role === 'ADMIN' || user.role === 'SUPERVISOR'

  function handleInventoryScan(raw: string): void {
    if (showMoveModal || lowStockOpen || selectedProduct) return

    let code = raw.trim()
    try {
      const parsed = JSON.parse(raw) as unknown
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'sku' in parsed &&
        typeof (parsed as Record<string, unknown>).sku === 'string'
      ) {
        code = (parsed as { sku: string }).sku
      }
    } catch {
      // plain barcode — use as-is
    }

    if (!code) return
    setSearch(code)
  }

  useBarcodeScanner(handleInventoryScan)

  return (
    <section className={styles.page}>
      {lowStockOpen && <LowStockModal products={products} onClose={() => setLowStockOpen(false)} />}
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
                placeholder="Buscar producto, SKU o categoría…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className={styles.periodTabs}>
              {(['today', 'week', 'month'] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.periodTab} ${period === p ? styles.periodTabActive : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p === 'today' ? 'Hoy' : p === 'week' ? 'Semana' : 'Mes'}
                </button>
              ))}
            </div>
            {canManage && (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setShowMoveModal(true)}
              >
                <FiPlus size={14} /> Nuevo movimiento
              </button>
            )}
          </div>
        </div>

        {/* ── Scroll area ────────────────────────────────────── */}
        <div className={styles.scroll}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          {/* ── KPIs ─────────────────────────────────────────── */}
          <div className={styles.kpiGrid}>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className={styles.kpiCard}
                    style={{ borderTop: '3px solid #e2e8f0' }}
                  >
                    <div className={styles.kpiLabel} style={{ color: '#cbd5e1' }}>
                      Cargando…
                    </div>
                    <div className={styles.kpiValue} style={{ color: '#e2e8f0' }}>
                      —
                    </div>
                  </div>
                ))
              : kpiRows.map((k, i) => (
                  <KpiCard
                    key={i}
                    {...k}
                    onClick={
                      i === 6 && stats && stats.bajos > 0 ? () => setLowStockOpen(true) : undefined
                    }
                  />
                ))}
          </div>

          {/* ── Analytics + Movement summary ─────────────────── */}
          <div className={styles.analyticsRow}>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.cardTitle}>Ventas y ganancias</div>
                  <div className={styles.cardSub}>Últimos 7 días</div>
                </div>
                <div className={styles.chartTabs}>
                  {(['both', 'sales', 'profit'] as ChartMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`${styles.chartTab} ${chartMode === m ? styles.chartTabActive : ''}`}
                      onClick={() => setChartMode(m)}
                    >
                      {m === 'both' ? 'Ambos' : m === 'sales' ? 'Ventas' : 'Ganancia'}
                    </button>
                  ))}
                </div>
              </div>
              <BarChart data={chart} mode={chartMode} />
              <div className={styles.chartLegend}>
                {chartMode !== 'profit' && (
                  <>
                    <span className={styles.legendDot} style={{ background: '#4f6ef7' }} /> Ventas
                  </>
                )}
                {chartMode !== 'sales' && (
                  <>
                    <span className={styles.legendDot} style={{ background: '#10b981' }} /> Ganancia
                  </>
                )}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>Resumen de movimientos</div>
                <div className={styles.cardSub}>Registros visibles</div>
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

          {/* ── Movements table ───────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Movimientos recientes</div>
                <div className={styles.cardSub}>{movements.length} registros</div>
              </div>
              <div className={styles.moveFilterRow}>
                <FiFilter size={13} style={{ color: '#9ca3af' }} />
                {(['all', 'entrada', 'venta', 'ajuste', 'merma'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.moveFilterBtn} ${moveFilter === t ? styles.moveFilterActive : ''}`}
                    onClick={() => handleFilterChange(t)}
                  >
                    {t === 'all'
                      ? 'Todos'
                      : t === 'entrada'
                        ? 'Entradas'
                        : t === 'venta'
                          ? 'Ventas'
                          : t === 'ajuste'
                            ? 'Ajustes'
                            : 'Mermas'}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.tableWrap}>
              <div className={`${styles.tableRow} ${styles.tableHead}`}>
                <div>Fecha</div>
                <div>Producto</div>
                <div>Tipo</div>
                <div className={styles.tCenter}>Cant.</div>
                <div className={styles.tCenter}>Antes</div>
                <div className={styles.tCenter}>Después</div>
                <div>Usuario</div>
                <div>Nota</div>
              </div>
              {loading ? (
                <div className={styles.tableRow}>
                  <div className={styles.muted} style={{ gridColumn: '1 / -1' }}>
                    Cargando movimientos…
                  </div>
                </div>
              ) : movements.length === 0 ? (
                <div className={styles.tableRow}>
                  <div className={styles.muted} style={{ gridColumn: '1 / -1' }}>
                    Sin movimientos registrados.
                  </div>
                </div>
              ) : (
                movements.map((m) => (
                  <div key={m.id} className={styles.tableRow}>
                    <div className={styles.cellDate}>
                      <span>{m.date}</span>
                      <span className={styles.cellTime}>{m.time}</span>
                    </div>
                    <div className={styles.cellName}>{m.product}</div>
                    <div>
                      <MoveBadge type={m.type} />
                    </div>
                    <div
                      className={`${styles.tCenter} ${m.type === 'entrada' || m.type === 'devolucion' ? styles.qtyIn : styles.qtyOut}`}
                    >
                      {m.type === 'entrada' || m.type === 'devolucion' ? '+' : '-'}
                      {m.qty}
                    </div>
                    <div className={`${styles.tCenter} ${styles.muted}`}>
                      {m.stockBefore ?? '—'}
                    </div>
                    <div className={`${styles.tCenter} ${styles.muted}`}>{m.stockAfter ?? '—'}</div>
                    <div className={styles.muted}>{m.user}</div>
                    <div className={`${styles.muted} ${styles.cellNote}`}>{m.note}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Consumption + Inventory status ───────────────── */}
          <div className={styles.twoColRow}>
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
                {consumption.length === 0 && !loading && (
                  <div className={styles.muted} style={{ padding: '12px 0', fontSize: 13 }}>
                    Sin ventas registradas en los últimos 30 días.
                  </div>
                )}
              </div>
            </div>

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
                  <span className={styles.statusBigVal} style={{ color: '#10b981' }}>
                    {statusCounts.ok}
                  </span>
                  <span className={styles.statusStatLabel}>Disponibles</span>
                </div>
                <div className={styles.statusStatItem}>
                  <span className={styles.statusBigVal} style={{ color: '#f59e0b' }}>
                    {statusCounts.low}
                  </span>
                  <span className={styles.statusStatLabel}>Stock bajo</span>
                </div>
                <div className={styles.statusStatItem}>
                  <span className={styles.statusBigVal} style={{ color: '#ef4444' }}>
                    {statusCounts.out}
                  </span>
                  <span className={styles.statusStatLabel}>Agotados</span>
                </div>
              </div>

              {statusCounts.total > 0 && (
                <>
                  <div className={styles.statusBar}>
                    <div
                      className={styles.statusBarOk}
                      style={{ flex: Math.max(statusCounts.ok, 0.1) }}
                    />
                    <div
                      className={styles.statusBarLow}
                      style={{ flex: Math.max(statusCounts.low, 0.1) }}
                    />
                    <div
                      className={styles.statusBarOut}
                      style={{ flex: Math.max(statusCounts.out, 0.1) }}
                    />
                  </div>
                  <div className={styles.statusBarLabels}>
                    <span style={{ color: '#10b981' }}>
                      Disponible {Math.round((statusCounts.ok / statusCounts.total) * 100)}%
                    </span>
                    <span style={{ color: '#f59e0b' }}>
                      Bajo {Math.round((statusCounts.low / statusCounts.total) * 100)}%
                    </span>
                    <span style={{ color: '#ef4444' }}>
                      Agotado {Math.round((statusCounts.out / statusCounts.total) * 100)}%
                    </span>
                  </div>
                </>
              )}

              <div className={styles.statusList}>
                {products
                  .filter((p) => p.status !== 'ok')
                  .map((p) => (
                    <div key={p.id} className={styles.statusListItem}>
                      <StatusBadge status={p.status} />
                      <span className={styles.statusListName}>{p.name}</span>
                      <span className={styles.statusListStock}>{p.stock} uds</span>
                    </div>
                  ))}
                {!loading && products.filter((p) => p.status !== 'ok').length === 0 && (
                  <div className={styles.muted} style={{ fontSize: 13, padding: '8px 0' }}>
                    Todos los productos tienen stock suficiente.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Products table ────────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Productos en inventario</div>
                <div className={styles.cardSub}>
                  {filteredProducts.length} de {products.length} productos
                </div>
              </div>
              <div className={styles.tableActions}>
                <button type="button" className={styles.btnOutline}>
                  <FiFilter size={13} /> Filtros
                </button>
                <button type="button" className={styles.btnOutline}>
                  <FiChevronDown size={13} /> Categoría
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  onClick={() => void loadAll(period)}
                >
                  <FiRefreshCw size={13} /> Recargar
                </button>
              </div>
            </div>
            <div className={styles.tableWrapScroll}>
              <div className={`${styles.productRow} ${styles.tableHead}`}>
                <div>Producto</div>
                <div>SKU</div>
                <div>Categoría</div>
                <div className={styles.tCenter}>Stock</div>
                <div className={styles.tCenter}>Mínimo</div>
                <div>Costo</div>
                <div>Precio</div>
                <div className={styles.tCenter}>Margen</div>
                <div className={styles.tCenter}>Consumo</div>
                <div>Último mov.</div>
                <div>Estado</div>
                <div />
              </div>
              {loading ? (
                <div className={styles.productRow}>
                  <div className={styles.muted} style={{ gridColumn: '1 / -1' }}>
                    Cargando productos…
                  </div>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className={styles.productRow}>
                  <div className={styles.muted} style={{ gridColumn: '1 / -1' }}>
                    Sin productos encontrados.
                  </div>
                </div>
              ) : (
                filteredProducts.map((p) => (
                  <div
                    key={p.id}
                    className={`${styles.productRow} ${p.status === 'out' ? styles.rowOut : p.status === 'low' ? styles.rowLow : ''}`}
                  >
                    <div className={styles.cellName}>{p.name}</div>
                    <div className={styles.cellSku}>{p.sku}</div>
                    <div className={styles.muted}>{p.category}</div>
                    <div
                      className={`${styles.tCenter} ${p.status === 'out' ? styles.stockZero : p.status === 'low' ? styles.stockLow : styles.stockOk}`}
                    >
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
                    <div>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowBtn}
                        title="Ver detalle"
                        onClick={() => setSelectedProduct(p)}
                      >
                        <FiEye size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Alerts ───────────────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Alertas e insights</div>
                <div className={styles.cardSub}>
                  {alerts.length} aviso{alerts.length !== 1 ? 's' : ''} activo
                  {alerts.length !== 1 ? 's' : ''}
                </div>
              </div>
              <FiAlertTriangle size={16} style={{ color: '#f59e0b' }} />
            </div>
            <div className={styles.alertList}>
              {alerts.length === 0 ? (
                <div className={styles.muted} style={{ padding: '12px 0', fontSize: 13 }}>
                  Sin alertas activas. Todos los stocks están en niveles correctos.
                </div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className={`${styles.alertItem} ${styles[`alert_${a.level}`]}`}>
                    <div className={styles.alertDot} />
                    <div className={styles.alertBody}>
                      <span className={styles.alertProduct}>{a.product}</span>
                      <span className={styles.alertMsg}>{a.message}</span>
                    </div>
                    {a.level === 'critical' && <span className={styles.alertTag}>Urgente</span>}
                    {a.level === 'warning' && <span className={styles.alertTagWarn}>Atención</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        {/* end .scroll */}
      </div>
      {/* end .panel */}

      {/* ── Product detail drawer ─────────────────────────── */}
      {selectedProduct && (
        <div className={styles.drawerBackdrop} onClick={() => setSelectedProduct(null)}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHead}>
              <div>
                <div className={styles.drawerTitle}>{selectedProduct.name}</div>
                <div className={styles.drawerSku}>
                  {selectedProduct.sku} · {selectedProduct.category}
                </div>
              </div>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => setSelectedProduct(null)}
              >
                <FiX size={18} />
              </button>
            </div>

            <div style={{ padding: '0 18px' }}>
              <StatusBadge status={selectedProduct.status} />
            </div>

            <div className={styles.drawerGrid}>
              <div className={styles.drawerStat}>
                <div className={styles.drawerStatLabel}>Stock actual</div>
                <div
                  className={`${styles.drawerStatVal} ${selectedProduct.status === 'out' ? styles.stockZero : selectedProduct.status === 'low' ? styles.stockLow : styles.stockOk}`}
                >
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
            </div>

            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Movimientos recientes</div>
              {movements
                .filter((m) => m.product === selectedProduct.name)
                .slice(0, 4)
                .map((m) => (
                  <div key={m.id} className={styles.drawerMoveRow}>
                    <MoveBadge type={m.type} />
                    <span className={styles.muted}>
                      {m.date} {m.time}
                    </span>
                    <span
                      className={
                        m.type === 'entrada' || m.type === 'devolucion'
                          ? styles.qtyIn
                          : styles.qtyOut
                      }
                    >
                      {m.type === 'entrada' || m.type === 'devolucion' ? '+' : '-'}
                      {m.qty} uds
                    </span>
                  </div>
                ))}
              {movements.filter((m) => m.product === selectedProduct.name).length === 0 && (
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
              {canManage && (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => {
                    setSelectedProduct(null)
                    setShowMoveModal(true)
                  }}
                >
                  <FiPlus size={13} /> Registrar movimiento
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New movement modal ────────────────────────────── */}
      {showMoveModal && (
        <MovementModal
          products={products}
          userId={user.id}
          onClose={() => setShowMoveModal(false)}
          onSaved={async () => {
            setShowMoveModal(false)
            await loadAll(period)
          }}
        />
      )}
    </section>
  )
}
