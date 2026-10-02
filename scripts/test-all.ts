import "dotenv/config";
import { validateEnv, getEnv } from "../api/_utils/env";
import { createSessionToken, verifySessionToken } from "../api/_utils/auth";
import { db } from "../src/db";
import { users, activity, stars, settings } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";

async function runTests() {
  console.log("=================================================");
  console.log("    AAVORA PHASE 1 & 2 AUTOMATED TEST SUITE      ");
  console.log("=================================================\n");

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

  // TEST 1: Env validation fails when variables are missing
  console.log("1. Testing Environment Validation & Error Handling...");
  try {
    validateEnv({});
    assert(false, "Env validation should fail on empty env");
  } catch (err: any) {
    const isDescriptive =
      err.message.includes("Missing required environment variables") &&
      err.message.includes("DATABASE_URL") &&
      err.message.includes("GOOGLE_CLIENT_ID");
    assert(isDescriptive, "Env validation throws clear, safe error on missing vars");
  }

  // TEST 2: Session secret length check
  try {
    validateEnv({
      DATABASE_URL: "postgres://fake",
      GOOGLE_CLIENT_ID: "client_id",
      GOOGLE_CLIENT_SECRET: "client_secret",
      GOOGLE_REDIRECT_URI: "http://localhost:5173/api/auth/callback",
      GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder_id",
      ADMIN_EMAIL: "admin@example.com",
      SESSION_SECRET: "too_short_secret",
      APP_URL: "http://localhost:5173",
    });
    assert(false, "Env validation should fail on short SESSION_SECRET");
  } catch (err: any) {
    const isSecretError = err.message.includes("SESSION_SECRET must be at least 32 characters");
    assert(isSecretError, "Env validation enforces 32+ character SESSION_SECRET");
  }

  // TEST 3: Active .env validation succeeds
  try {
    const config = getEnv();
    assert(
      !!config.DATABASE_URL &&
      !!config.GOOGLE_CLIENT_ID &&
      !!config.ADMIN_EMAIL &&
      config.SESSION_SECRET.length >= 32,
      "Active .env config loaded and validated successfully"
    );
  } catch (err: any) {
    assert(false, "Active .env failed validation", err.message);
  }

  // TEST 4: Cookie Encrypt and Decrypt (jose AES-256-GCM)
  console.log("\n2. Testing Cookie Encryption & Decryption (jose)...");
  try {
    const samplePayload = {
      id: 999,
      email: "family.member@example.com",
      name: "Family Member",
      role: "member" as const,
    };

    const token = await createSessionToken(samplePayload);
    assert(typeof token === "string" && token.split(".").length === 5, "createSessionToken generates valid JWE token (5 compact parts)");

    const decrypted = await verifySessionToken(token);
    assert(
      decrypted?.email === samplePayload.email &&
      decrypted?.role === samplePayload.role &&
      decrypted?.name === samplePayload.name,
      "verifySessionToken decrypts exact payload successfully"
    );

    // Tampered token test
    const tampered = token.slice(0, -6) + "xxxxxx";
    const failedDecrypt = await verifySessionToken(tampered);
    assert(failedDecrypt === null, "Tampered ciphertext safely fails decryption");
  } catch (err: any) {
    assert(false, "Cookie encrypt/decrypt test threw error", err.message);
  }

  // TEST 5: Neon Database Tables & Seed Verification
  console.log("\n3. Testing Neon Postgres Database & Allowed Users...");
  try {
    // Check tables exist by executing count queries
    const [{ userCount }] = await db.select({ userCount: sql<number>`count(*)::int` }).from(users);
    const [{ activityCount }] = await db.select({ activityCount: sql<number>`count(*)::int` }).from(activity);
    const [{ starsCount }] = await db.select({ starsCount: sql<number>`count(*)::int` }).from(stars);
    const [{ settingsCount }] = await db.select({ settingsCount: sql<number>`count(*)::int` }).from(settings);

    assert(typeof userCount === "number", "users table exists and responds in Neon");
    assert(typeof activityCount === "number", "activity table exists and responds in Neon");
    assert(typeof starsCount === "number", "stars table exists and responds in Neon");
    assert(typeof settingsCount === "number", "settings table exists and responds in Neon");

    // Check admin email is seeded
    const env = getEnv();
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, env.ADMIN_EMAIL.toLowerCase()))
      .limit(1);

    assert(
      !!adminUser && adminUser.role === "admin" && adminUser.active === true,
      "ADMIN_EMAIL is seeded, active, and has role: 'admin'"
    );

    // TEST 6: Allowed-user check logic
    const [unallowedUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, "stranger.unauthorized@gmail.com"))
      .limit(1);

    assert(!unallowedUser, "Unallowed email is not in users table and will be rejected");
  } catch (err: any) {
    assert(false, "Database query threw error", err.message);
  }

  console.log("\n=================================================");
  console.log(`SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log("=================================================");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
