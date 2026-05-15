import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type ChangeEvent,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import { FiX, FiSave, FiImage, FiHelpCircle, FiPlus, FiCheck } from 'react-icons/fi'
import { MdOutlineQrCode2 } from 'react-icons/md'
import { CiBarcode } from 'react-icons/ci'
import { QRCodeSVG } from 'qrcode.react'
import styles from './AddProductModal.module.css'
import { productRepository, type CreateProductPayload } from '../../repositories/productRepository'
import { supabase } from '../../lib/supabaseClient'
import { bpToPctString, formatNumber, percentToBp } from '../../lib/formatters'
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner'

type Category = { id: number; name: string }

async function fetchCategoriesFromSupabase(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('Category')
    .select('id, name')
    .is('deletedAt', null)
    .order('name', { ascending: true })
  if (error) return []
  return (data ?? []) as Category[]
}

async function createCategoryInSupabase(name: string): Promise<Category | null> {
  const { data, error } = await supabase
    .from('Category')
    .insert({ name: name.trim(), publicId: crypto.randomUUID() })
    .select('id, name')
    .single()
  if (error) return null
  return data as Category
}

type Props = {
  open: boolean
  onClose: () => void
  productId?: number | null
  productID?: number | null
}

type FormState = {
  code: string
  name: string
  stockMin: string
  stockMax: string
  buyPrice: string
  sellPrice: string
  stock: string
  profitPct: string
  categoryId: number | null
}

const initialState: FormState = {
  code: '',
  name: '',
  stockMin: '',
  stockMax: '',
  buyPrice: '',
  sellPrice: '',
  stock: '',
  profitPct: '',
  categoryId: null
}

type PriceEditMode = 'sell' | 'pct' | null
type ImageIntent = 'keep' | 'replace' | 'remove'
type DataSource = 'local' | 'supabase'

type ProductDetails = {
  id: number
  sku: string
  name: string
  price: number
  cost: number
  profitPctBp: number
  stock: number
  stockMin: number
  stockMax: number
  imageUrl?: string | null
  imagePath?: string | null
}

type SupabaseProductRow = {
  id: number | string
  sku?: string | null
  code?: string | null
  name?: string | null
  price?: number | null
  cost?: number | null
  profit_pct_bp?: number | null
  profitPctBp?: number | null
  stock?: number | null
  stock_min?: number | null
  stockMin?: number | null
  stock_max?: number | null
  stockMax?: number | null
  image_url?: string | null
  imageUrl?: string | null
  image_path?: string | null
  imagePath?: string | null
  active?: boolean | null
}

type ProductsBridge = {
  get?: (id: number) => Promise<ProductDetails>
  update?: (id: number, payload: Partial<CreateProductPayload>) => Promise<void>
  getBySku?: (sku: string) => Promise<ProductDetails | null>
}

function getProductsBridge(): ProductsBridge | null {
  const w = window as unknown as { pos?: { products?: ProductsBridge } }
  return w.pos?.products ?? null
}

function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
}

function getCryptoRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0

  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
  if (!hasCrypto) return Math.floor(Math.random() * maxExclusive)

  const range = 0xffffffff
  const limit = range - (range % maxExclusive)
  const buffer = new Uint32Array(1)

  let x = 0
  do {
    crypto.getRandomValues(buffer)
    x = buffer[0]
  } while (x >= limit)

  return x % maxExclusive
}

function generate8DigitCode(): string {
  const value = getCryptoRandomInt(100_000_000)
  return String(value).padStart(8, '0')
}

function parseDecimal(input: string): number | null {
  const raw = input.trim()
  if (!raw) return null

  const normalized = raw.replace(/\s+/g, '').replace(/,/g, '.')
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null

  return n
}

function parseInteger(input: string): number | null {
  const raw = input.trim()
  if (!raw) return null

  const n = Number(raw)
  if (!Number.isFinite(n)) return null

  return Math.trunc(n)
}

// formatNumber, percentToBp, bpToPctString imported from formatters

function computeProfitPct(buy: number, sell: number): number | null {
  if (!(buy > 0)) return null
  return ((sell - buy) / buy) * 100
}

function computeSellPrice(buy: number, pct: number): number | null {
  if (!(buy > 0)) return null
  return buy * (1 + pct / 100)
}

function toCents(value: number): number {
  return Math.round(value * 100)
}

function fromCentsToInput(cents: number): string {
  return formatNumber((cents ?? 0) / 100, 2)
}

const bpToPctInput = bpToPctString

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.readAsDataURL(file)
  })
}

async function buildCreateProductPayload(
  form: FormState,
  imageFile: File | null
): Promise<CreateProductPayload> {
  const buy = parseDecimal(form.buyPrice) ?? 0
  const sell = parseDecimal(form.sellPrice) ?? 0
  const pct = parseDecimal(form.profitPct) ?? 0

  const payload: CreateProductPayload = {
    sku: form.code.trim(),
    name: form.name.trim(),
    stock: parseInteger(form.stock) ?? 0,
    stockMin: parseInteger(form.stockMin) ?? 0,
    stockMax: parseInteger(form.stockMax) ?? 0,
    cost: toCents(buy),
    price: toCents(sell),
    profitPctBp: percentToBp(pct),
    imageDataUrl: null,
    categoryId: form.categoryId ?? null
  }

  if (imageFile) payload.imageDataUrl = await fileToDataUrl(imageFile)
  return payload
}

async function buildUpdateProductPayload(
  form: FormState,
  imageFile: File | null,
  imageIntent: ImageIntent
): Promise<Partial<CreateProductPayload>> {
  const buy = parseDecimal(form.buyPrice) ?? 0
  const sell = parseDecimal(form.sellPrice) ?? 0
  const pct = parseDecimal(form.profitPct) ?? 0

  const payload: Partial<CreateProductPayload> = {
    sku: form.code.trim(),
    name: form.name.trim(),
    stock: parseInteger(form.stock) ?? 0,
    stockMin: parseInteger(form.stockMin) ?? 0,
    stockMax: parseInteger(form.stockMax) ?? 0,
    cost: toCents(buy),
    price: toCents(sell),
    profitPctBp: percentToBp(pct),
    categoryId: form.categoryId ?? null
  }

  if (imageIntent === 'remove') {
    payload.imageDataUrl = null
    return payload
  }

  if (imageIntent === 'replace') {
    if (!imageFile) return payload
    payload.imageDataUrl = await fileToDataUrl(imageFile)
    return payload
  }

  return payload
}

function toRenderableImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null

  const v = value.trim()
  if (/^(data:|file:|https?:)/i.test(v)) return v

  const normalizedPath = v.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalizedPath)) return `file:///${normalizedPath}`
  if (normalizedPath.startsWith('/')) return `file://${normalizedPath}`

  return `file:///${normalizedPath}`
}

const QR_DOWNLOAD_SIZE = 512

function buildQrPayload(sku: string, name: string): string {
  return JSON.stringify({ v: 1, sku, name })
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40)
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function getSvgMarkup(svg: SVGElement, size: number): string {
  const clone = svg.cloneNode(true) as SVGElement
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(size))
  clone.setAttribute('height', String(size))
  return new XMLSerializer().serializeToString(clone)
}

async function downloadQrSvgAsPng(svg: SVGElement, filename: string, size: number): Promise<void> {
  const markup = getSvgMarkup(svg, size)
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo preparar el QR para descarga'))
    img.src = svgDataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo generar el QR (canvas no disponible)')

  ctx.drawImage(img, 0, 0, size, size)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No se pudo generar el PNG'))),
      'image/png'
    )
  })

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function mapSupabaseRowToDetails(row: SupabaseProductRow): ProductDetails {
  return {
    id: Number(row.id),
    sku: row.sku ?? row.code ?? '',
    name: row.name ?? '',
    price: Number(row.price ?? 0),
    cost: Number(row.cost ?? 0),
    profitPctBp: Number(row.profit_pct_bp ?? row.profitPctBp ?? 0),
    stock: Number(row.stock ?? 0),
    stockMin: Number(row.stock_min ?? row.stockMin ?? 0),
    stockMax: Number(row.stock_max ?? row.stockMax ?? 0),
    imageUrl: row.imagePath ?? row.image_path ?? null,
    imagePath: row.imagePath ?? row.image_path ?? null
  }
}

async function fetchSupabaseProductById(id: number): Promise<ProductDetails | null> {
  const result = await supabase
    .from('Product')
    .select('*')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  if (result.error) throw new Error(result.error.message)

  const data = (result.data as SupabaseProductRow | null) ?? null
  if (!data) return null

  return mapSupabaseRowToDetails(data)
}

async function fetchSupabaseProductBySku(sku: string): Promise<ProductDetails | null> {
  const normalized = sku.trim()
  if (!normalized) return null

  const result = await supabase
    .from('Product')
    .select('*')
    .eq('sku', normalized)
    .eq('active', true)
    .maybeSingle()

  if (result.error) throw new Error(result.error.message)

  const data = (result.data as SupabaseProductRow | null) ?? null
  if (!data) return null

  return mapSupabaseRowToDetails(data)
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

async function tryLocalGet(id: number): Promise<ProductDetails | null> {
  const productsApi = getProductsBridge()
  const get = productsApi?.get
  if (typeof get !== 'function') return null

  try {
    return await get(id)
  } catch {
    return null
  }
}

async function tryLocalGetBySku(sku: string): Promise<ProductDetails | null> {
  const productsApi = getProductsBridge()
  const getBySku = productsApi?.getBySku
  if (typeof getBySku !== 'function') return null

  try {
    return await getBySku(sku)
  } catch {
    return null
  }
}

type ModalShellProps = {
  onClose: () => void
  children: JSX.Element
}

function ModalShell({ onClose, children }: ModalShellProps): JSX.Element {
  function handleBackdropMouseDown(e: MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  )
}

type ModalHeaderProps = {
  title: string
  onClose: () => void
}

function ModalHeader({ title, onClose }: ModalHeaderProps): JSX.Element {
  return (
    <div className={styles.header}>
      <h3 className={styles.title}>{title}</h3>

      <button className={styles.closeBtn} type="button" onClick={onClose} aria-label="Cerrar">
        <FiX />
      </button>
    </div>
  )
}

type SaveFooterProps = {
  onSave: () => void | Promise<void>
  disabled?: boolean
}

function SaveFooter({ onSave, disabled }: SaveFooterProps): JSX.Element {
  return (
    <div className={styles.footer}>
      <button className={styles.saveBtn} type="button" onClick={onSave} disabled={disabled}>
        <span>{disabled ? 'Guardando...' : 'Guardar'}</span>
        <FiSave />
      </button>
    </div>
  )
}

type ProductFormProps = {
  form: FormState
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  onGenerateCode: () => void
  onDownloadQr: () => void
  onCodeBlur: () => void
  onCodeKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
  codeInputRef?: RefObject<HTMLInputElement | null>
  onBuyPriceChange: (value: string) => void
  onSellPriceChange: (value: string) => void
  onProfitPctChange: (value: string) => void
  onStockChange: (value: string) => void
  categories: Category[]
  addingCategory: boolean
  newCategoryName: string
  savingCategory: boolean
  onOpenAddCategory: () => void
  onCancelAddCategory: () => void
  onNewCategoryNameChange: (v: string) => void
  onSaveNewCategory: () => void
}

function ProductForm({
  form,
  setField,
  onGenerateCode,
  onDownloadQr,
  onCodeBlur,
  onCodeKeyDown,
  codeInputRef,
  onBuyPriceChange,
  onSellPriceChange,
  onProfitPctChange,
  onStockChange,
  categories,
  addingCategory,
  newCategoryName,
  savingCategory,
  onOpenAddCategory,
  onCancelAddCategory,
  onNewCategoryNameChange,
  onSaveNewCategory
}: ProductFormProps): JSX.Element {
  return (
    <div className={styles.form}>
      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Código de Producto</label>

          <div className={styles.codeWrap}>
            <input
              ref={codeInputRef}
              className={styles.input}
              value={form.code}
              onChange={(e) => setField('code', e.target.value)}
              onBlur={onCodeBlur}
              onKeyDown={onCodeKeyDown}
              placeholder="Escanea o escribe el código"
            />

            <div className={styles.codeActions}>
              <button
                className={styles.iconBtn}
                type="button"
                aria-label="Generar código"
                data-tooltip="Generar código"
                title="Generar código"
                onClick={onGenerateCode}
              >
                <CiBarcode />
              </button>

              <button
                className={styles.iconBtn}
                type="button"
                aria-label="Generar QR"
                data-tooltip="Generar QR"
                title="Generar QR"
                onClick={onDownloadQr}
              >
                <MdOutlineQrCode2 />
              </button>

              <button
                className={styles.iconBtn}
                type="button"
                aria-label="Ayuda"
                data-tooltip="Ayuda"
                title="Ayuda"
              >
                <FiHelpCircle />
              </button>
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Nombre del Producto</label>
          <input
            className={styles.input}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder=""
          />
        </div>
      </div>

      <div className={styles.row4}>
        <div className={styles.field}>
          <label className={styles.label}>Stock Mínimo</label>
          <input
            className={styles.input}
            value={form.stockMin}
            onChange={(e) => setField('stockMin', e.target.value)}
            inputMode="numeric"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Stock Máximo</label>
          <input
            className={styles.input}
            value={form.stockMax}
            onChange={(e) => setField('stockMax', e.target.value)}
            inputMode="numeric"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Precio Compra</label>
          <input
            className={styles.input}
            value={form.buyPrice}
            onChange={(e) => onBuyPriceChange(e.target.value)}
            inputMode="decimal"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Precio Venta</label>
          <input
            className={styles.input}
            value={form.sellPrice}
            onChange={(e) => onSellPriceChange(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>

      <div className={styles.row4}>
        <div className={styles.field}>
          <label className={styles.label}>Stock</label>
          <input
            className={styles.input}
            value={form.stock}
            onChange={(e) => onStockChange(e.target.value)}
            inputMode="numeric"
          />
        </div>

        <div className={styles.field} style={{ gridColumn: 'span 2' }}>
          <label className={styles.label}>Categoría</label>
          <div className={styles.categoryRow}>
            <select
              className={styles.select}
              value={form.categoryId ?? ''}
              onChange={(e) =>
                setField('categoryId', e.target.value === '' ? null : Number(e.target.value))
              }
            >
              <option value="">— Sin categoría —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className={styles.addCategoryBtn}
              type="button"
              title="Nueva categoría"
              onClick={onOpenAddCategory}
            >
              <FiPlus />
            </button>
          </div>

          {addingCategory && (
            <div className={styles.categoryRow} style={{ marginTop: 6 }}>
              <input
                className={styles.input}
                placeholder="Nombre de la categoría"
                value={newCategoryName}
                onChange={(e) => onNewCategoryNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveNewCategory()
                  if (e.key === 'Escape') onCancelAddCategory()
                }}
                autoFocus
              />
              <button
                className={styles.addCategoryBtn}
                type="button"
                title="Confirmar"
                disabled={savingCategory || !newCategoryName.trim()}
                onClick={onSaveNewCategory}
              >
                <FiCheck />
              </button>
              <button
                className={styles.cancelBtn}
                type="button"
                title="Cancelar"
                onClick={onCancelAddCategory}
                style={{ height: 34, padding: '0 10px', fontSize: 12 }}
              >
                <FiX />
              </button>
            </div>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Porcentaje de ganancia</label>
          <input
            className={styles.input}
            value={form.profitPct}
            onChange={(e) => onProfitPctChange(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>
    </div>
  )
}

type ImagePanelProps = {
  fileInputRef: RefObject<HTMLInputElement | null>
  previewUrl: string | null
  onPickImage: () => void
  onFileSelected: (file: File | null) => void
  onClearImage: () => void
}

function ImagePanel({
  fileInputRef,
  previewUrl,
  onPickImage,
  onFileSelected,
  onClearImage
}: ImagePanelProps): JSX.Element {
  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] ?? null
    onFileSelected(file)
    e.currentTarget.value = ''
  }

  return (
    <div className={styles.imagePanel}>
      <div className={styles.imageTitle}>Imagen del producto</div>

      <button className={styles.imageBox} type="button" onClick={onPickImage}>
        {previewUrl ? (
          <>
            <img
              className={styles.imagePreview}
              src={previewUrl}
              alt="Vista previa del producto"
              draggable={false}
            />
            <span className={styles.imageOverlay}>Cambiar imagen</span>
          </>
        ) : (
          <>
            <span>Agregar imagen</span>
            <FiImage />
          </>
        )}
      </button>

      {previewUrl ? (
        <button className={styles.clearImageBtn} type="button" onClick={onClearImage}>
          Quitar imagen
        </button>
      ) : null}

      <input
        ref={fileInputRef}
        className={styles.hiddenFile}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />
    </div>
  )
}

type AlertKind = 'error' | 'warning'
type AlertMessage = { kind: AlertKind; text: string; key: string }

export default function AddProductModal({
  open,
  onClose,
  productId,
  productID
}: Props): JSX.Element | null {
  const effectiveProductId = productId ?? productID ?? null
  const isEditMode = Boolean(effectiveProductId)

  const [form, setForm] = useState<FormState>(initialState)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [imageIntent, setImageIntent] = useState<ImageIntent>('remove')
  const [priceEditMode, setPriceEditMode] = useState<PriceEditMode>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isLoadingProduct, setIsLoadingProduct] = useState(false)
  const [sellPriceError, setSellPriceError] = useState<string | null>(null)
  const [stockAlert, setStockAlert] = useState<string | null>(null)
  const [skuError, setSkuError] = useState<string | null>(null)
  const [loadedFrom, setLoadedFrom] = useState<DataSource | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [qrDownloadValue, setQrDownloadValue] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
  const [scanNotice, setScanNotice] = useState<string | null>(null)
  const [isLookingUp, setIsLookingUp] = useState(false)

  const qrRenderRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  const scanNoticeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (imagePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  function clearImage(): void {
    setImageFile(null)
    setImagePreviewUrl(null)
    setImageIntent('remove')
  }

  const closeAll = useCallback(() => {
    setSaveError(null)
    setSyncNotice(null)
    setScanNotice(null)
    setIsLookingUp(false)
    if (scanNoticeTimerRef.current !== null) {
      window.clearTimeout(scanNoticeTimerRef.current)
      scanNoticeTimerRef.current = null
    }
    setIsSaving(false)
    setIsLoadingProduct(false)
    setLoadedFrom(null)
    onClose()
  }, [onClose])

  useEscapeToClose(open, closeAll)

  useEffect(() => {
    if (!open) return
    void fetchCategoriesFromSupabase().then(setCategories)
  }, [open])

  async function handleSaveNewCategory(): Promise<void> {
    const name = newCategoryName.trim()
    if (!name) return
    setSavingCategory(true)
    const created = await createCategoryInSupabase(name)
    if (created) {
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'es')))
      setField('categoryId', created.id)
    }
    setNewCategoryName('')
    setAddingCategory(false)
    setSavingCategory(false)
  }

  useEffect(() => {
    if (!open) return

    setSaveError(null)
    setSyncNotice(null)
    setScanNotice(null)
    setIsLookingUp(false)
    setSellPriceError(null)
    setStockAlert(null)
    setSkuError(null)
    setQrDownloadValue('')
    setPriceEditMode(null)
    setLoadedFrom(null)

    if (!effectiveProductId) {
      setForm(initialState)
      setImageFile(null)
      setImagePreviewUrl(null)
      setImageIntent('remove')
      return
    }

    let cancelled = false
    setIsLoadingProduct(true)

    void (async () => {
      try {
        const localProduct = await tryLocalGet(effectiveProductId)
        const supabaseProduct = localProduct
          ? null
          : await fetchSupabaseProductById(effectiveProductId)
        const product = localProduct ?? supabaseProduct

        if (cancelled) return
        if (!product)
          throw new Error('No se pudo cargar el producto desde local ni desde Supabase.')

        setLoadedFrom(localProduct ? 'local' : 'supabase')
        setForm({
          code: product.sku ?? '',
          name: product.name ?? '',
          stockMin: String(product.stockMin ?? 0),
          stockMax: String(product.stockMax ?? 0),
          buyPrice: fromCentsToInput(product.cost ?? 0),
          sellPrice: fromCentsToInput(product.price ?? 0),
          stock: String(product.stock ?? 0),
          profitPct: bpToPctInput(product.profitPctBp ?? 0),
          categoryId: null
        })

        const existingImage = toRenderableImageUrl(product.imageUrl ?? product.imagePath ?? null)
        if (existingImage) {
          setImagePreviewUrl(existingImage)
          setImageFile(null)
          setImageIntent('keep')
        } else {
          setImagePreviewUrl(null)
          setImageFile(null)
          setImageIntent('remove')
        }

        setPriceEditMode('sell')
      } catch (error) {
        setSaveError(toErrorMessage(error, 'No se pudo cargar el producto'))
      } finally {
        if (!cancelled) setIsLoadingProduct(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, effectiveProductId])

  // Auto-focus code input when modal opens in add mode
  useEffect(() => {
    if (!open || isEditMode) return
    const timer = window.setTimeout(() => codeInputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open, isEditMode])

  function parseScanCode(raw: string): { sku: string; name?: string } | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'sku' in parsed &&
        typeof (parsed as Record<string, unknown>).sku === 'string'
      ) {
        const p = parsed as { sku: string; name?: unknown }
        return { sku: p.sku, name: typeof p.name === 'string' ? p.name : undefined }
      }
    } catch {
      // plain barcode string
    }
    return { sku: trimmed }
  }

  function showScanNotice(text: string): void {
    if (scanNoticeTimerRef.current !== null) window.clearTimeout(scanNoticeTimerRef.current)
    setScanNotice(text)
    scanNoticeTimerRef.current = window.setTimeout(() => {
      setScanNotice(null)
      scanNoticeTimerRef.current = null
    }, 4000)
  }

  async function lookupAndFill(sku: string, nameHint?: string): Promise<void> {
    const normalized = sku.trim()
    if (!normalized) return

    setForm((prev) => ({ ...prev, code: normalized }))
    setSkuError(null)

    setIsLookingUp(true)
    showScanNotice('Buscando producto...')

    try {
      const local = await tryLocalGetBySku(normalized)
      const product = local ?? (await fetchSupabaseProductBySku(normalized))

      if (product) {
        setForm({
          code: product.sku,
          name: product.name,
          stockMin: String(product.stockMin ?? 0),
          stockMax: String(product.stockMax ?? 0),
          buyPrice: fromCentsToInput(product.cost ?? 0),
          sellPrice: fromCentsToInput(product.price ?? 0),
          stock: String(product.stock ?? 0),
          profitPct: bpToPctInput(product.profitPctBp ?? 0),
          categoryId: null
        })
        showScanNotice('Producto encontrado — campos completados.')
      } else {
        if (nameHint) setForm((prev) => ({ ...prev, name: prev.name || nameHint }))
        showScanNotice('Código escaneado. Producto no encontrado en catálogo.')
      }
    } catch {
      showScanNotice('Código escaneado. Producto no encontrado en catálogo.')
    } finally {
      setIsLookingUp(false)
    }
  }

  function handleGlobalScan(code: string): void {
    if (!open || isEditMode) return
    const parsed = parseScanCode(code)
    if (parsed) void lookupAndFill(parsed.sku, parsed.name)
  }

  useBarcodeScanner(handleGlobalScan)

  function handleCodeKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const current = (e.currentTarget as HTMLInputElement).value
    const parsed = parseScanCode(current)
    if (parsed) void lookupAndFill(parsed.sku, parsed.name)
  }

  if (!open) return null

  async function validateSkuUniqueness(sku: string): Promise<boolean> {
    const normalized = sku.trim()
    if (!normalized) {
      setSkuError(null)
      return true
    }

    try {
      const localExisting = await tryLocalGetBySku(normalized)
      if (localExisting && (!effectiveProductId || localExisting.id !== effectiveProductId)) {
        setSkuError(`El código "${normalized}" ya está registrado en la BD local.`)
        return false
      }

      const supabaseExisting = await fetchSupabaseProductBySku(normalized)
      if (supabaseExisting && (!effectiveProductId || supabaseExisting.id !== effectiveProductId)) {
        setSkuError(`El código "${normalized}" ya está registrado en Supabase.`)
        return false
      }

      setSkuError(null)
      return true
    } catch (error) {
      setSkuError(toErrorMessage(error, 'No se pudo validar el código del producto.'))
      return false
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'code') setSkuError(null)
  }

  function ensureProductCode(): string {
    const current = form.code.trim()
    if (current) return current

    const next = generate8DigitCode()
    setField('code', next)
    return next
  }

  function handleGenerateCode(): void {
    const next = generate8DigitCode()
    setField('code', next)
    void validateSkuUniqueness(next)
  }

  async function handleDownloadQr(): Promise<void> {
    try {
      setSaveError(null)

      const sku = ensureProductCode()
      const name = form.name.trim()
      if (!name) throw new Error('Para generar el QR, primero ingresa el nombre del producto.')

      const isUnique = await validateSkuUniqueness(sku)
      if (!isUnique && !isEditMode) {
        throw new Error('El código de producto ya existe. Cambia el código para generar el QR.')
      }

      const payload = buildQrPayload(sku, name)
      setQrDownloadValue(payload)

      await nextAnimationFrame()

      const svg = qrRenderRef.current?.querySelector('svg')
      if (!svg) throw new Error('No se pudo generar el QR para descarga.')

      const safeName = sanitizeFilenamePart(name)
      const filename = `qr_${sku}_${safeName || 'producto'}.png`
      await downloadQrSvgAsPng(svg, filename, QR_DOWNLOAD_SIZE)
    } catch (error) {
      setSaveError(toErrorMessage(error, 'No se pudo descargar el QR'))
    }
  }

  function handlePickImage(): void {
    fileInputRef.current?.click()
  }

  function handleImageSelected(file: File | null): void {
    if (!file) {
      clearImage()
      return
    }

    if (!file.type.startsWith('image/')) return

    if (imagePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl)

    setImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
    setImageIntent('replace')
  }

  function handleClearImage(): void {
    if (imagePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl)
    clearImage()
  }

  function handleStockChange(value: string): void {
    setField('stock', value)

    const stock = parseInteger(value)
    const min = parseInteger(form.stockMin)

    if (stock === null || min === null) {
      setStockAlert(null)
      return
    }

    if (stock < min) {
      setStockAlert(`El stock está por debajo del stock mínimo (${min}).`)
      return
    }

    setStockAlert(null)
  }

  function handleSellPriceChange(value: string): void {
    if (!value.trim()) {
      setSellPriceError(null)
      setPriceEditMode('sell')
      setField('sellPrice', value)
      setField('profitPct', '')
      return
    }

    if (value.includes('-')) {
      setSellPriceError('El precio de venta no puede ser negativo.')
      return
    }

    const sell = parseDecimal(value)
    if (sell !== null && sell < 0) {
      setSellPriceError('El precio de venta no puede ser negativo.')
      return
    }

    setSellPriceError(null)
    setPriceEditMode('sell')
    setField('sellPrice', value)

    const buy = parseDecimal(form.buyPrice)
    if (buy === null || sell === null) return

    const pct = computeProfitPct(buy, sell)
    if (pct === null) return

    setField('profitPct', formatNumber(pct, 2))
  }

  function handleProfitPctChange(value: string): void {
    setPriceEditMode('pct')
    setField('profitPct', value)

    const pct = parseDecimal(value)
    if (pct === null) return

    const buy = parseDecimal(form.buyPrice)
    if (buy === null) return

    const sell = computeSellPrice(buy, pct)
    if (sell === null) return

    setField('sellPrice', formatNumber(sell, 2))
  }

  function handleBuyPriceChange(value: string): void {
    setField('buyPrice', value)

    const buy = parseDecimal(value)
    if (buy === null) return

    if (priceEditMode === 'pct') {
      const pct = parseDecimal(form.profitPct)
      if (pct === null) return

      const sell = computeSellPrice(buy, pct)
      if (sell === null) return

      setField('sellPrice', formatNumber(sell, 2))
      return
    }

    if (priceEditMode === 'sell') {
      const sell = parseDecimal(form.sellPrice)
      if (sell === null) return

      const pct = computeProfitPct(buy, sell)
      if (pct === null) return

      setField('profitPct', formatNumber(pct, 2))
    }
  }

  const profitPctNumber = parseDecimal(form.profitPct)
  const profitPctAlert =
    profitPctNumber !== null && profitPctNumber < 0
      ? 'El porcentaje de ganancia es negativo.'
      : null

  const alerts: AlertMessage[] = [
    skuError ? { key: 'sku', kind: 'error', text: skuError } : null,
    sellPriceError ? { key: 'sell', kind: 'error', text: sellPriceError } : null,
    saveError ? { key: 'save', kind: 'error', text: saveError } : null,
    stockAlert ? { key: 'stock', kind: 'warning', text: stockAlert } : null,
    profitPctAlert ? { key: 'pct', kind: 'warning', text: profitPctAlert } : null,
    syncNotice ? { key: 'sync', kind: 'warning', text: syncNotice } : null
  ].filter((x): x is AlertMessage => x !== null)

  async function handleSave(): Promise<void> {
    if (isSaving || isLoadingProduct) return

    setIsSaving(true)
    setSaveError(null)
    setSyncNotice(null)

    try {
      const code = form.code.trim()
      const name = form.name.trim()

      if (!code) throw new Error('Falta el código del producto')
      if (!name) throw new Error('Falta el nombre del producto')

      const sell = parseDecimal(form.sellPrice)
      if (sell !== null && sell < 0) throw new Error('El precio de venta no puede ser negativo')

      const okSku = await validateSkuUniqueness(code)
      if (!okSku && !isEditMode)
        throw new Error('El código del producto ya existe. Usa otro código.')

      const createPayload = await buildCreateProductPayload(form, imageFile)
      const updatePayload = await buildUpdateProductPayload(form, imageFile, imageIntent)

      if (!effectiveProductId) {
        await productRepository.create(createPayload)
      } else {
        await productRepository.update(effectiveProductId, updatePayload)
      }

      closeAll()
    } catch (error) {
      setSaveError(toErrorMessage(error, 'Error al guardar el producto'))
    } finally {
      setIsSaving(false)
    }
  }

  const modalTitle = isEditMode ? 'Editar Producto' : 'Agregar Producto'
  const sourceLabel =
    loadedFrom === 'local'
      ? 'Fuente: BD local'
      : loadedFrom === 'supabase'
        ? 'Fuente: Supabase'
        : null

  return createPortal(
    <>
      <ModalShell onClose={closeAll}>
        <div className={styles.modal}>
          <ModalHeader title={modalTitle} onClose={closeAll} />

          <div className={styles.body}>
            <div className={styles.contentGrid}>
              <ProductForm
                form={form}
                setField={setField}
                onGenerateCode={handleGenerateCode}
                onDownloadQr={handleDownloadQr}
                onCodeBlur={() => void validateSkuUniqueness(form.code)}
                onCodeKeyDown={handleCodeKeyDown}
                codeInputRef={codeInputRef}
                onBuyPriceChange={handleBuyPriceChange}
                onSellPriceChange={handleSellPriceChange}
                onProfitPctChange={handleProfitPctChange}
                onStockChange={handleStockChange}
                categories={categories}
                addingCategory={addingCategory}
                newCategoryName={newCategoryName}
                savingCategory={savingCategory}
                onOpenAddCategory={() => setAddingCategory(true)}
                onCancelAddCategory={() => {
                  setAddingCategory(false)
                  setNewCategoryName('')
                }}
                onNewCategoryNameChange={setNewCategoryName}
                onSaveNewCategory={() => void handleSaveNewCategory()}
              />

              <ImagePanel
                fileInputRef={fileInputRef}
                previewUrl={imagePreviewUrl}
                onPickImage={handlePickImage}
                onFileSelected={handleImageSelected}
                onClearImage={handleClearImage}
              />
            </div>

            <div
              ref={qrRenderRef}
              style={{
                position: 'absolute',
                left: -99999,
                top: -99999,
                width: 1,
                height: 1,
                overflow: 'hidden'
              }}
              aria-hidden="true"
            >
              <QRCodeSVG value={qrDownloadValue || ' '} size={QR_DOWNLOAD_SIZE} includeMargin />
            </div>

            {isLoadingProduct ? (
              <div style={{ padding: '0 16px', marginTop: 10, opacity: 0.75 }}>
                Cargando producto...
              </div>
            ) : null}

            {!isLoadingProduct && sourceLabel ? (
              <div style={{ padding: '0 16px', marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                {sourceLabel}
              </div>
            ) : null}

            {scanNotice ? (
              <div
                style={{
                  padding: '0 16px',
                  marginTop: 8,
                  fontSize: 12,
                  color: isLookingUp
                    ? '#555'
                    : scanNotice.startsWith('Producto encontrado')
                      ? '#166534'
                      : '#b45309'
                }}
                role="status"
                aria-live="polite"
              >
                {scanNotice}
              </div>
            ) : null}

            {alerts.length ? (
              <div
                style={{ padding: '0 16px', marginTop: 12, display: 'grid', gap: 6 }}
                role="status"
                aria-live="polite"
              >
                {alerts.map((a) => (
                  <div
                    key={a.key}
                    style={{
                      fontSize: 12,
                      color: a.kind === 'error' ? 'crimson' : '#b45309'
                    }}
                  >
                    {a.text}
                  </div>
                ))}
              </div>
            ) : null}

            <SaveFooter onSave={handleSave} disabled={isSaving || isLoadingProduct} />
          </div>
        </div>
      </ModalShell>
    </>,
    document.body
  )
}
