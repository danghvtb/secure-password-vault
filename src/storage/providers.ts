import { deserializeEnvelope, serializeEnvelope } from '../crypto/vaultCrypto'
import type { DriveMetadata, DrivePermission, EncryptedVaultEnvelope, VaultStorageProvider } from '../types/vault'

const MOCK_KEY = 'securevault.mock-drive.envelope.v1'
const MOCK_META_KEY = 'securevault.mock-drive.metadata.v1'

export class MockDriveProvider implements VaultStorageProvider {
  readonly mode = 'mock' as const

  async connect(): Promise<void> {
    return Promise.resolve()
  }

  async create(envelope: EncryptedVaultEnvelope): Promise<DriveMetadata> {
    const metadata: DriveMetadata = {
      fileId: `mock-${crypto.randomUUID()}`,
      fileName: 'PasswordVault.vault',
      permission: 'owner',
      mode: 'mock',
      linkedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
    }
    localStorage.setItem(MOCK_KEY, serializeEnvelope(envelope))
    localStorage.setItem(MOCK_META_KEY, JSON.stringify(metadata))
    return metadata
  }

  async download(metadata: DriveMetadata): Promise<EncryptedVaultEnvelope> {
    if (metadata.mode !== 'mock') throw new Error('Mock provider cannot access this file.')
    const stored = localStorage.getItem(MOCK_KEY)
    if (!stored) throw new Error('Vault file not found.')
    return deserializeEnvelope(stored)
  }

  async update(metadata: DriveMetadata, envelope: EncryptedVaultEnvelope): Promise<DriveMetadata> {
    if (metadata.permission === 'reader') throw new Error('This vault is read only.')
    localStorage.setItem(MOCK_KEY, serializeEnvelope(envelope))
    const updated = { ...metadata, lastSyncAt: new Date().toISOString() }
    localStorage.setItem(MOCK_META_KEY, JSON.stringify(updated))
    return updated
  }

  async getMetadata(metadata: DriveMetadata): Promise<DriveMetadata> {
    const stored = localStorage.getItem(MOCK_META_KEY)
    return stored ? JSON.parse(stored) as DriveMetadata : metadata
  }
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

interface GoogleIdentity {
  accounts: { oauth2: { initTokenClient(config: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void }): GoogleTokenClient } }
}

declare global {
  interface Window { google?: { accounts: GoogleIdentity['accounts'] } }
}

export class GoogleDriveProvider implements VaultStorageProvider {
  readonly mode = 'google' as const
  private accessToken = ''
  private tokenClient: GoogleTokenClient | null = null
  private readonly clientId: string

  constructor(clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '') {
    this.clientId = clientId
  }

  async connect(): Promise<void> {
    if (!this.clientId) throw new Error('Google OAuth client ID is not configured.')
    await loadGoogleIdentityScript()
    if (!window.google) throw new Error('Google Identity Services could not load.')
    await new Promise<void>((resolve, reject) => {
      this.tokenClient = window.google?.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response) => {
          if (response.error || !response.access_token) reject(new Error('Google authorization failed.'))
          else { this.accessToken = response.access_token; resolve() }
        },
      }) ?? null
      this.tokenClient?.requestAccessToken({ prompt: '' })
    })
  }

  async create(envelope: EncryptedVaultEnvelope): Promise<DriveMetadata> {
    const metadata = { name: 'PasswordVault.vault', mimeType: 'application/octet-stream', appProperties: { app: 'secure-password-manager', schemaVersion: '1' } }
    const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      body: multipartBody(metadata, serializeEnvelope(envelope)),
      headers: { 'Content-Type': 'multipart/related; boundary=securevault-boundary' },
    })
    const file = await response.json() as { id: string; name: string }
    return { fileId: file.id, fileName: file.name, permission: 'owner', mode: 'google', linkedAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() }
  }

  async download(metadata: DriveMetadata): Promise<EncryptedVaultEnvelope> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(metadata.fileId)}?alt=media`)
    return deserializeEnvelope(await response.text())
  }

  async update(metadata: DriveMetadata, envelope: EncryptedVaultEnvelope): Promise<DriveMetadata> {
    if (metadata.permission === 'reader') throw new Error('This vault is read only.')
    await this.request(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(metadata.fileId)}?uploadType=media`, { method: 'PATCH', body: serializeEnvelope(envelope), headers: { 'Content-Type': 'application/octet-stream' } })
    return { ...metadata, lastSyncAt: new Date().toISOString() }
  }

  async getMetadata(metadata: DriveMetadata): Promise<DriveMetadata> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(metadata.fileId)}?fields=id,name,capabilities(canEdit),trashed`)
    const file = await response.json() as { id: string; name: string; capabilities?: { canEdit?: boolean }; trashed?: boolean }
    if (file.trashed) throw new Error('Vault file was moved to trash.')
    return { ...metadata, fileName: file.name, permission: file.capabilities?.canEdit === false ? 'reader' : metadata.permission }
  }

  async listPermissions(metadata: DriveMetadata): Promise<DrivePermission[]> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(metadata.fileId)}/permissions?fields=permissions(id,emailAddress,role,displayName)`)
    const body = await response.json() as { permissions?: Array<{ id: string; emailAddress?: string; role: 'owner' | 'writer' | 'reader'; displayName?: string }> }
    return (body.permissions ?? []).map((permission) => ({ id: permission.id, email: permission.emailAddress ?? 'Unknown', role: permission.role, displayName: permission.displayName }))
  }

  async share(metadata: DriveMetadata, email: string, role: 'reader' | 'writer'): Promise<void> {
    await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(metadata.fileId)}/permissions?sendNotificationEmail=true`, { method: 'POST', body: JSON.stringify({ type: 'user', role, emailAddress: email }), headers: { 'Content-Type': 'application/json' } })
  }

  async removePermission(metadata: DriveMetadata, permissionId: string): Promise<void> {
    await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(metadata.fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' })
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) throw new Error('Google Drive is not connected.')
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.headers ?? {}) } })
    if (!response.ok) throw new Error(`Drive request failed (${response.status}).`)
    return response
  }
}

function multipartBody(metadata: object, content: string): string {
  return `--securevault-boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--securevault-boundary\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--securevault-boundary--`
}

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Identity Services could not load.'))
    document.head.appendChild(script)
  })
}
