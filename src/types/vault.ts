export const CURRENT_SCHEMA_VERSION = 1

export type EntryIcon =
  | 'google'
  | 'facebook'
  | 'github'
  | 'microsoft'
  | 'email'
  | 'banking'
  | 'wifi'
  | 'shopping'
  | 'social'
  | 'other'

export interface Category {
  id: string
  name: string
  color: string
}

export interface VaultEntry {
  id: string
  name: string
  username: string
  password: string
  url: string
  categoryId: string
  notes: string
  favorite: boolean
  icon: EntryIcon
  createdAt: string
  updatedAt: string
}

export interface Vault {
  schemaVersion: number
  vaultId: string
  vaultVersion: number
  createdAt: string
  updatedAt: string
  entries: VaultEntry[]
  categories: Category[]
}

export interface CryptoEnvelope {
  cipher: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
}

export interface EncryptedVaultEnvelope {
  format: 'secure-password-vault'
  schemaVersion: number
  crypto: CryptoEnvelope
  ciphertext: string
}

export type VaultPermission = 'owner' | 'writer' | 'reader'
export type StorageMode = 'mock' | 'google'

export interface GoogleAccount {
  email: string
  displayName?: string
  permissionId?: string
}

export interface DriveFileCandidate {
  fileId: string
  fileName: string
  mimeType?: string
  createdTime?: string
  modifiedTime?: string
  trashed?: boolean
  permission: VaultPermission
}

export type GoogleConnectOptions = {
  prompt?: '' | 'none' | 'consent' | 'select_account'
}

export interface DriveMetadata {
  fileId: string
  fileName: string
  permission: VaultPermission
  mode: StorageMode
  googleAccountEmail?: string
  linkedAt: string
  lastSyncAt: string | null
}

export interface DrivePermission {
  id: string
  email: string
  role: 'owner' | 'writer' | 'reader'
  displayName?: string
}

export interface VaultStorageProvider {
  readonly mode: StorageMode
  connect(options?: GoogleConnectOptions): Promise<void>
  create(envelope: EncryptedVaultEnvelope): Promise<DriveMetadata>
  download(metadata: DriveMetadata): Promise<EncryptedVaultEnvelope>
  update(metadata: DriveMetadata, envelope: EncryptedVaultEnvelope): Promise<DriveMetadata>
  getMetadata(metadata: DriveMetadata): Promise<DriveMetadata>
  listPermissions?(metadata: DriveMetadata): Promise<DrivePermission[]>
  share?(metadata: DriveMetadata, email: string, role: 'reader' | 'writer'): Promise<void>
  removePermission?(metadata: DriveMetadata, permissionId: string): Promise<void>
  switchAccount?(metadata?: DriveMetadata): Promise<DriveMetadata | undefined>
  getAccount?(): GoogleAccount | null
  findVaultFiles?(): Promise<DriveFileCandidate[]>
}

export interface VaultHealth {
  weak: VaultEntry[]
  reused: VaultEntry[]
  stale: VaultEntry[]
  missingUrl: VaultEntry[]
}
