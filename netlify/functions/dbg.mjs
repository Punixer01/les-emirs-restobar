import { json } from "./_lib/util.mjs";
// TEMP diagnostic: returns names (not values) of DB-related runtime env vars.
export default async () => {
  const keys = Object.keys(process.env).filter((k) => /DATABASE|NEON|NETLIFY_DB|PG/i.test(k));
  return json({ keys });
};
