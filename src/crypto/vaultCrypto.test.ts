import { describe, expect, it } from 'vitest'
import { decryptVault, encryptVault, serializeEnvelope } from './vaultCrypto'
import { createEmptyVault, createEntry, addEntry } from '../vault/vaultService'

describe('vault crypto', () => {
  it('encrypts and decrypts unicode vault data', async () => {
    let vault = createEmptyVault()
    vault = addEntry(vault, createEntry({ name: '銀行 / Café', username: 'ü@example.com', password: 'Pässw🚀rd!42', notes: '秘密のメモ' }))
    const envelope = await encryptVault(vault, 'mật khẩu rất mạnh 🚀', 1_000)
    const result = await decryptVault(envelope, 'mật khẩu rất mạnh 🚀')
    expect(result.vault).toEqual(vault)
    expect(envelope.ciphertext).not.toContain('Café')
  })

  it('rejects wrong passwords', async () => {
    const envelope = await encryptVault(createEmptyVault(), 'correct horse battery staple', 1_000)
    await expect(decryptVault(envelope, 'wrong password')).rejects.toThrow()
  })

  it('rejects ciphertext and authenticated metadata tampering', async () => {
    const envelope = await encryptVault(createEmptyVault(), 'a secure password', 1_000)
    const changedCiphertext = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}aa` }
    const changedMetadata = { ...envelope, crypto: { ...envelope.crypto, iterations: 1_001 } }
    await expect(decryptVault(changedCiphertext, 'a secure password')).rejects.toThrow()
    await expect(decryptVault(changedMetadata, 'a secure password')).rejects.toThrow()
  })

  it('generates a unique IV for every encryption', async () => {
    const vault = createEmptyVault()
    const first = await encryptVault(vault, 'same password', 1_000)
    const second = await encryptVault(vault, 'same password', 1_000)
    expect(first.crypto.iv).not.toBe(second.crypto.iv)
    expect(serializeEnvelope(first)).not.toEqual(serializeEnvelope(second))
  })

  it('handles a larger vault', async () => {
    let vault = createEmptyVault()
    for (let index = 0; index < 100; index += 1) {
      vault = addEntry(vault, createEntry({ name: `Service ${index}`, username: `user${index}`, password: `Unique-${index}-Password!`, notes: 'A longer note with unicode ✓' }))
    }
    const envelope = await encryptVault(vault, 'large vault password', 1_000)
    const result = await decryptVault(envelope, 'large vault password')
    expect(result.vault.entries).toHaveLength(100)
  })
})
