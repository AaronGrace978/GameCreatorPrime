import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AppSettings {
  providerId: string
  modelId: string
  customBaseUrl: string
  customModelId: string
  blenderPath: string
  libraryPath: string
  maxAgentSteps: number
  temperature: number
  encryptedKeys: Record<string, string>
}

const DEFAULTS: AppSettings = {
  providerId: 'ollama-cloud',
  modelId: 'glm-5.3',
  customBaseUrl: 'http://127.0.0.1:8000/v1',
  customModelId: 'custom-model',
  blenderPath: '',
  libraryPath: '',
  maxAgentSteps: 18,
  temperature: 0.35,
  encryptedKeys: {}
}

function settingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(next: AppSettings) {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
}

export function getApiKey(providerId: string): string {
  const settings = loadSettings()
  const packed = settings.encryptedKeys[providerId]
  if (!packed) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(packed, 'base64'))
    }
    return Buffer.from(packed, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

export function setApiKey(providerId: string, key: string) {
  const settings = loadSettings()
  if (!key) {
    delete settings.encryptedKeys[providerId]
  } else if (safeStorage.isEncryptionAvailable()) {
    settings.encryptedKeys[providerId] = safeStorage.encryptString(key).toString('base64')
  } else {
    settings.encryptedKeys[providerId] = Buffer.from(key, 'utf8').toString('base64')
  }
  saveSettings(settings)
}

export function publicSettings() {
  const s = loadSettings()
  return {
    providerId: s.providerId,
    modelId: s.modelId,
    customBaseUrl: s.customBaseUrl,
    customModelId: s.customModelId,
    blenderPath: s.blenderPath,
    libraryPath: s.libraryPath,
    maxAgentSteps: s.maxAgentSteps,
    temperature: s.temperature,
    configuredProviders: Object.keys(s.encryptedKeys)
  }
}

export type PublicSettings = ReturnType<typeof publicSettings>
