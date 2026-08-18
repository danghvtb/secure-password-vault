import type { Category, EntryIcon, Vault, VaultEntry, VaultHealth } from '../types/vault'

export const defaultCategories: Category[] = [
  { id: 'cat-login', name: 'Logins', color: '#8b5cf6' },
  { id: 'cat-work', name: 'Work', color: '#2dd4bf' },
  { id: 'cat-finance', name: 'Finance', color: '#f59e0b' },
  { id: 'cat-personal', name: 'Personal', color: '#fb7185' },
]

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()

export function createEmptyVault(): Vault {
  const timestamp = now()
  return {
    schemaVersion: 1,
    vaultId: id(),
    vaultVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    entries: [],
    categories: defaultCategories,
  }
}

export function createEntry(input: Pick<VaultEntry, 'name' | 'username' | 'password'> & Partial<VaultEntry>): VaultEntry {
  const timestamp = now()
  return {
    id: id(),
    name: input.name,
    username: input.username,
    password: input.password,
    url: input.url ?? '',
    categoryId: input.categoryId ?? 'cat-login',
    notes: input.notes ?? '',
    favorite: input.favorite ?? false,
    icon: input.icon ?? 'other',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function addEntry(vault: Vault, entry: VaultEntry): Vault {
  return touch({ ...vault, entries: [entry, ...vault.entries] })
}

export function updateEntry(vault: Vault, entryId: string, changes: Partial<Omit<VaultEntry, 'id' | 'createdAt'>>): Vault {
  return touch({
    ...vault,
    entries: vault.entries.map((entry) => entry.id === entryId ? { ...entry, ...changes, updatedAt: now() } : entry),
  })
}

export function removeEntry(vault: Vault, entryId: string): Vault {
  return touch({ ...vault, entries: vault.entries.filter((entry) => entry.id !== entryId) })
}

export function toggleFavorite(vault: Vault, entryId: string): Vault {
  const entry = vault.entries.find((candidate) => candidate.id === entryId)
  return entry ? updateEntry(vault, entryId, { favorite: !entry.favorite }) : vault
}

export function addCategory(vault: Vault, name: string, color = '#8b5cf6'): Vault {
  const category: Category = { id: id(), name: name.trim(), color }
  return touch({ ...vault, categories: [...vault.categories, category] })
}

export function searchEntries(entries: VaultEntry[], query: string, categoryId?: string): VaultEntry[] {
  const normalized = query.trim().toLowerCase()
  return entries.filter((entry) => {
    const matchesCategory = !categoryId || entry.categoryId === categoryId
    if (!matchesCategory) return false
    if (!normalized) return true
    return [entry.name, entry.username, entry.url, entry.notes].some((value) => value.toLowerCase().includes(normalized))
  })
}

export function calculateHealth(entries: VaultEntry[]): VaultHealth {
  const passwordMap = new Map<string, VaultEntry[]>()
  entries.forEach((entry) => passwordMap.set(entry.password, [...(passwordMap.get(entry.password) ?? []), entry]))
  const reused = [...passwordMap.values()].filter((group) => group.length > 1).flat()
  const staleThreshold = Date.now() - 180 * 24 * 60 * 60 * 1000
  return {
    weak: entries.filter((entry) => scorePassword(entry.password) < 3),
    reused,
    stale: entries.filter((entry) => Date.parse(entry.updatedAt) < staleThreshold),
    missingUrl: entries.filter((entry) => !entry.url),
  }
}

export function scorePassword(password: string): number {
  let score = 0
  if (password.length >= 12) score += 1
  if (password.length >= 18) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

export function generatePassword(length = 20, options: { uppercase?: boolean; numbers?: boolean; symbols?: boolean } = {}): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const numbers = '23456789'
  const symbols = '!@#$%^&*()-_=+[]{}?'
  let alphabet = lower
  if (options.uppercase !== false) alphabet += upper
  if (options.numbers !== false) alphabet += numbers
  if (options.symbols !== false) alphabet += symbols
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function touch(vault: Vault): Vault {
  return { ...vault, vaultVersion: vault.vaultVersion + 1, updatedAt: now() }
}

export function iconForEntry(entry: VaultEntry): EntryIcon {
  const haystack = `${entry.name} ${entry.url}`.toLowerCase()
  if (haystack.includes('google')) return 'google'
  if (haystack.includes('github')) return 'github'
  if (haystack.includes('facebook')) return 'facebook'
  if (haystack.includes('microsoft') || haystack.includes('outlook')) return 'microsoft'
  if (haystack.includes('bank') || haystack.includes('finance')) return 'banking'
  if (haystack.includes('wifi')) return 'wifi'
  return entry.icon
}

export function migrateVault(vault: Vault, fromVersion: number, toVersion: number): Vault {
  if (fromVersion === toVersion) return vault
  if (fromVersion > toVersion) throw new Error('Vault version is newer than this app.')
  return { ...vault, schemaVersion: toVersion }
}
