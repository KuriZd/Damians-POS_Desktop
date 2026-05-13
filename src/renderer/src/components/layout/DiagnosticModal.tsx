import { useState, useEffect, type ReactElement } from 'react'
import styles from './DiagnosticModal.module.css'

type ConnCheck = { ok: boolean; ms: number; error?: string }

type DiagnosticResult = {
  supabaseUrl: string
  checkedAt: string
  connection: {
    anon:  ConnCheck
    admin: ConnCheck
  }
  local: {
    salesTotal: number
    salesUnsynced: number
    movementsUnsynced: number
    lastSyncedAt: string | null
  }
  remote: {
    sales: number | null
    products: number | null
    error?: string
  }
  unsyncedSales: { id: number; folio: string; total: number; createdAt: string }[]
}

type PushResult = { ok: boolean; pushed: number; failed: number; error?: string }

type DiagnosticModalProps = {
  onClose: () => void
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }): ReactElement {
  return (
    <span className={ok ? styles.badgeOk : styles.badgeFail}>
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}

function Row({ label, value, sub }: { label: string; value: ReactElement | string; sub?: string }): ReactElement {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
      {sub && <span className={styles.rowSub}>{sub}</span>}
    </div>
  )
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

export default function DiagnosticModal({ onClose }: DiagnosticModalProps): ReactElement {
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullResult, setPullResult] = useState<string | null>(null)

  useEffect(() => {
    void window.pos.sync.diagnose()
      .then((r: DiagnosticResult) => { setResult(r); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function handlePush(): Promise<void> {
    setPushing(true)
    setPushResult(null)
    try {
      const r = await window.pos.sync.pushPending() as { ok: boolean; pushed: number; failed: number }
      setPushResult({ ok: r.failed === 0, pushed: r.pushed, failed: r.failed })
      // Re-run diagnose to refresh counts
      const fresh = await window.pos.sync.diagnose() as DiagnosticResult
      setResult(fresh)
    } catch (e) {
      setPushResult({ ok: false, pushed: 0, failed: 0, error: e instanceof Error ? e.message : 'Error desconocido' })
    } finally {
      setPushing(false)
    }
  }

  async function handlePull(): Promise<void> {
    setPulling(true)
    setPullResult(null)
    try {
      const r = await window.pos.sync.pullAll() as { ok: boolean; counts: Record<string, number> }
      const parts = Object.entries(r.counts ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')
      setPullResult(`Catálogo actualizado — ${parts}`)
    } catch (e) {
      setPullResult(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setPulling(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.box} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Diagnóstico de Supabase</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <p className={styles.loading}>Ejecutando diagnóstico…</p>
          ) : !result ? (
            <p className={styles.error}>No se pudo ejecutar el diagnóstico.</p>
          ) : (
            <>
              {/* URL */}
              <section className={styles.section}>
                <h4 className={styles.sectionTitle}>Configuración</h4>
                <Row label="Supabase URL" value={
                  <span className={styles.mono}>{result.supabaseUrl}</span>
                } />
                <Row label="Revisado" value={new Date(result.checkedAt).toLocaleString('es-MX')} />
              </section>

              {/* Conexión */}
              <section className={styles.section}>
                <h4 className={styles.sectionTitle}>Conexión</h4>
                <Row
                  label="Clave anónima (lectura pública)"
                  value={<StatusBadge ok={result.connection.anon.ok} label={result.connection.anon.ok ? `${result.connection.anon.ms} ms` : 'Sin conexión'} />}
                  sub={result.connection.anon.error}
                />
                <Row
                  label="Clave de servicio (escritura)"
                  value={<StatusBadge ok={result.connection.admin.ok} label={result.connection.admin.ok ? `${result.connection.admin.ms} ms` : 'Sin conexión'} />}
                  sub={result.connection.admin.error}
                />
              </section>

              {/* Local */}
              <section className={styles.section}>
                <h4 className={styles.sectionTitle}>Base de datos local</h4>
                <Row label="Ventas totales" value={String(result.local.salesTotal)} />
                <Row
                  label="Ventas sin sincronizar"
                  value={
                    <span className={result.local.salesUnsynced > 0 ? styles.warn : styles.ok}>
                      {result.local.salesUnsynced}
                    </span>
                  }
                />
                <Row
                  label="Movimientos sin sincronizar"
                  value={
                    <span className={result.local.movementsUnsynced > 0 ? styles.warn : styles.ok}>
                      {result.local.movementsUnsynced}
                    </span>
                  }
                />
                <Row
                  label="Última sincronización"
                  value={result.local.lastSyncedAt
                    ? new Date(result.local.lastSyncedAt).toLocaleString('es-MX')
                    : <span className={styles.warn}>Nunca</span>
                  }
                />
              </section>

              {/* Remoto */}
              <section className={styles.section}>
                <h4 className={styles.sectionTitle}>Supabase (remoto)</h4>
                {result.remote.error ? (
                  <p className={styles.error}>{result.remote.error}</p>
                ) : (
                  <>
                    <Row label="Ventas en Supabase" value={result.remote.sales !== null ? String(result.remote.sales) : '—'} />
                    <Row label="Productos en Supabase" value={result.remote.products !== null ? String(result.remote.products) : '—'} />
                  </>
                )}
              </section>

              {/* Ventas pendientes */}
              {result.unsyncedSales.length > 0 && (
                <section className={styles.section}>
                  <h4 className={styles.sectionTitle}>Ventas pendientes de push (últimas {result.unsyncedSales.length})</h4>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Folio</th>
                        <th>Total</th>
                        <th>Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unsyncedSales.map(s => (
                        <tr key={s.id}>
                          <td className={styles.mono}>{s.folio}</td>
                          <td>{fmt(s.total)}</td>
                          <td>{new Date(s.createdAt).toLocaleString('es-MX')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Resultados de acciones */}
              {pushResult && (
                <p className={pushResult.ok ? styles.actionOk : styles.actionErr}>
                  {pushResult.error
                    ? `Error: ${pushResult.error}`
                    : `Push completado — ${pushResult.pushed} enviadas, ${pushResult.failed} fallidas`
                  }
                </p>
              )}
              {pullResult && (
                <p className={pullResult.startsWith('Error') ? styles.actionErr : styles.actionOk}>
                  {pullResult}
                </p>
              )}
            </>
          )}
        </div>

        {!loading && result && (
          <div className={styles.footer}>
            <button className={styles.btnSecondary} onClick={onClose}>Cerrar</button>
            <button
              className={styles.btnAction}
              onClick={() => { void handlePull() }}
              disabled={pulling || pushing}
            >
              {pulling ? 'Sincronizando…' : 'Pull catálogo'}
            </button>
            <button
              className={styles.btnPrimary}
              onClick={() => { void handlePush() }}
              disabled={pushing || pulling || result.local.salesUnsynced === 0 && result.local.movementsUnsynced === 0}
            >
              {pushing ? 'Enviando…' : `Push pendientes (${result.local.salesUnsynced + result.local.movementsUnsynced})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
