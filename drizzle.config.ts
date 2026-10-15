import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/schema.server.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env["DATABASE_URL"] || "file:data/trai-pro.db" },
});
