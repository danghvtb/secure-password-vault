# SecureVault — Implementation Plan

## Mục tiêu

Password Manager frontend-only, responsive và production-ready với React + TypeScript + Vite. Vault được mã hóa trước khi lưu; Google Drive là storage production và Mock Drive dùng cho development/test. Master Password không bao giờ được lưu persistent.

## Trạng thái triển khai

### Phase 1 — Scaffold — COMPLETE

- [x] Vite + React + TypeScript, strict mode.
- [x] ESLint, Prettier, Vitest, Playwright scripts.
- [x] `.env.example`, `.gitignore`, package lock và build config.

### Phase 2 — Crypto layer — COMPLETE

- [x] PBKDF2-SHA256 với mặc định 600.000 iterations và random salt.
- [x] AES-256-GCM với random IV cho mỗi lần encrypt.
- [x] Envelope serialize/deserialize và validation.
- [x] Sai password, ciphertext tamper và authenticated metadata tamper đều bị từ chối.
- [x] CryptoKey và plaintext chỉ tồn tại trong session RAM.

### Phase 3 — Vault domain — COMPLETE

- [x] `Vault`, `VaultEntry`, `Category`, encrypted envelope types.
- [x] CRUD, favorites, categories, search và migration boundary.
- [x] Web Crypto password generator.
- [x] Health checks: weak, reused, stale và missing URL.

### Phase 4 — Storage providers — COMPLETE WITH AUTH BOUNDARY

- [x] `VaultStorageProvider` abstraction.
- [x] Mock Drive provider lưu encrypted envelope cho local/CI/E2E.
- [x] Google Drive API v3 provider với Google Identity Services.
- [x] Narrow scope `https://www.googleapis.com/auth/drive.file`.
- [x] Create, download, update, metadata, permissions, share/revoke.
- [x] Permission denied, read-only, network error và conflict boundaries.
- [ ] OAuth consent và Drive smoke test thật — cần user account interaction.

### Phase 5 — App lock và session — COMPLETE

- [x] First-run wizard, password confirmation, strength meter và no-reset warning.
- [x] Unlock bằng derive key + AES-GCM decrypt; không hard-code password.
- [x] Auto-lock mặc định 10 phút; tùy chọn 1/5/10/15/30 phút.
- [x] Manual lock bằng header và `Ctrl/Cmd + Shift + L`.
- [x] Clear vault, key references, search và temporary sensitive state khi lock.
- [x] Cảnh báo trước auto-lock và best-effort clipboard clear sau 30 giây.

### Phase 6 — Main UI — COMPLETE

- [x] Lock screen và setup wizard responsive.
- [x] Dashboard, stats, sync status và recent entries.
- [x] Entry list/detail, search, favorites, add/edit/delete, reveal/copy.
- [x] Categories, password generator và password health.
- [x] Settings: General, Security, Google Drive, Sharing, Backup, Appearance, About.
- [x] Light/Dark/System theme.
- [x] Không analytics, tracking pixel, remote favicon hoặc third-party vault telemetry.

### Phase 7 — Backup và sharing — COMPLETE

- [x] Export encrypted backup.
- [x] Import encrypted backup với envelope validation.
- [x] Connect existing shared vault bằng file ID hoặc Google Drive URL.
- [x] Owner/Editor/Viewer capability từ Drive.
- [x] Share/revoke permission khi provider có quyền tương ứng.

### Phase 8 — Security review — COMPLETE

- [x] Sweep plaintext persistence, token leak, `console.log`, hard-coded secret, unsafe HTML và `Math.random`.
- [x] Không gửi URL, username, password, notes, search hoặc analytics tới third party.
- [x] `npm audit --audit-level=moderate` không phát hiện vulnerability.
- [x] Threat model trong README cho source exposure, Drive download, mất laptop, XSS, password yếu, revoke permission, concurrent edit, corrupt vault và supply chain.

### Phase 9 — Tests — COMPLETE

- [x] Crypto: round trip, wrong password, ciphertext/AAD tamper, unique IV, Unicode và large vault.
- [x] Vault: CRUD, favorites, categories, search, duplicate detection và health.
- [x] Session lock behavior và hook runtime coverage.
- [x] Storage: create/download/update, read-only và error boundaries.
- [x] React Testing Library setup smoke test.
- [x] Playwright Mock Drive E2E: setup → add → lock → wrong unlock → correct unlock → edit → reload → unlock.

### Phase 10 — CI và release — LOCAL COMPLETE / EXTERNAL PENDING

- [x] `npm run lint` pass.
- [x] `npm run typecheck` pass.
- [x] `npm run test` pass: 5 files, 14 tests.
- [x] `npm run build` pass.
- [x] `.github/workflows/ci.yml` chạy lint, typecheck, test và build.
- [x] `.github/workflows/deploy-pages.yml` deploy sau CI thành công trên `main`.
- [x] Vite relative base và app-shell navigation phù hợp GitHub Pages.
- [x] README tiếng Việt, security model, threat model, setup, testing và limitations.
- [x] Local production-like smoke test bằng Playwright pass.
- [x] GitHub repository creation và push — repository `danghvtb/secure-password-vault` đã tạo private và push lên `main`.
- [ ] GitHub Pages URL — cần bật Pages và chờ workflow deploy trên GitHub.
- [ ] Google Cloud OAuth client, OAuth consent và production Drive smoke test — cần user account interaction.

## Public interfaces chính

```ts
interface VaultStorageProvider {
  connect(): Promise<void>
  create(envelope: EncryptedVaultEnvelope): Promise<DriveMetadata>
  download(metadata: DriveMetadata): Promise<EncryptedVaultEnvelope>
  update(metadata: DriveMetadata, envelope: EncryptedVaultEnvelope): Promise<DriveMetadata>
  getMetadata(metadata: DriveMetadata): Promise<DriveMetadata>
}
```

Envelope production format:

```json
{
  "format": "secure-password-vault",
  "schemaVersion": 1,
  "crypto": {
    "cipher": "AES-256-GCM",
    "kdf": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt": "base64",
    "iv": "base64"
  },
  "ciphertext": "base64"
}
```

## Security invariants

- Master Password, AES key, decrypted vault và access token dài hạn không được lưu persistent.
- Drive metadata không chứa website, username, password, category hoặc notes.
- Password generation dùng Web Crypto API, không dùng `Math.random()`.
- Mỗi encryption dùng salt/IV phù hợp; AES-GCM xác thực ciphertext và associated metadata.
- Không commit `PasswordVault.vault`, encrypted backup, credentials hoặc `.env`.
- Mất Master Password đồng nghĩa dữ liệu không thể khôi phục.

## External authentication boundaries

Tự động thực hiện mọi phần có thể kiểm chứng local. Chỉ cần user thao tác khi bắt buộc:

1. Google OAuth sign-in/consent và Drive permission.
2. GitHub CLI authentication nếu cần tạo/push repository.
3. Google Cloud OAuth client configuration nếu chưa có client ID.

Không yêu cầu user gửi password, PAT, access token, refresh token hoặc secret qua chat.

## Known environment constraints

- Git 2.55.0 và GitHub CLI 2.97.0 đã cài; GitHub API xác thực được trong CMD người dùng, nhưng tiến trình Codex không đọc được keyring đó.

- Node và npm đã có sẵn.
- PowerShell chặn `npm.ps1`, dùng `npm.cmd` khi chạy command.
- Git và GitHub CLI chưa có trong PATH.
- Local Mock Drive và Playwright E2E đã được xác minh; Google Drive/GitHub production cần external authentication.
