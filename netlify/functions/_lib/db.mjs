import { neon } from "@neondatabase/serverless";

// Netlify injects the (read-write) Neon connection as NETLIFY_DB_URL at runtime.
const url =
  process.env.NETLIFY_DB_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL;

if (!url) console.warn("[db] No Neon connection string in env.");

export const sql = neon(url);
