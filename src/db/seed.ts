import "dotenv/config";
import { getEnv } from "../../api/_utils/env";
import { db } from "./index";
import { users } from "./schema";
import { eq } from "drizzle-orm";

export async function seedUsers() {
  const env = getEnv();
  const adminEmail = env.ADMIN_EMAIL.toLowerCase().trim();
  const allowedEmails = env.ALLOWED_EMAILS.map((e) => e.toLowerCase().trim());

  console.log("[Seed]: Seeding users into Neon database...");

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
      name: defaultName.charAt(0).toUpperCase() + defaultName.slice(1),
      role: "admin",
      active: true,
    });
    console.log(`[Seed]: Admin user initialized (${adminEmail})`);
  } else {
    // Ensure role is admin and active is true
    await db
      .update(users)
      .set({ role: "admin", active: true })
      .where(eq(users.id, existingAdmin.id));
    console.log(`[Seed]: Admin user verified (${adminEmail})`);
  }

  // 2. Seed allowed members
  for (const memberEmail of allowedEmails) {
    if (memberEmail === adminEmail) continue;

    const [existingMember] = await db
      .select()
      .from(users)
      .where(eq(users.email, memberEmail))
      .limit(1);

    if (!existingMember) {
      const defaultName = memberEmail.split("@")[0].replace(/[._]/g, " ");
      await db.insert(users).values({
        email: memberEmail,
        name: defaultName.charAt(0).toUpperCase() + defaultName.slice(1),
        role: "member",
        active: true,
      });
      console.log(`[Seed]: Member initialized (${memberEmail})`);
    } else {
      console.log(`[Seed]: Member verified (${memberEmail})`);
    }
  }

  console.log("[Seed]: Database seeding completed successfully.");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed.ts")) {
  seedUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Seed Error]:", err.message);
      process.exit(1);
    });
}
