import { ipcMain } from 'electron'
import https from 'node:https'

function getCredentials(): { token: string; deviceId: string } {
  const token = process.env.MP_ACCESS_TOKEN
  const deviceId = process.env.MP_DEVICE_ID
  if (!token || !deviceId) {
    throw new Error('MP_ACCESS_TOKEN y MP_DEVICE_ID son requeridos en el archivo .env')
  }
  return { token, deviceId }
}

function mpRequest<T>(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const options: https.RequestOptions = {
      hostname: 'api.mercadopago.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as T & { status?: number; error?: string; message?: string }
          const status = res.statusCode ?? 0
          if (status < 200 || status >= 300) {
            reject(new Error(`MP ${status}: ${parsed.message ?? parsed.error ?? data}`))
            return
          }
          resolve(parsed)
        } catch {
          reject(new Error(`Respuesta invalida de MP: ${data}`))
        }
      })
    })

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

type PaymentIntentResponse = {
  id: string
  device_id: string
  amount: number
  state?: string
  payment?: {
    id: number | string
    installments?: number
    type?: string
    state?: string
  }
}

export function registerMercadoPagoIpc(): void {
  ipcMain.handle('mp:createPaymentIntent', async (_e, amount: number, externalRef: string) => {
    try {
      const { token, deviceId } = getCredentials()
      const result = await mpRequest<PaymentIntentResponse>(
        'POST',
        `/point/integration-api/devices/${encodeURIComponent(deviceId)}/payment-intents`,
        token,
        {
          amount,
          additional_info: {
            external_reference: externalRef,
            print_on_terminal: true
          }
        }
      )
      return { ok: true, id: result.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
    }
  })

  ipcMain.handle('mp:getPaymentIntent', async (_e, intentId: string) => {
    try {
      const { token } = getCredentials()
      const result = await mpRequest<PaymentIntentResponse>(
        'GET',
        `/point/integration-api/payment-intents/${intentId}`,
        token
      )
      return { ok: true, state: result.state, payment: result.payment ?? null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
    }
  })

  ipcMain.handle('mp:cancelPaymentIntent', async (_e, intentId: string) => {
    try {
      const { token, deviceId } = getCredentials()
      await mpRequest(
        'DELETE',
        `/point/integration-api/devices/${encodeURIComponent(deviceId)}/payment-intents/${intentId}`,
        token
      )
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
    }
  })
}
