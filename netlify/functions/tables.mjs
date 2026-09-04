import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

/* Floor plan.
   GET    /api/tables?date=&time=      -> every table + who occupies it in that window
   POST   /api/tables  {table}         -> create / update one table (owner)
   POST   /api/tables  {tables:[...]}  -> bulk save positions after a drag (owner)
   DELETE /api/tables?id=              -> remove a table (owner)

   A table counts as busy for a 2h window around a booking, which is the
   turn time the restaurant actually works to. */
const WINDOW_MIN = 120;

function mins(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}

export default async (req) => {
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);

  if (req.method === "GET") {
    const tables = await sql`select * from tables order by zone, code`;
    // a joined table shows the combined cover count and hides its children
    const kidsOf = {};
    for (const t of tables) if (t.merged_into) (kidsOf[t.merged_into] = kidsOf[t.merged_into] || []).push(t);
    for (const t of tables) {
      const kids = kidsOf[t.id] || [];
      t.merged_seats = t.seats + kids.reduce((a, k) => a + k.seats, 0);
      t.merged_with = kids.map((k) => k.code);
    }
    const date = url.searchParams.get("date");
    const time = url.searchParams.get("time");

    let busy = {};
    if (date) {
      const held = await sql`
        select id, table_id, name, phone, res_time, party_size, status, waiting
        from reservations
        where res_date = ${date}
          and table_id is not null
          and status in ('accepted','arrived','seated')`;
      const ref = time ? mins(time) : null;
      for (const r of held) {
        if (ref !== null && Math.abs(mins(r.res_time) - ref) >= WINDOW_MIN) continue;
        busy[r.table_id] = {
          reservation_id: r.id, name: r.name, phone: r.phone,
          time: r.res_time, party: r.party_size, status: r.status,
        };
      }
    }
    return json({ tables, busy });
  }

  if (me.role !== "owner") return json({ error: "forbidden" }, 403);

  if (req.method === "POST") {
    const b = await readBody(req);

    /* Join tables: 27 + 28 become one "27" seating 8. The children keep their
       own row so the pairing can be undone, but they disappear from the plan
       and their seats roll into the parent. */
    if (b.action === "merge") {
      const parentId = parseInt(b.parent, 10);
      const childIds = (b.children || []).map((x) => parseInt(x, 10)).filter(Boolean);
      if (!parentId || !childIds.length) return json({ error: "Choisissez au moins deux tables." }, 400);
      if (childIds.includes(parentId)) return json({ error: "Une table ne peut pas se joindre à elle-même." }, 400);

      const parent = await sql`select * from tables where id = ${parentId}`;
      if (!parent.length) return json({ error: "Table principale introuvable." }, 404);
      if (parent[0].merged_into) return json({ error: "Cette table est déjà rattachée à une autre." }, 409);

      for (const cid of childIds) {
        const kids = await sql`select id from tables where merged_into = ${cid}`;
        if (kids.length) return json({ error: "Séparez d'abord les tables déjà jointes." }, 409);
        await sql`update reservations set table_id = ${parentId} where table_id = ${cid}`;
        await sql`update tables set merged_into = ${parentId} where id = ${cid}`;
      }
      const seats = await sql`select coalesce(sum(seats),0) as n from tables
                              where id = ${parentId} or merged_into = ${parentId}`;
      return json({ ok: true, parent: parentId, seats: seats[0].n });
    }

    /* Hold a table for the house — his own friends, a private party. It stays
       on the plan, clearly marked, and the picker will not hand it out by
       accident. Different from "hors service", which means broken/unusable. */
    if (b.action === "block") {
      const id = parseInt(b.id, 10);
      if (!id) return json({ error: "bad request" }, 400);
      const on = b.blocked === false ? 0 : 1;
      const rows = await sql`update tables set blocked = ${on}, blocked_note = ${on ? (b.note || null) : null}
                             where id = ${id} returning *`;
      if (!rows.length) return json({ error: "Table introuvable." }, 404);
      return json({ ok: true, table: rows[0] });
    }

    /* Undo a join — the children come back as their own tables. */
    if (b.action === "split") {
      const parentId = parseInt(b.parent, 10);
      if (!parentId) return json({ error: "bad request" }, 400);
      await sql`update tables set merged_into = null where merged_into = ${parentId}`;
      return json({ ok: true });
    }

    // bulk position save (drag & drop on the plan)
    if (Array.isArray(b.tables)) {
      for (const t of b.tables) {
        if (!t.id) continue;
        await sql`update tables set x = ${Number(t.x) || 0}, y = ${Number(t.y) || 0},
                  rot = ${Number(t.rot) || 0} where id = ${t.id}`;
      }
      return json({ ok: true, saved: b.tables.length });
    }

    const t = b.table || b;
    const code = String(t.code || "").trim();
    if (!code) return json({ error: "Le nom de la table est requis." }, 400);
    const zone = t.zone === "terrace" ? "terrace" : "inside";
    const seats = Math.max(1, Math.min(30, parseInt(t.seats, 10) || 2));
    const shape = ["round", "square", "rect"].includes(t.shape) ? t.shape : "round";
    const x = Math.max(0, Math.min(100, Number(t.x) || 10));
    const y = Math.max(0, Math.min(100, Number(t.y) || 10));
    const active = t.active === false || t.active === 0 ? 0 : 1;

    if (t.id) {
      const rows = await sql`update tables set code = ${code}, zone = ${zone}, seats = ${seats},
        shape = ${shape}, x = ${x}, y = ${y}, rot = ${Number(t.rot) || 0},
        active = ${active}, note = ${t.note || null} where id = ${t.id} returning *`;
      if (!rows.length) return json({ error: "not found" }, 404);
      return json({ ok: true, table: rows[0] });
    }

    const dup = await sql`select id from tables where code = ${code}`;
    if (dup.length) return json({ error: `La table « ${code} » existe déjà.` }, 409);

    const rows = await sql`insert into tables (code, zone, seats, shape, x, y, rot, active, note)
      values (${code}, ${zone}, ${seats}, ${shape}, ${x}, ${y}, ${Number(t.rot) || 0}, ${active}, ${t.note || null})
      returning *`;
    return json({ ok: true, table: rows[0] });
  }

  if (req.method === "DELETE") {
    const id = parseInt(url.searchParams.get("id"), 10);
    if (!id) return json({ error: "bad request" }, 400);
    await sql`update reservations set table_id = null where table_id = ${id}`;
    await sql`delete from tables where id = ${id}`;
    return json({ ok: true });
  }

  return json({ error: "method" }, 405);
};
