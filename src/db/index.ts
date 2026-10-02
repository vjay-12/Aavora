import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { getEnv } from "../../api/_utils/env";

const connectionString = getEnv().DATABASE_URL;

// Use Neon HTTP driver for ultra-low latency & zero persistent connection overhead in serverless
const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
export { schema };
