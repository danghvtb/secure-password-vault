import type { DriveMetadata, StorageMode } from '../types/vault'

const PREFS_KEY = 'securevault.preferences.v1'

export interface DevicePreferences {
  username: string
  theme: 'light' | 'dark' | 'system'
  autoLockMinutes: 1 | 5 | 10 | 15 | 30
  clipboardClearSeconds: number
  setupComplete: boolean
  storageMode: StorageMode
  driveMetadata: DriveMetadata | null
}

const defaults: DevicePreferences = {
  username: 'admin',
  theme: 'dark',
  autoLockMinutes: 10,
  clipboardClearSeconds: 30,
  setupComplete: false,
  storageMode: 'mock',
  driveMetadata: null,
}

export function loadPreferences(): DevicePreferences {
  try {
    const value = localStorage.getItem(PREFS_KEY)
    return value ? { ...defaults, ...(JSON.parse(value) as Partial<DevicePreferences>) } : defaults
  } catch {
    return defaults
  }
}

export function savePreferences(prefs: DevicePreferences): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

export function clearDeviceLinkage(): DevicePreferences {
  const prefs = { ...loadPreferences(), setupComplete: false, driveMetadata: null }
  savePreferences(prefs)
  return prefs
}
