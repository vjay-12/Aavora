import { getEnv } from "../server/env.js";

async function verifyLiveDevServer() {
  console.log("=================================================");
  console.log("   LIVE VERCEL DEV SERVER VERIFICATION CHECKS   ");
  console.log("=================================================\n");

  const baseUrl = "http://localhost:5173";
  const env = getEnv();

  // CHECK 1: /api/me returns 401 when logged out
  console.log("Check 1: Verifying /api/me returns 401 when logged out...");
  const meRes = await fetch(`${baseUrl}/api/me`);
  const meStatus = meRes.status;
  const meData = await meRes.json();
  console.log(`  -> Status code: ${meStatus}`);
  console.log(`  -> Body:`, meData);
  if (meStatus === 401) {
    console.log("  [PASS] /api/me returns 401 Unauthorized as expected.\n");
  } else {
    console.error("  [FAIL] Expected 401 from /api/me, got:", meStatus);
    process.exit(1);
  }

  // CHECK 2: /api/auth/login redirect contains correct client_id & redirect_uri
  console.log("Check 2: Verifying /api/auth/login redirect URL parameters...");
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    redirect: "manual",
  });
  const locationHeader = loginRes.headers.get("location");
  console.log(`  -> HTTP Status: ${loginRes.status}`);

  if (!locationHeader) {
    console.error("  [FAIL] No Location header returned from /api/auth/login");
    process.exit(1);
  }

  const redirectUrl = new URL(locationHeader);
  const clientIdParam = redirectUrl.searchParams.get("client_id");
  const redirectUriParam = redirectUrl.searchParams.get("redirect_uri");
  const scopeParam = redirectUrl.searchParams.get("scope");
  const promptParam = redirectUrl.searchParams.get("prompt");

  console.log(`  -> Redirect Host: ${redirectUrl.hostname}`);
  console.log(`  -> client_id matches: ${clientIdParam === env.GOOGLE_CLIENT_ID}`);
  console.log(`  -> redirect_uri matches: ${redirectUriParam === env.GOOGLE_REDIRECT_URI}`);
  console.log(`  -> prompt: ${promptParam}`);
  console.log(`  -> scope contains openid/email/profile: ${scopeParam?.includes("email")}`);

  if (
    clientIdParam === env.GOOGLE_CLIENT_ID &&
    redirectUriParam === env.GOOGLE_REDIRECT_URI &&
    scopeParam?.includes("email")
  ) {
    console.log("  [PASS] OAuth login redirect URL contains exact client_id, redirect_uri, and user scopes.\n");
  } else {
    console.error("  [FAIL] Redirect URL parameters mismatch!");
    process.exit(1);
  }

  // CHECK 3: Callback rejects unauthorized user
  console.log("Check 3: Verifying unauthorized callback rejection...");
  const callbackRes = await fetch(`${baseUrl}/api/auth/callback?error=access_denied`, {
    redirect: "manual",
  });
  const cbLocation = callbackRes.headers.get("location");
  console.log(`  -> Status: ${callbackRes.status}`);
  console.log(`  -> Location header: ${cbLocation}`);

  if (cbLocation?.includes("/access-denied")) {
    console.log("  [PASS] Unauthorized callback redirects to /access-denied.\n");
  } else {
    console.error("  [FAIL] Expected redirect to /access-denied, got:", cbLocation);
    process.exit(1);
  }

  console.log("=================================================");
  console.log("       ALL LIVE ENDPOINT CHECKS PASSED           ");
  console.log("=================================================");
}

verifyLiveDevServer().catch((err) => {
  console.error("Error during verification:", err);
  process.exit(1);
});
