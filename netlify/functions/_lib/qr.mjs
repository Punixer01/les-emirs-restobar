/* Minimal QR encoder — byte mode, EC level M, versions 1..10.
   Self-contained on purpose: the Pages CSP blocks external scripts, and the
   same code has to run in a Worker (to render the pass image for the email)
   and in the browser (to draw the pass on screen). */

const EC_M_BITS = 0x00;

// per version (1..10) at EC level M: [ecCodewordsPerBlock, [[blocks, dataCodewords], ...]]
const SPEC_M = {
  1:  [10, [[1, 16]]],
  2:  [16, [[1, 28]]],
  3:  [26, [[1, 44]]],
  4:  [18, [[2, 32]]],
  5:  [24, [[2, 43]]],
  6:  [16, [[4, 27]]],
  7:  [18, [[4, 31]]],
  8:  [22, [[2, 38], [2, 39]]],
  9:  [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/* ---- GF(256) for Reed-Solomon ---- */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// g(x) = product of (x - alpha^i), coefficients HIGHEST power first.
// Returns the non-leading coefficients only (the polynomial is monic).
function rsGenerator(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                     // multiply by x
      next[j + 1] ^= mul(poly[j], EXP[i]);    // multiply by alpha^i
    }
    poly = next;
  }
  return poly.slice(1);                       // drop the leading 1
}
function rsEncode(data, ecLen) {
  const coef = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= mul(coef[i], factor);
  }
  return res;
}

/* ---- data encoding ---- */
function utf8Bytes(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function capacityBytes(v) {
  let total = 0;
  for (const [blocks, dataLen] of SPEC_M[v][1]) total += blocks * dataLen;
  return total;
}
function pickVersion(len) {
  for (let v = 1; v <= 10; v++) {
    const charCountBits = v <= 9 ? 8 : 16;
    if (Math.ceil((4 + charCountBits + len * 8) / 8) <= capacityBytes(v)) return v;
  }
  throw new Error("QR: contenu trop long");
}

function buildCodewords(bytes, version) {
  const [ecLen, groups] = SPEC_M[version];
  const totalData = capacityBytes(version);
  const charCountBits = version <= 9 ? 8 : 16;

  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                       // byte mode
  push(bytes.length, charCountBits);
  for (const b of bytes) push(b, 8);
  const cap = totalData * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  const PAD = [0xec, 0x11];
  let p = 0;
  while (data.length < totalData) data.push(PAD[p++ % 2]);

  const dataBlocks = [], ecBlocks = [];
  let idx = 0;
  for (const [blocks, dataLen] of groups) {
    for (let b = 0; b < blocks; b++) {
      const chunk = data.slice(idx, idx + dataLen); idx += dataLen;
      dataBlocks.push(chunk);
      ecBlocks.push(rsEncode(chunk, ecLen));
    }
  }
  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++)
    for (const blk of dataBlocks) if (i < blk.length) out.push(blk[i]);
  for (let i = 0; i < ecLen; i++)
    for (const blk of ecBlocks) out.push(blk[i]);
  return out;
}

/* ---- matrix ---- */
function isReserved(version, size, r, c) {
  if (r <= 8 && c <= 8) return true;                       // top-left finder + format
  if (r <= 8 && c >= size - 8) return true;                // top-right
  if (r >= size - 8 && c <= 8) return true;                // bottom-left
  if (r === 6 || c === 6) return true;                     // timing
  for (const ar of ALIGN[version]) for (const ac of ALIGN[version]) {
    if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
    if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
  }
  if (version >= 7) {
    if (r < 6 && c >= size - 11 && c < size - 8) return true;
    if (c < 6 && r >= size - 11 && r < size - 8) return true;
  }
  return false;
}

function makeMatrix(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const ring = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      set(r0 + r, c0 + c, ring || core ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) { const v = i % 2 === 0 ? 1 : 0; m[6][i] = v; m[i][6] = v; }

  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
  }
  return m;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(m, version, codewords) {
  const size = m.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  const bitAt = (i) => (i < totalBits ? (codewords[i >> 3] >> (7 - (i & 7))) & 1 : 0);
  let upward = true;
  for (let colPair = size - 1; colPair > 0; colPair -= 2) {
    if (colPair === 6) colPair--;                 // skip vertical timing column
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (const c of [colPair, colPair - 1]) {
        if (isReserved(version, size, r, c)) continue;
        m[r][c] = bitAt(bitIdx++);
      }
    }
    upward = !upward;
  }
}

function penalty(m) {
  const n = m.length; let score = 0;
  const runs = (get) => {
    for (let a = 0; a < n; a++) {
      let last = -1, len = 0;
      for (let b = 0; b < n; b++) {
        const v = get(a, b);
        if (v === last) { len++; if (len === 5) score += 3; else if (len > 5) score += 1; }
        else { last = v; len = 1; }
      }
    }
  };
  runs((a, b) => m[a][b]); runs((a, b) => m[b][a]);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
  }
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const rpat = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const hit = (arr, i, p) => p.every((v, k) => arr[i + k] === v);
  for (let a = 0; a < n; a++) {
    const row = m[a], col = m.map((x) => x[a]);
    for (let i = 0; i + 11 <= n; i++) {
      if (hit(row, i, pat) || hit(row, i, rpat)) score += 40;
      if (hit(col, i, pat) || hit(col, i, rpat)) score += 40;
    }
  }
  let dark = 0; for (const row of m) for (const v of row) dark += v;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

function formatBits(maskId) {
  const data = (EC_M_BITS << 3) | maskId;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  return (v << 12) | rem;
}
function applyFormat(m, version, maskId) {
  const size = m.length, bits = formatBits(maskId);
  const g = (i) => (bits >> i) & 1;
  // copy 1: bits 0-5 down column 8, then bits 8-14 leftwards along row 8
  for (let i = 0; i <= 5; i++) m[i][8] = g(i);
  m[7][8] = g(6); m[8][8] = g(7); m[8][7] = g(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = g(i);
  // copy 2: bits 0-7 leftwards along row 8 (right edge), bits 8-14 down column 8 (bottom)
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = g(i);
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = g(i);
  m[size - 8][8] = 1;                                  // always-dark module
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const b = (vb >> i) & 1, a = Math.floor(i / 3), c = i % 3;
      m[size - 11 + c][a] = b; m[a][size - 11 + c] = b;
    }
  }
}

/** Square array of 0/1 — the QR modules. Quiet zone NOT included. */
export function qrMatrix(text) {
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);
  const size = version * 4 + 17;

  let best = null, bestScore = Infinity;
  for (let maskId = 0; maskId < 8; maskId++) {
    const m = makeMatrix(version);
    placeData(m, version, codewords);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (!isReserved(version, size, r, c) && MASKS[maskId](r, c)) m[r][c] ^= 1;
    applyFormat(m, version, maskId);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** Crisp SVG, one <path> for every dark module. */
export function qrSvg(text, opts) {
  const o = opts || {};
  const size = o.size || 320, margin = o.margin == null ? 4 : o.margin;
  const dark = o.dark || "#17150f", light = o.light || "#ffffff";
  const m = qrMatrix(text), n = m.length, total = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (m[r][c]) d += "M" + (c + margin) + " " + (r + margin) + "h1v1h-1z";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 ' + total + " " + total + '" shape-rendering="crispEdges">' +
    '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
    '<path d="' + d + '" fill="' + dark + '"/></svg>';
}

/* ---- 1-bit PNG, so the code can be an <img> inside an email ----
   Most mail clients refuse inline SVG, so the email needs a real bitmap.
   Written by hand (stored deflate blocks) to avoid pulling in a dependency
   that would have to run inside a Worker. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function chunk(type, data) {
  const name = [...type].map((ch) => ch.charCodeAt(0));
  const body = new Uint8Array(name.length + data.length);
  body.set(name, 0); body.set(data, name.length);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** PNG bytes (Uint8Array) of the QR, 1 bit per pixel. */
export function qrPng(text, opts) {
  const o = opts || {};
  const scale = o.scale || 8, margin = o.margin == null ? 4 : o.margin;
  const m = qrMatrix(text), n = m.length;
  const W = (n + margin * 2) * scale;
  const rowBytes = Math.ceil(W / 8);

  // raw scanlines: filter byte 0, then 1bpp where bit set = white
  const raw = new Uint8Array((rowBytes + 1) * W);
  for (let y = 0; y < W; y++) {
    const base = y * (rowBytes + 1);
    raw[base] = 0;
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < W; x++) {
      const mx = Math.floor(x / scale) - margin;
      const dark = my >= 0 && my < n && mx >= 0 && mx < n && m[my][mx] === 1;
      if (!dark) raw[base + 1 + (x >> 3)] |= 0x80 >> (x & 7);   // 1 = white
    }
  }

  // zlib stream with stored (uncompressed) deflate blocks
  const parts = [0x78, 0x01];
  const MAX = 65535;
  for (let off = 0; off < raw.length; off += MAX) {
    const slice = raw.subarray(off, Math.min(off + MAX, raw.length));
    const last = off + MAX >= raw.length ? 1 : 0;
    parts.push(last, slice.length & 255, (slice.length >> 8) & 255,
               ~slice.length & 255, (~slice.length >> 8) & 255);
    for (let i = 0; i < slice.length; i++) parts.push(slice[i]);
  }
  parts.push(...u32(adler32(raw)));

  const ihdr = [...u32(W), ...u32(W), 1, 0, 0, 0, 0];   // 1-bit grayscale
  const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", ihdr), ...chunk("IDAT", parts), ...chunk("IEND", [])];
  return new Uint8Array(out);
}
