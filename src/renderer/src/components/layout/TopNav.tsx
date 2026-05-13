// src/renderer/src/components/layout/TopNav.tsx
import { useState, type ReactElement } from 'react'
import styles from './TopNav.module.css'
import type { SyncStatus } from '../../hooks/useSync'
import DiagnosticModal from './DiagnosticModal'

type TopNavProps = {
    user: AuthUser
    title: string
    showUserSummary: boolean
    syncStatus: SyncStatus
    lastSyncAt: Date | null
    conflictCount: number
    onSyncNow: () => void
}

function BellIcon(): ReactElement {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
    )
}

function SyncIcon({ spinning }: { spinning: boolean }): ReactElement {
    return (
        <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
        >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    )
}

function syncLabel(status: SyncStatus, lastSyncAt: Date | null): string {
    if (status === 'syncing') return 'Sincronizando...'
    if (status === 'error') return 'Error al sincronizar — clic para reintentar'
    if (lastSyncAt) {
        const mins = Math.floor((Date.now() - lastSyncAt.getTime()) / 60000)
        if (mins < 1) return 'Sincronizado hace un momento'
        if (mins < 60) return `Sincronizado hace ${mins} min`
        const hrs = Math.floor(mins / 60)
        return `Sincronizado hace ${hrs} h`
    }
    return 'Sincronizar ahora'
}

function syncColor(status: SyncStatus): string {
    if (status === 'syncing') return '#5b79ff'
    if (status === 'error') return '#e05353'
    if (status === 'ok') return '#2db57a'
    return '#9a9a9a'
}

export default function TopNav({
    user,
    title,
    syncStatus,
    lastSyncAt,
    conflictCount,
    onSyncNow,
}: TopNavProps): ReactElement {
    const [diagOpen, setDiagOpen] = useState(false)

    return (
        <header className={styles.topNav}>
        {diagOpen && <DiagnosticModal onClose={() => setDiagOpen(false)} />}

            {/* ─── Izquierda: título + breadcrumb ─────────────────── */}
            <div className={styles.titleBlock}>
                <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                    <span className={styles.breadcrumbRoot}>Inicio</span>
                    <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                    <span className={styles.breadcrumbCurrent} aria-current="page">{title}</span>
                </nav>
                <h1 className={styles.title}>{title}</h1>
            </div>

            {/* ─── Derecha: acciones ───────────────────────────────── */}
            <div className={styles.actions}>
                <button
                    type="button"
                    className={styles.syncButton}
                    onClick={syncStatus !== 'syncing' ? onSyncNow : undefined}
                    aria-label={syncLabel(syncStatus, lastSyncAt)}
                    title={syncLabel(syncStatus, lastSyncAt)}
                    style={{ color: syncColor(syncStatus) }}
                    disabled={syncStatus === 'syncing'}
                >
                    <SyncIcon spinning={syncStatus === 'syncing'} />
                </button>

                {user.role === 'ADMIN' && <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => setDiagOpen(true)}
                    title="Diagnóstico de Supabase"
                    aria-label="Diagnóstico de Supabase"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                </button>}

                <button
                    type="button"
                    className={styles.actionButton}
                    aria-label={conflictCount > 0 ? `${conflictCount} conflicto(s) de sincronización` : 'Notificaciones'}
                    title={conflictCount > 0 ? `${conflictCount} conflicto(s) de sincronización sin resolver` : 'Notificaciones'}
                    style={{ position: 'relative' }}
                >
                    <BellIcon />
                    {conflictCount > 0 && (
                        <span style={{
                            position: 'absolute',
                            top: '2px',
                            right: '2px',
                            minWidth: '16px',
                            height: '16px',
                            padding: '0 3px',
                            borderRadius: '8px',
                            background: '#e05353',
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 700,
                            lineHeight: '16px',
                            textAlign: 'center',
                            pointerEvents: 'none',
                        }}>
                            {conflictCount > 9 ? '9+' : conflictCount}
                        </span>
                    )}
                </button>
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </header>
    )
}
