# SecureVault

SecureVault là password manager cá nhân chạy chủ yếu trên trình duyệt. Dữ liệu vault được mã hóa trước khi upload lên Google Drive bằng Web Crypto API.

## Security model

- AES-256-GCM cho mã hóa dữ liệu.
- PBKDF2-SHA256 với 600.000 iterations để derive key.
- Salt và IV ngẫu nhiên; IV mới ở mỗi lần mã hóa.
- Master Password không được lưu trong localStorage, IndexedDB, cookie, source code hoặc server.
- Google Drive chỉ nhận encrypted envelope; Drive metadata không chứa username, URL, password, category hoặc notes.
- Auto-lock mặc định sau 10 phút và có manual lock.
- Không có analytics, tracking pixel, backend database hoặc plaintext offline queue.

Nếu mất Master Password, dữ liệu không thể khôi phục. Đây là thiết kế bảo mật, không phải lỗi hỗ trợ.

## Kiến trúc

```text
React + TypeScript + Vite
       │
       ├── Web Crypto: PBKDF2 → AES-256-GCM
       ├── Vault domain: entries, categories, health, migration
       ├── App lock: in-memory session + auto-lock
       └── VaultStorageProvider
             ├── MockDriveProvider (development / CI)
             └── GoogleDriveProvider (production)
```

## Cài đặt và development

```bash
npm install
copy .env.example .env
npm run dev
```

Không cần credential để chạy local demo. Chọn **Local demo** trong Setup Wizard; envelope vẫn được mã hóa trước khi lưu.

## Google Drive setup

1. Tạo Google Cloud project.
2. Enable Google Drive API.
3. Tạo OAuth Client ID loại Web application.
4. Thêm `http://localhost:5173` vào Authorized JavaScript origins.
5. Thêm GitHub Pages origin sau khi biết URL production.
6. Điền `VITE_GOOGLE_CLIENT_ID` trong `.env`.
7. Chạy app, chọn Google Drive và hoàn thành Google sign-in/consent trong browser.

App dùng scope `https://www.googleapis.com/auth/drive.file`. Không đưa client secret vào frontend và không gửi token/password qua chat.

## Google Drive vault

Khi kết nối lần đầu app tạo `PasswordVault.vault` với MIME type `application/octet-stream`. File chỉ chứa encrypted envelope. Google Drive permission là source of truth cho Owner, Editor và Viewer.

## Backup, restore và sharing

Backup phải là encrypted vault envelope, không phải plaintext export. Khi chia sẻ, chỉ dùng Google Drive permission; không có user database riêng. Người Viewer được đọc sau khi có Master Password nhưng không được cập nhật file.

## Threat model

Được bảo vệ ở mức ứng dụng:

- Người xem GitHub source không có vault hoặc Master Password.
- Người tải file Drive vẫn cần Master Password.
- Mất laptop/browser profile không tự làm lộ plaintext nếu app đã khóa.
- AES-GCM phát hiện ciphertext hoặc metadata bị sửa.
- Password không bị gửi tới analytics/third-party service.

Không thể bảo vệ hoàn toàn nếu:

- Master Password yếu hoặc đã bị lộ.
- Browser đang bị XSS/malware kiểm soát khi vault mở.
- Google permission bị cấp sai.
- Hai người cùng sửa vault; bản v1 chỉ phát hiện conflict ở provider boundary.
- Dependency hoặc trình duyệt bị compromise.

## Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run e2e
npm audit
```

## GitHub Pages

CI chạy lint, typecheck, test và build. Workflow Pages chỉ deploy sau khi CI trên `main` thành công. GitHub/GitHub CLI cần được cài và user cần hoàn tất `gh auth login` bằng flow chính thức.

GitHub không được chứa:

- `PasswordVault.vault`.
- encrypted backup.
- Master Password.
- OAuth token, refresh token hoặc credentials.

## Project structure

```text
src/
├── app/          app shell, lock/setup screens, views
├── auth/         auto-lock session behavior
├── crypto/       Web Crypto envelope implementation
├── storage/      device preferences and storage providers
├── types/        public vault/provider types
└── vault/        domain operations, generator and health
```

## Known limitations

- Google OAuth cần cấu hình client ID và user consent thật.
- Offline changes không được persist dưới dạng plaintext.
- Mất Master Password không có reset/recovery.
- GitHub deployment cần Git/GitHub CLI và authentication ngoài codebase.
