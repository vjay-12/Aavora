import { pgTable, text, timestamp, boolean, jsonb, primaryKey, index, serial } from "drizzle-orm/pg-core";

// 1. Users table (admin or member)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  picture: text("picture"),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 2. Activity table
export const activity = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(), // User's email or identifier
    userName: text("user_name"),
    action: text("action", {
      enum: [
        "upload",
        "rename",
        "move",
        "trash",
        "restore",
        "delete",
        "create_folder",
      ],
    }).notNull(),
    driveId: text("drive_id").notNull(),
    name: text("name").notNull(),
    path: text("path"),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index("activity_created_at_idx").on(table.createdAt.desc()),
    userIdIdx: index("activity_user_id_idx").on(table.userId),
    driveIdIdx: index("activity_drive_id_idx").on(table.driveId),
  })
);

// 3. Stars table (Primary key on composite user_id, drive_id)
export const stars = pgTable(
  "stars",
  {
    userId: text("user_id").notNull(),
    driveId: text("drive_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.driveId] }),
    userIdIdx: index("stars_user_id_idx").on(table.userId),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
export type Star = typeof stars.$inferSelect;
export type NewStar = typeof stars.$inferInsert;
