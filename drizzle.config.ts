import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/drizzle",
  strict: true,
  verbose: true,
});
