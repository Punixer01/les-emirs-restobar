export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRef() {
  let s = "";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return "LE-" + s;
}

export function normPhone(p) {
  return String(p || "").replace(/[^\d+]/g, "");
}

export function fmtDate(d) {
  // d is a Date or 'YYYY-MM-DD'
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  return dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function fmtTime(t) {
  return String(t || "").slice(0, 5);
}

export function seatFr(s) {
  return s === "terrace" ? "Terrasse" : "Intérieur";
}

// Basic validation for a public booking payload
export function validateBooking(b) {
  const errors = [];
  if (!b.name || String(b.name).trim().length < 2) errors.push("nom");
  const phone = normPhone(b.phone);
  if (phone.replace(/\D/g, "").length < 6) errors.push("téléphone");
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) errors.push("date");
  if (!b.time || !/^\d{2}:\d{2}/.test(b.time)) errors.push("heure");
  const party = parseInt(b.party, 10);
  if (!party || party < 1 || party > 30) errors.push("couverts");
  const seating = b.seating === "terrace" ? "terrace" : "inside";
  /* The confirmation, the QR pass and the change link all travel by email,
     so a booking without one cannot actually be served. Staff-entered
     bookings are exempt: they are taken over the phone. */
  const email = b.email && /.+@.+\..+/.test(b.email) ? String(b.email).trim() : null;
  if (!email && !b.staff) errors.push("email");
  return {
    errors,
    value: {
      name: String(b.name || "").trim(),
      phone,
      email,
      date: b.date,
      time: fmtTime(b.time),
      party,
      seating,
      service: b.service === "dinner" ? "dinner" : b.service === "lunch" ? "lunch" : null,
      note: b.note ? String(b.note).slice(0, 500) : null,
    },
  };
}
