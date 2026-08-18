# Technical decisions

## Frontend-only storage

Google Drive is the production storage layer. A backend database is intentionally not introduced. `MockDriveProvider` stores only the encrypted envelope in browser storage and exists for local development and CI/E2E.

## Key handling

The app derives a non-extractable AES-GCM CryptoKey from the Master Password. The key and decrypted vault exist only in memory for the unlocked session. The Master Password is never persisted.

## GitHub Pages routing

The first release keeps navigation in the app shell instead of depending on server-side SPA rewrites. Vite uses a relative base so a project page can load assets from a repository subpath.

## Google authorization

Google Identity Services is loaded only when the user selects Google Drive and a client ID is configured. The app requests the narrow `drive.file` scope and does not implement a frontend refresh-token store.
