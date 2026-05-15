import { useCallback, useEffect, useRef, useState } from 'react'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const LAST_SYNC_KEY = 'pos:lastSyncAt'

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error'

type UseSyncReturn = {
  status: SyncStatus
  lastSyncAt: Date | null
  conflictCount: number
  sync: () => Promise<void>
}

export function useSync(): UseSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(() => {
    const stored = localStorage.getItem(LAST_SYNC_KEY)
    return stored ? new Date(stored) : null
  })
  const [conflictCount, setConflictCount] = useState(0)
  const isSyncing = useRef(false)

  const sync = useCallback(async () => {
    if (isSyncing.current || !window.pos?.sync?.pullAll) return
    isSyncing.current = true
    setStatus('syncing')
    try {
      const result = await window.pos.sync.pullAll()
      const now = new Date()
      localStorage.setItem(LAST_SYNC_KEY, now.toISOString())
      setLastSyncAt(now)
      setConflictCount(result.conflictCount)
      setStatus('ok')
    } catch (err) {
      console.error('[sync] Error al sincronizar con Supabase:', err)
      setStatus('error')
    } finally {
      isSyncing.current = false
    }
  }, [])

  useEffect(() => {
    void sync()

    const interval = setInterval(() => void sync(), SIX_HOURS_MS)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { status, lastSyncAt, conflictCount, sync }
}
