import { neon } from "@neondatabase/serverless";

// Netlify injects NETLIFY_DATABASE_URL at runtime (Neon extension).
const url =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL;

if (!url) console.warn("[db] NETLIFY_DATABASE_URL is not set.");

export const sql = neon(url);
