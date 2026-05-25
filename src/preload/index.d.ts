import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    pos: {
      config: {
        getPublic: () => {
          supabaseUrl: string
          supabaseAnonKey: string
          source: string
        }
      }
      mercadopago: {
        createPaymentIntent: (
          amount: number,
          externalRef: string
        ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        getPaymentIntent: (intentId: string) => Promise<{
          ok: true
          state: string
          payment: { id: number; state: string; type: string } | null
        } | { ok: false; error: string }>
        cancelPaymentIntent: (
          intentId: string
        ) => Promise<{ ok: true } | { ok: false; error: string }>
      }
    }
  }
}
