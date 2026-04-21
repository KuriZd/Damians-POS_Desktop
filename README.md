# POS Multimodal

Aplicacion de escritorio para punto de venta construida con Electron, React y TypeScript.
Opera con SQLite local y sincroniza catalogo con Supabase.

## Stack

- Electron
- React
- TypeScript
- Vite + electron-vite
- SQLite con `better-sqlite3`
- Supabase
- CSS Modules

## Modulos Activos

- Login con sesion persistida
- Dashboard
- Productos y servicios
- Inventario
- Ventas
- Usuarios

## Requisitos

- Node.js 20+ recomendado
- npm
- Variables de entorno de Supabase

## Variables de Entorno

Crea un archivo `.env` en la raiz del proyecto con:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Notas:

- `SUPABASE_SERVICE_ROLE_KEY` se usa solo en el proceso principal.
- Las variables `VITE_*` son para el renderer.

## Instalacion

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Validacion

```bash
npm run typecheck
npm run lint
```

## Build

```bash
npm run build
npm run build:win
npm run build:mac
npm run build:linux
```

## Arquitectura

- `src/main`: proceso principal, SQLite, IPC y acceso privilegiado a Supabase
- `src/preload`: bridge seguro con `window.pos`
- `src/renderer`: interfaz React

IPC expuesto:

- `auth`
- `products`
- `services`
- `users`
- `inventory`
- `dashboard`
- `sales`
- `sync`

## Base Local

La base SQLite se crea en:

```text
app.getPath('userData')/data/pos-local.db
```

Incluye tablas para:

- usuarios
- catalogo
- ventas
- pagos
- movimientos de inventario
- cola de sincronizacion

## Sincronizacion

Estado actual:

- `pullAll()` descarga catalogo remoto desde Supabase
- el catalogo remoto reemplaza el local
- hay auto-sync al iniciar y cada 6 horas
- `pushPending()` aun no sube cambios locales

En la practica, la sincronizacion actual es `pull-only`.

## Roles

- `ADMIN`: acceso total
- `SUPERVISOR`: dashboard, productos, inventario, ventas, usuarios
- `CASHIER`: ventas

## Scripts Disponibles

- `npm run dev`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run build:win`
- `npm run build:mac`
- `npm run build:linux`
- `npm run rebuild:native`

## Build de Escritorio

Configuracion actual:

- `productName`: `pos-damian`
- `appId`: `com.electron.app`
- Windows: instalador NSIS
- macOS: build configurado con permisos de camara, microfono, Documents y Downloads
- Linux: `AppImage`, `snap` y `deb`

## Estado del Proyecto

Implementado:

- autenticacion con cache local y sesion persistida
- CRUD de usuarios
- ventas con registro local
- descuento y metodos de pago en POS
- movimientos manuales de inventario
- dashboard con heatmap y KPIs

Pendiente:

- push real a Supabase
- resolucion de conflictos
- corte de caja
- limpieza general de textos con problemas de encoding en UI

## Documentacion Relacionada

- [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)
