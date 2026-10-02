import "dotenv/config";
import { getEnv } from "../env.js";
import { db, sql } from "./index.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";

export async function seedUsers() {
  const env = getEnv();
  const adminEmail = env.ADMIN_EMAIL.toLowerCase().trim();
  const allowedEmails = env.ALLOWED_EMAILS.map((e: string) => e.toLowerCase().trim());

  console.log("[Seed]: Ensuring schema and seeding users in Neon database...");
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_encrypted TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `;

  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS given_name TEXT;
  `;
  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name_locked BOOLEAN NOT NULL DEFAULT false;
  `;

  // 1. Seed or update Admin
  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  if (!existingAdmin) {
    const defaultName = adminEmail.split("@")[0].replace(/[._]/g, " ");
    await db.insert(users).values({
      email: adminEmail,
      name: defaultName,
      role: "admin",
      active: true,
    });
    console.log(`[Seed]: Created primary admin user: ${adminEmail}`);
  } else if (existingAdmin.role !== "admin") {
    await db
      .update(users)
      .set({ role: "admin", active: true })
      .where(eq(users.email, adminEmail));
    console.log(`[Seed]: Promoted ${adminEmail} to admin role.`);
  }

  // 2. Seed allowed members
  for (const email of allowedEmails) {
    if (email === adminEmail) continue;

    const [existingMember] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!existingMember) {
      const defaultName = email.split("@")[0].replace(/[._]/g, " ");
      await db.insert(users).values({
        email,
        name: defaultName,
        role: "member",
        active: true,
      });
      console.log(`[Seed]: Created authorized member: ${email}`);
    }
  }

  console.log("[Seed]: User seeding complete.");
}

// Allow direct CLI execution
if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  seedUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Seed Error]:", err);
      process.exit(1);
    });
}
