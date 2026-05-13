export const localSchema = `
CREATE TABLE IF NOT EXISTS "User" (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  "passwordHashLocal" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRemoteLoginAt" TEXT,
  "deletedAt" TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_username
  ON "User"(username);

CREATE TABLE IF NOT EXISTS "Product" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "publicId" TEXT NOT NULL UNIQUE,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0,
  "profitPctBp" INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  "stockMin" INTEGER NOT NULL DEFAULT 0,
  "stockMax" INTEGER NOT NULL DEFAULT 0,
  "imagePath" TEXT,
  "taxRateBp" INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  "categoryId" INTEGER,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "deletedAt" TEXT
);

CREATE TABLE IF NOT EXISTS "Category" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "publicId" TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "deletedAt" TEXT
);

CREATE TABLE IF NOT EXISTS "Sale" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "publicId" TEXT NOT NULL UNIQUE,
  folio TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  total INTEGER NOT NULL,
  "cashierId" INTEGER NOT NULL,
  "originDeviceId" TEXT,
  "syncedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- itemType values: 'PRODUCT' | 'SERVICE'  (uppercase, mirrors Supabase enum)
-- price column renamed to unitPrice; computed columns mirror Supabase migration
CREATE TABLE IF NOT EXISTS "SaleItem" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "publicId" TEXT NOT NULL UNIQUE,
  "salePublicId" TEXT NOT NULL,
  "itemType" TEXT NOT NULL,
  "productPublicId" TEXT,
  "servicePublicId" TEXT,
  "originalProductId" INTEGER,
  "originalServiceId" INTEGER,
  qty INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  "lineTotal" INTEGER NOT NULL,
  "lineSubtotal" INTEGER,
  "lineTax" INTEGER NOT NULL DEFAULT 0,
  "lineCostTotal" INTEGER,
  "lineProfit" INTEGER,
  "itemCodeSnapshot" TEXT,
  "itemNameSnapshot" TEXT,
  "itemCategorySnapshot" TEXT,
  "itemSkuSnapshot" TEXT,
  "itemBarcodeSnapshot" TEXT,
  "unitCostSnapshot" INTEGER,
  "unitTaxRateBpSnapshot" INTEGER,
  "unitProfitPctBpSnapshot" INTEGER,
  "inventoryTracked" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Payment" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "publicId" TEXT NOT NULL UNIQUE,
  "salePublicId" TEXT NOT NULL,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reference TEXT,
  "originDeviceId" TEXT,
  "syncedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Service" (
  id INTEGER PRIMARY KEY,
  "publicId" TEXT UNIQUE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  "durationMin" INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0,
  "profitPctBp" INTEGER NOT NULL DEFAULT 0,
  "taxRateBp" INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "deletedAt" TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_code ON "Service"(code);

CREATE TABLE IF NOT EXISTS "ServiceSupply" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "serviceId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  UNIQUE("serviceId", "productId"),
  FOREIGN KEY("serviceId") REFERENCES "Service"(id) ON DELETE CASCADE,
  FOREIGN KEY("productId") REFERENCES "Product"(id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_name TEXT NOT NULL,
  entity_public_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  retries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- sourceType mirrors Supabase enum InventorySourceType:
--   SALE | SALE_CANCEL | SERVICE_CONSUMPTION | PURCHASE |
--   ADJUSTMENT | RETURN | OPENING_STOCK | MANUAL
CREATE TABLE IF NOT EXISTS "InventoryMovement" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "publicId" TEXT UNIQUE,
  type TEXT,
  "productId" INTEGER,
  "originalProductId" INTEGER,
  "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceId" INTEGER,
  qty INTEGER NOT NULL,
  reason TEXT,
  "stockBefore" INTEGER,
  "stockAfter" INTEGER,
  "userId" INTEGER,
  note TEXT,
  "saleId" INTEGER,
  "saleItemId" INTEGER,
  "relatedServiceId" INTEGER,
  "relatedServiceOriginalId" INTEGER,
  "productPublicIdSnapshot" TEXT,
  "productCodeSnapshot" TEXT,
  "productNameSnapshot" TEXT,
  "relatedServiceNameSnapshot" TEXT,
  "unitCostSnapshot" INTEGER,
  "metaJson" TEXT NOT NULL DEFAULT '{}',
  "originDeviceId" TEXT,
  "syncedAt" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT,
  FOREIGN KEY("productId")   REFERENCES "Product"(id) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY("userId")      REFERENCES "User"(id),
  FOREIGN KEY("saleId")      REFERENCES "Sale"(id) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY("saleItemId")  REFERENCES "SaleItem"(id) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY("relatedServiceId") REFERENCES "Service"(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_product_code ON "Product"(sku, barcode);
CREATE INDEX IF NOT EXISTS idx_product_active ON "Product"(active, "deletedAt");
CREATE INDEX IF NOT EXISTS idx_sale_cashier ON "Sale"("cashierId");
CREATE INDEX IF NOT EXISTS idx_sale_item_sale ON "SaleItem"("salePublicId");
CREATE INDEX IF NOT EXISTS idx_payment_sale ON "Payment"("salePublicId");
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_name, status);
CREATE INDEX IF NOT EXISTS idx_inv_move_product ON "InventoryMovement"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_inv_move_sourceType ON "InventoryMovement"("sourceType");
CREATE INDEX IF NOT EXISTS idx_saleitem_itemType ON "SaleItem"("itemType");
CREATE INDEX IF NOT EXISTS idx_saleitem_originalProductId ON "SaleItem"("originalProductId");
`

// Applied once on existing databases to add new columns without losing data.
// SQLite 3.37+ supports ADD COLUMN IF NOT EXISTS.
export const localMigrations = `
ALTER TABLE "Sale" ADD COLUMN "originDeviceId" TEXT;

ALTER TABLE "SaleItem" ADD COLUMN "originalProductId" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "originalServiceId" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "lineSubtotal" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "lineTax" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SaleItem" ADD COLUMN "lineCostTotal" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "lineProfit" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "itemCodeSnapshot" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "itemNameSnapshot" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "itemCategorySnapshot" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "itemSkuSnapshot" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "itemBarcodeSnapshot" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "unitCostSnapshot" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "unitTaxRateBpSnapshot" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "unitProfitPctBpSnapshot" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "inventoryTracked" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "InventoryMovement" ADD COLUMN "originalProductId" INTEGER;
ALTER TABLE "InventoryMovement" ADD COLUMN "publicId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN type TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "saleId" INTEGER;
ALTER TABLE "InventoryMovement" ADD COLUMN "saleItemId" INTEGER;
ALTER TABLE "InventoryMovement" ADD COLUMN "sourceId" INTEGER;
ALTER TABLE "InventoryMovement" ADD COLUMN "relatedServiceId" INTEGER;
ALTER TABLE "InventoryMovement" ADD COLUMN "relatedServiceOriginalId" INTEGER;
ALTER TABLE "InventoryMovement" ADD COLUMN reason TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "productPublicIdSnapshot" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "productCodeSnapshot" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "productNameSnapshot" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "relatedServiceNameSnapshot" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "unitCostSnapshot" INTEGER;
ALTER TABLE "InventoryMovement" ADD COLUMN "metaJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "InventoryMovement" ADD COLUMN "originDeviceId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "syncedAt" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "updatedAt" TEXT;

ALTER TABLE "Service" ADD COLUMN "taxRateBp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ServiceSupply" ADD COLUMN "createdAt" TEXT;
ALTER TABLE "ServiceSupply" ADD COLUMN "updatedAt" TEXT;
`
