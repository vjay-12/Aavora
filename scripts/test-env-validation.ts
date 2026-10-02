import "dotenv/config";
import { validateEnv } from "../api/_utils/env";

const REQUIRED_VARS = [
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
  "ADMIN_EMAIL",
  "SESSION_SECRET",
  "APP_URL",
] as const;

export async function testEnvValidation() {
  console.log("=================================================");
  console.log("      ENV VALIDATION: PER-VARIABLE TEST SUITE    ");
  console.log("=================================================\n");

  const originalEnv = { ...process.env };
  let allPassed = true;

  for (const varName of REQUIRED_VARS) {
    // Clone env and delete one variable
    const testEnv = { ...originalEnv };
    delete testEnv[varName];

    try {
      validateEnv(testEnv);
      console.error(`[FAIL] App should have failed when ${varName} is missing`);
      allPassed = false;
    } catch (err: any) {
      const message = err.message || "";
      const mentionsMissing = message.includes("Missing required environment variables");
      const mentionsVar = message.includes(varName);

      // Verify no secrets leaked in error message
      const leakedSecret =
        (originalEnv.GOOGLE_CLIENT_SECRET && message.includes(originalEnv.GOOGLE_CLIENT_SECRET)) ||
        (originalEnv.DATABASE_URL && message.includes(originalEnv.DATABASE_URL)) ||
        (originalEnv.SESSION_SECRET && message.includes(originalEnv.SESSION_SECRET));

      if (mentionsMissing && mentionsVar && !leakedSecret) {
        console.log(`[PASS] Correctly rejected missing ${varName} with descriptive safe error`);
      } else {
        console.error(`[FAIL] ${varName} check failed. Mentions missing: ${mentionsMissing}, Mentions var: ${mentionsVar}, Leaked: ${leakedSecret}`);
        allPassed = false;
      }
    }
  }

  // Restore env
  process.env = originalEnv;

  console.log("\n=================================================");
  console.log(allPassed ? "ALL 8 ENV VARIABLE VALIDATION CHECKS PASSED!" : "SOME ENV CHECKS FAILED!");
  console.log("=================================================\n");

  if (!allPassed) process.exit(1);
}

testEnvValidation();
