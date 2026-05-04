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

## Configuracion de Supabase

En desarrollo puedes usar `.env` en la raiz del proyecto:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Notas:

- `SUPABASE_SERVICE_ROLE_KEY` se usa solo en el proceso principal.
- El renderer ya toma la configuracion publica desde `window.pos.config`.
- En release, la app busca configuracion en este orden:
  - `POS_RUNTIME_CONFIG_PATH`
  - `./pos-runtime.env`
  - `./.env`
  - `pos-runtime.env` junto al `.exe`
  - `pos-runtime.env` dentro de `resources`

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
npm run build:release
npm run build:official
npm run build:signed
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

- `productName`: `POS Multimodal`
- `appId`: `com.oscarzamudio.posmultimodal`
- `package name`: `pos-multimodal`
- `version actual`: `0.1.0`
- Windows: instalador NSIS
- macOS: build configurado con permisos de camara, microfono, Documents y Downloads
- Linux: `AppImage`, `snap` y `deb`

Artefactos:

- los builds oficiales salen en `release/`
- Windows genera un instalador `POS Multimodal-x.y.z-setup.exe`
- tambien puedes usar `npm run build:unpack` para probar la app sin instalador

### Release MVP en Windows

1. Instala dependencias:

```bash
npm install
```

2. Si `better-sqlite3` necesita recompilarse:

```bash
npm run rebuild:native
```

3. Genera el instalador:

```bash
npm run build:official
```

4. Toma como base [build/pos-runtime.env.example](./build/pos-runtime.env.example) y crea un archivo `build/pos-runtime.env` solo en la maquina de release.

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_PUBLISHABLE_KEY=tu-publishable-key
SUPABASE_ANON_KEY=tu-anon-key
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

5. El instalador incluira `pos-runtime.env` y `pos-runtime.env.example` dentro de `resources`. No subas `build/pos-runtime.env` al repo.

Notas practicas:

- la base local queda en `app.getPath('userData')/data/pos-local.db`
- los iconos de release salen de `build/icon.ico`, `build/icon.icns` y `build/icon.png`
- el instalador permite elegir carpeta de instalacion
- el ejecutable de Windows sale como `POSMultimodal.exe`
- el instalador final queda en `release/POS Multimodal-x.y.z-setup.exe`

### Firma y distribucion

Para una release comercial en Windows, el siguiente paso recomendado es firmar el instalador y el ejecutable.

Variables tipicas de `electron-builder` para firma:

```env
CSC_LINK=
CSC_KEY_PASSWORD=
WIN_CSC_LINK=
WIN_CSC_KEY_PASSWORD=
```

Recomendacion:

- no guardes esas variables en el repo
- cargalas solo en tu entorno de release
- usa el build firmado solo para distribucion
- antes de publicar, instala el `.exe` en una maquina limpia y valida:
  - login
  - lectura de `pos-runtime.env`
  - escritura de SQLite local
  - sincronizacion con Supabase

### Release firmado en Windows

1. Exporta el certificado y password en la misma terminal:

```powershell
$env:WIN_CSC_LINK="C:\ruta\certificado\pos-code-signing.pfx"
$env:WIN_CSC_KEY_PASSWORD="tu-password"
```

2. Ejecuta el build firmado:

```powershell
npm.cmd run build:signed
```

3. El script validara la firma de estos artefactos:

- `release/POS Multimodal-x.y.z-setup.exe`
- `release/win-unpacked/POSMultimodal.exe`

Si no quieres usar el script, `electron-builder` tambien firmara automaticamente con esas variables al correr `npm run build:official`.

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
