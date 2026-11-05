// Port JavaScript della core logic di Quat3rnion (mirror di Kernel.cs / Stanza.cs
// / Faccia.cs / PG.cs / Evento.cs). Usato sia dal gioco (Three.js) sia dai test.

export const DIRS = ["right", "left", "up", "down", "forward", "back"];
export const OPPOSITE = { right: "left", left: "right", up: "down", down: "up", forward: "back", back: "forward" };
export const FaceType = { Normale: 0, Simbolo: 1, Trappola: 2 };
export const EventAction = { Attiva: 0, Disattiva: 1, Cambia: 2, Messaggio: 3, Gravita: 4 };
export const EventTrigger = { Entra: 0, Esci: 1, Attraversa: 2, Caplesta: 3, Inizio: 4 };

export class Faccia {
  constructor(code) {
    this.type = FaceType.Normale;
    this._symbol = 0;
    this.active = true;
    this.events = [];
    if (code) this.fromCode(code);
  }
  fromCode(code) {
    const c = code[0];
    if (c === "N" || c === "n") return;
    if (c === "S" || c === "s") this.type = FaceType.Simbolo;
    else if (c === "T" || c === "t") this.type = FaceType.Trappola;
    this._symbol = parseInt(code.slice(1), 10) || 0;
    if (c >= "a" && c <= "z") this.active = false;
  }
  get symbol() { return this.type === FaceType.Normale ? 0 : this._symbol; }
  set symbol(v) { this._symbol = v; }
  tunnel(other) {
    return this.active && this.type === FaceType.Simbolo &&
           other.active && other.type === FaceType.Simbolo &&
           this._symbol === other._symbol;
  }
}

function defaultFaces() {
  return {
    right: new Faccia(), left: new Faccia(), up: new Faccia(),
    down: new Faccia(), forward: new Faccia(), back: new Faccia(),
  };
}

export class Stanza {
  constructor(faces, exists = true) {
    this.faces = faces || defaultFaces();
    this.esiste = exists;
    this.events = [];
  }
  face(dir) { return this.faces[dir]; }
  rotate(axis, positive) {
    const f = this.faces;
    const swap = (a, b, c, d) => {
      const oa = f[a], ob = f[b], oc = f[c], od = f[d];
      f[a] = od; f[b] = oa; f[c] = ob; f[d] = oc;
    };
    if (axis === "x") {
      if (!positive) swap("up", "forward", "down", "back");
      else swap("up", "back", "down", "forward");
    } else if (axis === "y") {
      if (positive) swap("left", "forward", "right", "back");
      else swap("left", "back", "right", "forward");
    } else if (axis === "z") {
      if (!positive) swap("up", "left", "down", "right");
      else swap("up", "right", "down", "left");
    }
  }
}

export class PG {
  constructor() {
    this.color = "";
    this.position = [0, 0, 0];
    this.keys = 0;
    this.neededKeys = 0;
    this.totalKeys = 0;
    this.keyPositions = [];
    this.hasKey = [];
    this.exitPosition = [0, 0, 0];
    this.dead = false;
    this.end = false;
  }
  static eq(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
  grabKey() {
    if (this.keys === this.totalKeys) return false;
    for (let i = 0; i < this.totalKeys; i++) {
      if (!this.hasKey[i] && PG.eq(this.position, this.keyPositions[i])) {
        this.hasKey[i] = true; this.keys++; return true;
      }
    }
    return false;
  }
  exit() {
    this.end = this.end || (this.keys >= this.neededKeys && PG.eq(this.position, this.exitPosition));
    return this.end;
  }
}

export class MoveResult {
  constructor(before, after, nGrabbedKeys, grabbedKeys, dead, exit, path) {
    this.before = before.slice();
    this.after = after.slice();
    this.nGrabbedKeys = nGrabbedKeys;
    this.grabbedKeys = grabbedKeys;
    this.dead = dead;
    this.exit = exit;
    this.path = path ? path.map((c) => c.slice()) : [before.slice(), after.slice()];
  }
}

export class Evento {
  constructor(target, action, trigger, msg) {
    this.target = target; // {isFace, face, room}
    this.action = EventAction[action];
    this.trigger = EventTrigger[trigger];
    this.msg = msg;
  }
  run(k) {
    switch (this.action) {
      case EventAction.Attiva:
        if (this.target.isFace) this.target.face.active = true; else if (this.target.room) this.target.room.esiste = true;
        break;
      case EventAction.Disattiva:
        if (this.target.isFace) this.target.face.active = false; else if (this.target.room) this.target.room.esiste = false;
        break;
      case EventAction.Cambia:
        if (this.target.isFace) this.target.face.active = !this.target.face.active;
        else if (this.target.room) this.target.room.esiste = !this.target.room.esiste;
        break;
      case EventAction.Messaggio:
        k.hasMessage = true; k.message = this.msg; break;
      case EventAction.Gravita:
        k.gravityDirection = this.msg; break;
    }
  }
}

function parseVec(s) { return s.split(",").map((v) => parseInt(v.trim(), 10)); }

// Direzione (convenzione mano destra) della rotazione attorno all'asse.
// +1 = antioraria attorno ad +axis. Il segno dipende dall'asse: Y è invertito
// rispetto a X/Z (verificato contro la permutazione di Stanza.rotate).
export function rotationSign(axis, verse) {
  const s = axis === "y" ? 1 : -1;
  return s * (verse ? 1 : -1);
}

// ---------------------------------------------------------------- parsing XML

export function parseLevel(xmlString) {
  const doc = new globalThis.DOMParser().parseFromString(xmlString, "text/xml");
  const root = doc.documentElement;

  // xmldom restituisce "" per gli attributi assenti, il browser null: normalizziamo.
  const attr = (el, name) => {
    if (!el) return null;
    if (typeof el.hasAttribute === "function")
      return el.hasAttribute(name) ? el.getAttribute(name) : null;
    const v = el.getAttribute(name);
    return v == null || v === "" ? null : v;
  };

  const size = parseInt(attr(root, "size") || "3", 10);

  const rooms = Array.from(root.getElementsByTagName("room")).map((r) => ({
    pos: attr(r, "pos"),
    faces: Array.from(r.getElementsByTagName("face")).map((f) => ({
      pos: attr(f, "pos"),
      type: attr(f, "type"),
    })),
  }));

  const pgs = Array.from(root.getElementsByTagName("pg")).map((p) => {
    const start = p.getElementsByTagName("start")[0];
    const exit = p.getElementsByTagName("exit")[0];
    return {
      color: attr(p, "color"),
      neededKeys: attr(p, "neededKeys"),
      start: attr(start, "pos"),
      keys: Array.from(p.getElementsByTagName("key")).map((k) => attr(k, "pos")),
      exit: attr(exit, "pos"),
    };
  });

  const events = Array.from(root.getElementsByTagName("event")).map((e) => ({
    pos: attr(e, "pos"),
    target: attr(e, "target"),
    action: attr(e, "action"),
    trigger: attr(e, "trigger"),
    msg: attr(e, "msg"),
  }));

  const opt = root.getElementsByTagName("options")[0];
  const options = opt ? {
    gravity: attr(opt, "gravity"),
    rotColAxis: attr(opt, "rotColAxis"),
    rotColNeededPgs: attr(opt, "rotColNeededPgs"),
    rotColSync: attr(opt, "rotColSync"),
    rotFaceAxis: attr(opt, "rotFaceAxis"),
    rotFaceNeededPgs: attr(opt, "rotFaceNeededPgs"),
    rotFaceSync: attr(opt, "rotFaceSync"),
  } : null;

  return { size, rooms, pgs, events, options };
}

// --------------------------------------------------------------------- Kernel

export class Kernel {
  constructor(xmlOrParsed) {
    this.size = 0;
    this.stanze = null;
    this.pg = [];
    this.directions = DIRS;
    this.gravityDirection = "down";
    this.pgToRotateFace = 1;
    this.pgToRotateColumn = 1;
    this.syncFaceRotation = false;
    this.syncColumnRotation = false;
    this.canRotF = [true, true, true];
    this.canRotC = [false, true, false];
    this.hasMessage = false;
    this.message = null;

    if (typeof xmlOrParsed === "string") this.load(parseLevel(xmlOrParsed));
    else if (xmlOrParsed) this.load(xmlOrParsed);
  }

  load(parsed) {
    this.size = parsed.size || 3;
    const n = this.size;
    const dummy = new Stanza(null, false);
    this.stanze = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => new Array(n).fill(dummy)));

    for (const room of parsed.rooms) {
      const pos = parseVec(room.pos);
      const fs = defaultFaces();
      for (const f of room.faces) fs[f.pos] = new Faccia(f.type);
      this.stanze[pos[0]][pos[1]][pos[2]] = new Stanza(fs, true);
    }

    this.pg = parsed.pgs.map((pd) => {
      const p = new PG();
      p.color = pd.color;
      p.position = parseVec(pd.start);
      p.keys = 0;
      p.totalKeys = pd.keys.length;
      const nk = pd.neededKeys == null ? 0 : parseInt(pd.neededKeys, 10);
      p.neededKeys = nk === 0 ? p.totalKeys : nk;
      p.keyPositions = pd.keys.map(parseVec);
      p.hasKey = new Array(p.totalKeys).fill(false);
      p.exitPosition = parseVec(pd.exit);
      p.dead = false;
      return p;
    });

    for (const ev of parsed.events) {
      const target = this._eventTarget(ev.target);
      const evento = new Evento(target, ev.action, ev.trigger, ev.msg);
      const pos = this._eventTarget(ev.pos);
      if (!pos) continue;
      if (pos.isFace) pos.face.events.push(evento); else pos.room.events.push(evento);
    }

    const o = parsed.options;
    if (o) {
      this.gravityDirection = o.gravity != null ? o.gravity : "down";

      if (o.rotColAxis != null) {
        if (!o.rotColAxis.includes("x")) this.canRotC[0] = false;
        if (!o.rotColAxis.includes("y")) this.canRotC[1] = false;
        if (!o.rotColAxis.includes("z")) this.canRotC[2] = false;
      } else this.canRotC = [false, true, false];
      this.pgToRotateColumn = o.rotColNeededPgs != null ? parseInt(o.rotColNeededPgs, 10) : 1;
      this.syncColumnRotation = o.rotColSync != null && o.rotColSync !== "false";

      if (o.rotFaceAxis != null) {
        if (!o.rotFaceAxis.includes("x")) this.canRotF[0] = false;
        if (!o.rotFaceAxis.includes("y")) this.canRotF[1] = false;
        if (!o.rotFaceAxis.includes("z")) this.canRotF[2] = false;
      } else this.canRotF = [true, true, true];
      this.pgToRotateFace = o.rotFaceNeededPgs != null ? parseInt(o.rotFaceNeededPgs, 10) : 1;
      this.syncFaceRotation = o.rotFaceSync != null && o.rotFaceSync !== "false";
    } else {
      this.gravityDirection = "down";
      this.canRotF = [true, true, true];
      this.canRotC = [false, true, false];
      this.pgToRotateFace = 1;
      this.pgToRotateColumn = 1;
      this.syncFaceRotation = false;
      this.syncColumnRotation = false;
    }
  }

  _eventTarget(str) {
    if (str == null) return null;
    const parts = str.split(",");
    const room = this.stanza(+parts[0], +parts[1], +parts[2]);
    if (!room) return null;
    if (parts.length > 3) return { isFace: true, face: room.face(parts[3]), room: null };
    return { isFace: false, face: null, room };
  }

  stanza(x, y, z) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size || z < 0 || z >= this.size) return null;
    return this.stanze[x][y][z];
  }
  Pg(i) { return this.pg[i]; }
  PgSize() { return this.pg.length; }

  canRotateFaces(axis) {
    if (axis >= "x" && axis <= "z") return this.canRotF[axis.charCodeAt(0) - 120];
    return true;
  }
  canRotateColumns(axis) {
    if (axis >= "x" && axis <= "z") return this.canRotC[axis.charCodeAt(0) - 120];
    return true;
  }

  // ------------------------------------------------------------- rotazioni

  _swap4(rot, a, b, c, d) {
    const ga = rot[a[0]][a[1]], gb = rot[b[0]][b[1]], gc = rot[c[0]][c[1]], gd = rot[d[0]][d[1]];
    rot[a[0]][a[1]] = gd; rot[b[0]][b[1]] = ga; rot[c[0]][c[1]] = gb; rot[d[0]][d[1]] = gc;
  }

  rotateFace(axis, who, verse) {
    const n = this.size;
    const rot = Array.from({ length: n }, () => new Array(n).fill(null));
    if (axis === "x") { for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) rot[j][k] = this.stanze[who][j][k]; }
    else if (axis === "y") { for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) rot[i][k] = this.stanze[i][who][k]; }
    else if (axis === "z") { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rot[i][j] = this.stanze[i][j][who]; }

    const half = Math.ceil(n / 2), halfFloor = Math.floor(n / 2);
    if (verse) {
      for (let i = 0; i < half; i++) for (let j = 0; j < halfFloor; j++)
        this._swap4(rot, [i, j], [j, n - i - 1], [n - i - 1, n - j - 1], [n - j - 1, i]);
    } else {
      for (let i = 0; i < half; i++) for (let j = 0; j < halfFloor; j++)
        this._swap4(rot, [i, j], [n - j - 1, i], [n - i - 1, n - j - 1], [j, n - i - 1]);
    }

    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const s = rot[a][b];
      if (s) s.rotate(axis, verse);
    }

    const shift = (arr, idx) => {
      if (arr[idx[0]] !== who) return;
      const i1 = verse ? idx[1] : idx[2];
      const i2 = verse ? idx[2] : idx[1];
      const tmp = arr[i1];
      arr[i1] = arr[i2];
      arr[i2] = n - tmp - 1;
    };

    if (axis === "x") {
      for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) this.stanze[who][j][k] = rot[j][k];
      for (const p of this.pg) {
        shift(p.position, [0, 1, 2]);
        for (const kp of p.keyPositions) shift(kp, [0, 1, 2]);
        shift(p.exitPosition, [0, 1, 2]);
      }
    } else if (axis === "y") {
      for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) this.stanze[i][who][k] = rot[i][k];
      for (const p of this.pg) {
        shift(p.position, [1, 0, 2]);
        for (const kp of p.keyPositions) shift(kp, [1, 0, 2]);
        shift(p.exitPosition, [1, 0, 2]);
      }
    } else if (axis === "z") {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) this.stanze[i][j][who] = rot[i][j];
      for (const p of this.pg) {
        shift(p.position, [2, 0, 1]);
        for (const kp of p.keyPositions) shift(kp, [2, 0, 1]);
        shift(p.exitPosition, [2, 0, 1]);
      }
    }

    return this._applyGravity();
  }

  rotateColumn(axis, x, y, z, verse) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const cx = axis === "x" ? i : x, cy = axis === "y" ? i : y, cz = axis === "z" ? i : z;
      const s = this.stanze[cx][cy][cz];
      if (s) s.rotate(axis, verse);
    }
    return this._applyGravity();
  }

  _applyGravity() {
    const res = [];
    if (this.gravityDirection === "no") return res;
    for (let i = 0; i < this.pg.length; i++) {
      if (this.canMove(i, this.gravityDirection)) res.push(this.Move(i, this.gravityDirection));
      else {
        const p = this.pg[i];
        const f = this.stanze[p.position[0]][p.position[1]][p.position[2]].face(this.gravityDirection);
        if (f && f.type === FaceType.Trappola && f.active) {
          p.dead = true;
          res.push(new MoveResult(p.position, p.position, 0, [], true, false));
        }
      }
    }
    return res;
  }

  checkTunnel(x, y, z, direction) {
    if (!DIRS.includes(direction)) return false;
    const n = this.size;
    if ((x === n - 1 && direction === "right") || (x === 0 && direction === "left") ||
        (y === n - 1 && direction === "up") || (y === 0 && direction === "down") ||
        (z === n - 1 && direction === "forward") || (z === 0 && direction === "back")) return false;

    let x1 = x, y1 = y, z1 = z;
    do {
      x1 += direction === "right" ? 1 : direction === "left" ? -1 : 0;
      y1 += direction === "up" ? 1 : direction === "down" ? -1 : 0;
      z1 += direction === "forward" ? 1 : direction === "back" ? -1 : 0;
      if (x1 >= n && direction === "right") return false;
      if (x1 <= -1 && direction === "left") return false;
      if (y1 >= n && direction === "up") return false;
      if (y1 <= -1 && direction === "down") return false;
      if (z1 >= n && direction === "forward") return false;
      if (z1 <= -1 && direction === "back") return false;
    } while (this.stanze[x1][y1][z1] == null || !this.stanze[x1][y1][z1].esiste);

    return this.stanze[x][y][z].face(direction).tunnel(this.stanze[x1][y1][z1].face(OPPOSITE[direction]));
  }

  _nextRoom(pos, direction) {
    const n = this.size;
    let x = pos[0], y = pos[1], z = pos[2];
    do {
      x += direction === "right" ? 1 : direction === "left" ? -1 : 0;
      y += direction === "up" ? 1 : direction === "down" ? -1 : 0;
      z += direction === "forward" ? 1 : direction === "back" ? -1 : 0;
      if (x < 0 || x >= n || y < 0 || y >= n || z < 0 || z >= n) return null;
    } while (this.stanze[x][y][z] == null || !this.stanze[x][y][z].esiste);
    return [x, y, z];
  }

  canMove(pgID, posOrDir, maybeDir) {
    // overload come in C#: canMove(id, dir) oppure canMove(id, pos, dir)
    let pos, direction;
    if (typeof posOrDir === "string") { direction = posOrDir; pos = this.pg[pgID].position; }
    else { pos = posOrDir; direction = maybeDir; }

    if (!this.checkTunnel(pos[0], pos[1], pos[2], direction) || direction === OPPOSITE[this.gravityDirection])
      return false;

    const dest = this._nextRoom(pos, direction);
    if (!dest) return false;
    for (let p = 0; p < this.pg.length; p++) {
      if (p !== pgID && !this.pg[p].end && PG.eq(this.pg[p].position, dest)) return false;
    }
    if (direction === this.gravityDirection) return true;

    const upDir = OPPOSITE[this.gravityDirection];
    if (this.checkTunnel(pos[0], pos[1], pos[2], upDir)) {
      const above = this._nextRoom(pos, upDir);
      if (above) for (const p of this.pg) if (!p.end && PG.eq(p.position, above)) return false;
    }
    return true;
  }

  Move(pgID, direction) {
    const p = this.pg[pgID];
    const before = p.position.slice();
    const keys = [];
    let count = 0;
    const path = [before.slice()];

    while (this.canMove(pgID, p.position, direction)) {
      const here = this.stanze[p.position[0]][p.position[1]][p.position[2]];
      for (const e of here.events) if (e.trigger === EventTrigger.Esci) e.run(this);
      for (const e of here.face(direction).events)
        if (e.trigger === EventTrigger.Esci || e.trigger === EventTrigger.Attraversa) e.run(this);

      const dest = this._nextRoom(p.position, direction);
      p.position = dest.slice();
      path.push(p.position.slice());

      if (p.grabKey()) keys[count++] = p.position.slice();
      if (p.exit()) return new MoveResult(before, p.position, count, keys, false, true, path);

      const f = this.stanze[p.position[0]][p.position[1]][p.position[2]].face(this.gravityDirection);
      if (f && f.type === FaceType.Trappola && f.active) {
        p.dead = true;
        return new MoveResult(before, p.position, count, keys, true, false, path);
      }

      const droom = this.stanze[p.position[0]][p.position[1]][p.position[2]];
      for (const e of droom.events) if (e.trigger === EventTrigger.Entra) e.run(this);
      for (const e of droom.face(direction).events)
        if (e.trigger === EventTrigger.Entra || e.trigger === EventTrigger.Attraversa) e.run(this);
      if (this.gravityDirection !== "no")
        for (const e of droom.face(this.gravityDirection).events)
          if (e.trigger === EventTrigger.Caplesta) e.run(this);

      if (this.gravityDirection === "no") break;
      direction = this.gravityDirection;
    }

    return new MoveResult(before, p.position, count, keys, false, false, path);
  }
}
