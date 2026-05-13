import { contextBridge, ipcRenderer } from 'electron'
import { getPublicRuntimeConfig } from '../shared/runtime-config'

const publicRuntimeConfig = getPublicRuntimeConfig()

contextBridge.exposeInMainWorld('pos', {
  config: {
    getPublic: () => publicRuntimeConfig
  },
  auth: {
    login: (username: string, password: string) =>
      ipcRenderer.invoke('auth:login', username, password),
    me: () => ipcRenderer.invoke('auth:me'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    verifySupervisor: (username: string, password: string) =>
      ipcRenderer.invoke('auth:verifySupervisor', username, password),
  },
  products: {
    findByCode: (code: string) => ipcRenderer.invoke('products:findByCode', code),
    get: (id: number) => ipcRenderer.invoke('products:get', id),
    getBySku: (sku: string) => ipcRenderer.invoke('products:getBySku', sku),
    list: (args: unknown) => ipcRenderer.invoke('products:list', args)
  },
  services: {
    get: (id: number) => ipcRenderer.invoke('services:get', id),
    getByCode: (code: string) => ipcRenderer.invoke('services:getByCode', code),
    list: (args: unknown) => ipcRenderer.invoke('services:list', args)
  },
  users: {
    list: () => ipcRenderer.invoke('users:list'),
    create: (payload: unknown) => ipcRenderer.invoke('users:create', payload),
    update: (id: number, payload: unknown) => ipcRenderer.invoke('users:update', id, payload),
    delete: (id: number) => ipcRenderer.invoke('users:delete', id)
  },
  inventory: {
    products:         ()                 => ipcRenderer.invoke('inventory:products'),
    stats:            (period: string)   => ipcRenderer.invoke('inventory:stats', period),
    chart:            ()                 => ipcRenderer.invoke('inventory:chart'),
    movements:        (typeFilter?: string) => ipcRenderer.invoke('inventory:movements', typeFilter),
    registerMovement: (payload: unknown) => ipcRenderer.invoke('inventory:registerMovement', payload),
  },
  dashboard: {
    stats: () => ipcRenderer.invoke('dashboard:stats'),
  },
  sales: {
    create:        (payload: unknown)                        => ipcRenderer.invoke('sales:create', payload),
    recent:        (limit?: number)                          => ipcRenderer.invoke('sales:recent', limit),
    corte:         (cashierId: number)                       => ipcRenderer.invoke('sales:corte', cashierId),
    confirmCorte:  (cashierId: number, countedCash?: number) => ipcRenderer.invoke('sales:confirmCorte', cashierId, countedCash),
    cashMovement:  (payload: unknown)                        => ipcRenderer.invoke('sales:cashMovement', payload),
  },
  sync: {
    pullProducts: () => ipcRenderer.invoke('sync:pullProducts'),
    pullAll:      () => ipcRenderer.invoke('sync:pullAll'),
    pushPending:  () => ipcRenderer.invoke('sync:pushPending'),
    conflicts:    () => ipcRenderer.invoke('sync:conflicts'),
    diagnose:     () => ipcRenderer.invoke('sync:diagnose'),
  }
})
