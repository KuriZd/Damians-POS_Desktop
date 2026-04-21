# POS Multimodal - Project Overview

Documento de referencia del estado actual del proyecto.
Aplicacion de escritorio construida con Electron + React, con almacenamiento local en SQLite y sincronizacion de catalogo con Supabase.

---

## Resumen

- La app corre como escritorio con Electron.
- El proceso `main` administra SQLite, IPC y acceso privilegiado a Supabase.
- El `renderer` implementa la UI de login, dashboard, productos, inventario, ventas y usuarios.
- El modo operativo es `local-first` para catalogo y ventas locales, con `pull` de catalogo desde Supabase.
- El `push` de pendientes y la resolucion real de conflictos aun no estan implementados.

---

## Stack

| Capa | Tecnologia |
| --- | --- |
| Desktop | Electron 39 |
| UI | React 19 + TypeScript |
| Build | Vite 7 + electron-vite |
| Base local | better-sqlite3 / SQLite |
| Backend remoto | Supabase |
| Auth local | bcryptjs |
| Estilos | CSS Modules |
| UI helpers | react-icons, qrcode.react |
| Config | dotenv |
| Empaquetado | electron-builder |

---

## Arquitectura

### Main process

- Inicializa la base SQLite local.
- Registra handlers IPC para `auth`, `users`, `products`, `services`, `sales`, `inventory`, `dashboard` y `sync`.
- Crea la ventana principal con `contextIsolation: true`, `nodeIntegration: false` y `sandbox: false`.
- Expone acceso privilegiado a Supabase desde `src/main/supabase/client.ts`.

### Preload

- Expone `window.pos` mediante `contextBridge`.
- Sirve como unica superficie de comunicacion segura entre renderer y main.

### Renderer

- `App.tsx` restaura sesion y decide entre `LoginPage` o `AppLayout`.
- `AppLayout` monta sidebar, top nav, auto-sync y navegacion por modulos.
- Modulos activos:
  - `DashboardPage`
  - `ProductsPage`
  - `InventoryPage`
  - `SalesPage`
  - `UsersPage`

---

## Estructura Principal

```text
src/
|- main/
|  |- index.ts
|  |- db/
|  |  |- local-db.ts
|  |  `- local-schema.ts
|  |- ipc/
|  |  |- auth.ipc.ts
|  |  |- dashboard.ipc.ts
|  |  |- inventory.ipc.ts
|  |  |- products.ipc.ts
|  |  |- sales.ipc.ts
|  |  |- services.ipc.ts
|  |  |- sync.ipc.ts
|  |  `- users.ipc.ts
|  `- supabase/
|     `- client.ts
|- preload/
|  |- index.ts
|  `- index.d.ts
`- renderer/src/
   |- App.tsx
   |- hooks/
   |  |- useBarcodeScanner.ts
   |  `- useSync.ts
   |- pages/
   |  |- LoginPage.tsx
   |  |- DashboardPage.tsx
   |  |- ProductsPage.tsx
   |  |- InventoryPage.tsx
   |  |- SalesPage.tsx
   |  `- UsersPage.tsx
   |- components/
   |- repositories/
   |- lib/
   `- types/
```

---

## Modulos Funcionales

### Autenticacion

- `auth:login` intenta primero autenticacion remota via RPC `pos_login`.
- Si Supabase falla por RPC y existe hash local, puede validar con `bcrypt`.
- La sesion se guarda en `session.json` dentro de `app.getPath('userData')`.
- `auth:me` restaura la sesion persistida.
- `auth:logout` limpia memoria y archivo de sesion.

### Dashboard

- Muestra ventas de hoy y semana.
- Calcula ganancia diaria desde `SaleItem.lineProfit`.
- Reporta productos con stock bajo.
- Renderiza heatmap de actividad de las ultimas 52 semanas.
- Incluye scanner rapido por codigo usando `useBarcodeScanner`.

### Productos y Servicios

- Vista tabulada para productos y servicios.
- Busqueda, paginacion y ordenamiento.
- Fallback entre datos locales y Supabase.
- Alta/edicion mediante modales.
- Eliminacion logica marcando `active = false`.

### Inventario

- Panel analitico con KPIs por periodo: hoy, semana y mes.
- Tabla de productos con estado de stock, consumo y ultimo movimiento.
- Grafica de ventas/ganancia de 7 dias.
- Historial de movimientos desde `InventoryMovement`.
- Registro manual de entradas, ajustes, mermas y devoluciones.
- Solo `ADMIN` y `SUPERVISOR` pueden registrar movimientos.

### Ventas

- Catalogo unificado de productos y servicios.
- Carrito con cantidades, resumen, descuento y notas.
- Metodos de pago: efectivo, tarjeta, transferencia y mixto.
- Registro de venta en SQLite con:
  - `Sale`
  - `SaleItem`
  - `Payment`
  - `InventoryMovement` para productos
- Modal de historial con ventas recientes.
- `Corte de caja` aparece en UI pero sigue marcado como `TODO`.

### Usuarios

- CRUD de usuarios desde Supabase usando `supabaseAdmin`.
- Refleja cambios tambien en SQLite local.
- `ADMIN` puede gestionar `ADMIN`, `SUPERVISOR` y `CASHIER`.
- `SUPERVISOR` solo puede gestionar `SUPERVISOR` y `CASHIER`.
- No se permite eliminar la propia cuenta desde la UI.

---

## Base de Datos Local

La base se crea en:

```text
app.getPath('userData')/data/pos-local.db
```

Configuracion aplicada:

- `journal_mode = WAL`
- `foreign_keys = ON`
- migraciones previas y posteriores al esquema para compatibilidad con bases existentes

### Tablas principales

- `User`
- `Category`
- `Product`
- `Service`
- `ServiceSupply`
- `Sale`
- `SaleItem`
- `Payment`
- `InventoryMovement`
- `sync_queue`
- `device_config`

### Notas de modelo

- Los precios y montos se almacenan en centavos enteros en la base local.
- `SaleItem` usa `unitPrice` en lugar de `price`.
- `itemType` se normaliza a `PRODUCT` o `SERVICE`.
- `InventoryMovement.sourceType` usa enums alineados a Supabase como:
  - `SALE`
  - `SALE_CANCEL`
  - `SERVICE_CONSUMPTION`
  - `PURCHASE`
  - `ADJUSTMENT`
  - `RETURN`
  - `OPENING_STOCK`
  - `MANUAL`
- `SaleItem` e `InventoryMovement` guardan snapshots para trazabilidad historica.

---

## API Expuesta en `window.pos`

```ts
window.pos.auth.login(username, password)
window.pos.auth.me()
window.pos.auth.logout()

window.pos.products.findByCode(code)
window.pos.products.get(id)
window.pos.products.getBySku(sku)
window.pos.products.list(args)

window.pos.services.get(id)
window.pos.services.getByCode(code)
window.pos.services.list(args)

window.pos.users.list()
window.pos.users.create(payload)
window.pos.users.update(id, payload)
window.pos.users.delete(id)

window.pos.inventory.products()
window.pos.inventory.stats(period)
window.pos.inventory.chart()
window.pos.inventory.movements(typeFilter?)
window.pos.inventory.registerMovement(payload)

window.pos.dashboard.stats()

window.pos.sales.create(payload)
window.pos.sales.recent(limit?)

window.pos.sync.pullProducts()
window.pos.sync.pullAll()
window.pos.sync.pushPending()
window.pos.sync.conflicts()
```

---

## Sincronizacion

### Implementado

- `useSync` ejecuta `pullAll()` al iniciar y cada 6 horas.
- `pullAll()` descarga:
  - `Category`
  - `Product`
  - `Service`
  - `ServiceSupply`
- El catalogo remoto reemplaza el catalogo local en SQLite.
- Se guarda `lastSyncAt` en `localStorage` con la clave `pos:lastSyncAt`.

### No implementado aun

- `pushPending()` devuelve `{ pushed: 0, failed: 0 }`.
- `sync_queue` existe en esquema, pero no hay pipeline real de subida.
- `conflicts()` expone memoria en runtime, pero hoy `pullAll()` resetea conflictos y devuelve `conflictCount: 0`.

Implicacion: hoy la sincronizacion es efectivamente `pull-only` para catalogo.

---

## Supabase

Hay dos clientes:

- `supabase`: usa `SUPABASE_ANON_KEY`
- `supabaseAdmin`: usa `SUPABASE_SERVICE_ROLE_KEY` cuando existe

Uso esperado:

- `supabase` para lecturas RPC y catalogo remoto
- `supabaseAdmin` solo en `main` para operaciones administrativas como usuarios

Tablas remotas usadas por la app:

- `User`
- `Category`
- `Product`
- `Service`
- `ServiceSupply`

RPC usada:

- `pos_login(p_username, p_password)`

---

## Variables de Entorno

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Notas:

- `SUPABASE_SERVICE_ROLE_KEY` no debe exponerse al renderer.
- El renderer usa las variables `VITE_*` para lecturas directas donde aplica.

---

## Roles y Acceso

| Rol | Secciones habilitadas |
| --- | --- |
| `ADMIN` | dashboard, products, inventory, sales, users |
| `SUPERVISOR` | dashboard, products, inventory, sales, users |
| `CASHIER` | sales |

---

## Estado Actual y Pendientes

### Estable

- Login con persistencia de sesion
- Dashboard operativo
- CRUD de usuarios
- Catalogo local/remoto de productos y servicios
- Registro de ventas con impacto en inventario
- Panel de inventario con consultas y movimientos manuales

### Incompleto o pendiente

- Push real de cambios locales a Supabase
- Resolucion de conflictos de sincronizacion
- Corte de caja
- Documentacion general del repo fuera de este archivo
- Limpieza de textos con problemas de encoding en varios archivos UI

---

## Seguridad Electron

| Configuracion | Valor |
| --- | --- |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `false` |
| Preload bridge | `window.pos` via `contextBridge` |

`sandbox: false` se usa por la dependencia nativa `better-sqlite3`.
