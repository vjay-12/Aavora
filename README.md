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

## 4. Manual Verification Steps for Google Sign-in

1. Open `http://localhost:5173` in your browser.
2. If not logged in, you will see the **Aavora Login Screen** with the "Continue with Google" button.
3. Click **"Continue with Google"**. You will be redirected to Google's OAuth consent screen:
   - Requesting permissions to manage Google Drive files and view your email/profile.
4. **Authorized Account Sign-in (`ADMIN_EMAIL` or `ALLOWED_EMAILS`):**
   - Google redirects back to `http://localhost:5173/api/auth/callback`.
   - The server validates your email against the Neon `users` table.
   - A 30-day encrypted HttpOnly cookie is set.
   - You are redirected to `/docs`, where you will see your Google Drive root folder cards and files with live breadcrumb navigation!
5. **Unauthorized Account Sign-in:**
   - The server rejects the login and redirects to `/access-denied`.
   - The **Access Denied** screen displays your rejected email and a button to switch accounts.

---

## 5. Deployment Guide (Vercel & Neon)

### Neon Postgres
- Ensure your Neon project is hosted in the **Singapore (`aws-ap-southeast-1`)** region.
- Use the **pooled connection string** (`-pooler`) for serverless connection reuse.

### Vercel Deployment
1. Set the function region in `vercel.json` to `sin1` (Singapore) for sub-50ms DB co-location:
   ```json
   {
     "regions": ["sin1"]
   }
   ```
2. Configure all environment variables from `.env` in the Vercel Project Settings:
   - `DATABASE_URL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (update to `https://<your-vercel-domain>/api/auth/callback`)
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID`
   - `ADMIN_EMAIL`
   - `ALLOWED_EMAILS`
   - `SESSION_SECRET`
   - `APP_URL` (update to `https://<your-vercel-domain>`)
3. In Google Cloud Console, add `https://<your-vercel-domain>/api/auth/callback` to Authorized Redirect URIs.

---

## 6. Architecture & Security Highlights

- **Zero-Knowledge Bundle:** Build output (`dist/`) is strictly audited against secret leaks. No environment variables or credentials appear in client assets.
- **Serverless Session Security:** Session tokens are encrypted JWEs (`A256GCM`) signed and decrypted exclusively server-side using `jose`.
- **Silent Refresh:** When an access token expires (1 hour), `/api` functions automatically use the stored Google refresh token to fetch a new access token and seamlessly update the encrypted cookie.
- **Hierarchical Drive Isolation:** Every request to `/api/drive/list` traverses the folder tree up to `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Any attempt to access a folder outside the designated family vault is rejected with HTTP 403.
- **Stale-While-Revalidate PWA:** Directory listings are instantly hydrated from IndexedDB cache on boot/reload and revalidated in the background.

---

## 7. Next Phases Roadmap (Phases 3+)

- **File Uploads:** Resumable multipart upload directly to Google Drive via Admin token with progress tracking.
- **Trash & Restore:** Soft-delete move to Drive Bin with undo toast notification and admin-only permanent purge.
- **Activity Audit Trail:** Real-time logging of document views, downloads, stars, and deletions with cursor-based pagination.
- **Starred Documents:** Fast bookmarking synced to Neon Postgres `stars` table.
- **App Lock Screen:** Local PIN protection (PBKDF2) and WebAuthn biometric unlock (fingerprint, Face ID, Windows Hello).
- **Offline Document Encryption:** Web Crypto AES-GCM encrypted local storage for offline document viewing.
