// One-time database setup: runs db/schema.sql against NETLIFY_DATABASE_URL.
// Usage:  NETLIFY_DATABASE_URL="postgres://..." node scripts/setup-db.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("✗ Set NETLIFY_DATABASE_URL (or DATABASE_URL) first.");
  process.exit(1);
}
const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const statements = schema
  .replace(/--.*$/gm, "")     // strip comments
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

let ok = 0;
for (const stmt of statements) {
  try {
    await sql.query(stmt);
    ok++;
    console.log("✓", stmt.slice(0, 56).replace(/\s+/g, " "));
  } catch (e) {
    console.error("✗", stmt.slice(0, 56).replace(/\s+/g, " "), "->", e.message);
  }
}
console.log(`\nDone: ${ok}/${statements.length} statements executed.`);
