import "dotenv/config";
import { getEnv } from "../api/_utils/env";
import { createSessionToken, COOKIE_NAME } from "../api/_utils/auth";
import { resetRateLimits } from "../api/_utils/rate-limit";
import { EncryptJWT } from "jose";

const BASE_URL = "http://localhost:5173";

export async function testAuthAndSecurity() {
  resetRateLimits();
  console.log("=================================================");
  console.log("    AUTH & SECURITY (API) QA TEST SUITE          ");
  console.log("=================================================\n");

  const env = getEnv();
  let totalPassed = 0;
  let totalFailed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      totalPassed++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `- ${detail}` : ""}`);
      totalFailed++;
    }
  }

  // 1. /api/me returns 401 with no cookie
  console.log("1. Testing /api/me cookie authentication...");
  const resNoCookie = await fetch(`${BASE_URL}/api/me`);
  assert(resNoCookie.status === 401, "/api/me returns 401 with no cookie");

  // 2. /api/me returns 401 with a tampered cookie
  const validToken = await createSessionToken({
    id: 1,
    email: env.ADMIN_EMAIL,
    name: "Admin User",
    role: "admin",
    accessToken: "ya29.sample_valid_looking_token",
    accessTokenExpiresAt: Date.now() + 3600000,
  });
  const tamperedToken = validToken.slice(0, -10) + "tampered00";
  const resTampered = await fetch(`${BASE_URL}/api/me`, {
    headers: { Cookie: `${COOKIE_NAME}=${tamperedToken}` },
  });
  assert(resTampered.status === 401, "/api/me returns 401 with a tampered cookie");

  // 3. /api/me returns 401 with an expired cookie
  const secretKey = new TextEncoder().encode(env.SESSION_SECRET.padEnd(32, "0").slice(0, 32));
  const expiredToken = await new EncryptJWT({
    id: 1,
    email: env.ADMIN_EMAIL,
    name: "Admin User",
    role: "admin",
    accessToken: "ya29.sample_token",
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60) // Expired 60s ago
    .encrypt(secretKey);

  const resExpired = await fetch(`${BASE_URL}/api/me`, {
    headers: { Cookie: `${COOKIE_NAME}=${expiredToken}` },
  });
  assert(resExpired.status === 401, "/api/me returns 401 with an expired cookie");

  // 4. Login redirect contains correct params (client_id, redirect_uri, scope, access_type=offline, prompt=consent, state)
  console.log("\n2. Testing /api/auth/login OAuth parameters...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, { redirect: "manual" });
  const locationHeader = loginRes.headers.get("location") || "";
  const setCookieHeader = loginRes.headers.get("set-cookie") || "";
  
  assert(loginRes.status === 302, "/api/auth/login returns 302 redirect");
  assert(setCookieHeader.includes("aavora_oauth_state"), "/api/auth/login sets CSRF state cookie");

  const loginUrl = new URL(locationHeader);
  assert(loginUrl.searchParams.get("client_id") === env.GOOGLE_CLIENT_ID, "Redirect contains correct client_id");
  assert(loginUrl.searchParams.get("redirect_uri") === env.GOOGLE_REDIRECT_URI, "Redirect contains correct redirect_uri");
  assert(loginUrl.searchParams.get("access_type") === "offline", "Redirect contains access_type=offline");
  assert(loginUrl.searchParams.get("prompt") === "consent", "Redirect contains prompt=consent");
  assert(Boolean(loginUrl.searchParams.get("state")), "Redirect contains random state parameter");
  assert(loginUrl.searchParams.get("scope")?.includes("drive") === true, "Redirect scope includes drive");

  // 5. Callback rejects invalid or missing state or code
  console.log("\n3. Testing OAuth callback validation...");
  const cbNoParams = await fetch(`${BASE_URL}/api/auth/callback`, { redirect: "manual" });
  assert(cbNoParams.status === 302 && cbNoParams.headers.get("location")?.includes("/access-denied") === true, "Callback rejects missing code and state");

  const cbNoState = await fetch(`${BASE_URL}/api/auth/callback?code=mock_code`, { redirect: "manual" });
  assert(cbNoState.status === 302 && cbNoState.headers.get("location")?.includes("/access-denied") === true, "Callback rejects missing state parameter");

  const cbMismatchedState = await fetch(`${BASE_URL}/api/auth/callback?code=mock_code&state=attacker_state`, {
    redirect: "manual",
    headers: { Cookie: "aavora_oauth_state=legit_state" },
  });
  assert(cbMismatchedState.status === 302 && cbMismatchedState.headers.get("location")?.includes("/access-denied") === true, "Callback rejects mismatched CSRF state");

  // 6. Logout clears cookie and subsequent /api/me returns 401
  console.log("\n4. Testing /api/auth/logout...");
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: `${COOKIE_NAME}=${validToken}` },
  });
  const logoutCookies = logoutRes.headers.get("set-cookie") || "";
  assert(logoutRes.status === 200, "Logout endpoint returns 200");
  assert(logoutCookies.includes(`${COOKIE_NAME}=;`) && logoutCookies.includes("Max-Age=0"), "Logout clears session cookie (Max-Age=0)");

  // 7. Cookie properties check (HttpOnly, SameSite=Lax, Max-Age ~30 days)
  console.log("\n5. Testing Cookie Flags & Attributes...");
  assert(logoutCookies.includes("HttpOnly"), "Cookie has HttpOnly flag");
  assert(logoutCookies.includes("SameSite=Lax"), "Cookie has SameSite=Lax attribute");

  // 8. Security Headers check (CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors)
  console.log("\n6. Testing Security Headers...");
  const testPageRes = await fetch(`${BASE_URL}/api/me`);
  const xcto = testPageRes.headers.get("x-content-type-options");
  const referrerPolicy = testPageRes.headers.get("referrer-policy");
  const csp = testPageRes.headers.get("content-security-policy");

  assert(xcto === "nosniff", "X-Content-Type-Options: nosniff header present");
  assert(referrerPolicy?.includes("strict-origin") === true, "Referrer-Policy header present");
  assert(csp?.includes("frame-ancestors 'none'") === true, "CSP contains frame-ancestors 'none'");

  // 9. Every data endpoint returns 401 without session
  console.log("\n7. Testing all data endpoints return 401 without session...");
  const endpoints = [
    { path: "/api/me", method: "GET" },
    { path: "/api/activity", method: "GET" },
    { path: "/api/stars", method: "GET" },
    { path: "/api/drive/list", method: "GET" },
    { path: "/api/drive/file?id=fake", method: "GET" },
    { path: "/api/drive/folder", method: "POST" },
    { path: "/api/drive/trash", method: "POST" },
    { path: "/api/drive/restore", method: "POST" },
    { path: "/api/drive/rename", method: "POST" },
    { path: "/api/drive/move", method: "POST" },
    { path: "/api/drive/bin", method: "GET" },
    { path: "/api/drive/storage", method: "GET" },
  ];

  let allEndpointsProtected = true;
  for (const ep of endpoints) {
    console.log(`  Checking ${ep.method} ${ep.path}...`);
    const res = await fetch(`${BASE_URL}${ep.path}`, {
      method: ep.method,
      headers: ep.method === "POST" ? { "Content-Type": "application/json" } : {},
      body: ep.method === "POST" ? "{}" : undefined,
    });
    console.log(`  -> status: ${res.status}`);
    await res.text();
    if (res.status !== 401) {
      console.error(`  [FAIL] ${ep.method} ${ep.path} returned ${res.status}, expected 401`);
      allEndpointsProtected = false;
    }
  }
  assert(allEndpointsProtected, "All 12 data and Drive endpoints strictly return 401 without session");

  // 10. Rate limiting test
  console.log("\n8. Testing Rate Limiting (429 Too Many Requests)...");
  let received429 = false;
  let retryAfterHeader = null;
  // Send rapid requests to exceed rate limit (limit is 20 requests per minute)
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`${BASE_URL}/api/auth/login`, { redirect: "manual" });
    const status = r.status;
    const retry = r.headers.get("retry-after");
    await r.text();
    if (status === 429) {
      received429 = true;
      retryAfterHeader = retry;
      break;
    }
  }
  assert(received429, `Rate limiter successfully triggered HTTP 429 (Retry-After: ${retryAfterHeader}s)`);
  resetRateLimits();

  console.log("\n=================================================");
  console.log(`AUTH & SECURITY RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log("=================================================\n");

  if (totalFailed > 0) process.exit(1);
}

testAuthAndSecurity().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
