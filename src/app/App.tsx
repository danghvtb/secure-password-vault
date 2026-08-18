import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Archive, ArrowDownToLine, ArrowUpFromLine, Check,
  ChevronDown, Copy, Database, Eye, EyeOff, FileKey2, FolderPlus, Globe2,
  KeyRound, Landmark, LayoutDashboard, Lock, LogOut, Mail, Menu, MoreHorizontal,
  Pencil, Plus, RefreshCw, Search, Settings, Shield, Sparkles, Star, Sun, Trash2, Users,
  WandSparkles, Wifi, X, Chrome, Facebook, Github, Monitor, ShoppingBag,
} from 'lucide-react'
import { useAutoLock } from '../auth/useAutoLock'
import { decryptVault, deserializeEnvelope, encryptVault, encryptVaultWithKey, serializeEnvelope, VaultCryptoError } from '../crypto/vaultCrypto'
import { MockDriveProvider, GoogleDriveProvider } from '../storage/providers'
import { clearDeviceLinkage, loadPreferences, savePreferences, type DevicePreferences } from '../storage/preferences'
import {
  addEntry, addCategory, calculateHealth, createEmptyVault, createEntry, generatePassword,
  iconForEntry, removeEntry, scorePassword, searchEntries, toggleFavorite, updateEntry,
} from '../vault/vaultService'
import type { DrivePermission, EntryIcon as EntryIconType, EncryptedVaultEnvelope, Vault, VaultEntry, VaultStorageProvider } from '../types/vault'

type View = 'overview' | 'all' | 'favorites' | 'health' | 'generator' | 'settings'
type Notice = { type: 'success' | 'error' | 'info'; message: string }

function App() {
  const [preferences, setPreferences] = useState<DevicePreferences>(() => loadPreferences())
  const [locked, setLocked] = useState(() => !loadPreferences().setupComplete)
  const [vault, setVault] = useState<Vault | null>(null)
  const [view, setView] = useState<View>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [modal, setModal] = useState<'entry' | 'category' | 'backup' | null>(null)
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [provider, setProvider] = useState<VaultStorageProvider>(() => createProvider(preferences))
  const keyRef = useRef<CryptoKey | null>(null)
  const saltRef = useRef<Uint8Array | null>(null)

  const showNotice = useCallback((next: Notice) => {
    setNotice(next)
    window.setTimeout(() => setNotice((current) => current?.message === next.message ? null : current), 4500)
  }, [])

  const lock = useCallback(() => {
    keyRef.current = null
    saltRef.current = null
    setVault(null)
    setSelectedId(null)
    setQuery('')
    setLocked(true)
  }, [])

  const warning = useAutoLock(!locked && Boolean(vault), preferences.autoLockMinutes, lock)

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        lock()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [lock])

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
  }, [preferences.theme])

  const unlock = async (password: string) => {
    try {
      const metadata = preferences.driveMetadata
      if (!metadata) throw new Error('No vault is connected to this device.')
      await provider.connect()
      const envelope = await provider.download(metadata)
      const result = await decryptVault(envelope, password)
      keyRef.current = result.key
      saltRef.current = result.salt
      setVault(result.vault)
      setLocked(false)
      showNotice({ type: 'success', message: 'Vault unlocked securely.' })
    } catch (error) {
      const message = error instanceof VaultCryptoError ? 'Wrong Master Password, or the vault is corrupted.' : error instanceof Error ? error.message : 'Unable to unlock vault.'
      showNotice({ type: 'error', message })
      throw error
    }
  }

  const setup = async (password: string, mode: 'mock' | 'google') => {
    const provider = mode === 'google' ? new GoogleDriveProvider() : new MockDriveProvider()
    await provider.connect(mode === 'google' ? { prompt: 'select_account' } : undefined)
    const empty = createEmptyVault()
    const envelope = await encryptVault(empty, password)
    const metadata = await provider.create(envelope)
    const result = await decryptVault(envelope, password)
    const nextPreferences = { ...preferences, setupComplete: true, storageMode: mode, driveMetadata: metadata }
    setProvider(provider)
    keyRef.current = result.key
    saltRef.current = result.salt
    savePreferences(nextPreferences)
    setPreferences(nextPreferences)
    setVault(empty)
    setLocked(false)
    showNotice({ type: 'success', message: mode === 'mock' ? 'Encrypted local vault created.' : 'Google Drive vault created.' })
  }

  const persist = async (nextVault: Vault) => {
    const metadata = preferences.driveMetadata
    const key = keyRef.current
    const salt = saltRef.current
    if (!metadata || !key || !salt) throw new Error('Vault session is locked.')
    const envelope = await encryptVaultWithKey(nextVault, key, salt)
    const nextMetadata = await provider.update(metadata, envelope)
    const nextPreferences = { ...preferences, driveMetadata: nextMetadata }
    savePreferences(nextPreferences)
    setPreferences(nextPreferences)
    setVault(nextVault)
  }

  const mutateVault = async (nextVault: Vault) => {
    try {
      await persist(nextVault)
      showNotice({ type: 'success', message: 'Changes encrypted and synced.' })
    } catch (error) {
      showNotice({ type: 'error', message: error instanceof Error ? error.message : 'Could not save changes.' })
    }
  }

  const exportBackup = async (): Promise<EncryptedVaultEnvelope> => {
    if (!vault || !keyRef.current || !saltRef.current) throw new Error('Vault session is locked.')
    return encryptVaultWithKey(vault, keyRef.current, saltRef.current)
  }

  const importBackup = async (envelope: EncryptedVaultEnvelope) => {
    const metadata = preferences.driveMetadata
    if (!metadata) throw new Error('No connected vault.')
    const nextMetadata = await provider.update(metadata, envelope)
    const nextPreferences = { ...preferences, driveMetadata: nextMetadata }
    savePreferences(nextPreferences)
    setPreferences(nextPreferences)
    showNotice({ type: 'success', message: 'Encrypted backup imported and synced.' })
  }

  const connectExisting = async (fileIdOrUrl: string) => {
    const fileId = parseDriveFileId(fileIdOrUrl)
    if (!fileId) throw new Error('Enter a valid Google Drive file URL or file ID.')
    if (provider.mode !== 'google') throw new Error('Configure Google Drive before connecting a shared vault.')
    await provider.connect({ prompt: 'select_account' })
    const metadata = await provider.getMetadata({ fileId, fileName: 'PasswordVault.vault', permission: 'reader', mode: 'google', linkedAt: new Date().toISOString(), lastSyncAt: null })
    const nextPreferences = { ...preferences, setupComplete: true, storageMode: 'google' as const, driveMetadata: metadata }
    savePreferences(nextPreferences)
    setPreferences(nextPreferences)
    showNotice({ type: 'success', message: `Connected to ${metadata.fileName}. Unlock with the vault Master Password.` })
  }

  const switchGoogleAccount = async () => {
    if (provider.mode !== 'google' || !provider.switchAccount) return
    try {
      const nextMetadata = await provider.switchAccount(preferences.driveMetadata ?? undefined)
      if (nextMetadata) {
        const nextPreferences = { ...preferences, driveMetadata: nextMetadata }
        savePreferences(nextPreferences)
        setPreferences(nextPreferences)
      }
      showNotice({ type: 'success', message: 'Google account changed and current vault access was verified.' })
    } catch (error) {
      showNotice({ type: 'error', message: error instanceof Error ? error.message : 'Could not change Google account.' })
    }
  }

  const entries = useMemo(() => {
    if (!vault) return []
    let result = searchEntries(vault.entries, query, categoryFilter)
    if (view === 'favorites') result = result.filter((entry) => entry.favorite)
    if (view === 'health') {
      const health = calculateHealth(vault.entries)
      const ids = new Set([...health.weak, ...health.reused, ...health.stale, ...health.missingUrl].map((entry) => entry.id))
      result = result.filter((entry) => ids.has(entry.id))
    }
    return result
  }, [vault, query, categoryFilter, view])

  const selectedEntry = vault?.entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null

  if (!preferences.setupComplete) {
    return <SetupWizard onSetup={setup} configuredGoogle={Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)} />
  }
  if (locked || !vault) {
    return <UnlockScreen username={preferences.username} onUnlock={unlock} notice={notice} />
  }

  return (
    <div className="app-shell">
      {warning && <div className="lock-warning"><AlertTriangle size={16} /> Vault will lock soon due to inactivity. <button onClick={() => window.dispatchEvent(new Event('pointerdown'))}>Stay unlocked</button></div>}
      <Sidebar view={view} setView={(next) => { setView(next); setMobileMenu(false) }} open={mobileMenu} onClose={() => setMobileMenu(false)} vault={vault} />
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Vault</span><ChevronDown size={14} /><strong>{view === 'overview' ? 'Overview' : view === 'all' ? 'All passwords' : view === 'favorites' ? 'Favorites' : view === 'health' ? 'Password health' : view === 'generator' ? 'Generator' : 'Settings'}</strong></div>
          <div className="topbar-actions">
            <span className="sync-pill"><span className="status-dot" /> {preferences.driveMetadata?.mode === 'google' ? 'Google Drive' : 'Local encrypted'} <span className="muted">· Synced</span></span>
            <button className="icon-button" onClick={lock} aria-label="Lock vault" title="Lock vault (Ctrl/Cmd + Shift + L)"><Lock size={18} /></button>
            <div className="avatar">A</div>
          </div>
        </header>
        <div className="page-content">
          {view === 'overview' && <Overview vault={vault} onNavigate={setView} onSelect={(id) => { setSelectedId(id); setView('all') }} onNew={() => { setEditingEntry(null); setModal('entry') }} />}
          {view === 'generator' && <GeneratorView />}
          {view === 'settings' && <SettingsView preferences={preferences} setPreferences={(next) => { setPreferences(next); savePreferences(next) }} provider={provider} onNotice={showNotice} onDisconnect={() => { const next = clearDeviceLinkage(); setPreferences(next); lock() }} onSwitchGoogleAccount={switchGoogleAccount} onExport={exportBackup} onImport={importBackup} onConnectExisting={connectExisting} />}
          {view !== 'overview' && view !== 'generator' && view !== 'settings' && (
            <EntriesView
              title={view === 'all' ? 'All passwords' : view === 'favorites' ? 'Favorites' : 'Password health'}
              subtitle={view === 'health' ? 'Find weak and risky credentials before they become a problem.' : `${entries.length} saved ${entries.length === 1 ? 'login' : 'logins'}`}
              entries={entries}
              categories={vault.categories}
              selected={selectedEntry}
              query={query}
              categoryFilter={categoryFilter}
              clipboardClearSeconds={preferences.clipboardClearSeconds}
              setQuery={setQuery}
              setCategoryFilter={setCategoryFilter}
              onSelect={setSelectedId}
              onNew={() => { setEditingEntry(null); setModal('entry') }}
              onNewCategory={() => setModal('category')}
              onToggleFavorite={(id) => mutateVault(toggleFavorite(vault, id))}
              onDelete={(id) => mutateVault(removeEntry(vault, id))}
              onEdit={(entry) => { setEditingEntry(entry); setModal('entry') }}
            />
          )}
        </div>
      </main>
      {modal === 'entry' && <EntryModal entry={editingEntry} categories={vault.categories} onClose={() => setModal(null)} onSave={(input) => { const next = editingEntry ? updateEntry(vault, editingEntry.id, input) : addEntry(vault, createEntry(input)); void mutateVault(next); setModal(null) }} />}
      {modal === 'category' && <CategoryModal onClose={() => setModal(null)} onSave={(name, color) => { void mutateVault(addCategory(vault, name, color)); setModal(null) }} />}
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
    </div>
  )
}

function createProvider(preferences: DevicePreferences): VaultStorageProvider {
  return preferences.storageMode === 'google' ? new GoogleDriveProvider() : new MockDriveProvider()
}

function SetupWizard({ onSetup, configuredGoogle }: { onSetup: (password: string, mode: 'mock' | 'google') => Promise<void>; configuredGoogle: boolean }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mode, setMode] = useState<'mock' | 'google'>('mock')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const strength = scorePassword(password)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 12) return setError('Use at least 12 characters for your Master Password.')
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true); setError('')
    try { await onSetup(password, mode) } catch (setupError) { setError(setupError instanceof Error ? setupError.message : 'Setup failed.') } finally { setBusy(false) }
  }
  return <div className="auth-screen"><div className="auth-brand"><div className="brand-mark"><Shield size={28} /></div><span>Secure<span>Vault</span></span></div><div className="setup-card">
    <div className="step-label"><span className="step-active">01</span><span>02</span><span>03</span></div>
    <div className="eyebrow">Private by design</div><h1>Create your secure vault</h1><p className="auth-copy">Your Master Password is the only key. It never leaves this device and cannot be reset.</p>
    <form onSubmit={submit}>
      <label>Master Password<div className="password-field"><input autoFocus type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /> <button type="button" onClick={() => setShow(!show)} aria-label="Toggle password visibility">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
      <div className="strength"><div className="strength-bars">{[1, 2, 3, 4].map((level) => <span key={level} className={level <= strength ? `strength-${strength}` : ''} />)}</div><span>{password ? strength >= 4 ? 'Excellent' : strength >= 3 ? 'Good' : strength >= 2 ? 'Fair' : 'Weak' : 'Use a unique passphrase'}</span></div>
      <label>Confirm Master Password<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Enter it again" /></label>
      <div className="warning-box"><AlertTriangle size={18} /><span>If you lose this password, your encrypted vault cannot be recovered. SecureVault does not have a reset mechanism.</span></div>
      <div className="storage-choice"><div className="field-label">Vault storage</div><div className="choice-grid"><button type="button" className={mode === 'mock' ? 'choice selected' : 'choice'} onClick={() => setMode('mock')}><Database size={18} /><span><strong>Local demo</strong><small>Encrypted browser storage</small></span><Check size={16} /></button><button type="button" className={mode === 'google' ? 'choice selected' : 'choice'} disabled={!configuredGoogle} onClick={() => setMode('google')}><Globe2 size={18} /><span><strong>Google Drive</strong><small>{configuredGoogle ? 'Connect your own Drive' : 'Add OAuth client ID first'}</small></span><Check size={16} /></button></div></div>
      {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}<button className="primary-button full" disabled={busy} type="submit">{busy ? <><RefreshCw className="spin" size={17} /> Creating encrypted vault…</> : <>Create my vault <ArrowDownToLine size={17} /></>}</button>
    </form><div className="auth-footer"><Lock size={14} /> AES-256-GCM encryption · PBKDF2-SHA256</div>
  </div></div>
}

function UnlockScreen({ username, onUnlock, notice }: { username: string; onUnlock: (password: string) => Promise<void>; notice: Notice | null }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { await onUnlock(password) } catch (unlockError) { setError(unlockError instanceof Error ? unlockError.message : 'Unable to unlock vault.') } finally { setBusy(false) } }
  return <div className="auth-screen"><div className="auth-brand"><div className="brand-mark"><Shield size={28} /></div><span>Secure<span>Vault</span></span></div><div className="unlock-card"><div className="unlock-icon"><Lock size={30} /></div><div className="eyebrow">Welcome back, {username}</div><h1>Unlock your vault</h1><p className="auth-copy">Your passwords are encrypted and ready when you are.</p><form onSubmit={submit}><label>Master Password<div className="password-field"><input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your Master Password" /><button type="button" aria-label="Show password" onClick={(event) => { const input = event.currentTarget.previousElementSibling as HTMLInputElement | null; if (input) input.type = input.type === 'password' ? 'text' : 'password' }}><Eye size={18} /></button></div></label>{error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}<button className="primary-button full" disabled={busy} type="submit">{busy ? <><RefreshCw className="spin" size={17} /> Unlocking…</> : <><KeyRound size={17} /> Unlock vault</>}</button></form><div className="auth-footer"><Lock size={14} /> Auto-lock is enabled for your protection</div></div>{notice && <Toast notice={notice} onClose={() => undefined} />}</div>
}

function Sidebar({ view, setView, open, onClose, vault }: { view: View; setView: (view: View) => void; open: boolean; onClose: () => void; vault: Vault }) {
  const health = calculateHealth(vault.entries); const riskCount = new Set([...health.weak, ...health.reused, ...health.stale, ...health.missingUrl].map((entry) => entry.id)).size
  const nav = [{ id: 'overview' as const, label: 'Overview', icon: LayoutDashboard }, { id: 'all' as const, label: 'All passwords', icon: KeyRound, count: vault.entries.length }, { id: 'favorites' as const, label: 'Favorites', icon: Star, count: vault.entries.filter((entry) => entry.favorite).length }, { id: 'health' as const, label: 'Password health', icon: Activity, count: riskCount }]
  return <><div className={open ? 'sidebar-overlay visible' : 'sidebar-overlay'} onClick={onClose} /><aside className={open ? 'sidebar mobile-open' : 'sidebar'}><div className="sidebar-brand"><div className="brand-mark small"><Shield size={18} /></div><span>Secure<span>Vault</span></span><button className="icon-button close-mobile" onClick={onClose}><X size={18} /></button></div><div className="vault-selector"><div className="vault-avatar"><FileKey2 size={18} /></div><div><strong>Personal vault</strong><small>Encrypted vault</small></div><MoreHorizontal size={17} /></div><div className="nav-section"><span className="nav-label">Workspace</span>{nav.map((item) => <button key={item.id} className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setView(item.id)}><item.icon size={17} /><span>{item.label}</span>{item.count !== undefined && <em>{item.count}</em>}</button>)}<button className={view === 'generator' ? 'nav-item active' : 'nav-item'} onClick={() => setView('generator')}><WandSparkles size={17} /><span>Password generator</span></button></div><div className="sidebar-bottom"><button className={view === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setView('settings')}><Settings size={17} /><span>Settings</span></button><div className="security-card"><div className="security-icon"><Shield size={16} /></div><div><strong>Vault protected</strong><small>AES-256-GCM</small></div><span className="secure-check"><Check size={12} /></span></div><div className="sidebar-user"><div className="avatar">A</div><div><strong>admin</strong><small>Personal account</small></div><button className="icon-button"><LogOut size={16} /></button></div></div></aside></>
}

function Overview({ vault, onNavigate, onSelect, onNew }: { vault: Vault; onNavigate: (view: View) => void; onSelect: (id: string) => void; onNew: () => void }) {
  const health = calculateHealth(vault.entries); const riskCount = new Set([...health.weak, ...health.reused, ...health.stale, ...health.missingUrl].map((entry) => entry.id)).size
  return <div className="overview"><div className="page-heading"><div><div className="eyebrow">Tuesday, August 18, 2026</div><h1>Good evening, admin <span className="wave">✦</span></h1><p>Keep your digital life secure, one login at a time.</p></div><button className="primary-button" onClick={onNew}><Plus size={17} /> Add password</button></div><div className="stat-grid"><StatCard icon={KeyRound} label="Total passwords" value={vault.entries.length} color="violet" caption="in your vault" /><StatCard icon={Star} label="Favorites" value={vault.entries.filter((entry) => entry.favorite).length} color="amber" caption="quick access" /><StatCard icon={Shield} label="Security score" value={vault.entries.length ? `${Math.max(0, 100 - riskCount * 12)}%` : '—'} color="teal" caption={riskCount ? `${riskCount} need attention` : 'Everything looks good'} /><StatCard icon={RefreshCw} label="Last synced" value="Just now" color="blue" caption="Local encrypted storage" /></div><div className="content-grid"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recently added</h2><p>Your latest credentials</p></div><button className="text-button" onClick={() => onNavigate('all')}>View all <ArrowDownToLine size={14} /></button></div>{vault.entries.length ? vault.entries.slice(0, 5).map((entry) => <button className="recent-row" key={entry.id} onClick={() => onSelect(entry.id)}><EntryIcon icon={iconForEntry(entry)} /><span className="recent-copy"><strong>{entry.name}</strong><small>{entry.username || 'No username'}</small></span><span className="recent-time">{relativeDate(entry.createdAt)}</span><ChevronDown size={15} className="rotate-270" /></button>) : <EmptyState icon={KeyRound} title="Your vault is empty" copy="Add your first password to get started." action="Add password" onAction={onNew} />}</section><section className="panel score-panel"><div className="panel-heading"><div><h2>Security overview</h2><p>A quick look at your vault health</p></div><Shield size={19} className="panel-icon" /></div><div className="score-ring" style={{ '--score': `${Math.max(0, 100 - riskCount * 12)}` } as React.CSSProperties}><div><strong>{vault.entries.length ? Math.max(0, 100 - riskCount * 12) : 0}</strong><small>score</small></div></div><div className="score-label"><span className="status-dot" /> {riskCount ? 'A few things need attention' : 'Your vault is looking great'}</div><button className="outline-button full" onClick={() => onNavigate('health')}>Review password health <ArrowDownToLine size={15} /></button></section></div><section className="quick-actions"><div className="section-title"><div><h2>Quick actions</h2><p>Tools for a more secure day</p></div></div><div className="quick-grid"><QuickAction icon={WandSparkles} title="Generate password" copy="Create a strong, unique password" onClick={() => onNavigate('generator')} /><QuickAction icon={ArrowUpFromLine} title="Import backup" copy="Restore an encrypted vault" onClick={() => undefined} /><QuickAction icon={Users} title="Share vault" copy="Invite a trusted collaborator" onClick={() => onNavigate('settings')} /></div></section></div>
}

function EntriesView({ title, subtitle, entries, categories, selected, query, categoryFilter, clipboardClearSeconds, setQuery, setCategoryFilter, onSelect, onNew, onNewCategory, onToggleFavorite, onDelete, onEdit }: { title: string; subtitle: string; entries: VaultEntry[]; categories: Vault['categories']; selected: VaultEntry | null; query: string; categoryFilter?: string; clipboardClearSeconds: number; setQuery: (value: string) => void; setCategoryFilter: (value: string | undefined) => void; onSelect: (id: string) => void; onNew: () => void; onNewCategory: () => void; onToggleFavorite: (id: string) => void; onDelete: (id: string) => void; onEdit: (entry: VaultEntry) => void }) {
  return <div className="entries-page"><div className="page-heading compact"><div><div className="eyebrow">Your secure collection</div><h1>{title}</h1><p>{subtitle}</p></div><button className="primary-button" onClick={onNew}><Plus size={17} /> Add password</button></div><div className="entries-layout"><section className="panel entry-list-panel"><div className="entry-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search passwords…" /></div><select value={categoryFilter ?? ''} onChange={(event) => setCategoryFilter(event.target.value || undefined)}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button className="icon-button" title="New category" aria-label="New category" onClick={onNewCategory}><FolderPlus size={17} /></button></div>{entries.length ? <div className="entry-list">{entries.map((entry) => <button className={selected?.id === entry.id ? 'entry-row selected' : 'entry-row'} key={entry.id} onClick={() => onSelect(entry.id)}><EntryIcon icon={iconForEntry(entry)} /><span className="entry-copy"><strong>{entry.name}</strong><small>{entry.username || 'No username'}</small></span>{entry.favorite && <Star size={14} className="favorite-fill" fill="currentColor" />}<span className="row-chevron">›</span></button>)}</div> : <EmptyState icon={Search} title="No passwords found" copy="Try a different search or add a new login." action="Add password" onAction={onNew} />}</section>{selected ? <EntryDetail entry={selected} clipboardClearSeconds={clipboardClearSeconds} onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected.id)} onToggleFavorite={() => onToggleFavorite(selected.id)} /> : <div className="panel detail-empty"><KeyRound size={30} /><p>Select a password to view its details.</p></div>}</div></div>
}

function EntryDetail({ entry, clipboardClearSeconds, onEdit, onDelete, onToggleFavorite }: { entry: VaultEntry; clipboardClearSeconds: number; onEdit: () => void; onDelete: () => void; onToggleFavorite: () => void }) {
  const [revealed, setRevealed] = useState(false); const [copied, setCopied] = useState(false)
  const copy = async (value: string) => { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 2000); window.setTimeout(() => { void navigator.clipboard?.writeText('') }, clipboardClearSeconds * 1000) }
  return <section className="panel detail-panel"><div className="detail-header"><div className="detail-title"><EntryIcon icon={iconForEntry(entry)} large /><div><h2>{entry.name}</h2><span>{entry.url || 'No website added'}</span></div></div><div className="detail-actions"><button className="icon-button" onClick={onToggleFavorite} aria-label="Toggle favorite">{entry.favorite ? <Star fill="currentColor" className="favorite-fill" size={18} /> : <Star size={18} />}</button><button className="icon-button" onClick={onEdit} aria-label="Edit entry"><Pencil size={17} /></button><button className="icon-button danger" onClick={() => { if (window.confirm('Delete this login permanently?')) onDelete() }} aria-label="Delete entry"><Trash2 size={17} /></button></div></div><div className="detail-divider" /><div className="detail-fields"><DetailField label="Username" value={entry.username} onCopy={() => copy(entry.username)} /><div className="detail-field"><span>Password</span><div><strong className="secret-value">{revealed ? entry.password : '••••••••••••••••'}</strong><button className="inline-icon" onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={16} /> : <Eye size={16} />}</button><button className="inline-icon" onClick={() => copy(entry.password)}><Copy size={16} /></button></div></div><DetailField label="Website" value={entry.url || '—'} onCopy={() => entry.url && copy(entry.url)} /><div className="detail-field notes"><span>Notes</span><p>{entry.notes || 'No notes for this login.'}</p></div></div><div className="detail-footer"><span>Added {relativeDate(entry.createdAt)}</span><span>Updated {relativeDate(entry.updatedAt)}</span>{copied && <span className="copied"><Check size={14} /> Copied to clipboard</span>}</div></section>
}

function DetailField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) { return <div className="detail-field"><span>{label}</span><div><strong>{value}</strong><button className="inline-icon" onClick={onCopy}><Copy size={16} /></button></div></div> }

function EntryModal({ entry, categories, onClose, onSave }: { entry: VaultEntry | null; categories: Vault['categories']; onClose: () => void; onSave: (input: Pick<VaultEntry, 'name' | 'username' | 'password'> & Partial<VaultEntry>) => void }) {
  const [name, setName] = useState(entry?.name ?? ''); const [username, setUsername] = useState(entry?.username ?? ''); const [password, setPassword] = useState(entry?.password ?? ''); const [url, setUrl] = useState(entry?.url ?? ''); const [categoryId, setCategoryId] = useState(entry?.categoryId ?? categories[0]?.id ?? ''); const [notes, setNotes] = useState(entry?.notes ?? ''); const [favorite, setFavorite] = useState(entry?.favorite ?? false); const [show, setShow] = useState(false)
  return <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}><div className="modal-card"><div className="modal-heading"><div><div className="eyebrow">{entry ? 'Edit credential' : 'New credential'}</div><h2>{entry ? 'Update password' : 'Add password'}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="form-grid"><label>Website or service<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Google Workspace" /></label><label>Username or email<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="you@example.com" /></label><label>Password<div className="password-field"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter or generate a password" /><button type="button" onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button><button type="button" onClick={() => setPassword(generatePassword())}><WandSparkles size={17} /></button></div></label><label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Website URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label><label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional secure notes" rows={3} /></label></div><label className="check-label"><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} /> <Star size={16} /> Add to favorites</label><div className="modal-actions"><button className="outline-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name || !password} onClick={() => onSave({ name, username, password, url, categoryId, notes, favorite })}><Check size={16} /> Save encrypted</button></div></div></div>
}

function GeneratorView() { const [length, setLength] = useState(20); const [uppercase, setUppercase] = useState(true); const [numbers, setNumbers] = useState(true); const [symbols, setSymbols] = useState(true); const [password, setPassword] = useState(() => generatePassword()); const [copied, setCopied] = useState(false); const regenerate = () => setPassword(generatePassword(length, { uppercase, numbers, symbols })); const copy = async () => { await navigator.clipboard?.writeText(password); setCopied(true); window.setTimeout(() => setCopied(false), 2000) }; return <div className="generator-page"><div className="page-heading compact"><div><div className="eyebrow">Create something unguessable</div><h1>Password generator</h1><p>Generate strong, unique passwords with browser-native randomness.</p></div></div><div className="generator-layout"><section className="panel generator-result"><div className="result-label"><Sparkles size={16} /> Your generated password</div><div className="generated-password">{password}</div><div className="generator-actions"><button className="primary-button" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy password'}</button><button className="outline-button" onClick={regenerate}><RefreshCw size={16} /> Regenerate</button></div><div className="generator-strength"><span>Strength</span><div className="strength-bars">{[1, 2, 3, 4].map((level) => <span className="strength-4" key={level} />)}</div><strong>Excellent</strong></div></section><section className="panel generator-options"><h2>Customize</h2><p>Adjust the rules for your generated password.</p><label className="range-label"><span>Password length <strong>{length}</strong></span><input type="range" min="12" max="40" value={length} onChange={(event) => setLength(Number(event.target.value))} /></label><Toggle label="Uppercase letters" checked={uppercase} onChange={setUppercase} /><Toggle label="Numbers" checked={numbers} onChange={setNumbers} /><Toggle label="Symbols" checked={symbols} onChange={setSymbols} /></section></div><div className="generator-tip"><Shield size={18} /><span><strong>Why this matters:</strong> Unique passwords protect you if one service is breached. Never reuse a password across accounts.</span></div></div> }

function SettingsView({ preferences, setPreferences, provider, onNotice, onDisconnect, onSwitchGoogleAccount, onExport, onImport, onConnectExisting }: { preferences: DevicePreferences; setPreferences: (preferences: DevicePreferences) => void; provider: VaultStorageProvider; onNotice: (notice: Notice) => void; onDisconnect: () => void; onSwitchGoogleAccount: () => Promise<void>; onExport: () => Promise<EncryptedVaultEnvelope>; onImport: (envelope: EncryptedVaultEnvelope) => Promise<void>; onConnectExisting: (fileIdOrUrl: string) => Promise<void> }) { const [tab, setTab] = useState('Security'); const tabs = ['General', 'Security', 'Google Drive', 'Sharing', 'Backup', 'Appearance', 'About']; return <div className="settings-page"><div className="page-heading compact"><div><div className="eyebrow">Your preferences</div><h1>Settings</h1><p>Configure how SecureVault works for you.</p></div></div><div className="settings-layout"><nav className="settings-nav">{tabs.map((item) => <button className={tab === item ? 'settings-tab active' : 'settings-tab'} key={item} onClick={() => setTab(item)}>{item === 'Security' ? <Shield size={16} /> : item === 'Google Drive' ? <Database size={16} /> : item === 'Sharing' ? <Users size={16} /> : item === 'Appearance' ? <Sun size={16} /> : <Settings size={16} />}{item}</button>)}</nav><section className="panel settings-card">{tab === 'Security' && <><SettingHeading title="Security" copy="Keep your unlocked session short and your clipboard clean." icon={Shield} /><SettingRow title="Auto-lock" copy="Lock the vault after inactivity"><select value={preferences.autoLockMinutes} onChange={(event) => setPreferences({ ...preferences, autoLockMinutes: Number(event.target.value) as DevicePreferences['autoLockMinutes'] })}><option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option></select></SettingRow><SettingRow title="Clear clipboard" copy="Remove copied passwords automatically"><select value={preferences.clipboardClearSeconds} onChange={(event) => setPreferences({ ...preferences, clipboardClearSeconds: Number(event.target.value) })}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></SettingRow><div className="setting-callout"><Lock size={17} /><div><strong>Master Password cannot be reset</strong><p>SecureVault never receives or stores it. Keep a secure offline recovery reminder.</p></div></div></>}{tab === 'General' && <><SettingHeading title="General" copy="Basic account preferences." icon={Settings} /><SettingRow title="Account label" copy="Shown on the lock screen"><input value={preferences.username} onChange={(event) => setPreferences({ ...preferences, username: event.target.value })} /></SettingRow></>}{tab === 'Appearance' && <><SettingHeading title="Appearance" copy="Choose a comfortable look for your vault." icon={Sun} /><SettingRow title="Theme" copy="System follows your operating system"><select value={preferences.theme} onChange={(event) => setPreferences({ ...preferences, theme: event.target.value as DevicePreferences['theme'] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></SettingRow></>}{tab === 'Google Drive' && <><SettingHeading title="Google Drive" copy="Your encrypted vault storage and device linkage." icon={Database} /><div className="drive-status"><div className="drive-logo"><Database size={22} /></div><div><strong>{preferences.driveMetadata?.mode === 'google' ? 'Google Drive connected' : 'Local encrypted storage'}</strong><p>{preferences.driveMetadata?.fileName ?? 'No vault connected'}</p></div><span className="status-badge"><span className="status-dot" /> Connected</span></div><div className="setting-callout"><Shield size={17} /><div><strong>Only ciphertext is uploaded</strong><p>Drive metadata does not contain usernames, URLs, passwords or notes.</p></div></div><button className="outline-button" onClick={() => onNotice({ type: 'info', message: provider.mode === 'mock' ? 'Local encrypted provider is active. Configure VITE_GOOGLE_CLIENT_ID for Google Drive.' : 'Google Drive is already connected.' })}><RefreshCw size={16} /> Check connection</button>{provider.mode === 'google' && <button className="outline-button" onClick={() => void onSwitchGoogleAccount()}><RefreshCw size={16} /> Change Google account</button>}{provider.mode === 'google' && <ConnectExisting onConnect={onConnectExisting} />}<button className="danger-text-button" onClick={onDisconnect}>Disconnect this device</button></>}{tab === 'Sharing' && <SharingView provider={provider} metadata={preferences.driveMetadata} onNotice={onNotice} />}{tab === 'Backup' && <BackupView onNotice={onNotice} onExport={onExport} onImport={onImport} />}{tab === 'About' && <><SettingHeading title="About SecureVault" copy="Private password management for people who value control." icon={Shield} /><div className="about-list"><div><strong>Encryption</strong><span>AES-256-GCM</span></div><div><strong>Key derivation</strong><span>PBKDF2-SHA256 · 600,000 iterations</span></div><div><strong>Storage</strong><span>No backend database · Google Drive ciphertext only</span></div></div></>}</section></div></div> }

function ConnectExisting({ onConnect }: { onConnect: (fileIdOrUrl: string) => Promise<void> }) { const [value, setValue] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); return <div className="connect-existing"><div className="field-label">Connect an existing shared vault</div><div className="share-form"><input placeholder="Drive file URL or file ID" value={value} onChange={(event) => setValue(event.target.value)} /><button className="outline-button" disabled={!value || busy} onClick={async () => { setBusy(true); setError(''); try { await onConnect(value) } catch (connectError) { setError(connectError instanceof Error ? connectError.message : 'Could not connect vault.') } finally { setBusy(false) } }}>{busy ? 'Connecting…' : 'Connect'}</button></div>{error && <div className="form-error"><AlertTriangle size={15} /> {error}</div>}</div> }

function SharingView({ provider, metadata, onNotice }: { provider: VaultStorageProvider; metadata: DevicePreferences['driveMetadata']; onNotice: (notice: Notice) => void }) { const [permissions, setPermissions] = useState<DrivePermission[]>([]); const [email, setEmail] = useState(''); const [role, setRole] = useState<'reader' | 'writer'>('reader'); const load = async () => { if (!provider.listPermissions || !metadata) return; try { setPermissions(await provider.listPermissions(metadata)) } catch (error) { onNotice({ type: 'error', message: error instanceof Error ? error.message : 'Could not load permissions.' }) } }; return <><SettingHeading title="Vault access" copy="Drive permissions are the source of truth for collaboration." icon={Users} /><div className="share-form"><input type="email" placeholder="person@gmail.com" value={email} onChange={(event) => setEmail(event.target.value)} /><select value={role} onChange={(event) => setRole(event.target.value as 'reader' | 'writer')}><option value="reader">Viewer</option><option value="writer">Editor</option></select><button className="primary-button" disabled={!email || !provider.share || !metadata} onClick={async () => { try { await provider.share?.(metadata!, email, role); setEmail(''); onNotice({ type: 'success', message: 'Vault access updated.' }); await load() } catch (error) { onNotice({ type: 'error', message: error instanceof Error ? error.message : 'Could not share vault.' }) } }}><Plus size={16} /> Share</button></div><button className="text-button" onClick={() => void load()}><RefreshCw size={14} /> Refresh permissions</button><div className="permission-list">{permissions.length ? permissions.map((permission) => <div className="permission-row" key={permission.id}><div className="avatar tiny">{permission.email[0]?.toUpperCase()}</div><span><strong>{permission.email}</strong><small>{permission.displayName ?? 'Drive user'}</small></span><em>{permission.role}</em>{provider.removePermission && metadata && <button className="icon-button danger" onClick={() => void provider.removePermission?.(metadata, permission.id).then(() => { onNotice({ type: 'success', message: 'Permission removed.' }); return load() }).catch(() => onNotice({ type: 'error', message: 'Could not remove permission.' }))}><Trash2 size={15} /></button>}</div>) : <p className="empty-copy">No permissions loaded yet. Refresh to query Drive.</p>}</div></> }

function BackupView({ onNotice, onExport, onImport }: { onNotice: (notice: Notice) => void; onExport: () => Promise<EncryptedVaultEnvelope>; onImport: (envelope: EncryptedVaultEnvelope) => Promise<void> }) { const [file, setFile] = useState<File | null>(null); const exportBackup = async () => { try { const envelope = await onExport(); const blob = new Blob([serializeEnvelope(envelope)], { type: 'application/octet-stream' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'PasswordVault.backup.vault'; anchor.click(); URL.revokeObjectURL(url); onNotice({ type: 'success', message: 'Encrypted backup exported.' }) } catch (error) { onNotice({ type: 'error', message: error instanceof Error ? error.message : 'Could not export backup.' }) } }; const importBackup = async (nextFile: File) => { setFile(nextFile); try { const envelope = deserializeEnvelope(await nextFile.text()); await onImport(envelope) } catch (error) { onNotice({ type: 'error', message: error instanceof Error ? error.message : 'Invalid encrypted backup.' }) } }; return <><SettingHeading title="Encrypted backup" copy="Move an encrypted vault envelope between devices." icon={Archive} /><div className="backup-actions"><button className="outline-button" onClick={() => void exportBackup()}><ArrowUpFromLine size={16} /> Export encrypted backup</button><label className="outline-button"><ArrowDownToLine size={16} /> Import backup<input hidden type="file" accept=".vault,.enc,application/json" onChange={(event) => { const nextFile = event.target.files?.[0]; if (nextFile) void importBackup(nextFile) }} /></label></div>{file && <div className="file-picked"><Check size={16} /> {file.name} selected and validated as an encrypted envelope.</div>}<div className="setting-callout"><AlertTriangle size={17} /><div><strong>Backups are still sensitive</strong><p>Anyone with the encrypted file still needs your Master Password. Keep backups in a trusted location.</p></div></div></> }

function SettingHeading({ title, copy, icon: Icon }: { title: string; copy: string; icon: typeof Shield }) { return <div className="setting-heading"><div className="setting-icon"><Icon size={19} /></div><div><h2>{title}</h2><p>{copy}</p></div></div> }
function SettingRow({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><p>{copy}</p></div>{children}</div> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><button type="button" className={checked ? 'toggle checked' : 'toggle'} onClick={() => onChange(!checked)}><span /></button></label> }
function StatCard({ icon: Icon, label, value, caption, color }: { icon: typeof KeyRound; label: string; value: string | number; caption: string; color: string }) { return <div className="stat-card"><div className={`stat-icon ${color}`}><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{caption}</small></div> }
function QuickAction({ icon: Icon, title, copy, onClick }: { icon: typeof KeyRound; title: string; copy: string; onClick: () => void }) { return <button className="quick-action" onClick={onClick}><div className="quick-icon"><Icon size={19} /></div><span><strong>{title}</strong><small>{copy}</small></span><ChevronDown size={16} className="rotate-270" /></button> }
function EmptyState({ icon: Icon, title, copy, action, onAction }: { icon: typeof KeyRound; title: string; copy: string; action: string; onAction: () => void }) { return <div className="empty-state"><div className="empty-icon"><Icon size={22} /></div><h3>{title}</h3><p>{copy}</p><button className="outline-button" onClick={onAction}><Plus size={15} /> {action}</button></div> }
function CategoryModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, color: string) => void }) { const [name, setName] = useState(''); const [color, setColor] = useState('#8b5cf6'); return <div className="modal-backdrop"><div className="modal-card small-modal"><div className="modal-heading"><div><div className="eyebrow">Organize your vault</div><h2>New category</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><label>Category name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Travel" /></label><label>Accent color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><div className="modal-actions"><button className="outline-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()} onClick={() => onSave(name, color)}><Check size={16} /> Create category</button></div></div></div> }
function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) { return <div className={`toast ${notice.type}`}><span>{notice.type === 'success' ? <Check size={16} /> : notice.type === 'error' ? <AlertTriangle size={16} /> : <Shield size={16} />}</span><p>{notice.message}</p><button onClick={onClose}><X size={15} /></button></div> }
function EntryIcon({ icon, large = false }: { icon: EntryIconType; large?: boolean }) { const icons: Record<EntryIconType, typeof Globe2> = { google: Chrome, facebook: Facebook, github: Github, microsoft: Monitor, email: Mail, banking: Landmark, wifi: Wifi, shopping: ShoppingBag, social: Users, other: Globe2 }; const Icon = icons[icon]; return <div className={large ? 'entry-icon large' : 'entry-icon'}><Icon size={large ? 23 : 18} /></div> }
function relativeDate(date: string): string { const days = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 86400000)); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago` }

function parseDriveFileId(value: string): string | null {
  const trimmed = value.trim()
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) ?? trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) ? trimmed : null)
}

export default App
