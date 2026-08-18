import { describe, expect, it } from 'vitest'
import { addEntry, calculateHealth, createEmptyVault, createEntry, generatePassword, removeEntry, searchEntries, toggleFavorite, updateEntry } from './vaultService'

describe('vault service', () => {
  it('supports entry CRUD, favorites and search', () => {
    let vault = createEmptyVault()
    const entry = createEntry({ name: 'GitHub', username: 'dev@example.com', password: 'A strong password!42', url: 'https://github.com' })
    vault = addEntry(vault, entry)
    expect(searchEntries(vault.entries, 'github')).toHaveLength(1)
    vault = updateEntry(vault, entry.id, { notes: 'Personal account' })
    expect(vault.entries[0]?.notes).toBe('Personal account')
    vault = toggleFavorite(vault, entry.id)
    expect(vault.entries[0]?.favorite).toBe(true)
    vault = removeEntry(vault, entry.id)
    expect(vault.entries).toHaveLength(0)
  })

  it('detects weak, reused and missing-url passwords', () => {
    let vault = createEmptyVault()
    vault = addEntry(vault, createEntry({ name: 'Weak', username: 'a', password: '123', url: '' }))
    vault = addEntry(vault, createEntry({ name: 'Reuse A', username: 'b', password: 'Same-strong-password!42', url: 'https://a.test' }))
    vault = addEntry(vault, createEntry({ name: 'Reuse B', username: 'c', password: 'Same-strong-password!42', url: 'https://b.test' }))
    const health = calculateHealth(vault.entries)
    expect(health.weak.map((entry) => entry.name)).toContain('Weak')
    expect(health.reused).toHaveLength(2)
    expect(health.missingUrl).toHaveLength(1)
  })

  it('generates passwords with requested length and alphabet controls', () => {
    const password = generatePassword(24, { uppercase: false, numbers: false, symbols: false })
    expect(password).toHaveLength(24)
    expect(password).toMatch(/^[a-z]+$/)
  })
})
