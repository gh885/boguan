import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./connection";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export function migrateDatabase(db: Db): void {
  migrate(db, { migrationsFolder });
}

export { migrationsFolder };
