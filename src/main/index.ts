import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import fs from 'node:fs'
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

const APP_NAME = 'Papeleria Damian'
const APP_DATA_DIR = 'PapeleriaDamian'

function configureAppStorage(): void {
  app.setName(APP_NAME)

  const roamingRoot = app.getPath('appData')
  const localRoot = app.getPath('userData').includes('Roaming')
    ? path.join(path.dirname(path.dirname(app.getPath('userData'))), 'Local')
    : path.dirname(app.getPath('userData'))

  const userDataPath = path.join(roamingRoot, APP_DATA_DIR)
  const sessionDataPath = path.join(localRoot, APP_DATA_DIR, 'Session')
  const cachePath = path.join(localRoot, APP_DATA_DIR, 'Cache')

  fs.mkdirSync(userDataPath, { recursive: true })
  fs.mkdirSync(sessionDataPath, { recursive: true })
  fs.mkdirSync(cachePath, { recursive: true })

  app.setPath('userData', userDataPath)
  app.setPath('sessionData', sessionDataPath)
  app.commandLine.appendSwitch('disk-cache-dir', cachePath)
}

configureAppStorage()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1200,
    height: 800,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
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
  nativeTheme.themeSource = 'light'
  Menu.setApplicationMenu(null)
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
