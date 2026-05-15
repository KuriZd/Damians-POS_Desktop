import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { getLocalDb } from './db/local-db'
import { registerProductsIpc } from './ipc/products.ipc'
import { registerServicesIpc } from './ipc/services.ipc'
import { registerSalesIpc } from './ipc/sales.ipc'
import { registerSyncIpc } from './ipc/sync.ipc'
import { registerAuthIpc, clearSession } from './ipc/auth.ipc'
import { registerUsersIpc } from './ipc/users.ipc'
import { registerInventoryIpc } from './ipc/inventory.ipc'
import { registerDashboardIpc } from './ipc/dashboard.ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }

  void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  getLocalDb()
  registerAuthIpc()
  registerUsersIpc()
  registerProductsIpc()
  registerServicesIpc()
  registerSalesIpc()
  registerSyncIpc()
  registerInventoryIpc()
  registerDashboardIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  clearSession()
})
