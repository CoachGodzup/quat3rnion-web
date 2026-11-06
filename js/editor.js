// Stato e serializzazione del level editor web.
// Modulo puro (niente DOM/Three) così è testabile con Node come logic.js.
//
// Il livello è tenuto in una forma semplice e serializzabile in JSON:
//   { size, gravity, rooms: { "x,y,z": { faces: { dir: "S1" } } }, pgs: [...] }

export const DIRECTIONS = ["right", "left", "up", "down", "forward", "back"];
export const PG_COLORS = ["red", "blue", "pink", "orange"];
export const SYMBOLS = [1, 2, 3, 4, 5];
export const TOOLS = ["room", "symbol", "trap", "key", "start", "exit", "erase"];

export const MAX_SIZE = 5;
export const MIN_SIZE = 2;

export function cellKey(x, y, z) { return `${x},${y},${z}`; }

export function inBounds(level, pos) {
  return !!pos && pos.every((v) => Number.isInteger(v) && v >= 0 && v < level.size);
}

export function roomAt(level, pos) {
  return level.rooms[cellKey(pos[0], pos[1], pos[2])] || null;
}

export function ensureRoom(level, pos) {
  const key = cellKey(pos[0], pos[1], pos[2]);
  if (!level.rooms[key]) level.rooms[key] = { faces: {} };
  return level.rooms[key];
}

// Rimuove una stanza e tutto ciò che vi era appoggiato (facce, chiavi,
// partenze e uscite), così il livello resta sempre coerente.
export function removeRoom(level, pos) {
  const key = cellKey(pos[0], pos[1], pos[2]);
  delete level.rooms[key];
  for (const pg of level.pgs) {
    if (samePos(pg.start, pos)) pg.start = null;
    if (samePos(pg.exit, pos)) pg.exit = null;
    pg.keys = pg.keys.filter((k) => !samePos(k, pos));
  }
}

export function toggleRoom(level, pos) {
  if (roomAt(level, pos)) removeRoom(level, pos);
  else ensureRoom(level, pos);
}

export function setFace(level, pos, dir, code) {
  if (!DIRECTIONS.includes(dir)) return;
  if (!code) {
    const room = roomAt(level, pos);
    if (room) delete room.faces[dir];
    return;
  }
  const room = ensureRoom(level, pos);
  room.faces[dir] = code;
}

export function setStart(level, pgIndex, pos) {
  const pg = level.pgs[pgIndex];
  if (!pg) return;
  ensureRoom(level, pos);
  pg.start = pos.slice();
}

export function setExit(level, pgIndex, pos) {
  const pg = level.pgs[pgIndex];
  if (!pg) return;
  ensureRoom(level, pos);
  pg.exit = pos.slice();
}

export function toggleKey(level, pgIndex, pos) {
  const pg = level.pgs[pgIndex];
  if (!pg) return;
  ensureRoom(level, pos);
  const i = pg.keys.findIndex((k) => samePos(k, pos));
  if (i >= 0) pg.keys.splice(i, 1);
  else pg.keys.push(pos.slice());
}

export function addPg(level) {
  if (level.pgs.length >= PG_COLORS.length) return null;
  const used = new Set(level.pgs.map((p) => p.color));
  const color = PG_COLORS.find((c) => !used.has(c)) || "red";
  level.pgs.push({ color, start: null, exit: null, keys: [] });
  return level.pgs.length - 1;
}

export function removePg(level, index) {
  if (level.pgs.length <= 1) return false;
  level.pgs.splice(index, 1);
  return true;
}

function samePos(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function createEditorLevel(size = 3) {
  const n = clampSize(size);
  const mid = Math.floor((n - 1) / 2);
  const center = [mid, mid, mid];
  return {
    version: 1,
    size: n,
    gravity: "down",
    rooms: { [cellKey(mid, mid, mid)]: { faces: {} } },
    pgs: [{ color: "red", start: center.slice(), exit: center.slice(), keys: [] }],
    activePg: 0,
    tool: "room",
    faceDir: "right",
    symbol: 1,
  };
}

export function clampSize(size) {
  const n = parseInt(size, 10);
  if (!Number.isFinite(n)) return 3;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
}

// Cambia la dimensione del cubo conservando solo ciò che resta nei limiti.
export function resizeLevel(level, size) {
  const n = clampSize(size);
  if (n === level.size) return level;
  level.size = n;
  for (const key of Object.keys(level.rooms)) {
    const pos = key.split(",").map(Number);
    if (!inBounds(level, pos)) delete level.rooms[key];
  }
  for (const pg of level.pgs) {
    if (!inBounds(level, pg.start)) pg.start = null;
    if (!inBounds(level, pg.exit)) pg.exit = null;
    pg.keys = pg.keys.filter((k) => inBounds(level, k));
  }
  return level;
}

export function validateLevel(level) {
  const errors = [];
  if (!inBounds(level, [0, 0, 0]) || !inBounds(level, [level.size - 1, level.size - 1, level.size - 1]))
    errors.push("dimensione non valida");
  if (Object.keys(level.rooms).length === 0) errors.push("aggiungi almeno una stanza");

  const candidates = level.pgs.filter((p) => p.start && p.exit);
  if (candidates.length === 0) errors.push("ogni livello ha bisogno di un PG con partenza e uscita");

  for (const [i, pg] of level.pgs.entries()) {
    if (!pg.start && !pg.exit) continue; // PG ancora vuoto: ignorato
    if (!pg.start) errors.push(`PG ${i + 1}: manca la partenza`);
    if (!pg.exit) errors.push(`PG ${i + 1}: manca l'uscita`);
    if (pg.start && !inBounds(level, pg.start)) errors.push(`PG ${i + 1}: partenza fuori dal cubo`);
    if (pg.exit && !inBounds(level, pg.exit)) errors.push(`PG ${i + 1}: uscita fuori dal cubo`);
    if (pg.start && !roomAt(level, pg.start)) errors.push(`PG ${i + 1}: la partenza non è in una stanza`);
    if (pg.exit && !roomAt(level, pg.exit)) errors.push(`PG ${i + 1}: l'uscita non è in una stanza`);
    for (const key of pg.keys) {
      if (!inBounds(level, key) || !roomAt(level, key))
        errors.push(`PG ${i + 1}: chiave fuori da una stanza`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function faceCode(code) {
  if (!code) return null;
  if (code[0] === "T") return { type: "T1" };
  return { type: "S" + (parseInt(code.slice(1), 10) || 1) };
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

function sortedRooms(level) {
  return Object.entries(level.rooms).sort(([a], [b]) => {
    const pa = a.split(",").map(Number), pb = b.split(",").map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  });
}

// Genera l'XML nello stesso formato dei livelli originali.
export function levelToXml(level, { pretty = true } = {}) {
  const nl = pretty ? "\n" : "";
  const ind = (n) => (pretty ? "  ".repeat(n) : "");
  const lines = [];
  lines.push(`<level size="${level.size}">`);

  for (const [key, room] of sortedRooms(level)) {
    const faces = DIRECTIONS
      .filter((dir) => room.faces && room.faces[dir])
      .map((dir) => {
        const fc = faceCode(room.faces[dir]);
        return `${ind(2)}<face pos="${dir}" type="${fc.type}" />`;
      });
    if (faces.length) {
      lines.push(`${ind(1)}<room pos="${key}">`);
      lines.push(...faces);
      lines.push(`${ind(1)}</room>`);
    } else {
      lines.push(`${ind(1)}<room pos="${key}" />`);
    }
  }

  for (const pg of level.pgs) {
    // I PG senza partenza/uscita non sono ancora pronti: li saltiamo.
    if (!pg.start || !pg.exit) continue;
    const needed = pg.keys.length;
    const attrs = [`color="${escapeXml(pg.color)}"`, `neededKeys="${needed}"`];
    const inner = [];
    inner.push(`${ind(2)}<start pos="${pg.start.join(",")}" />`);
    for (const k of pg.keys) inner.push(`${ind(2)}<key pos="${k.join(",")}" />`);
    inner.push(`${ind(2)}<exit pos="${pg.exit.join(",")}" />`);
    lines.push(`${ind(1)}<pg ${attrs.join(" ")}>`);
    lines.push(...inner);
    lines.push(`${ind(1)}</pg>`);
  }

  const gravity = level.gravity || "down";
  lines.push(`${ind(1)}<options gravity="${gravity}" rotColAxis="y" rotColNeededPgs="1" rotColSync="False" rotFaceAxis="xyz" rotFaceNeededPgs="1" rotFaceSync="False" />`);
  lines.push(`</level>`);
  return lines.join(nl);
}

export function serializeLevel(level) {
  return JSON.stringify(level);
}

export function deserializeLevel(text) {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || !raw.rooms || !Array.isArray(raw.pgs)) return null;
    const level = {
      version: 1,
      size: clampSize(raw.size),
      gravity: raw.gravity === "up" || raw.gravity === "no" ? raw.gravity : "down",
      rooms: {},
      pgs: raw.pgs.map((p) => ({
        color: PG_COLORS.includes(p.color) ? p.color : "red",
        start: Array.isArray(p.start) ? p.start.slice(0, 3).map(Number) : null,
        exit: Array.isArray(p.exit) ? p.exit.slice(0, 3).map(Number) : null,
        keys: Array.isArray(p.keys) ? p.keys.filter((k) => Array.isArray(k)).map((k) => k.slice(0, 3).map(Number)) : [],
      })),
      activePg: 0,
      tool: "room",
      faceDir: "right",
      symbol: 1,
    };
    if (level.pgs.length === 0) level.pgs.push({ color: "red", start: null, exit: null, keys: [] });

    for (const [key, room] of Object.entries(raw.rooms)) {
      const pos = key.split(",").map(Number);
      if (!inBounds(level, pos)) continue;
      const faces = {};
      for (const dir of DIRECTIONS) {
        const code = room && room.faces && room.faces[dir];
        if (typeof code === "string" && (code === "T1" || /^S[1-5]$/.test(code))) faces[dir] = code;
      }
      level.rooms[key] = { faces };
    }
    level.activePg = Number.isInteger(raw.activePg) ? Math.max(0, Math.min(level.pgs.length - 1, raw.activePg)) : 0;
    if (TOOLS.includes(raw.tool)) level.tool = raw.tool;
    if (DIRECTIONS.includes(raw.faceDir)) level.faceDir = raw.faceDir;
    if (SYMBOLS.includes(Number(raw.symbol))) level.symbol = Number(raw.symbol);
    return level;
  } catch {
    return null;
  }
}
