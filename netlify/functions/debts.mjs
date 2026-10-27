import { sql } from "./_lib/db.mjs";
import { json, readBody, normPhone } from "./_lib/util.mjs";
import { auth, isWatcher, OWNER_ONLY_DEBT_ACTIONS } from "./_lib/auth.mjs";
import { workbook, S } from "./_lib/xlsx.mjs";
import { pushOwners } from "./_lib/notify.mjs";

/* Ardoise — one ACCOUNT per client, and a LEDGER of every operation on it.
   Nothing is ever overwritten: a new debt, a payment and the opening balance
   are each their own line, so the owner can always see how a balance was built.

     balance = Σ(opening + debts) − Σ(payments)

   GET  /api/debts                       → accounts + balances (no photos)
   GET  /api/debts?account=<id>          → that account's full ledger
   GET  /api/debts?photo=<opId>          → one ticket photo, on demand
   POST /api/debts { action, ... }       → account / opening / debt / payment   */

const METHODS = ["cash", "cheque", "tpe", "virement"];
const SIGNED = `sum(case kind when 'payment' then -amount else amount end)`;

/* photos are data: URLs downscaled on the phone; cap them so a full-res image
   can never bloat a row */
const cleanPhoto = (p, max) =>
  p && /^data:image\//.test(String(p)) && String(p).length <= max ? String(p) : null;

export default async (req) => {
  /* Crédits: the owner runs it, the gérant works it, the watcher only reads it */
  const me = auth(req, ["owner", "gerant", "watcher"]);
  if (!me) return json({ error: "unauthorized" }, 401);
  if (isWatcher(me) && req.method !== "GET") return json({ error: "Compte en lecture seule." }, 403);

  /* ---------------- reads ---------------- */
  if (req.method === "GET") {
    const url = new URL(req.url);

    const photoId = parseInt(url.searchParams.get("photo"), 10);
    if (photoId) {
      const rows = await sql`select photo from debt_ops where id = ${photoId}`;
      if (!rows.length) return json({ error: "Introuvable." }, 404);
      return json({ photo: rows[0].photo || null });
    }

    /* one account's ledger, oldest first so the running balance can be built */
    const acctId = parseInt(url.searchParams.get("account"), 10);
    /* ?account=&export=1 is the per-client Excel and ?account=&statement=1 the
       one-client relevé — both handled below, not as the ledger */
    if (acctId && url.searchParams.get("export") !== "1" && url.searchParams.get("statement") !== "1") {
      const a = await sql`select * from debt_accounts where id = ${acctId}`;
      if (!a.length) return json({ error: "Compte introuvable." }, 404);
      const ops = await sql`
        select id, kind, amount, method, note, created_by, created_at, edited_at, edited_by,
               photo_thumb, (photo is not null) as has_photo
          from debt_ops where account_id = ${acctId}
         order by created_at asc, id asc`;
      let run = 0;
      for (const o of ops) { run += o.kind === "payment" ? -o.amount : o.amount; o.balance = Math.round(run * 1000) / 1000; }
      return json({ account: a[0], ops });
    }

    /* Excel export (.xlsx) — three sheets:
       1 "Releves clients"  one statement per client: who he is (name, phone,
                            account n°, client since, account note, status and
                            balance today), the balance carried into the
                            period, then EVERY operation on its own line
                            (crédit or paiement, mode, note, ticket, who entered
                            it, balance after) and the period totals
       2 "Etat des clients" one summary line per client
       3 "Operations"       every line of the period, chronological, to filter
       ?account=<id> exports one client · ?scope=due|paid keeps only the clients
       à crédit or only the soldés · from/to = period (inclusive).            */
    if (url.searchParams.get("export") === "1") {
      const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null);
      const fromIn = ymd(url.searchParams.get("from")), toIn = ymd(url.searchParams.get("to"));
      const from = fromIn || "0000-01-01", to = toIn || "9999-12-31";
      const one = parseInt(url.searchParams.get("account"), 10) || 0;
      const scope = ["due", "paid"].includes(url.searchParams.get("scope")) ? url.searchParams.get("scope") : "all";

      const accts = one
        ? await sql`select id, name, phone, note, created_at from debt_accounts where id = ${one}`
        : await sql`select id, name, phone, note, created_at from debt_accounts order by name asc, id asc`;
      if (one && !accts.length) return json({ error: "Compte introuvable." }, 404);
      const ops = one
        ? await sql`select id, account_id, kind, amount, method, note, created_by, created_at, (photo is not null) as has_photo
                      from debt_ops where account_id = ${one} order by created_at asc, id asc`
        : await sql`select id, account_id, kind, amount, method, note, created_by, created_at, (photo is not null) as has_photo
                      from debt_ops order by created_at asc, id asc`;

      const KIND = { debt: "Crédit", payment: "Paiement", opening: "Solde initial" };
      const PAY = { cash: "Espèces", cheque: "Chèque", tpe: "TPE", virement: "Virement bancaire" };
      const r3 = (n) => Math.round((n || 0) * 1000) / 1000;
      /* D1 stores UTC; Tunisia is UTC+1 all year (no DST) */
      const local = (ts) => new Date(Date.parse(String(ts || "").replace(" ", "T").replace(/Z?$/, "Z")) + 3600000);
      const dayOf = (d) => d.toISOString().slice(0, 10);
      const dateC = (d) => ({ v: Math.floor(d.getTime() / 86400000) + 25569, s: S.date });            // Excel day number
      const timeC = (d) => ({ v: (d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440, s: S.time });  // exact hh:mm
      const ymdC = (s) => ({ v: Date.parse(s + "T00:00:00Z") / 86400000 + 25569, s: S.date });
      const money = (n) => ({ v: r3(n), s: S.money });
      const tot = (n) => ({ v: r3(n), s: S.totalMoney });
      const head = (arr) => arr.map((v) => ({ v, s: S.head }));
      const who = (c) => (c ? (c === "direction" ? "Direction" : "Réception") : "");

      /* one pass: all-time running balance per account, split around the period */
      const st = new Map(accts.map((a) => [a.id, { a, before: 0, bal: 0, credits: 0, paid: 0, n: 0, last: null, ops: [] }]));
      for (const o of ops) {
        const s = st.get(o.account_id); if (!s) continue;
        s.bal = r3(s.bal + (o.kind === "payment" ? -o.amount : o.amount));
        const d = local(o.created_at), day = dayOf(d);
        if (day < from) { s.before = s.bal; continue; }        // history before the period still counts
        if (day > to) continue;                                 // after it: only today's balance
        s.n++; s.last = d;
        if (o.kind === "payment") s.paid += o.amount; else s.credits += o.amount;
        s.ops.push({ o, d, after: s.bal });
      }
      const kept = [...st.values()].filter((s) => one || scope === "all" || (scope === "due" ? s.bal > 0.0005 : s.bal <= 0.0005));

      /* one operation line — the same cells in the statement and in the flat list */
      const opCells = (x) => {
        const pay = x.o.kind === "payment";
        return [x.o.id, dateC(x.d), timeC(x.d), KIND[x.o.kind] || x.o.kind, x.o.note || "",
          pay ? null : money(x.o.amount), pay ? money(x.o.amount) : null,
          PAY[x.o.method] || "", x.o.has_photo ? "Oui" : "Non", who(x.o.created_by), money(x.after)];
      };
      const OP_HEAD = ["N°", "Date", "Heure", "Opération", "Détail / note", "Crédit (DT)", "Paiement (DT)",
                       "Mode de paiement", "Ticket signé", "Saisi par", "Solde après (DT)"];

      const now = new Date(Date.now() + 3600000);
      const SCOPE_FR = { all: "Tous les clients", due: "Clients à crédit", paid: "Clients soldés" };
      const meta = [
        [{ v: "Les Émirs - Crédits clients", s: S.title }],
        ["Sélection", one ? "Client : " + accts[0].name : SCOPE_FR[scope]],
        ["Du", fromIn ? ymdC(fromIn) : "Début", "Au", toIn ? ymdC(toIn) : "Aujourd'hui"],
        ["Exporté le", dateC(now), timeC(now)],
        [],
      ];

      /* ---- sheet 1: a statement per client ---- */
      const band = (text) => [{ v: text, s: S.section }, ...Array.from({ length: OP_HEAD.length - 1 }, () => ({ v: "", s: S.section }))];
      const label = (k, v) => [{ v: k, s: S.bold }, v == null || v === "" ? "—" : v];
      const releves = [...meta];
      if (!kept.length) releves.push(["Aucun client pour cette sélection."]);
      for (const s of kept) {
        const end = r3(s.before + s.credits - s.paid);
        releves.push(
          band("CLIENT : " + String(s.a.name).toUpperCase()),
          label("Téléphone", s.a.phone),
          label("N° de compte", s.a.id),
          label("Client depuis", s.a.created_at ? dateC(local(s.a.created_at)) : ""),
          label("Note du compte", s.a.note),
          label("Statut aujourd'hui", s.bal > 0.0005 ? "À crédit" : "Soldé"),
          [{ v: "Solde dû aujourd'hui (DT)", s: S.bold }, tot(s.bal)],
          [],
          head(OP_HEAD),
        );
        if (fromIn) releves.push(["", ymdC(fromIn), "", "Report", "Solde avant la période", null, null, "", "", "", money(s.before)]);
        if (s.ops.length) for (const x of s.ops) releves.push(opCells(x));
        else releves.push(["", "", "", "Aucune opération sur cette période."]);
        releves.push(
          ["", "", "", { v: "TOTAL PÉRIODE", s: S.bold }, { v: s.n + " opération(s)", s: S.bold }, tot(s.credits), tot(s.paid), "", "", "", tot(end)],
          [], [],
        );
      }
      const sheetReleves = { name: "Releves clients", widths: [26, 12, 8, 15, 34, 14, 14, 17, 12, 12, 17], rows: releves };

      /* ---- sheet 2: one summary line per client ---- */
      const t = { before: 0, credits: 0, paid: 0, end: 0, bal: 0 };
      const etat = kept.map((s) => {
        const end = r3(s.before + s.credits - s.paid);
        t.before += s.before; t.credits += s.credits; t.paid += s.paid; t.end += end; t.bal += s.bal;
        return [s.a.name, s.a.phone || "", s.bal > 0.0005 ? "À crédit" : "Soldé", money(s.before), money(s.credits),
                money(s.paid), money(end), money(s.bal), s.n, s.last ? dateC(s.last) : "Aucune",
                s.a.created_at ? dateC(local(s.a.created_at)) : ""];
      });
      const sheetEtat = {
        name: "Etat des clients",
        widths: [26, 16, 12, 18, 18, 18, 20, 22, 12, 18, 14],
        rows: [...meta,
          head(["Client", "Téléphone", "Statut", "Solde avant période (DT)", "Crédits période (DT)", "Encaissé période (DT)",
                "Solde fin de période (DT)", "Solde dû aujourd'hui (DT)", "Opérations", "Dernière opération", "Client depuis"]),
          ...etat,
          [{ v: "TOTAL", s: S.bold }, { v: kept.length + " client(s)", s: S.bold }, "", tot(t.before), tot(t.credits),
           tot(t.paid), tot(t.end), tot(t.bal)]],
      };

      /* ---- sheet 3: every operation of the period, chronological ---- */
      const flat = kept.flatMap((s) => s.ops.map((x) => ({ s, x }))).sort((p, q2) => p.x.d - q2.x.d)
        .map(({ s, x }) => [s.a.name, s.a.phone || "", ...opCells(x)]);
      const sheetOps = {
        name: "Operations",
        widths: [26, 16, 8, 12, 8, 15, 34, 14, 14, 17, 12, 12, 17],
        rows: [...meta,
          head(["Client", "Téléphone", ...OP_HEAD]),
          ...(flat.length ? flat : [["Aucune opération sur cette période."]]),
          [{ v: "TOTAL", s: S.bold }, "", "", "", "", "", "", tot(t.credits), tot(t.paid)]],
      };

      const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "client";
      const file = `credits-${one ? slug(accts[0].name) : scope}-${fromIn || "debut"}_${toIn || "aujourdhui"}.xlsx`;
      return new Response(workbook([sheetReleves, sheetEtat, sheetOps]), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${file}"`,
          "x-filename": file,
        },
      });
    }

    /* Owner's statement (relevé): every movement of a period — one client or all
       — oldest first like a bank statement, with the balance carried into the
       period, the running balance after each line and the closing balance. */
    if (url.searchParams.get("statement") === "1") {
      /* reading the relevé is open to every crédit dashboard (direction, gérance,
         suivi) — it is a read; changing an operation stays owner-only (edit_op) */
      const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
      const tnToday = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
      const from = ymdOk(url.searchParams.get("from")) ? url.searchParams.get("from") : null;
      const to = ymdOk(url.searchParams.get("to")) ? url.searchParams.get("to") : tnToday;
      const acct = parseInt(url.searchParams.get("account"), 10) || 0;
      const base = [], baseArgs = [];
      if (acct) { base.push("o.account_id = ?"); baseArgs.push(acct); }
      const before = from
        ? await sql.query(
            `select coalesce(sum(case o.kind when 'payment' then -o.amount else o.amount end),0) as b
               from debt_ops o where ${[...base, "o.created_at < datetime(?, '-1 hour')"].join(" and ")}`,
            [...baseArgs, from + " 00:00:00"])
        : [{ b: 0 }];
      const w = [...base, "o.created_at < datetime(?, '+1 day', '-1 hour')"], wa = [...baseArgs, to + " 00:00:00"];
      if (from) { w.push("o.created_at >= datetime(?, '-1 hour')"); wa.push(from + " 00:00:00"); }
      const ops = await sql.query(
        `select o.id, o.account_id, o.kind, o.amount, o.method, o.note, o.created_by, o.created_at,
                o.edited_at, o.edited_by, (o.photo is not null) as has_photo, a.name, a.phone
           from debt_ops o join debt_accounts a on a.id = o.account_id
          where ${w.join(" and ")}
          order by o.created_at asc, o.id asc limit 3001`, wa);
      const truncated = ops.length > 3000;
      if (truncated) ops.length = 3000;
      const r3 = (n) => Math.round((n || 0) * 1000) / 1000;
      const opening = r3(before[0] && before[0].b);
      let run = opening;
      const totals = { count: ops.length, credits: 0, payments: 0, cash: 0, cheque: 0, tpe: 0, virement: 0 };
      for (const o of ops) {
        if (o.kind === "payment") { run -= o.amount; totals.payments += o.amount; if (o.method && o.method in totals) totals[o.method] += o.amount; }
        else { run += o.amount; totals.credits += o.amount; }
        o.balance = r3(run);
      }
      return json({ from, to, today: tnToday, account: acct || null, opening, closing: r3(run), totals, truncated, ops });
    }

    /* Owner's journal: every Crédit operation of one day (Tunisia time, UTC+1),
       newest first, with the day's totals, plus how many operations each of
       the 35 days up to `until` had — for the day strip's activity dots. */
    const journal = url.searchParams.get("journal");
    if (journal !== null) {
      if (me.role !== "owner") return json({ error: "Réservé à la direction." }, 403);
      const tnToday = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
      const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
      const day = ymdOk(journal) ? journal : tnToday;
      const until = ymdOk(url.searchParams.get("until")) ? url.searchParams.get("until") : tnToday;
      const start = day + " 00:00:00", end = until + " 00:00:00";
      const ops = await sql`
        select o.id, o.account_id, o.kind, o.amount, o.method, o.note, o.created_by, o.created_at,
               o.edited_at, o.edited_by, (o.photo is not null) as has_photo, a.name, a.phone
          from debt_ops o join debt_accounts a on a.id = o.account_id
         where o.created_at >= datetime(${start}, '-1 hour')
           and o.created_at <  datetime(${start}, '+1 day', '-1 hour')
         order by o.created_at desc, o.id desc`;
      const totals = { count: ops.length, credits: 0, payments: 0, cash: 0, cheque: 0, tpe: 0, virement: 0 };
      for (const o of ops) {
        if (o.kind === "payment") { totals.payments += o.amount; if (o.method in totals) totals[o.method] += o.amount; }
        else totals.credits += o.amount;
      }
      const act = await sql`
        select date(created_at, '+1 hour') as d, count(*) as n from debt_ops
         where created_at >= datetime(${end}, '-34 days', '-1 hour')
           and created_at <  datetime(${end}, '+1 day', '-1 hour')
         group by d`;
      const activity = {};
      for (const r of act) activity[r.d] = r.n;
      return json({ day, until, today: tnToday, ops, totals, activity });
    }

    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const showAll = url.searchParams.get("all") === "1";
    const like = "%" + q + "%";
    const base = `
      select a.id, a.name, a.phone, a.client_id, a.created_at,
             coalesce((select ${SIGNED} from debt_ops o where o.account_id = a.id),0) as balance,
             (select count(*) from debt_ops o where o.account_id = a.id)              as ops,
             (select max(created_at) from debt_ops o where o.account_id = a.id)       as last_op
        from debt_accounts a`;
    const where = [];
    if (q) where.push(`(lower(a.name) like ? or a.phone like ?)`);
    if (!showAll) where.push(`coalesce((select ${SIGNED} from debt_ops o where o.account_id = a.id),0) > 0.0005`);
    const sqlText = base + (where.length ? ` where ${where.join(" and ")}` : "") +
                    ` order by coalesce(last_op, a.created_at) desc limit 300`;
    const accounts = await sql.query(sqlText, q ? [like, like] : []);

    const sums = await sql.query(
      `select coalesce(sum(bal),0) as outstanding, sum(case when bal > 0.0005 then 1 else 0 end) as debtors
         from (select coalesce((select ${SIGNED} from debt_ops o where o.account_id = a.id),0) as bal
                 from debt_accounts a)`);
    return json({
      accounts,
      outstanding: sums[0] ? sums[0].outstanding : 0,
      debtors: sums[0] ? sums[0].debtors : 0,
    });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);

  /* ---------------- writes ---------------- */
  const b = await readBody(req);
  const action = b.action || "";
  /* deleting a credit line, deleting a client's account and setting the
     "solde initial" stay with the owner — the gérant can add and cash in only */
  if (me.role !== "owner" && OWNER_ONLY_DEBT_ACTIONS.includes(action)) {
    return json({ error: "Action réservée à la direction." }, 403);
  }
  const by = me.role === "owner" ? "direction" : me.role === "gerant" ? "gérance" : "réception";
  const amount = Number(b.amount);
  const acctId = parseInt(b.account_id, 10);

  /* the direction can date an operation on any past day (old paper-book
     debts, a payment entered late). Screen = Tunisia time (UTC+1), base = UTC.
     Returns undefined = "now", null = invalid, else the UTC timestamp. */
  const whenOf = (date, time) => {
    if (me.role !== "owner" || !date) return undefined;
    const d = String(date), t = String(time || "12:00").slice(0, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
    const ms = Date.parse(d + "T" + t + ":00Z") - 3600000;
    if (!Number.isFinite(ms) || ms > Date.now() + 5 * 60000) return null;
    return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  };

  const needAccount = async () => {
    const rows = await sql`select id from debt_accounts where id = ${acctId}`;
    return rows.length ? rows[0] : null;
  };

  if (action === "create_account") {
    const name = String(b.name || "").trim();
    if (!name) return json({ error: "Nom requis." }, 400);
    const phone = b.phone ? normPhone(b.phone).slice(0, 40) : null;
    /* a credit client must be reachable — except when the direction enters an
       old debt from its paper book, where there may be no number at all */
    if (me.role !== "owner" && (!phone || String(phone).replace(/\D/g, "").length < 8)) {
      return json({ error: "Numéro de téléphone obligatoire (8 chiffres minimum)." }, 400);
    }
    /* the solde initial belongs to the direction, at creation as afterwards */
    if (me.role !== "owner" && Math.abs(Number(b.opening) || 0) > 0.0005) {
      return json({ error: "Le solde initial est réservé à la direction." }, 403);
    }
    const note = b.note ? String(b.note).trim().slice(0, 500) : null;

    /* link to the client book when the number matches (last 8 digits, because
       Tunisian numbers are stored both with and without +216) */
    let clientId = null;
    if (phone) {
      const tail = phone.replace(/\D/g, "").slice(-8);
      if (tail.length === 8) {
        const c = await sql`select id from clients where replace(replace(phone,' ',''),'+','') like ${"%" + tail} limit 1`;
        if (c.length) clientId = c[0].id;
      }
    }
    const rows = await sql`insert into debt_accounts (name, phone, client_id, note)
                           values (${name}, ${phone}, ${clientId}, ${note}) returning id`;
    const id = rows[0].id;

    /* an opening balance is the first line of the ledger, never a hidden field */
    const opening = Number(b.opening);
    if (Number.isFinite(opening) && Math.abs(opening) > 0.0005) {
      await sql`insert into debt_ops (account_id, kind, amount, note, created_by)
                values (${id}, 'opening', ${opening}, 'Solde initial', ${by})`;
    }
    if (me.role === "gerant") {
      try {
        await pushOwners(sql, { title: "Crédit · nouveau client par la gérance", body: `${name} · ${phone}`, url: "/admin" }, { role: "owner" });
      } catch (e) { console.error("[debts push]", e); }
    }
    return json({ ok: true, id, audit: { name, phone, opening: Number(b.opening) || 0 } });
  }

  if (action === "set_opening") {
    if (!(await needAccount())) return json({ error: "Compte introuvable." }, 404);
    if (!Number.isFinite(amount)) return json({ error: "Montant invalide." }, 400);
    const existing = await sql`select id, amount from debt_ops where account_id = ${acctId} and kind = 'opening' limit 1`;
    if (existing.length) {
      await sql`update debt_ops set amount = ${amount}, created_by = ${by} where id = ${existing[0].id}`;
    } else {
      await sql`insert into debt_ops (account_id, kind, amount, note, created_by)
                values (${acctId}, 'opening', ${amount}, 'Solde initial', ${by})`;
    }
    const acc = await sql`select name from debt_accounts where id = ${acctId}`;
    return json({ ok: true, audit: { name: acc.length ? acc[0].name : null, amount, previous: existing.length ? existing[0].amount : null } });
  }

  if (action === "add_debt" || action === "add_payment") {
    if (!(await needAccount())) return json({ error: "Compte introuvable." }, 404);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Montant invalide." }, 400);
    const note = b.note ? String(b.note).trim().slice(0, 500) : null;
    const at = whenOf(b.date, b.time);
    if (at === null) return json({ error: "Date invalide (pas dans le futur)." }, 400);

    if (action === "add_payment") {
      const method = METHODS.includes(b.method) ? b.method : null;
      if (!method) return json({ error: "Mode de paiement requis (espèces, chèque, TPE ou virement)." }, 400);
      await sql`insert into debt_ops (account_id, kind, amount, method, note, created_by, created_at)
                values (${acctId}, 'payment', ${amount}, ${method}, ${note}, ${by}, coalesce(${at || null}, datetime('now')))`;
    } else {
      /* a crédit is a debt the client signs for: no ticket, no crédit */
      const photo = cleanPhoto(b.photo, 1500000);
      /* the direction may enter old paper debts, which have no ticket to photograph */
      if (!photo && me.role !== "owner") return json({ error: "Photo du ticket signé obligatoire pour un crédit." }, 400);
      await sql`insert into debt_ops (account_id, kind, amount, note, photo, photo_thumb, created_by, created_at)
                values (${acctId}, 'debt', ${amount}, ${note},
                        ${photo}, ${cleanPhoto(b.photo_thumb, 60000)}, ${by}, coalesce(${at || null}, datetime('now')))`;
    }
    const cur = await sql.query(`select coalesce(${SIGNED},0) as balance from debt_ops where account_id = ?`, [acctId]);

    const acc = await sql`select name from debt_accounts where id = ${acctId}`;
    const who = acc.length ? acc[0].name : "Client";
    /* the direction is told about every credit movement, whoever entered it —
       on the owner's own devices only */
    try {
      const PAYFR = { cash: "espèces", cheque: "chèque", tpe: "TPE", virement: "virement bancaire" };
      const author = by === "direction" ? "par la direction" : "par la gérance";
      await pushOwners(sql, action === "add_payment"
        ? { title: "Crédit · encaissement " + author, body: `${who} · ${amount.toFixed(3)} DT en ${PAYFR[b.method] || b.method}`, url: "/admin" }
        : { title: "Crédit · nouveau crédit " + author, body: `${who} · +${amount.toFixed(3)} DT`, url: "/admin" },
        { role: "owner" });
    } catch (e) { console.error("[debts push]", e); }
    return json({ ok: true, balance: cur[0] ? cur[0].balance : 0,
                  audit: { name: who, amount, method: action === "add_payment" ? b.method : null, balance: cur[0] ? cur[0].balance : 0 } });
  }

  /* "Changer la photo" (direction only): a staff member's blurry ticket is
     replaced by a readable one. The amount and the balance don't move. */
  if (action === "set_photo") {
    const id = parseInt(b.id, 10);
    const photo = cleanPhoto(b.photo, 1500000);
    if (!id || !photo) return json({ error: "Photo invalide." }, 400);
    const cur = await sql`select o.id, o.kind, o.amount, (o.photo is not null) as had, a.name
                            from debt_ops o join debt_accounts a on a.id = o.account_id where o.id = ${id}`;
    if (!cur.length) return json({ error: "Opération introuvable." }, 404);
    await sql`update debt_ops set photo = ${photo}, photo_thumb = ${cleanPhoto(b.photo_thumb, 60000)},
                edited_at = datetime('now'), edited_by = ${by} where id = ${id}`;
    return json({ ok: true, audit: { op: id, name: cur[0].name, amount: cur[0].amount, replaced: !!cur[0].had } });
  }

  if (action === "delete_op") {
    const id = parseInt(b.id, 10);
    if (!id) return json({ error: "bad request" }, 400);
    const gone = await sql`select o.kind, o.amount, o.method, o.created_at, a.name
                             from debt_ops o join debt_accounts a on a.id = o.account_id where o.id = ${id}`;
    await sql`delete from debt_ops where id = ${id}`;
    return json({ ok: true, audit: gone.length ? gone[0] : null });
  }

  /* "Modifier le compte" (direction only): the client's name, number and the
     account's information note. The number stays optional for the direction
     (old paper-book debts); the link to the client book follows the number.
     Only what changed is written, and the before/after goes to the history. */
  if (action === "edit_account") {
    if (!acctId) return json({ error: "bad request" }, 400);
    const cur = await sql`select * from debt_accounts where id = ${acctId}`;
    if (!cur.length) return json({ error: "Compte introuvable." }, 404);
    const o = cur[0];
    const name = b.name !== undefined ? String(b.name || "").trim().slice(0, 120) : o.name;
    if (!name) return json({ error: "Nom requis." }, 400);
    const phone = b.phone !== undefined
      ? (String(b.phone || "").trim() ? normPhone(b.phone).slice(0, 40) : null)
      : o.phone;
    const note = b.note !== undefined ? (String(b.note || "").trim().slice(0, 500) || null) : o.note;
    const changed = {};
    if (name !== o.name) changed.name = [o.name, name];
    if ((phone || null) !== (o.phone || null)) changed.phone = [o.phone || null, phone || null];
    if ((note || null) !== (o.note || null)) changed.note = [o.note || null, note || null];
    if (!Object.keys(changed).length) return json({ ok: true, unchanged: true });
    let clientId = o.client_id;
    if (changed.phone) {
      clientId = null;
      const tail = String(phone || "").replace(/\D/g, "").slice(-8);
      if (tail.length === 8) {
        const c = await sql`select id from clients where replace(replace(phone,' ',''),'+','') like ${"%" + tail} limit 1`;
        if (c.length) clientId = c[0].id;
      }
    }
    await sql`update debt_accounts set name = ${name}, phone = ${phone}, note = ${note}, client_id = ${clientId}
               where id = ${acctId}`;
    return json({ ok: true, changed: Object.keys(changed), audit: { name, changed } });
  }

  if (action === "delete_account") {
    if (!acctId) return json({ error: "bad request" }, 400);
    const gone = await sql.query(
      `select a.name, a.phone, (select count(*) from debt_ops o where o.account_id = a.id) as ops,
              coalesce((select ${SIGNED} from debt_ops o where o.account_id = a.id),0) as balance
         from debt_accounts a where a.id = ?`, [acctId]);
    await sql`delete from debt_ops where account_id = ${acctId}`;
    await sql`delete from debt_accounts where id = ${acctId}`;
    return json({ ok: true, audit: gone.length ? gone[0] : null });
  }

  /* "Modifier" (direction only): change any field of one operation — type,
     amount, payment method, note, date and time. Only what actually changed is
     written; the line is marked as modified and the before/after values go to
     the activity history. Dates are Tunisia time on screen, UTC in the base. */
  if (action === "edit_op") {
    const id = parseInt(b.id, 10);
    if (!id) return json({ error: "bad request" }, 400);
    const cur = await sql`select o.*, a.name from debt_ops o join debt_accounts a on a.id = o.account_id where o.id = ${id}`;
    if (!cur.length) return json({ error: "Opération introuvable." }, 404);
    const o = cur[0];
    const next = { kind: o.kind, amount: o.amount, method: o.method, note: o.note, created_at: o.created_at };
    const changed = {};

    if (b.kind !== undefined && o.kind !== "opening") {
      if (!["debt", "payment"].includes(b.kind)) return json({ error: "Type d'opération invalide." }, 400);
      if (b.kind !== o.kind) { next.kind = b.kind; changed.kind = [o.kind, b.kind]; }
    }
    if (b.amount !== undefined) {
      const a = Number(b.amount);
      if (!Number.isFinite(a) || (next.kind !== "opening" && a <= 0)) return json({ error: "Montant invalide." }, 400);
      if (Math.abs(a - o.amount) > 0.0005) { next.amount = a; changed.amount = [o.amount, a]; }
    }
    if (next.kind === "payment") {
      const m = b.method !== undefined ? b.method : o.method;
      if (!METHODS.includes(m)) return json({ error: "Mode de paiement requis (espèces, chèque, TPE ou virement)." }, 400);
      if (m !== o.method) { next.method = m; changed.method = [o.method, m]; }
    } else if (o.method) {
      next.method = null; changed.method = [o.method, null];
    }
    if (b.note !== undefined) {
      const n = String(b.note || "").trim().slice(0, 500) || null;
      if (n !== (o.note || null)) { next.note = n; changed.note = [o.note || null, n]; }
    }
    if (b.date !== undefined || b.time !== undefined) {
      const local = new Date(Date.parse(String(o.created_at).replace(" ", "T") + "Z") + 3600000).toISOString();
      const d = b.date !== undefined ? String(b.date) : local.slice(0, 10);
      const t = b.time !== undefined ? String(b.time).slice(0, 5) : local.slice(11, 16);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return json({ error: "Date ou heure invalide." }, 400);
      const ms = Date.parse(d + "T" + t + ":00Z") - 3600000;
      if (!Number.isFinite(ms)) return json({ error: "Date ou heure invalide." }, 400);
      if (ms > Date.now() + 5 * 60000) return json({ error: "La date ne peut pas être dans le futur." }, 400);
      const utc = new Date(ms).toISOString().slice(0, 19).replace("T", " ");
      if (utc.slice(0, 16) !== String(o.created_at).slice(0, 16)) { next.created_at = utc; changed.created_at = [o.created_at, utc]; }
    }
    if (!Object.keys(changed).length) return json({ ok: true, unchanged: true });

    await sql`update debt_ops set kind = ${next.kind}, amount = ${next.amount}, method = ${next.method},
                note = ${next.note}, created_at = ${next.created_at},
                edited_at = datetime('now'), edited_by = ${by}
              where id = ${id}`;
    return json({ ok: true, changed: Object.keys(changed), audit: { op: id, name: o.name, changed } });
  }

  return json({ error: "action inconnue" }, 400);
};
