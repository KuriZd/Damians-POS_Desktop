import { type ReactElement } from 'react'
import styles from './Sidebar.module.css'
import productsIcon from '../../assets/products.png'
import inventoryIcon from '../../assets/inventory.png'
import salesIcon from '../../assets/sales.png'
import logoutIcon from '../../assets/logout.png'
import homeIcon from '../../assets/home.png'
import settingsIcon from '../../assets/engranaje.png'
import type { AppSection, SidebarMenuItem } from './layout.types' // ✅ AuthUser importado

type SidebarProps = {
  user: AuthUser
  menuItems: SidebarMenuItem[]
  activeSection: AppSection
  isCollapsed: boolean
  onToggleCollapse: () => void
  onSelectSection: (section: AppSection) => void
  onLogout: () => void
}

export default function Sidebar({
  user,
  menuItems,
  activeSection,
  isCollapsed,
  onToggleCollapse,
  onSelectSection,
  onLogout
}: SidebarProps): ReactElement {
  const iconMap: Record<AppSection, string> = {
    dashboard: homeIcon,
    products: productsIcon,
    inventory: inventoryIcon,
    sales: salesIcon,
    users: settingsIcon
  }

  return (
    <aside className={`${styles.sidebar} ${isCollapsed ? styles.sidebarCollapsed : ''}`}>
      {/* ─── Top block ───────────────────────────────────────── */}
      <div className={`${styles.topBlock} ${isCollapsed ? styles.topBlockCollapsed : ''}`}>
        <div className={styles.topRow}>
          <button
            type="button"
            className={styles.toggleButton}
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
          >
            <span />
            <span />
            <span />
          </button>

          {/* ✅ Nombre en la misma fila que el toggle, oculto al colapsar */}
          {!isCollapsed && (
            <div className={styles.userBlock}>
              <p className={styles.userName}>{user.name}</p>
              <p className={styles.userRole}>{user.role}</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Nav ─────────────────────────────────────────────── */}
      <nav className={styles.menu}>
        {menuItems.map((item) => {
          const isActive = activeSection === item.key
          const icon = iconMap[item.key]

          if (!icon) return null // ✅ guardia contra keys sin ícono

          return (
            <button
              key={item.key}
              type="button"
              className={[
                styles.menuItem,
                isActive ? styles.menuItemActive : '',
                isCollapsed ? styles.menuItemCollapsed : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectSection(item.key)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined} // ✅ accesibilidad
              title={isCollapsed ? item.label : undefined}
            >
              <img
                src={icon}
                alt=""
                className={item.key === 'dashboard' ? styles.menuIconHome : styles.menuIcon}
              />
              {!isCollapsed && <span className={styles.menuLabel}>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* ─── Bottom block (logout) ───────────────────────────── */}
      <div className={styles.bottomBlock}>
        <button
          type="button"
          className={[styles.logoutButton, isCollapsed ? styles.logoutButtonCollapsed : '']
            .filter(Boolean)
            .join(' ')}
          onClick={onLogout}
          aria-label="Cerrar sesión"
          title={isCollapsed ? 'Cerrar sesión' : undefined}
        >
          <img src={logoutIcon} alt="" className={styles.logoutIcon} /> {/* ✅ alt="" */}
          {!isCollapsed && <span className={styles.logoutLabel}>Cerrar sesión</span>}
        </button>
      </div>
    </aside>
  )
}
