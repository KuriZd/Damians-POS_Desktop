import fs from 'node:fs'
import path from 'node:path'
import { parse as parseDotenv } from 'dotenv'

export type RuntimeConfig = {
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey: string | null
  source: string
}

type RuntimeEnvResult = {
  values: Record<string, string>
  source: string
}

function existingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function candidateEnvFiles(): string[] {
  const execDir = path.dirname(process.execPath)
  const candidates = [
    process.env.POS_RUNTIME_CONFIG_PATH,
    path.resolve(process.cwd(), 'pos-runtime.env'),
    path.resolve(process.cwd(), '.env'),
    path.join(execDir, 'pos-runtime.env'),
    path.join(process.resourcesPath, 'pos-runtime.env')
  ]

  return candidates.filter((value): value is string => Boolean(value))
}

function loadRuntimeEnv(): RuntimeEnvResult {
  for (const filePath of candidateEnvFiles()) {
    if (!existingFile(filePath)) continue

    const fileContent = fs.readFileSync(filePath, 'utf8')
    return {
      values: parseDotenv(fileContent),
      source: filePath
    }
  }

  return {
    values: {},
    source: 'process.env'
  }
}

function requiredValue(
  name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY',
  fileValues: Record<string, string>
): string {
  const value =
    process.env[name] ??
    fileValues[name] ??
    (name === 'SUPABASE_URL'
      ? process.env.VITE_SUPABASE_URL
      : process.env.VITE_SUPABASE_ANON_KEY) ??
    (name === 'SUPABASE_URL' ? fileValues.VITE_SUPABASE_URL : fileValues.VITE_SUPABASE_ANON_KEY)

  if (!value) {
    console.warn(
      `[runtime-config] Falta ${name} — la app funcionará sin sincronización con Supabase`
    )
    return ''
  }

  return value
}

let cachedConfig: RuntimeConfig | null = null

export function getRuntimeConfig(): RuntimeConfig {
  if (cachedConfig) return cachedConfig

  const envFile = loadRuntimeEnv()

  cachedConfig = {
    supabaseUrl: requiredValue('SUPABASE_URL', envFile.values),
    supabaseAnonKey: requiredValue('SUPABASE_ANON_KEY', envFile.values),
    supabaseServiceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? envFile.values.SUPABASE_SERVICE_ROLE_KEY ?? null,
    source: envFile.source
  }

  return cachedConfig
}

export function getPublicRuntimeConfig(): Pick<
  RuntimeConfig,
  'supabaseUrl' | 'supabaseAnonKey' | 'source'
> {
  const config = getRuntimeConfig()
  return {
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    source: config.source
  }
}
