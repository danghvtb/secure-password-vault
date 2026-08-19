import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleDriveProvider, MockDriveProvider } from './providers'
import { createEmptyVault } from '../vault/vaultService'
import { decryptVault, encryptVault } from '../crypto/vaultCrypto'

describe('MockDriveProvider', () => {
  it('creates, downloads and updates encrypted vaults', async () => {
    const provider = new MockDriveProvider()
    const envelope = await encryptVault(createEmptyVault(), 'test password', 1_000)
    const metadata = await provider.create(envelope)
    expect(metadata.fileName).toBe('PasswordVault.vault')
    const downloaded = await provider.download(metadata)
    await expect(decryptVault(downloaded, 'test password')).resolves.toBeTruthy()
    const updated = await provider.update(metadata, envelope)
    expect(updated.lastSyncAt).not.toBeNull()
  })

  it('enforces read-only mode', async () => {
    const provider = new MockDriveProvider()
    const envelope = await encryptVault(createEmptyVault(), 'test password', 1_000)
    const metadata = await provider.create(envelope)
    await expect(provider.update({ ...metadata, permission: 'reader' }, envelope)).rejects.toThrow('read only')
  })
})

describe('GoogleDriveProvider authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('can explicitly request the Google account chooser', async () => {
    const prompts: string[] = []
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: (options) => {
              prompts.push(options?.prompt ?? '')
              callback({ access_token: 'test-access-token' })
            },
          }),
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ user: { emailAddress: 'owner@example.com', displayName: 'Owner', permissionId: 'owner-id' } }),
    })))

    try {
      const provider = new GoogleDriveProvider('test-client-id')
      await provider.connect({ prompt: 'select_account' })
      expect(prompts).toEqual(['select_account'])
      expect(provider.getAccount()).toEqual({ email: 'owner@example.com', displayName: 'Owner', permissionId: 'owner-id' })
    } finally {
      delete window.google
    }
  })

  it('finds active vault files for the connected account', async () => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: () => callback({ access_token: 'test-access-token' }),
          }),
        },
      },
    }
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { emailAddress: 'owner@example.com', permissionId: 'owner-id' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [
        { id: 'vault-1', name: 'PasswordVault.vault', modifiedTime: '2026-08-19T08:00:00.000Z', owners: [{ permissionId: 'owner-id' }] },
      ] }) })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = new GoogleDriveProvider('test-client-id')
      await provider.connect()
      await expect(provider.findVaultFiles()).resolves.toEqual([expect.objectContaining({ fileId: 'vault-1', permission: 'owner' })])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      delete window.google
    }
  })

  it('refuses to create a second vault for the connected account', async () => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: () => callback({ access_token: 'test-access-token' }),
          }),
        },
      },
    }
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { emailAddress: 'owner@example.com', permissionId: 'owner-id' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ id: 'existing-vault', name: 'PasswordVault.vault', owners: [{ permissionId: 'owner-id' }] }] }) })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = new GoogleDriveProvider('test-client-id')
      await provider.connect()
      const envelope = await encryptVault(createEmptyVault(), 'test password', 1_000)
      await expect(provider.create(envelope)).rejects.toThrow('already has a vault')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      delete window.google
    }
  })
})
