/// <reference types="vite/client" />

type AppRole = 'ADMIN' | 'CASHIER' | 'SUPERVISOR'

type InventoryProduct = {
  id: number; name: string; sku: string; category: string
  stock: number; stockMin: number; stockMax: number
  cost: number; price: number; consumption: number
  lastMove: string; active: boolean
  status: 'ok' | 'low' | 'out'
}

type InventoryStats = {
  ventas: number; ganancia: number; costo: number; margen: number
  tickets: number; unidades: number; bajos: number; movimientos: number
  changes: { ventas: number; ganancia: number; costo: number; margen: number; tickets: number; unidades: number; bajos: number; movimientos: number }
}

type InventoryChartPoint = { label: string; sales: number; profit: number }

type InventoryMovement = {
  id: string; date: string; time: string; product: string
  type: 'entrada' | 'venta' | 'ajuste' | 'merma' | 'devolucion'
  qty: number; stockBefore: number | null; stockAfter: number | null
  user: string; note: string
}

type DashboardStats = {
  today:       { total: number; tickets: number; units: number }
  todayProfit: number
  week:        { total: number; tickets: number }
  lowStock:    number
  heatmap:     Array<{ date: string; total: number; tickets: number }>
}

type RecentSale = {
  id: number
  folio: string
  createdAt: string
  total: number
  subtotal: number
  tax: number
  status: string
  cashierName: string
  itemCount: number
  paymentMethod: string
}

type InventoryMovementPayload = {
  productId: number; type: 'entrada' | 'ajuste' | 'merma' | 'devolucion'
  qty: number; userId?: number; note?: string
}

interface SyncConflict {
  entityName: string
  publicId: string
  localUpdatedAt: string
  remoteUpdatedAt: string
  detectedAt: string
}

interface AuthUser {
  id: number
  name: string
  username: string
  role: AppRole
  active: boolean
  source: 'local' | 'remote'
}

interface ProductLookup {
  publicId: string
  sku: string
  barcode: string | null
  name: string
  price: number
  stock: number
  active: number
}

interface Window {
  pos: {
    dashboard: {
      stats: () => Promise<DashboardStats>
    }
    auth: {
      login: (username: string, password: string) => Promise<AuthUser | null>
      me: () => Promise<AuthUser | null>
      logout: () => Promise<{ ok: boolean }>
    }
    products: {
      findByCode: (code: string) => Promise<ProductLookup | null>
      list: (args: import('./types/pos').ProductsListArgs) => Promise<import('./types/pos').ProductsListResult>
      get: (id: number) => Promise<import('./types/pos').ProductDetails>
      getBySku?: (sku: string) => Promise<import('./types/pos').ProductDetails | null>
    }
    services: {
      list: (args: import('./types/pos').ServicesListArgs) => Promise<import('./types/pos').ServicesListResult>
      get: (id: number) => Promise<import('./types/pos').ServiceDetails>
      getByCode?: (code: string) => Promise<import('./types/pos').ServiceDetails | null>
    }
    users: {
    list: () => Promise<import('./types/pos').UserListItem[]>
    create: (payload: import('./types/pos').CreateUserPayload) => Promise<{ ok: boolean }>
    update: (id: number, payload: import('./types/pos').UpdateUserPayload) => Promise<{ ok: boolean }>
    delete: (id: number) => Promise<{ ok: boolean }>
  }
  inventory: {
    products: () => Promise<InventoryProduct[]>
    stats: (period: 'today' | 'week' | 'month') => Promise<InventoryStats>
    chart: () => Promise<InventoryChartPoint[]>
    movements: (typeFilter?: string) => Promise<InventoryMovement[]>
    registerMovement: (payload: InventoryMovementPayload) => Promise<{ ok: boolean; stockBefore: number; stockAfter: number }>
  }
  sales: {
      recent: (limit?: number) => Promise<RecentSale[]>
      create: (payload: {
        cashierId: number
        items: Array<{
          itemType: 'product' | 'service'
          productPublicId: string | null
          servicePublicId: string | null
          qty: number
          price: number
          discount: number
          lineTotal: number
        }>
        subtotal: number
        tax: number
        total: number
        payment: { method: string; amount: number }
      }) => Promise<{ ok: true; folio: string; salePublicId: string }>
    }
    sync: {
      pullProducts: () => Promise<{ ok: boolean; count: number }>
      pullAll: () => Promise<{
        ok: boolean
        syncedAt: string
        push: { pushed: number; failed: number }
        conflictCount: number
        counts: { categories: number; products: number; services: number; serviceSupplies: number }
      }>
      pushPending: () => Promise<{ ok: boolean; pushed: number; failed: number }>
      conflicts: () => Promise<SyncConflict[]>
    }
  }
}
