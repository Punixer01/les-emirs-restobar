// Netlify DB (Neon). @netlify/neon reads the read-write NETLIFY_DATABASE_URL
// that Netlify injects into the function runtime when the DB integration is active.
import { neon } from "@netlify/neon";

export const sql = neon();
