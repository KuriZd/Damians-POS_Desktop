# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
npm run dev          # Start Electron + Vite dev server with HMR
npm run build        # Full TypeScript check + electron-vite build
npm run typecheck    # Run both node and web TypeScript checks
npm run lint         # ESLint with cache
npm run format       # Prettier formatting
npm run rebuild:native  # Rebuild better-sqlite3 after Node/Electron version change
npm run build:win    # Build NSIS installer for Windows
```

No automated test suite exists yet (no jest/vitest/playwright configured).

---

## Architecture

This is a **local-first POS desktop app** (Electron + React 19 + TypeScript + SQLite + Supabase). It runs in three processes:

### Main Process (`src/main/`)

- Owns the SQLite database (`better-sqlite3`) at `app.getPath('userData')/data/pos-local.db`
- Registers all IPC handlers in `src/main/ipc/*.ipc.ts` (one file per domain)
- Holds the privileged Supabase admin client (`src/main/supabase/client.ts`)
- Window config: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (required for better-sqlite3)

### Preload Process (`src/preload/index.ts`)

- Exposes `window.pos` via `contextBridge` — the **only** communication surface to the renderer
- All IPC calls flow through `ipcRenderer.invoke()`; the renderer never calls Node directly
- Type definitions in `src/preload/index.d.ts`

### Renderer Process (`src/renderer/src/`)

- React 19 SPA with CSS Modules; no global state manager (React hooks + localStorage only)
- `App.tsx` restores session and routes between `LoginPage` and `AppLayout`
- `AppLayout` mounts sidebar, top nav, auto-sync (`useSync` hook), and module routing
- Path alias: `@renderer/*` → `src/renderer/src/*`

---

## IPC Pattern

Every feature domain follows the same three-layer pattern:

```
src/main/ipc/{domain}.ipc.ts   ← ipcMain.handle() registrations
src/preload/index.ts           ← window.pos.{domain}.{method}()
src/renderer/src/pages/        ← UI calling window.pos.*
```

Existing domains: `auth`, `dashboard`, `inventory`, `products`, `sales`, `services`, `sync`, `users`.

To add a new IPC endpoint: add the handler in `src/main/ipc/`, expose it in preload, and register in `src/main/index.ts`.

---

## Database

**Local SQLite** (via better-sqlite3):

- Schema and migration logic in `src/main/db/local-schema.ts`
- WAL journal mode, foreign keys enabled
- Migration runs on app start: pre-schema renames → DDL → post-schema backfills
- All monetary amounts stored as **integer centavos** (not floats)

**Remote Supabase** (catalog only):

- Two clients: `supabase` (anon key, public RPC) and `supabaseAdmin` (service role, user management only)
- `supabaseAdmin` must **never** be used from the renderer
- Runtime config loaded via `src/shared/runtime-config.ts` (reads from `POS_RUNTIME_CONFIG_PATH`, `.env`, or `pos-runtime.env`)

**Sync** (pull-only today):

- `useSync` hook calls `window.pos.sync.pullAll()` on mount and every 6 hours
- `pullAll()` replaces local Category, Product, Service, ServiceSupply from Supabase
- Push pipeline (`pushPending`) and conflict resolution are scaffolded but not implemented

---

## Key Data Model Notes

- `SaleItem` uses `unitPrice` (not `price`); stores `lineSubtotal`, `lineTax`, `lineCostTotal`, `lineProfit`
- `SaleItem` and `InventoryMovement` store **snapshots** of catalog data at time of sale for historical traceability
- `InventoryMovement.sourceType` values: `SALE`, `SALE_CANCEL`, `SERVICE_CONSUMPTION`, `PURCHASE`, `ADJUSTMENT`, `RETURN`, `OPENING_STOCK`, `MANUAL`
- `itemType` is normalized to `PRODUCT` or `SERVICE` everywhere

---

## Role-Based Access

| Role         | Modules                                      |
| ------------ | -------------------------------------------- |
| `ADMIN`      | dashboard, products, inventory, sales, users |
| `SUPERVISOR` | dashboard, products, inventory, sales, users |
| `CASHIER`    | sales only                                   |

---

## Environment Variables

```env
# Main process only (never expose to renderer)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Renderer (VITE_ prefix required for vite to expose)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## Known Incomplete Areas

- `pushPending()` returns `{ pushed: 0, failed: 0 }` — no real push pipeline
- `conflicts()` always returns `conflictCount: 0`
- "Corte de caja" is stubbed in the UI but not implemented
- Several UI files have text encoding issues (special characters)

---

## Supabase Schema (Remote)

See `CLAUDE.md` SQL block below for the canonical migration that defines `SaleItem` and `InventoryMovement` columns, constraints, indexes, and the `vw_ItemSalesAudit` view used in production.

---

esta es la base de datos que estamos utilizando en supabase begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'InventorySourceType'
  ) then
    create type "InventorySourceType" as enum (
      'SALE',
      'SALE_CANCEL',
      'SERVICE_CONSUMPTION',
      'PURCHASE',
      'ADJUSTMENT',
      'RETURN',
      'OPENING_STOCK',
      'MANUAL'
    );
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'SaleItem'
      and column_name = 'price'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'SaleItem'
      and column_name = 'unitPrice'
  ) then
    alter table "SaleItem" rename column "price" to "unitPrice";
  end if;
end $$;

alter table "SaleItem"
  add column if not exists "originalProductId" int4,
  add column if not exists "originalServiceId" int4,
  add column if not exists "catalogPublicId" uuid,
  add column if not exists "itemCodeSnapshot" text,
  add column if not exists "itemNameSnapshot" text,
  add column if not exists "itemCategorySnapshot" text,
  add column if not exists "itemSkuSnapshot" text,
  add column if not exists "itemBarcodeSnapshot" text,
  add column if not exists "unitCostSnapshot" int4,
  add column if not exists "unitTaxRateBpSnapshot" int4,
  add column if not exists "unitProfitPctBpSnapshot" int4,
  add column if not exists "lineSubtotal" int4,
  add column if not exists "lineTax" int4 not null default 0,
  add column if not exists "lineCostTotal" int4,
  add column if not exists "lineProfit" int4,
  add column if not exists "inventoryTracked" boolean not null default false;

update "SaleItem" si
set
  "originalProductId" = coalesce(si."originalProductId", si."productId"),
  "catalogPublicId" = coalesce(si."catalogPublicId", p."publicId"),
  "itemCodeSnapshot" = coalesce(si."itemCodeSnapshot", p."sku"),
  "itemNameSnapshot" = coalesce(si."itemNameSnapshot", p."name"),
  "itemCategorySnapshot" = coalesce(si."itemCategorySnapshot", c."name"),
  "itemSkuSnapshot" = coalesce(si."itemSkuSnapshot", p."sku"),
  "itemBarcodeSnapshot" = coalesce(si."itemBarcodeSnapshot", p."barcode"),
  "unitCostSnapshot" = coalesce(si."unitCostSnapshot", p."cost", 0),
  "unitTaxRateBpSnapshot" = coalesce(si."unitTaxRateBpSnapshot", p."taxRateBp", 0),
  "unitProfitPctBpSnapshot" = coalesce(si."unitProfitPctBpSnapshot", p."profitPctBp", 0),
  "lineSubtotal" = coalesce(si."lineSubtotal", (si."qty" * si."unitPrice") - coalesce(si."discount", 0)),
  "lineCostTotal" = coalesce(si."lineCostTotal", coalesce(p."cost", 0) * si."qty"),
  "lineProfit" = coalesce(si."lineProfit", si."lineTotal" - (coalesce(p."cost", 0) * si."qty")),
  "inventoryTracked" = true
from "Product" p
left join "Category" c on c."id" = p."categoryId"
where si."productId" = p."id";

update "SaleItem" si
set
  "originalServiceId" = coalesce(si."originalServiceId", si."serviceId"),
  "catalogPublicId" = coalesce(si."catalogPublicId", s."publicId"),
  "itemCodeSnapshot" = coalesce(si."itemCodeSnapshot", s."code"),
  "itemNameSnapshot" = coalesce(si."itemNameSnapshot", s."name"),
  "unitCostSnapshot" = coalesce(si."unitCostSnapshot", s."cost", 0),
  "unitTaxRateBpSnapshot" = coalesce(si."unitTaxRateBpSnapshot", s."taxRateBp", 0),
  "unitProfitPctBpSnapshot" = coalesce(si."unitProfitPctBpSnapshot", s."profitPctBp", 0),
  "lineSubtotal" = coalesce(si."lineSubtotal", (si."qty" * si."unitPrice") - coalesce(si."discount", 0)),
  "lineCostTotal" = coalesce(si."lineCostTotal", coalesce(s."cost", 0) * si."qty"),
  "lineProfit" = coalesce(si."lineProfit", si."lineTotal" - (coalesce(s."cost", 0) * si."qty")),
  "inventoryTracked" = false
from "Service" s
where si."serviceId" = s."id";

update "SaleItem"
set
  "itemCodeSnapshot" = coalesce("itemCodeSnapshot", 'SIN-CODIGO'),
  "itemNameSnapshot" = coalesce("itemNameSnapshot", 'ITEM SIN NOMBRE'),
  "lineSubtotal" = coalesce("lineSubtotal", ("qty" * "unitPrice") - coalesce("discount", 0)),
  "lineCostTotal" = coalesce("lineCostTotal", 0),
  "lineProfit" = coalesce("lineProfit", "lineTotal" - coalesce("lineCostTotal", 0));

alter table "SaleItem"
alter column "itemCodeSnapshot" set not null,
alter column "itemNameSnapshot" set not null,
alter column "lineSubtotal" set not null,
alter column "lineCostTotal" set not null,
alter column "lineProfit" set not null;

alter table "SaleItem"
drop constraint if exists "SaleItem_item_reference_check";

alter table "SaleItem"
add constraint "SaleItem_item_reference_check"
check (
(
"itemType"::text = 'PRODUCT'
and "serviceId" is null
and "originalProductId" is not null
)
or
(
"itemType"::text = 'SERVICE'
and "productId" is null
and "originalServiceId" is not null
)
);

alter table "SaleItem"
drop constraint if exists "SaleItem_productId_fkey",
drop constraint if exists "SaleItem_serviceId_fkey";

alter table "SaleItem"
add constraint "SaleItem_productId_fkey"
foreign key ("productId")
references "Product"("id")
on update cascade
on delete set null,
add constraint "SaleItem_serviceId_fkey"
foreign key ("serviceId")
references "Service"("id")
on update cascade
on delete set null;

alter table "InventoryMovement"
alter column "productId" drop not null;

alter table "InventoryMovement"
add column if not exists "originalProductId" int4,
add column if not exists "sourceType" "InventorySourceType" not null default 'MANUAL',
add column if not exists "sourceId" int4,
add column if not exists "saleId" int4,
add column if not exists "saleItemId" int4,
add column if not exists "relatedServiceId" int4,
add column if not exists "relatedServiceOriginalId" int4,
add column if not exists "productPublicIdSnapshot" uuid,
add column if not exists "productCodeSnapshot" text,
add column if not exists "productNameSnapshot" text,
add column if not exists "relatedServiceNameSnapshot" text,
add column if not exists "stockBefore" int4,
add column if not exists "stockAfter" int4,
add column if not exists "unitCostSnapshot" int4,
add column if not exists "metaJson" jsonb not null default '{}'::jsonb;

update "InventoryMovement" im
set
"originalProductId" = coalesce(im."originalProductId", im."productId"),
"productPublicIdSnapshot" = coalesce(im."productPublicIdSnapshot", p."publicId"),
"productCodeSnapshot" = coalesce(im."productCodeSnapshot", p."sku"),
"productNameSnapshot" = coalesce(im."productNameSnapshot", p."name"),
"unitCostSnapshot" = coalesce(im."unitCostSnapshot", p."cost")
from "Product" p
where im."productId" = p."id";

update "InventoryMovement"
set
"productCodeSnapshot" = coalesce("productCodeSnapshot", 'SIN-CODIGO'),
"productNameSnapshot" = coalesce("productNameSnapshot", 'PRODUCTO SIN NOMBRE');

alter table "InventoryMovement"
alter column "productCodeSnapshot" set not null,
alter column "productNameSnapshot" set not null;

alter table "InventoryMovement"
drop constraint if exists "InventoryMovement_productId_fkey";

alter table "InventoryMovement"
add constraint "InventoryMovement_productId_fkey"
foreign key ("productId")
references "Product"("id")
on update cascade
on delete set null;

alter table "InventoryMovement"
drop constraint if exists "InventoryMovement_saleId_fkey",
drop constraint if exists "InventoryMovement_saleItemId_fkey",
drop constraint if exists "InventoryMovement_relatedServiceId_fkey";

alter table "InventoryMovement"
add constraint "InventoryMovement_saleId_fkey"
foreign key ("saleId")
references "Sale"("id")
on update cascade
on delete set null,
add constraint "InventoryMovement_saleItemId_fkey"
foreign key ("saleItemId")
references "SaleItem"("id")
on update cascade
on delete set null,
add constraint "InventoryMovement_relatedServiceId_fkey"
foreign key ("relatedServiceId")
references "Service"("id")
on update cascade
on delete set null;

create index if not exists "SaleItem_createdAt_idx" on "SaleItem" ("createdAt");
create index if not exists "SaleItem_itemType_idx" on "SaleItem" ("itemType");
create index if not exists "SaleItem_itemCodeSnapshot_idx" on "SaleItem" ("itemCodeSnapshot");
create index if not exists "SaleItem_itemNameSnapshot_idx" on "SaleItem" ("itemNameSnapshot");
create index if not exists "SaleItem_originalProductId_idx" on "SaleItem" ("originalProductId");
create index if not exists "SaleItem_originalServiceId_idx" on "SaleItem" ("originalServiceId");

create index if not exists "InventoryMovement_createdAt_idx" on "InventoryMovement" ("createdAt");
create index if not exists "InventoryMovement_sourceType_idx" on "InventoryMovement" ("sourceType");
create index if not exists "InventoryMovement_saleId_idx" on "InventoryMovement" ("saleId");
create index if not exists "InventoryMovement_saleItemId_idx" on "InventoryMovement" ("saleItemId");
create index if not exists "InventoryMovement_originalProductId_idx" on "InventoryMovement" ("originalProductId");

create or replace view "vw_ItemSalesAudit" as
select
si."itemType",
si."originalProductId",
si."originalServiceId",
si."catalogPublicId",
si."itemCodeSnapshot",
si."itemNameSnapshot",
si."itemCategorySnapshot",
sum(si."qty")::bigint as "qtySold",
sum(si."lineSubtotal")::bigint as "subtotalSold",
sum(si."lineTax")::bigint as "taxSold",
sum(si."lineTotal")::bigint as "totalSold",
sum(si."lineCostTotal")::bigint as "costSold",
sum(si."lineProfit")::bigint as "profitSold",
min(si."createdAt") as "firstSoldAt",
max(si."createdAt") as "lastSoldAt"
from "SaleItem" si
group by
si."itemType",
si."originalProductId",
si."originalServiceId",
si."catalogPublicId",
si."itemCodeSnapshot",
si."itemNameSnapshot",
si."itemCategorySnapshot";

commit;
