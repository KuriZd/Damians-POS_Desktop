import { ipcMain, app } from 'electron'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { getLocalDb } from '../db/local-db'
import { supabase, supabaseAdmin } from '../supabase/client'
import { revalidateUserFromDb, type AuthUser } from './auth.core'

type AppRole = 'ADMIN' | 'CASHIER' | 'SUPERVISOR'

type LocalUserRow = {
  id: number
  name: string
  username: string
  role: AppRole
  active: number
  passwordHashLocal: string | null
}

let currentUser: AuthUser | null = null

export function getCurrentUser(): AuthUser | null {
  return currentUser
}

type RemoteAuthRow = {
  id: number
  name: string
  username: string
  role: AppRole
  active: boolean
}

type RemoteUserCredentialRow = RemoteAuthRow & {
  passwordHash?: string | null
  pinHash?: string | null
}

type RemoteLoginAttempt = {
  candidate: string
  rpcError: string | null
  matched: boolean
}

type RemoteUserProbe = {
  candidate: string
  exists: boolean
  active: boolean | null
  username: string | null
  error: string | null
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sessionFilePath(): string {
  return path.join(app.getPath('userData'), 'session.json')
}

function saveSession(user: AuthUser): void {
  try {
    fs.writeFileSync(sessionFilePath(), JSON.stringify(user), { encoding: 'utf-8', mode: 0o600 })
  } catch (err) {
    console.warn('[auth] No se pudo guardar la sesión:', err)
  }
}

export function clearSession(): void {
  try {
    fs.unlinkSync(sessionFilePath())
  } catch {
    // archivo puede no existir
  }
}

function readSession(): AuthUser | null {
  try {
    const raw = fs.readFileSync(sessionFilePath(), 'utf-8')
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

async function loginAgainstSupabase(
  usernameCandidates: string[],
  password: string
): Promise<{ user: RemoteAuthRow | null; attempts: RemoteLoginAttempt[] }> {
  const attempts: RemoteLoginAttempt[] = []
  const remotePasswordHash = sha256Hex(password)

  for (const candidate of usernameCandidates) {
    const { data, error } = await supabase.rpc('pos_login', {
      p_username: candidate,
      p_password: password
    })

    if (error) {
      attempts.push({
        candidate,
        rpcError: error.message,
        matched: false
      })
      console.warn(`[auth] Falló pos_login para "${candidate}": ${error.message}`)
      continue
    }

    const remoteUser = (Array.isArray(data) ? data[0] : null) as RemoteAuthRow | null
    if (remoteUser) {
      attempts.push({
        candidate,
        rpcError: null,
        matched: true
      })
      return { user: remoteUser, attempts }
    }

    attempts.push({
      candidate,
      rpcError: null,
      matched: false
    })

    const { data: directRows, error: directError } = await supabaseAdmin
      .from('User')
      .select('id, name, username, role, active, passwordHash, pinHash')
      .ilike('username', candidate)
      .limit(5)

    if (directError) {
      attempts.push({
        candidate,
        rpcError: `[direct-check] ${directError.message}`,
        matched: false
      })
      continue
    }

    const rows = (directRows ?? []) as RemoteUserCredentialRow[]
    const exactRow =
      rows.find((row) => String(row.username ?? '') === candidate) ??
      rows.find((row) => String(row.username ?? '').toLowerCase() === candidate.toLowerCase()) ??
      null

    if (!exactRow) continue

    const storedPasswordHash =
      typeof exactRow.passwordHash === 'string' ? exactRow.passwordHash : null
    const storedPinHash = typeof exactRow.pinHash === 'string' ? exactRow.pinHash : null
    const isMatch =
      storedPasswordHash === remotePasswordHash || storedPinHash === remotePasswordHash

    attempts.push({
      candidate,
      rpcError: null,
      matched: isMatch
    })

    if (isMatch && exactRow.active) {
      return {
        user: {
          id: exactRow.id,
          name: exactRow.name,
          username: exactRow.username,
          role: exactRow.role,
          active: Boolean(exactRow.active)
        },
        attempts
      }
    }
  }

  return { user: null, attempts }
}

async function probeRemoteUsers(usernameCandidates: string[]): Promise<RemoteUserProbe[]> {
  const probes: RemoteUserProbe[] = []

  for (const candidate of usernameCandidates) {
    const { data, error } = await supabaseAdmin
      .from('User')
      .select('id, username, active')
      .ilike('username', candidate)
      .limit(5)

    if (error) {
      probes.push({
        candidate,
        exists: false,
        active: null,
        username: null,
        error: error.message
      })
      continue
    }

    const rows = Array.isArray(data) ? data : []
    const exactRow =
      rows.find((row) => String(row.username ?? '') === candidate) ??
      rows.find((row) => String(row.username ?? '').toLowerCase() === candidate.toLowerCase()) ??
      null

    probes.push({
      candidate,
      exists: Boolean(exactRow),
      active: exactRow ? Boolean(exactRow.active) : null,
      username: exactRow ? String(exactRow.username ?? '') : null,
      error: null
    })
  }

  return probes
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:login', async (_event, username: string, password: string) => {
    const trimmedUsername = username.trim()
    const normalizedUsername = trimmedUsername.toLowerCase()
    const db = getLocalDb()

    const localUser = db
      .prepare(
        `
        SELECT
          id,
          name,
          username,
          role,
          active,
          "passwordHashLocal" as passwordHashLocal
        FROM "User"
        WHERE lower(username) = lower(?)
          AND active = 1
          AND "deletedAt" IS NULL
        LIMIT 1
        `
      )
      .get(normalizedUsername) as LocalUserRow | undefined

    const usernameCandidates = Array.from(
      new Set([trimmedUsername, normalizedUsername].filter(Boolean))
    )
    const { user: remoteUser, attempts } = await loginAgainstSupabase(usernameCandidates, password)

    if (!remoteUser) {
      const rpcFailures = attempts.filter((attempt) => attempt.rpcError)
      const hasOnlyRpcFailures = attempts.length > 0 && rpcFailures.length === attempts.length

      if (hasOnlyRpcFailures && localUser?.passwordHashLocal) {
        const isLocalPasswordValid = await bcrypt.compare(password, localUser.passwordHashLocal)

        if (isLocalPasswordValid) {
          currentUser = {
            id: localUser.id,
            name: localUser.name,
            username: localUser.username,
            role: localUser.role,
            active: Boolean(localUser.active),
            source: 'local'
          }
          saveSession(currentUser)
          return currentUser
        }

        console.warn(`[auth] Password local inválido para "${localUser.username}"`)
      }

      if (rpcFailures.length > 0) {
        const attemptsSummary = rpcFailures
          .map((attempt) => `"${attempt.candidate}": ${attempt.rpcError}`)
          .join(' | ')
        throw new Error(`Login remoto falló en Supabase. Intentos: ${attemptsSummary}`)
      }

      const probes = await probeRemoteUsers(usernameCandidates)
      const visibleUsers = probes.filter((probe) => probe.exists)
      const probeErrors = probes.filter((probe) => probe.error)

      if (visibleUsers.length > 0) {
        const summary = visibleUsers
          .map((probe) => `${probe.username} (active=${probe.active ? 'true' : 'false'})`)
          .join(', ')
        throw new Error(
          `El usuario existe en Supabase pero pos_login rechazó las credenciales. Coincidencias: ${summary}.`
        )
      }

      if (probeErrors.length > 0) {
        const summary = probeErrors
          .map((probe) => `"${probe.candidate}": ${probe.error}`)
          .join(' | ')
        throw new Error(
          `pos_login no encontró usuario y además no se pudo inspeccionar la tabla User. Detalle: ${summary}`
        )
      }

      const triedCandidates = usernameCandidates.join(', ')
      throw new Error(
        `Supabase no encontró ningún usuario visible con esos nombres. Usuarios probados: ${triedCandidates}.`
      )
    }

    const passwordHashLocal = await bcrypt.hash(password, 10)

    db.prepare(
      `
      INSERT INTO "User" (
        id,
        username,
        name,
        role,
        active,
        "passwordHashLocal",
        "updatedAt",
        "lastRemoteLoginAt"
      ) VALUES (
        @id,
        @username,
        @name,
        @role,
        @active,
        @passwordHashLocal,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        name = excluded.name,
        role = excluded.role,
        active = excluded.active,
        "passwordHashLocal" = excluded."passwordHashLocal",
        "updatedAt" = CURRENT_TIMESTAMP,
        "lastRemoteLoginAt" = CURRENT_TIMESTAMP
      `
    ).run({
      id: remoteUser.id,
      username: remoteUser.username,
      name: remoteUser.name,
      role: remoteUser.role,
      active: remoteUser.active ? 1 : 0,
      passwordHashLocal
    })

    currentUser = {
      id: remoteUser.id,
      name: remoteUser.name,
      username: remoteUser.username,
      role: remoteUser.role,
      active: Boolean(remoteUser.active),
      source: 'remote'
    }
    saveSession(currentUser)
    return currentUser
  })

  ipcMain.handle('auth:verifySupervisor', async (_event, username: string, password: string) => {
    const db = getLocalDb()
    const trimmed = username.trim()

    const localUser = db
      .prepare(
        `
      SELECT id, name, username, role, active, "passwordHashLocal"
      FROM "User"
      WHERE lower(username) = lower(?) AND active = 1 AND "deletedAt" IS NULL
      LIMIT 1
    `
      )
      .get(trimmed) as LocalUserRow | undefined

    // Caso 1: hash local disponible → verificación offline sin red
    if (localUser?.passwordHashLocal) {
      const valid = await bcrypt.compare(password, localUser.passwordHashLocal)
      if (!valid) return { ok: false as const, error: 'Contraseña incorrecta.' }
      if (localUser.role === 'CASHIER')
        return {
          ok: false as const,
          error: 'El usuario no tiene permisos de supervisor o administrador.'
        }
      return { ok: true as const, name: localUser.name, role: localUser.role }
    }

    // Caso 2: usuario local sin hash → nunca inició sesión en este dispositivo
    if (localUser) {
      return {
        ok: false as const,
        error: `"${localUser.username}" necesita iniciar sesión en este dispositivo al menos una vez antes de poder autorizar.`
      }
    }

    // Caso 3: usuario no está localmente → intentar Supabase y cachear hash si tiene éxito
    try {
      const candidates = Array.from(new Set([trimmed, trimmed.toLowerCase()]))
      const { user: remoteUser } = await loginAgainstSupabase(candidates, password)
      if (!remoteUser) return { ok: false as const, error: 'Credenciales incorrectas.' }
      if (remoteUser.role === 'CASHIER')
        return {
          ok: false as const,
          error: 'El usuario no tiene permisos de supervisor o administrador.'
        }

      // Guardar hash local para futuras verificaciones sin red
      const passwordHashLocal = await bcrypt.hash(password, 10)
      db.prepare(
        `
        INSERT INTO "User" (id, username, name, role, active, "passwordHashLocal", "createdAt", "updatedAt", "lastRemoteLoginAt")
        VALUES (@id, @username, @name, @role, @active, @passwordHashLocal, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          "passwordHashLocal" = excluded."passwordHashLocal",
          "updatedAt" = CURRENT_TIMESTAMP,
          "lastRemoteLoginAt" = CURRENT_TIMESTAMP
      `
      ).run({
        id: remoteUser.id,
        username: remoteUser.username,
        name: remoteUser.name,
        role: remoteUser.role,
        active: remoteUser.active ? 1 : 0,
        passwordHashLocal
      })

      return { ok: true as const, name: remoteUser.name, role: remoteUser.role }
    } catch {
      return {
        ok: false as const,
        error:
          'Usuario no encontrado localmente y sin conexión a internet. El supervisor debe iniciar sesión en este dispositivo al menos una vez.'
      }
    }
  })

  ipcMain.handle('auth:me', async () => {
    const stored = currentUser ?? readSession()
    if (!stored) return null

    const db = getLocalDb()
    const validated = revalidateUserFromDb(db, stored)

    if (!validated) {
      clearSession()
      currentUser = null
      return null
    }

    if (validated.role !== stored.role || validated.active !== stored.active) {
      saveSession(validated)
    }

    currentUser = validated
    return currentUser
  })

  ipcMain.handle('auth:logout', async () => {
    currentUser = null
    clearSession()
    return { ok: true }
  })
}
