import type { CryptoEnvelope, EncryptedVaultEnvelope, Vault } from '../types/vault'

export const PBKDF2_ITERATIONS = 600_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class VaultCryptoError extends Error {
  constructor(message = 'Vault could not be decrypted.') {
    super(message)
    this.name = 'VaultCryptoError'
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function cryptoHeader(envelope: Pick<EncryptedVaultEnvelope, 'format' | 'schemaVersion' | 'crypto'>): Uint8Array {
  return encoder.encode(JSON.stringify({
    format: envelope.format,
    schemaVersion: envelope.schemaVersion,
    crypto: envelope.crypto,
  }))
}

export async function deriveVaultKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptVaultWithKey(vault: Vault, key: CryptoKey, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<EncryptedVaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cryptoInfo: CryptoEnvelope = {
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
  }
  const envelope: EncryptedVaultEnvelope = {
    format: 'secure-password-vault',
    schemaVersion: vault.schemaVersion,
    crypto: cryptoInfo,
    ciphertext: '',
  }
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: cryptoHeader(envelope) },
    key,
    encoder.encode(JSON.stringify(vault)),
  )
  return { ...envelope, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

export async function encryptVault(vault: Vault, password: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedVaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveVaultKey(password, salt, iterations)
  return encryptVaultWithKey(vault, key, salt, iterations)
}

export async function decryptVault(envelope: EncryptedVaultEnvelope, password: string): Promise<{ vault: Vault; key: CryptoKey; salt: Uint8Array }> {
  if (envelope.format !== 'secure-password-vault' || envelope.crypto.cipher !== 'AES-256-GCM' || envelope.crypto.kdf !== 'PBKDF2-SHA256') {
    throw new VaultCryptoError('Unsupported vault format.')
  }
  try {
    const salt = base64ToBytes(envelope.crypto.salt)
    const iv = base64ToBytes(envelope.crypto.iv)
    const key = await deriveVaultKey(password, salt, envelope.crypto.iterations)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: cryptoHeader(envelope) },
      key,
      base64ToBytes(envelope.ciphertext),
    )
    const vault = JSON.parse(decoder.decode(plaintext)) as Vault
    if (!vault || !Array.isArray(vault.entries) || !Array.isArray(vault.categories)) {
      throw new VaultCryptoError('Vault payload is invalid.')
    }
    return { vault, key, salt }
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error
    throw new VaultCryptoError()
  }
}

export function serializeEnvelope(envelope: EncryptedVaultEnvelope): string {
  return JSON.stringify(envelope)
}

export function deserializeEnvelope(serialized: string): EncryptedVaultEnvelope {
  const parsed: unknown = JSON.parse(serialized)
  if (!parsed || typeof parsed !== 'object') throw new VaultCryptoError('Invalid vault envelope.')
  const candidate = parsed as Partial<EncryptedVaultEnvelope>
  if (candidate.format !== 'secure-password-vault' || typeof candidate.ciphertext !== 'string' || !candidate.crypto) {
    throw new VaultCryptoError('Invalid vault envelope.')
  }
  return parsed as EncryptedVaultEnvelope
}
