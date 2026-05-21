# Pendientes del sistema POS

Encontrados durante simulación de venta completa (2026-05-20).

---

## CRÍTICO

### 1. Ticket / recibo no implementado
El flujo de venta completa termina sin comprobante. El folio se genera correctamente
(`VTA-YYYYMMDD-XXXX-YYYYYYYY`) pero no hay handler de impresión, componente de
recibo, ni salida en PDF. En producción el cliente no recibe nada.

### 2. IVA siempre cero
`lineTax` está hardcodeado a `0` en `sales.core.ts`. Los campos `taxRateBp` existen
en catálogo y se capturan como snapshot, pero el cálculo nunca se ejecuta.
Incumplimiento fiscal si se requiere desglose de IVA (16%) en los tickets.

---

## ALTO

### 3. Descuento por línea no funcional
La UI tiene estado `discount` global (nivel de venta) pero `SaleItem.discount` siempre
se envía como `0` en `SalesPage.tsx` (~línea 1390). Un cajero no puede aplicar
descuento a un producto específico del carrito.

### 4. Feedback de error de stock en la UI poco claro
El core (`sales.core.ts`) valida y retorna `StockErrorItem[]` correctamente, pero
hay que verificar que `SalesPage` muestre el error de forma visible al cajero y no
solo en consola.

---

## MEDIO

### 5. `window.prompt()` para descuento — mala UX
El descuento de venta se captura con el `prompt()` nativo del navegador (~línea 1566).
Frágil en Electron y con UX pobre. Debería ser un modal propio del diseño.

### 6. Corte de caja end-to-end sin verificar
La modal existe y la lógica de `sales:confirmCorte` está implementada, pero no se ha
probado el flujo completo (apertura de sesión → movimientos → confirmCorte).

---

## BAJO

### 7. ~~Paginación del catálogo~~
~~500 ítems por página cargados de golpe antes de mostrar el catálogo. Con catálogos~~
~~grandes el cajero espera más de lo necesario.~~
**RESUELTO** — Implementada carga progresiva por lotes con indicador de progreso.

### 8. Sin indicador de modo offline
Si Supabase falla, la venta local sí se guarda (SQLite), pero no hay indicador visual
de "operando sin conexión". El cajero no sabe si la sincronización está activa.
