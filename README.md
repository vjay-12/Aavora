# Aavora — Private Family Document Vault (PWA)

Aavora is a high-speed, secure, private cloud document vault for personal and family use.

## Stack
- **Frontend:** React + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query
- **Backend:** Vercel Serverless Functions in `/api` (Node + TypeScript, co-located in region `sin1`)
- **Database:** Neon Postgres (Singapore `aws-ap-southeast-1`) via `@neondatabase/serverless` (HTTP driver) + Drizzle ORM
- **Auth:** Google OAuth 2.0 authorization code flow, 30-day encrypted HttpOnly session cookie via `jose` (AES-256-GCM) with silent access token refresh
- **Storage:** Google Drive API v3 (full `drive` scope, scoped to restricted family folder `GOOGLE_DRIVE_ROOT_FOLDER_ID`)
- **PWA:** `vite-plugin-pwa` with Workbox offline precaching, installability, and responsive mobile/laptop layouts
- **Testing:** Playwright (Chromium Desktop 1440x900 & Mobile Pixel 7), Vitest, TypeScript compiler (`tsc -b`), Oxlint

---

## 1. Prerequisites
- **Node.js** v20+ (Node v24 tested & supported)
- **Google Cloud Console** project with:
  - Google Drive API v3 enabled
  - OAuth 2.0 Web Client ID with redirect URI: `http://localhost:5173/api/auth/callback`
  - OAuth Consent Screen configured with test users
- **Neon Postgres** serverless database instance in Singapore (`aws-ap-southeast-1`)

---

## 2. Setup Instructions

### Step 1: Clone and Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` (guaranteed in `.gitignore`):
```bash
cp .env.example .env
```
Populate the keys in `.env` (never commit or share these values):
- `DATABASE_URL`: Neon pooled Postgres connection string (`postgres://...`)
- `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret
- `GOOGLE_REDIRECT_URI`: `http://localhost:5173/api/auth/callback`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`: The folder ID of your shared family root folder on Google Drive
- `ADMIN_EMAIL`: Your primary admin Google account email
- `ALLOWED_EMAILS`: Optional comma-separated list of allowed family member Google accounts
- `SESSION_SECRET`: Random 32+ character string for AES-256-GCM cookie encryption
- `APP_URL`: `http://localhost:5173`

### Step 3: Push Database Schema & Seed Users
```bash
# Push Drizzle schema to Neon Postgres
npm run db:push

# Seed ADMIN_EMAIL and ALLOWED_EMAILS into users table
npm run db:seed
```

### Step 4: Start Local Development Server
Run with Vercel CLI on port 5173 so the OAuth redirect URI matches:
```bash
npm run vercel:dev
# Or directly:
# npx vercel dev --listen 5173 --yes --local
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 3. Automated Test Suites

Aavora includes comprehensive unit, integration, security, and End-to-End browser test suites:

### Run All Tests
```bash
# Runs Vitest unit tests followed by integration tests
npm test
```

### Run Unit Tests (Vitest)
```bash
npm run test:unit
```
Covers:
- Byte formatting utilities (`formatBytes`)
- Relative date formatting (`formatDate`)
- Class merging (`cn`)
- Environment variable validation & secret leak prevention
- `jose` AES-256-GCM cookie encryption, decryption, tamper detection, and expiration

### Run Integration & API Diagnostics
```bash
# Test env variable validation:
npm run test:env

# Test Neon DB connectivity, pooled latencies, indexes, seed, and CRUD:
npm run test:db

# Test Google Drive connection, folder hierarchies, token refresh, and permissions:
npm run test:drive

# Test Auth, session cookies, rate limiting, and security headers:
npm run test:auth
```

### Run End-to-End Tests (Playwright)
```bash
npm run e2e
```
Executes 38 automated browser tests across both **Desktop (1440x900)** and **Mobile (Pixel 7)**:
- `tests/e2e/auth-and-access.spec.ts`: Login page redirect, Access Denied screen, and protected route guards.
- `tests/e2e/ui-walkthrough.spec.ts`: Full navigation (Home, Docs, Saved, Activity, More), category cards, subfolder deep-dive, breadcrumbs, back button, empty states, pulse skeletons, mobile 5-tab bar (tap targets >= 44px, no 360px overflow), desktop 240px sidebar, and keyboard tab focus rings.
- `tests/e2e/cache-and-performance.spec.ts`: Stale-While-Revalidate verification via IndexedDB cache persistence, cold & warm API response timing.
- `tests/e2e/pwa-and-offline.spec.ts`: Web app manifest, theme colors, icons, offline banner display when network drops, and logout cache purge.
- `tests/e2e/edge-cases.spec.ts`: Tamil / Unicode file names (`குடும்ப_சொத்து_பத்திரம்_மற்றும்_பதிவு_2026.pdf`), long filename truncation, Drive 429/500 resilience, 250+ item rendering without freeze, and double-click debouncing.

---

## 4. Admin-Owned Drive Architecture

Aavora uses an **Admin-Owned Google Drive Architecture** to safeguard family documents and ensure members' personal Google Drives are never accessed:

1. **User Login (`openid email profile` only):**
   - Members and admins log in using standard Google identity scopes (`openid email profile`).
   - No Google Drive scope is ever requested during member sign-in.
   - The user's email is verified against the `users` table in Neon Postgres.
   - The session cookie (`aavora_session`) contains strictly identity attributes (`id`, `email`, `name`, `role`), never any Google Drive tokens.

2. **Admin Drive Connection (One-Time Setup):**
   - An admin signs in and navigates to **More** -> **Connect Drive**.
   - The server initiates an offline Google OAuth flow with the `https://www.googleapis.com/auth/drive` scope (`access_type=offline`, `prompt=consent`).
   - The callback confirms the authenticating account matches `ADMIN_EMAIL`.
   - The refresh token is encrypted using AES-256-GCM (with a key derived from `SESSION_SECRET`) and saved securely into the Neon Postgres `settings` table (`key`, `value_encrypted`, `updated_at`).
   - Optional fallback: `GOOGLE_ADMIN_REFRESH_TOKEN` environment variable.

3. **Server-Side Helper `getAdminDrive()`:**
   - All serverless endpoints in `/api/drive/*` and `/api/upload/*` interact with Google Drive via `getAdminDrive()`.
   - Access tokens are refreshed silently and cached in server memory.
   - If the token is missing or revoked, endpoints return HTTP 503 `ADMIN_DRIVE_NOT_CONNECTED`.
   - The frontend responds with an admin banner ("Reconnect Drive") or member message ("Vault is temporarily unavailable, contact the admin").

4. **Strict Vault Boundary Security:**
   - Directory listings default strictly to `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Requests to `"root"`, `"me"`, or My Drive are blocked.
   - Every file/folder access (list, download, create, rename, move, trash) walks the `parents` chain to verify it descends from `GOOGLE_DRIVE_ROOT_FOLDER_ID` (with a 5-minute memory cache) and rejects outside items with HTTP 403 Forbidden.

5. **Quota & Dashboard:**
   - The Home storage meter displays the admin vault's actual Google Drive quota (`about.get storageQuota`), labeled "Vault storage (admin Drive)" with support for unlimited Google Workspace plans.
   - Category cards display folders directly under `GOOGLE_DRIVE_ROOT_FOLDER_ID` only.

---

## 5. Google Cloud Console Redirect URI Setup

Ensure both redirect URIs are added to your **Authorized redirect URIs** in Google Cloud Console:
- `http://localhost:5173/api/auth/callback` (User identity sign-in)
- `http://localhost:5173/api/admin/drive/callback` (Admin Drive connection callback)

For production on Vercel:
- `https://<your-vercel-domain>/api/auth/callback`
- `https://<your-vercel-domain>/api/admin/drive/callback`

---

## 6. First-Time Admin Connection Steps

1. Start the app: `npm run vercel:dev` (or open your production Vercel URL).
2. Sign in with the designated `ADMIN_EMAIL` via Google.
3. Open the **More** tab in the navigation bar and select **Connect Drive**.
4. Click **Connect Google Drive** and grant Drive permissions on the Google consent screen.
5. You will be redirected back to the Home dashboard with `admin_drive_connected=true`.
6. Confirm the Home page displays **"Vault storage (admin Drive)"** with live quota and your vault root folders.

---

## 7. Architecture & Security Highlights

- **Zero-Knowledge Bundle:** Build output (`dist/`) is strictly audited against secret leaks. No environment variables or credentials appear in client assets.
- **Serverless Session Security:** Session tokens are encrypted JWEs (`A256GCM`) signed and decrypted exclusively server-side using `jose`.
- **Silent Refresh:** When an access token expires (1 hour), `getAdminAccessToken()` automatically uses the stored admin refresh token to fetch a new token and cache it in memory.
- **Hierarchical Drive Isolation:** Every request to `/api/drive/*` traverses the folder tree up to `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Any attempt to access a folder outside the designated family vault is rejected with HTTP 403.
- **Device Security:** Per-device PIN (PBKDF2) and WebAuthn biometric unlock (fingerprint, Face ID, Windows Hello) with auto-lock timer stored only in browser IndexedDB.
- **Offline Document Encryption:** Local documents encrypted with AES-256-GCM via Web Crypto API.
