import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import btnAddIcon from '../assets/btnadd.png'
import btnFiltroIcon from '../assets/btnfiltro.png'
import styles from './ProductsPage.module.css'
import { FaHandshake } from 'react-icons/fa'
import { AiOutlineProduct } from 'react-icons/ai'
import { FiClock, FiType } from 'react-icons/fi'
import AddProductModal from '../components/services/AddProductModal'
import AddServiceModal from '../components/services/AddServicesModal'
import { serviceRepository, type ServiceDetails } from '../repositories/serviceRepository'
import FiltersDropdown, {
  type FilterKey,
  type FilterOption
} from '../components/FiltersDropdown/FiltersDropdown'
import { supabase } from '../lib/supabaseClient'
import { formatMXN } from '../lib/formatters'

type DataSource = 'local' | 'supabase'

type ProductDTO = {
  id: number
  sku: string
  barcode: string | null
  name: string
  price: number
  stock: number | null
  active: boolean
}

type ProductListItem = ProductDTO & {
  source: DataSource
}

type ServiceListItem = Pick<ServiceDetails, 'id' | 'name' | 'price' | 'durationMin' | 'code'> & {
  source: DataSource
}

type ProductsListResult = {
  items: ProductListItem[]
  total: number
  page: number
  pageSize: number
  source: DataSource
}

type ServicesListResult = {
  items: ServiceListItem[]
  total: number
  page: number
  pageSize: number
  source: DataSource
}

type ViewMode = 'products' | 'services'

type LocalProductsApi = {
  list: (input: { page: number; pageSize: number; search?: string }) => Promise<{
    items: ProductDTO[]
    total: number
    page: number
    pageSize: number
  }>
  remove: (id: number) => Promise<void>
}

type LocalServicesApi = {
  remove?: (id: number) => Promise<void>
}

type SyncBridge = {
  pullAll?: () => Promise<unknown>
}

function sortProducts(items: ProductListItem[], key: FilterKey): ProductListItem[] {
  const copy = [...items]

  if (key === 'age') {
    copy.sort((a, b) => a.id - b.id)
    return copy
  }

  if (key === 'alpha') {
    copy.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    return copy
  }

  if (key === 'stock') {
    copy.sort((a, b) => (b.stock ?? -1) - (a.stock ?? -1))
    return copy
  }

  return copy
}

function sortServices(items: ServiceListItem[], key: FilterKey): ServiceListItem[] {
  const copy = [...items]

  if (key === 'age') {
    copy.sort((a, b) => a.id - b.id)
    return copy
  }

  if (key === 'alpha') {
    copy.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    return copy
  }

  return copy
}

const FILTER_LABELS: Record<FilterKey, string> = {
  age: 'Antigüedad',
  stock: 'Stock',
  alpha: 'Alfabético'
}

function getLocalProductsApi(): LocalProductsApi | null {
  return (window.pos?.products as unknown as LocalProductsApi | undefined) ?? null
}

function getLocalServicesApi(): LocalServicesApi | null {
  return (window.pos?.services as unknown as LocalServicesApi | undefined) ?? null
}

function getSyncBridge(): SyncBridge | null {
  return (window.pos?.sync as unknown as SyncBridge | undefined) ?? null
}

function normalizeProductFromSupabase(row: Record<string, unknown>): ProductListItem {
  return {
    id: Number(row.id ?? 0),
    sku: String(row.sku ?? row.code ?? ''),
    barcode: row.barcode ? String(row.barcode) : null,
    name: String(row.name ?? ''),
    price: Number(row.price ?? row.sell_price ?? row.sellPrice ?? 0),
    stock: row.stock == null ? null : Number(row.stock),
    active: Boolean(row.active ?? true),
    source: 'supabase'
  }
}

function normalizeServiceFromLocal(service: ServiceDetails): ServiceListItem {
  return {
    id: service.id,
    name: service.name,
    price: service.price,
    durationMin: service.durationMin,
    code: service.code,
    source: 'local'
  }
}

function normalizeServiceFromSupabase(row: Record<string, unknown>): ServiceListItem {
  return {
    id: Number(row.id ?? 0),
    name: String(row.name ?? ''),
    price: Number(row.price ?? 0),
    durationMin: Number(row.durationMin ?? row.duration_min ?? 0),
    code: String(row.code ?? row.sku ?? row.id ?? ''),
    source: 'supabase'
  }
}

async function fetchProductsFromLocal(
  page: number,
  pageSize: number,
  search: string
): Promise<ProductsListResult> {
  const productsApi = getLocalProductsApi()

  if (!productsApi?.list) {
    throw new Error('La API local de productos no está disponible.')
  }

  const res = await productsApi.list({
    page,
    pageSize,
    search: search.trim() || undefined
  })

  const items = res.items
    .filter((product) => product.active)
    .map((product) => ({
      ...product,
      source: 'local' as const
    }))

  return {
    items,
    total: items.length < res.total ? res.total : items.length,
    page: res.page,
    pageSize: res.pageSize,
    source: 'local'
  }
}

async function fetchProductsFromSupabase(
  page: number,
  pageSize: number,
  search: string
): Promise<ProductsListResult> {
  let query = supabase
    .from('Product')
    .select('*', { count: 'exact' })
    .eq('active', true)
    .order('id', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1)

  const term = search.trim()
  if (term) {
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
  }

  const { data, count, error } = await query

  if (error) {
    throw error
  }

  const rows = Array.isArray(data) ? data : []

  return {
    items: rows.map((row) => normalizeProductFromSupabase(row as Record<string, unknown>)),
    total: count ?? rows.length,
    page,
    pageSize,
    source: 'supabase'
  }
}

async function fetchServicesFromSupabase(
  page: number,
  pageSize: number,
  search: string
): Promise<ServicesListResult> {
  let query = supabase
    .from('Service')
    .select('*', { count: 'exact' })
    .eq('active', true)
    .order('id', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1)

  const term = search.trim()
  if (term) {
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`)
  }

  const { data, count, error } = await query

  if (error) {
    throw error
  }

  const rows = Array.isArray(data) ? data : []

  return {
    items: rows.map((row) => normalizeServiceFromSupabase(row as Record<string, unknown>)),
    total: count ?? rows.length,
    page,
    pageSize,
    source: 'supabase'
  }
}

export default function ProductsView(): JSX.Element {
  const [mode, setMode] = useState<ViewMode>('products')

  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadingServices, setLoadingServices] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [productsData, setProductsData] = useState<ProductsListResult>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    source: 'local'
  })

  const [servicesData, setServicesData] = useState<ServicesListResult>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    source: 'local'
  })

  const currentData = mode === 'products' ? productsData : servicesData
  const loading = mode === 'products' ? loadingProducts : loadingServices

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(currentData.total / currentData.pageSize)),
    [currentData.total, currentData.pageSize]
  )

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  const [productModalOpen, setProductModalOpen] = useState(false)
  const [editingProductId, setEditingProductId] = useState<number | null>(null)

  const [serviceModalOpen, setServiceModalOpen] = useState(false)
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterKey, setFilterKey] = useState<FilterKey>('alpha')
  const filterBtnRef = useRef<HTMLButtonElement | null>(null)

  const serviceFilterOptions: FilterOption[] = useMemo(
    () => [
      { key: 'age', label: 'Antigüedad', icon: <FiClock /> },
      { key: 'alpha', label: 'Alfabético', icon: <FiType /> }
    ],
    []
  )

  useEffect(() => {
    setFiltersOpen(false)

    setFilterKey((current) => {
      if (mode === 'services' && current === 'stock') return 'alpha'
      return current
    })
  }, [mode])

  async function fetchProductsList(
    nextPage = page,
    nextPageSize = pageSize,
    nextSearch = search
  ): Promise<void> {
    setLoadingProducts(true)
    setLoadError(null)

    try {
      const localResult = await fetchProductsFromLocal(nextPage, nextPageSize, nextSearch)

      if (localResult.total > 0 || !supabase) {
        setProductsData(localResult)
        return
      }

      const remoteResult = await fetchProductsFromSupabase(nextPage, nextPageSize, nextSearch)
      setProductsData(remoteResult)
    } catch (localError) {
      try {
        const remoteResult = await fetchProductsFromSupabase(nextPage, nextPageSize, nextSearch)
        setProductsData(remoteResult)
      } catch (remoteError) {
        console.error('No se pudieron cargar los productos.', { localError, remoteError })
        setLoadError(
          'No se pudieron cargar los productos. Verifica tu conexión e intenta de nuevo.'
        )
        setProductsData({
          items: [],
          total: 0,
          page: nextPage,
          pageSize: nextPageSize,
          source: 'local'
        })
      }
    } finally {
      setLoadingProducts(false)
    }
  }

  async function fetchServicesList(
    nextPage = page,
    nextPageSize = pageSize,
    nextSearch = search
  ): Promise<void> {
    setLoadingServices(true)
    setLoadError(null)

    try {
      const localResult = await serviceRepository.list({
        page: nextPage,
        pageSize: nextPageSize,
        search: nextSearch.trim()
      })

      const items = localResult.items.map(normalizeServiceFromLocal)

      if (localResult.total > 0 || !supabase) {
        setServicesData({
          items,
          total: localResult.total,
          page: localResult.page,
          pageSize: localResult.pageSize,
          source: 'local'
        })
        return
      }

      const remoteResult = await fetchServicesFromSupabase(nextPage, nextPageSize, nextSearch)
      setServicesData(remoteResult)
    } catch (localError) {
      try {
        const remoteResult = await fetchServicesFromSupabase(nextPage, nextPageSize, nextSearch)
        setServicesData(remoteResult)
      } catch (remoteError) {
        console.error('No se pudieron cargar los servicios.', { localError, remoteError })
        setLoadError(
          'No se pudieron cargar los servicios. Verifica tu conexión e intenta de nuevo.'
        )
        setServicesData({
          items: [],
          total: 0,
          page: nextPage,
          pageSize: nextPageSize,
          source: 'local'
        })
      }
    } finally {
      setLoadingServices(false)
    }
  }

  async function fetchCurrentList(
    nextPage = page,
    nextPageSize = pageSize,
    nextSearch = search,
    nextMode = mode
  ): Promise<void> {
    if (nextMode === 'products') {
      await fetchProductsList(nextPage, nextPageSize, nextSearch)
      return
    }

    await fetchServicesList(nextPage, nextPageSize, nextSearch)
  }

  // Search/pageSize: debounced, reset page to 1
  useEffect(() => {
    const t = setTimeout(() => {
      if (page !== 1) {
        setPage(1)
        return
      }
      void fetchCurrentList(1, pageSize, search, mode)
    }, 250)

    return () => clearTimeout(t)
  }, [search, pageSize])

  // Page change: immediate fetch
  useEffect(() => {
    void fetchCurrentList(page, pageSize, search, mode)
  }, [page])

  async function handleDeleteProduct(id: number, source: DataSource): Promise<void> {
    try {
      if (source === 'local') {
        const productsApi = getLocalProductsApi()
        if (!productsApi?.remove) throw new Error('La API local de productos no está disponible.')
        await productsApi.remove(id)
      }

      const { error } = await supabase.from('Product').update({ active: false }).eq('id', id)
      if (error) throw new Error(error.message)
      await getSyncBridge()
        ?.pullAll?.()
        .catch(() => undefined)

      const fallbackPage = page > 1 && productsData.items.length === 1 ? page - 1 : page
      setPage(fallbackPage)
      await fetchProductsList(fallbackPage, pageSize, search)
    } catch (error) {
      console.error('No se pudo eliminar el producto.', error)
      alert('No se pudo eliminar el producto.')
    }
  }

  async function handleDeleteService(id: number, source: DataSource): Promise<void> {
    try {
      if (source === 'local') {
        const servicesApi = getLocalServicesApi()
        if (!servicesApi?.remove) throw new Error('La API local de servicios no está disponible.')
        await servicesApi.remove(id)
      }

      const { error } = await supabase.from('Service').update({ active: false }).eq('id', id)
      if (error) throw new Error(error.message)
      await getSyncBridge()
        ?.pullAll?.()
        .catch(() => undefined)

      const fallbackPage = page > 1 && servicesData.items.length === 1 ? page - 1 : page
      setPage(fallbackPage)
      await fetchServicesList(fallbackPage, pageSize, search)
    } catch (error) {
      console.error('No se pudo eliminar el servicio.', error)
      alert('No se pudo eliminar el servicio.')
    }
  }

  function handleModeChange(newMode: ViewMode): void {
    if (newMode === mode) return
    setMode(newMode)
    setPage(1)
    void fetchCurrentList(1, pageSize, search, newMode)
  }

  function openCreateProductModal(): void {
    setEditingProductId(null)
    setProductModalOpen(true)
  }

  function openCreateServiceModal(): void {
    setEditingServiceId(null)
    setServiceModalOpen(true)
  }

  function openEditProductModal(productId: number): void {
    setEditingProductId(productId)
    setProductModalOpen(true)
  }

  function openEditServiceModal(serviceId: number): void {
    setEditingServiceId(serviceId)
    setServiceModalOpen(true)
  }

  function closeProductModal(): void {
    setProductModalOpen(false)
    setEditingProductId(null)
    void fetchProductsList(page, pageSize, search)
  }

  function closeServiceModal(): void {
    setServiceModalOpen(false)
    setEditingServiceId(null)
    void fetchServicesList(page, pageSize, search)
  }

  function closeAddMenu(): void {
    setAddMenuOpen(false)
  }

  function toggleAddMenu(): void {
    setAddMenuOpen((v) => !v)
  }

  function handleAddOption(option: 'product' | 'service' | 'assign'): void {
    closeAddMenu()

    queueMicrotask(() => {
      if (option === 'product') {
        openCreateProductModal()
        return
      }

      if (option === 'service') {
        openCreateServiceModal()
        return
      }

      if (option === 'assign') console.log('Agregar -> Asignar tutor')
    })
  }

  useEffect(() => {
    if (!addMenuOpen) return

    function onPointerDown(e: PointerEvent): void {
      const target = e.target as Node | null
      if (!target) return
      if (addMenuRef.current && !addMenuRef.current.contains(target)) closeAddMenu()
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeAddMenu()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [addMenuOpen])

  function handlePageScan(raw: string): void {
    if (productModalOpen || serviceModalOpen) return

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

  useBarcodeScanner(handlePageScan)

  const visibleProductItems = useMemo(
    () => sortProducts(productsData.items, filterKey),
    [productsData.items, filterKey]
  )
  const visibleServiceItems = useMemo(
    () => sortServices(servicesData.items, filterKey),
    [servicesData.items, filterKey]
  )

  const startIndex = currentData.total === 0 ? 0 : (currentData.page - 1) * currentData.pageSize + 1
  const endIndex = Math.min(currentData.total, currentData.page * currentData.pageSize)
  const searchPlaceholder = mode === 'products' ? 'Buscar productos...' : 'Buscar servicios...'
  const filterLabel = FILTER_LABELS[filterKey]
  const dataSourceLabel = currentData.source === 'local' ? 'Local' : 'Supabase'

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.topbar}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className={`${styles.btnGhost} ${mode === 'products' ? styles.tabActive : ''}`}
              type="button"
              onClick={() => handleModeChange('products')}
              aria-pressed={mode === 'products'}
              title="Ver productos"
            >
              <AiOutlineProduct style={{ marginRight: 8 }} />
              Productos
            </button>

            <button
              className={`${styles.btnGhost} ${mode === 'services' ? styles.tabActive : ''}`}
              type="button"
              onClick={() => handleModeChange('services')}
              aria-pressed={mode === 'services'}
              title="Ver servicios"
            >
              <FaHandshake style={{ marginRight: 8 }} />
              Servicios
            </button>

            <div className={styles.searchWrap}>
              <span aria-hidden>🔎</span>
              <input
                className={styles.searchInput}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
              />
            </div>
          </div>

          <div className={styles.actions}>
            <div className={styles.addMenuWrap} ref={addMenuRef}>
              <button
                className={`${styles.btn} ${styles.addBtn}`}
                type="button"
                onClick={toggleAddMenu}
              >
                <span>Agregar</span>
                <img className={styles.addIcon} src={btnAddIcon} alt="" />
              </button>

              {addMenuOpen && (
                <div className={styles.dropdown} role="menu" aria-label="Agregar">
                  <button
                    className={styles.dropdownItem}
                    type="button"
                    onClick={() => handleAddOption('product')}
                  >
                    <span className={styles.dropdownIcon}>
                      <AiOutlineProduct />
                    </span>
                    <span>Producto</span>
                  </button>

                  <button
                    className={styles.dropdownItem}
                    type="button"
                    onClick={() => handleAddOption('service')}
                  >
                    <span className={styles.dropdownIcon}>
                      <FaHandshake />
                    </span>
                    <span>Servicio</span>
                  </button>
                </div>
              )}
            </div>

            <button
              ref={filterBtnRef}
              className={styles.btnGhost}
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-label="Filtros"
              title={`Filtros: ${filterLabel}`}
              aria-expanded={filtersOpen}
            >
              <span>{filterLabel}</span>
              <img src={btnFiltroIcon} alt="Filtros" className={styles.filterIcon} />
            </button>

            <select
              className={styles.select}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Cantidad por página"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {loadError && (
          <div className={styles.errorBanner}>
            ⚠ {loadError}
            <button className={styles.errorRetry} onClick={() => fetchCurrentList()}>
              Reintentar
            </button>
          </div>
        )}

        <div className={styles.tableWrap}>
          {mode === 'products' ? (
            <div className={styles.tableHeader}>
              <div>#</div>
              <div>Nombre</div>
              <div>Stock</div>
              <div>Precio</div>
              <div>Código</div>
              <div />
            </div>
          ) : (
            <div className={styles.tableHeader}>
              <div>#</div>
              <div>Nombre</div>
              <div>Duración</div>
              <div>Precio</div>
              <div>Código</div>
              <div />
            </div>
          )}

          {loading && currentData.items.length === 0 ? (
            <div className={styles.row}>
              <div className={styles.muted}>...</div>
              <div className={styles.muted}>Cargando...</div>
              <div />
              <div />
              <div />
              <div />
            </div>
          ) : !loading && currentData.items.length === 0 ? (
            <div className={styles.row}>
              <div className={styles.muted}>-</div>
              <div className={styles.muted}>Sin resultados</div>
              <div />
              <div />
              <div />
              <div />
            </div>
          ) : mode === 'products' ? (
            visibleProductItems.map((p, idx) => (
              <div key={`${p.source}-${p.id}`} className={styles.row}>
                <div>{(productsData.page - 1) * productsData.pageSize + idx + 1}</div>
                <div>{p.name}</div>
                <div className={styles.muted}>{p.stock ?? 'N/A'}</div>
                <div>{formatMXN(p.price)}</div>
                <div className={styles.muted}>{p.barcode ?? p.sku}</div>

                <div className={styles.actionsCell}>
                  <button
                    className={`${styles.iconBtn} ${styles.iconBtnEdit}`}
                    type="button"
                    onClick={() => openEditProductModal(p.id)}
                    aria-label="Editar"
                    title="Editar"
                  >
                    ✎
                  </button>

                  <button
                    className={`${styles.iconBtn} ${styles.iconBtnDelete}`}
                    type="button"
                    onClick={() => void handleDeleteProduct(p.id, p.source)}
                    aria-label="Eliminar"
                    title="Eliminar"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          ) : (
            visibleServiceItems.map((s, idx) => (
              <div key={`${s.source}-${s.id}`} className={styles.row}>
                <div>{(servicesData.page - 1) * servicesData.pageSize + idx + 1}</div>
                <div>{s.name}</div>
                <div className={styles.muted}>{s.durationMin ? `${s.durationMin} min` : 'N/A'}</div>
                <div>{formatMXN(s.price)}</div>
                <div className={styles.muted}>{s.code}</div>

                <div className={styles.actionsCell}>
                  <button
                    className={`${styles.iconBtn} ${styles.iconBtnEdit}`}
                    type="button"
                    onClick={() => openEditServiceModal(s.id)}
                    aria-label="Editar"
                    title="Editar"
                  >
                    ✎
                  </button>

                  <button
                    className={`${styles.iconBtn} ${styles.iconBtnDelete}`}
                    type="button"
                    onClick={() => void handleDeleteService(s.id, s.source)}
                    aria-label="Eliminar"
                    title="Eliminar"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.pagination}>
          <span className={styles.muted}>
            {currentData.total === 0 ? '0' : `${startIndex}-${endIndex}`} de {currentData.total}
          </span>

          <span className={styles.muted}>Origen: {dataSourceLabel}</span>

          <button
            className={styles.pageBtn}
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ←
          </button>

          <div className={styles.pageIndicator}>
            <span className={styles.muted}>
              Página {page} / {totalPages}
            </span>
          </div>

          <button
            className={styles.pageBtn}
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </button>
        </div>
      </div>

      <FiltersDropdown
        open={filtersOpen}
        anchorRef={filterBtnRef}
        selected={filterKey}
        onSelect={(k) => setFilterKey(k)}
        onClose={() => setFiltersOpen(false)}
        options={mode === 'services' ? serviceFilterOptions : undefined}
      />

      <AddProductModal
        open={productModalOpen}
        productId={editingProductId}
        onClose={closeProductModal}
      />

      <AddServiceModal
        open={serviceModalOpen}
        serviceId={editingServiceId}
        onClose={closeServiceModal}
        key={editingServiceId ?? 'new'}
      />
    </div>
  )
}
