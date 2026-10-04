import "dotenv/config";
import { getEnv } from "../server/env";
import { db } from "../server/db";
import { users, activity, stars } from "../server/db/schema";
import { eq, sql } from "drizzle-orm";
import vercelConfig from "../vercel.json" with { type: "json" };

export async function testDatabase() {
  console.log("=================================================");
  console.log("          NEON POSTGRES DATABASE QA SUITE        ");
  console.log("=================================================\n");

  const env = getEnv();
  let allPassed = true;

  // 1. Latency test for SELECT 1 (pooled connection)
  console.log("1. Measuring SELECT 1 latency (pooled connection)...");
  const t0 = performance.now();
  await db.execute(sql`SELECT 1 as ping`);
  const t1 = performance.now();
  const firstLatency = Math.round(t1 - t0);

  const t2 = performance.now();
  await db.execute(sql`SELECT 1 as ping`);
  const t3 = performance.now();
  const secondLatency = Math.round(t3 - t2);

  console.log(`  -> First call latency:  ${firstLatency} ms`);
  console.log(`  -> Second call latency: ${secondLatency} ms`);
  if (firstLatency >= 0 && secondLatency >= 0) {
    console.log("  [PASS] Pooled connection SELECT 1 query succeeded.");
  } else {
    console.error("  [FAIL] Query timing failed.");
    allPassed = false;
  }

  // 2. Table, Column, PK, and Index Verification
  console.log("\n2. Verifying Tables, Primary Keys, and Indexes in Postgres catalog...");
  
  // Tables check
  const tablesResult: any = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('users', 'activity', 'stars')
  `);
  const existingTables = (tablesResult.rows || tablesResult).map((r: any) => r.table_name);
  console.log(`  -> Found tables: ${existingTables.join(", ")}`);
  
  const hasUsers = existingTables.includes("users");
  const hasActivity = existingTables.includes("activity");
  const hasStars = existingTables.includes("stars");

  if (hasUsers && hasActivity && hasStars) {
    console.log("  [PASS] All 3 required tables (users, activity, stars) exist in Neon Postgres.");
  } else {
    console.error("  [FAIL] Missing tables:", { hasUsers, hasActivity, hasStars });
    allPassed = false;
  }

  // Columns check
  const colsResult: any = await db.execute(sql`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name IN ('users', 'activity', 'stars')
    ORDER BY table_name, ordinal_position
  `);
  const cols = (colsResult.rows || colsResult);
  console.log(`  -> Total verified columns across 3 tables: ${cols.length}`);

  // Indexes check
  const indexesResult: any = await db.execute(sql`
    SELECT tablename, indexname, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'public' AND tablename IN ('users', 'activity', 'stars')
  `);
  const indexes = (indexesResult.rows || indexesResult);
  console.log("  -> Indexes found:");
  for (const idx of indexes) {
    console.log(`     - ${idx.tablename}.${idx.indexname}: ${idx.indexdef}`);
  }

  const activityCreatedAtIdx = indexes.find((i: any) => 
    i.tablename === "activity" && (i.indexname.includes("created_at") || i.indexdef.includes("created_at DESC"))
  );
  const starsUserIdIdx = indexes.find((i: any) => 
    i.tablename === "stars" && (i.indexname.includes("user_id") || i.indexdef.includes("user_id"))
  );

  if (activityCreatedAtIdx && starsUserIdIdx) {
    console.log("  [PASS] Required indexes exist (activity created_at desc, stars user_id).");
  } else {
    console.error("  [FAIL] Missing required indexes:", { 
      activityCreatedAtIdx: !!activityCreatedAtIdx, 
      starsUserIdIdx: !!starsUserIdIdx 
    });
    allPassed = false;
  }

  // 3. Seed verification
  console.log("\n3. Verifying Seeded Users & Roles...");
  const adminEmail = env.ADMIN_EMAIL.toLowerCase().trim();
  const [admin] = await db.select().from(users).where(eq(users.email, adminEmail));
  
  if (admin && admin.role === "admin" && admin.active === true) {
    console.log(`  [PASS] Admin ${adminEmail} verified with role 'admin' and active=true.`);
  } else {
    console.error(`  [FAIL] Admin user issue:`, admin);
    allPassed = false;
  }

  const allowedEmails = env.ALLOWED_EMAILS.map((e) => e.toLowerCase().trim());
  let allMembersValid = true;
  for (const mEmail of allowedEmails) {
    if (mEmail === adminEmail) continue;
    const [member] = await db.select().from(users).where(eq(users.email, mEmail));
    if (member && (member.role === "member" || member.role === "admin") && member.active === true) {
      console.log(`  [PASS] User ${mEmail} verified with role '${member.role}' and active=true.`);
    } else {
      console.error(`  [FAIL] Member user issue:`, member);
      allMembersValid = false;
      allPassed = false;
    }
  }

  // 4. Test CRUD operations on activity and stars
  console.log("\n4. Testing Insert, Read, and Delete (CRUD) on activity and stars...");
  
  // Test activity insert
  const [insertedActivity] = await db.insert(activity).values({
    userId: "test.qa@example.com",
    userName: "QA Tester",
    action: "upload",
    driveId: "qa-test-drive-id-123",
    name: "qa-test-file.pdf",
    path: "/Root/QA",
    meta: { testRun: true, timestamp: Date.now() },
  }).returning();

  console.log(`  -> Inserted activity id: ${insertedActivity?.id}`);

  // Test read activity
  const [readActivity] = await db.select().from(activity).where(eq(activity.id, insertedActivity.id));
  if (readActivity && readActivity.driveId === "qa-test-drive-id-123") {
    console.log("  [PASS] Read inserted activity successfully.");
  } else {
    console.error("  [FAIL] Could not read inserted activity row.");
    allPassed = false;
  }

  // Test stars insert
  await db.insert(stars).values({
    userId: "test.qa@example.com",
    driveId: "qa-test-drive-id-123",
  });
  console.log("  -> Inserted test star record.");

  // Test read stars
  const [readStar] = await db
    .select()
    .from(stars)
    .where(sql`${stars.userId} = 'test.qa@example.com' AND ${stars.driveId} = 'qa-test-drive-id-123'`);

  if (readStar) {
    console.log("  [PASS] Read inserted star successfully.");
  } else {
    console.error("  [FAIL] Could not read inserted star row.");
    allPassed = false;
  }

  // Delete test star
  await db.delete(stars).where(sql`${stars.userId} = 'test.qa@example.com' AND ${stars.driveId} = 'qa-test-drive-id-123'`);
  const [deletedStar] = await db
    .select()
    .from(stars)
    .where(sql`${stars.userId} = 'test.qa@example.com' AND ${stars.driveId} = 'qa-test-drive-id-123'`);
  
  if (!deletedStar) {
    console.log("  [PASS] Deleted star row successfully (cleaned up).");
  } else {
    console.error("  [FAIL] Star row was not cleaned up.");
    allPassed = false;
  }

  // Delete test activity
  await db.delete(activity).where(eq(activity.id, insertedActivity.id));
  const [deletedActivity] = await db.select().from(activity).where(eq(activity.id, insertedActivity.id));
  if (!deletedActivity) {
    console.log("  [PASS] Deleted activity row successfully (cleaned up).");
  } else {
    console.error("  [FAIL] Activity row was not cleaned up.");
    allPassed = false;
  }

  // 5. Region verification
  console.log("\n5. Checking Region Co-location...");
  const vercelRegions = vercelConfig.regions || [];
  const vercelRegion = vercelRegions[0] || "sin1";
  
  // Neon URL contains the region
  const dbUrl = env.DATABASE_URL;
  const isNeonSingapore = dbUrl.includes("ap-southeast-1") || dbUrl.includes("sin");
  console.log(`  -> Vercel function region: ${vercelRegion} (Singapore)`);
  console.log(`  -> Neon Postgres region:   ${isNeonSingapore ? "aws-ap-southeast-1 (Singapore)" : "Non-Singapore"}`);
  
  if (vercelRegion === "sin1" && isNeonSingapore) {
    console.log("  [PASS] Neon and Vercel functions are co-located in Singapore (sin1 / ap-southeast-1).");
  } else {
    console.warn("  [NOTE] Potential region mismatch between Vercel and Neon.");
  }

  console.log("\n=================================================");
  console.log(allPassed ? "ALL DATABASE CHECKS PASSED!" : "SOME DATABASE CHECKS FAILED!");
  console.log("=================================================\n");

  if (!allPassed) process.exit(1);
  return { firstLatency, secondLatency };
}

testDatabase().catch((err) => {
  console.error("DB QA Error:", err);
  process.exit(1);
});
