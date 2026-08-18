import { describe, expect, it } from 'vitest'
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

    try {
      await new GoogleDriveProvider('test-client-id').connect({ prompt: 'select_account' })
      expect(prompts).toEqual(['select_account'])
    } finally {
      delete window.google
    }
  })
})
