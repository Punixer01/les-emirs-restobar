/* Download a nightly database backup (made by the les-emirs-cron worker) into
   backup/ — which is git-ignored: it holds guests' names, phones and emails.
     node scripts/backup-pull.mjs              -> the latest one
     node scripts/backup-pull.mjs 2026-10-27   -> that day's
   Each file is JSON: { taken_at, tables: { name: { sql, rows: [...] } } }. */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const NS = "17ff75f0301d4449bf69f1bb0b4d215d";
const W = path.join("node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const env = { ...process.env }; delete env.CLOUDFLARE_API_TOKEN;      // use the logged-in account
const run = (args) => execFileSync(W, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });

const keys = JSON.parse(run(["kv", "key", "list", "--namespace-id", NS, "--remote"])).map((k) => k.name).sort();
if (!keys.length) { console.error("No backup yet."); process.exit(1); }
if (process.argv[2] && !/^\d{4}-\d{2}-\d{2}$/.test(process.argv[2])) { console.error("Date as YYYY-MM-DD."); process.exit(1); }
const want = process.argv[2] ? "backup-" + process.argv[2] : keys[keys.length - 1];
if (!keys.includes(want)) { console.error("No backup " + want + ". Available: " + keys.join(", ")); process.exit(1); }
const body = run(["kv", "key", "get", want, "--namespace-id", NS, "--remote", "--text"]);
fs.mkdirSync("backup", { recursive: true });
const file = path.join("backup", want + ".json");
fs.writeFileSync(file, body);
const data = JSON.parse(body);
console.log(file, "·", (body.length / 1048576).toFixed(1), "MB ·", Object.entries(data.tables).map(([n, t]) => n + " " + t.rows.length).join(", "));
