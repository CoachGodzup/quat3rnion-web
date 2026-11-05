import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Kernel } from "./logic.js";

const body = document.body;
const hudInfo = document.getElementById("info");
const hudStatus = document.getElementById("status");
const levelSelect = document.getElementById("level");

addEventListener("error", (e) => { body.dataset.error = String(e.message || e); });
addEventListener("unhandledrejection", (e) => { body.dataset.error = String(e.reason); });

const SYMBOL_COLORS = { 1: 0xff4040, 2: 0x40d860, 3: 0x4a7cff, 4: 0xffd23a, 5: 0xd94aff };
const PG_COLORS = { red: 0xf03a3a, blue: 0x4060f0, pink: 0xf066b0, orange: 0xfa8c26, green: 0x4ad860 };
const CELL = 1.2;
const BOX = CELL * 0.55;

const FACES = [
  { dir: "right", n: [1, 0, 0] }, { dir: "left", n: [-1, 0, 0] },
  { dir: "up", n: [0, 1, 0] }, { dir: "down", n: [0, -1, 0] },
  { dir: "forward", n: [0, 0, 1] }, { dir: "back", n: [0, 0, -1] },
];
const NORMAL = Object.fromEntries(FACES.map((f) => [f.dir, new THREE.Vector3(f.n[0], f.n[1], f.n[2])]));
const MOVES = ["right", "left", "up", "down", "forward", "back"];
const HALF = ["right", "up", "forward"];

let scene, camera, renderer, controls, board, decorGroup;
let kernel = null;
let activePg = 0;
let levelPath = "00 - 3 Years Old.xml";
let levelLabel = "00 - 3 Years Old";
let manifest = [];

let raycaster, pointer, downPos = null;
let roomObjects = [];
let roomGroups = new Map();
let playerGroups = [];
let activeTween = null;
let animating = false;
const bursts = [];
let levelWon = false;
let lastTime = performance.now();
let stars = null;
let pendingRot = null;
const AXIS_IDX = { x: 0, y: 1, z: 2 };
const AXIS_VEC = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
// +1 = rotazione antioraria attorno all'asse + (regola mano destra).
// Il segno dipende dall'asse: y e' invertito rispetto a x/z.
function rotationSign(axis, verse) {
  const s = axis === "y" ? 1 : -1;
  return s * (verse ? 1 : -1);
}

const texCache = new Map();
const zAxis = new THREE.Vector3(0, 0, 1);

init();

async function init() {
  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);

    camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
    camera.position.set(6.5, 6.5, -8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(6, 12, -8);
    scene.add(dir);

    board = new THREE.Group();
    scene.add(board);
    makeStars();

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    addEventListener("resize", onResize);
    addEventListener("keydown", onKey);
    renderer.domElement.addEventListener("pointerdown", (e) => { downPos = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved <= 6) handleClick(e);
    });

    manifest = await (await fetch("levels/manifest.json")).json();
    populateLevels();

    const qp = new URLSearchParams(location.search);
    const want = qp.get("level");
    let chosen = null;
    if (want) {
      const w = want.toLowerCase();
      chosen = manifest.find((m) => m.name === want || m.path === want)
        || manifest.find((m) => m.name.toLowerCase() === w)
        || manifest.find((m) => m.name.toLowerCase().includes(w));
    }
    const first = chosen || manifest.find((m) => m.name === "00 - 3 Years Old") || manifest[0];
    if (first) { levelPath = first.path; levelLabel = first.name; }
    await loadFromPath(levelPath);

    document.querySelectorAll("#rotpan button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!kernel || kernel.PgSize() === 0) return;
        const kind = btn.dataset.kind, axis = btn.dataset.axis, verse = btn.dataset.verse === "1";
        const p = kernel.Pg(Math.min(activePg, kernel.PgSize() - 1));
        if (kind === "face") requestRotation("face", axis, p.position[AXIS_IDX[axis]], 0, 0, verse);
        else requestRotation("column", axis, p.position[0], p.position[1], p.position[2], verse);
      });
    });

    if (location.search.includes("selftest") && kernel && kernel.PgSize() > 0) {
      const before = kernel.Pg(0).position.slice();
      let dirMoved = null;
      for (const d of MOVES) if (kernel.canMove(0, d)) { kernel.Move(0, d); dirMoved = d; break; }
      build();
      body.dataset.selftest = JSON.stringify({ moved: !!dirMoved, dir: dirMoved, before, after: kernel.Pg(0).position });
    }

    if (location.search.includes("animtest") && kernel && kernel.PgSize() > 0) {
      const res = { rotateStarted: false, moveStarted: false, error: null, ticked: false };
      try {
        const p = kernel.Pg(0);
        performRotateFace("z", p.position[2], true);
        res.rotateStarted = animating;
      } catch (e) { res.error = String(e); }
      setTimeout(() => {
        try {
          const d = MOVES.find((m) => kernel.canMove(0, m));
          if (d && !animating) { performMove(d); res.moveStarted = animating; }
        } catch (e) { res.error = String(e); }
        setTimeout(() => { res.ticked = true; body.dataset.animtest = JSON.stringify(res); }, 800);
      }, 500);
    }

    if (location.search.includes("celebrate") && kernel && kernel.PgSize() > 0) {
      celebrate();
      body.dataset.celebrate = JSON.stringify({ bursts: bursts.length });
    }

    if (location.search.includes("movetest") && kernel && kernel.PgSize() > 0) {
      const res = { dir: null, ok: false, error: null };
      try {
        const d = MOVES.find((m) => kernel.canMove(0, m));
        if (d) { res.dir = d; res.ok = performMove(d); }
      } catch (e) { res.error = String((e && e.stack) || e); }
      body.dataset.movetest = JSON.stringify(res);
    }

    if (location.search.includes("previewtest") && kernel && kernel.PgSize() > 0) {
      const res = { facePreview: false, spiralPreview: false, executed: false, error: null };
      try {
        const p = kernel.Pg(0);
        requestRotation("face", "z", p.position[2], 0, 0, true);
        res.facePreview = !!(pendingRot && pendingRot.indicator);
        requestRotation("column", "y", p.position[0], p.position[1], p.position[2], false);
        res.spiralPreview = !!(pendingRot && pendingRot.kind === "column" && pendingRot.indicator);
        requestRotation("column", "y", p.position[0], p.position[1], p.position[2], false);
        res.executed = animating;
      } catch (e) { res.error = String(e && e.stack || e); }
      body.dataset.previewtest = JSON.stringify(res);
    }

    requestAnimationFrame(loop);
    body.dataset.ready = "1";
  } catch (e) {
    body.dataset.error = String((e && e.stack) || e);
    hudStatus.textContent = "Errore: " + (e && e.message);
    console.error(e);
  }
}

function populateLevels() {
  for (const l of manifest) {
    const o = document.createElement("option");
    o.value = l.path;
    o.textContent = l.name;
    levelSelect.appendChild(o);
  }
  levelSelect.addEventListener("change", () => { if (!animating) loadFromPath(levelSelect.value); });
}

async function loadFromPath(path) {
  levelWon = false;
  clearBursts();
  clearPending();
  const m = manifest.find((l) => l.path === path);
  levelPath = path;
  levelLabel = m ? m.name : path.replace(/\.xml$/, "");
  const res = await fetch(encodeURI("levels/" + path));
  kernel = new Kernel(await res.text());
  activePg = 0;
  if (levelSelect.value !== path) levelSelect.value = path;
  build();
  frameCamera();
}

// ------------------------------------------------------------------ textures

function hex(n) { return "#" + (n >>> 0).toString(16).padStart(6, "0"); }

function faceTexture(f) {
  const key = f.type === 2 ? "trap" : "s" + f.symbol;
  if (texCache.has(key)) return texCache.get(key);

  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (f.type === 2) {
    g.fillStyle = "#1a0505"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#ff2d2d"; g.lineWidth = 10; g.strokeRect(8, 8, 112, 112);
    g.fillStyle = "#ff2d2d"; g.font = "bold 96px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("T", 64, 70);
  } else {
    g.fillStyle = hex(SYMBOL_COLORS[f.symbol] || 0x888888); g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#0b0e14"; g.font = "bold 88px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(f.symbol), 64, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------- camera

function frameCamera() {
  const d = Math.max(7, kernel.size * 3.1);
  camera.position.set(d, d * 0.85, -d);
  controls.target.set(0, 0, 0);
  controls.update();
}

// -------------------------------------------------------------------- build

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

function clearBoard() {
  disposeTree(board);
  board.clear();
  roomObjects = [];
  roomGroups = new Map();
  playerGroups = [];
}

function cellPos(x, y, z) {
  const off = (kernel.size - 1) / 2;
  return new THREE.Vector3((x - off) * CELL, (y - off) * CELL, (z - off) * CELL);
}

function beam(a, b, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const geom = new THREE.CylinderGeometry(CELL * 0.09, CELL * 0.09, len, 10, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(geom, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return m;
}

function build() {
  clearBoard();
  decorGroup = new THREE.Group();
  board.add(decorGroup);

  const n = kernel.size;
  const nrm = new THREE.Vector3();

  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
    const s = kernel.stanza(x, y, z);
    if (!s || !s.esiste) continue;
    const pos = cellPos(x, y, z);

    const g = new THREE.Group();
    g.position.copy(pos);
    board.add(g);
    roomGroups.set(`${x},${y},${z}`, g);

    const geom = new THREE.BoxGeometry(BOX, BOX, BOX);
    const box = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color: 0x8899bb, transparent: true, opacity: 0.10, depthWrite: false,
    }));
    box.userData.cell = [x, y, z];
    g.add(box);
    roomObjects.push(box);

    g.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: 0x5a6a8a, transparent: true, opacity: 0.5 }),
    ));

    for (const { dir, n: nn } of FACES) {
      const f = s.face(dir);
      if (f.type === 0) continue;
      nrm.set(nn[0], nn[1], nn[2]);
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(BOX * 0.92, BOX * 0.92),
        new THREE.MeshBasicMaterial({ map: faceTexture(f), side: THREE.DoubleSide, toneMapped: false }),
      );
      quad.position.copy(nrm).multiplyScalar(BOX * 0.5 + 0.01);
      quad.quaternion.setFromUnitVectors(zAxis, nrm);
      g.add(quad);
    }
  }

  // tunnel (decor: nascosti durante le animazioni di rotazione)
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
    const s = kernel.stanza(x, y, z);
    if (!s || !s.esiste) continue;
    for (const dir of HALF) {
      if (!kernel.checkTunnel(x, y, z, dir)) continue;
      const dest = kernel._nextRoom([x, y, z], dir);
      if (!dest) continue;
      const f = s.face(dir);
      const col = SYMBOL_COLORS[f.symbol] || 0xffffff;
      const nv = NORMAL[dir];
      const a = cellPos(x, y, z).addScaledVector(nv, BOX * 0.5);
      const b = cellPos(dest[0], dest[1], dest[2]).addScaledVector(nv, -BOX * 0.5);
      decorGroup.add(beam(a, b, col));
    }
  }

  for (let i = 0; i < kernel.PgSize(); i++) {
    const p = kernel.Pg(i);
    const col = PG_COLORS[p.color] || 0xffffff;
    const spread = (i - (kernel.PgSize() - 1) / 2) * (BOX * 0.22);

    // chiavi: colore del PG che le deve prendere
    for (let k = 0; k < p.keyPositions.length; k++) {
      if (p.hasKey[k]) continue;
      const kp = p.keyPositions[k];
      const key = new THREE.Mesh(
        new THREE.SphereGeometry(BOX * 0.3, 16, 12),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: i === activePg ? 0.9 : 0.55 }),
      );
      key.position.copy(cellPos(kp[0], kp[1], kp[2]));
      key.position.x += spread;
      decorGroup.add(key);
    }

    // uscita/portale: anch'esso del colore del PG
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(BOX * 0.45, BOX * 0.09, 10, 24),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: i === activePg ? 0.9 : 0.5 }),
    );
    ring.position.copy(cellPos(p.exitPosition[0], p.exitPosition[1], p.exitPosition[2]));
    ring.position.x += spread;
    ring.rotation.x = Math.PI / 2;
    decorGroup.add(ring);
  }

  for (let i = 0; i < kernel.PgSize(); i++) {
    const p = kernel.Pg(i);
    const c = PG_COLORS[p.color] || 0xffffff;
    const isActive = i === activePg;
    const g = new THREE.Group();
    g.position.copy(cellPos(p.position[0], p.position[1], p.position[2]));
    g.userData.cell = p.position.slice();

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(BOX * 0.55, BOX * 0.55, BOX * 0.55),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: isActive ? 1.4 : 0.18 }),
    );
    g.add(cube);

    if (isActive) {
      g.add(new THREE.PointLight(c, 2.6, CELL * 5, 2));
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(BOX * 0.5, BOX * 0.06, 8, 24),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, toneMapped: false }),
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.y = -BOX * 0.38;
      g.add(halo);
    }

    board.add(g);
    playerGroups.push(g);
  }

  if (kernel.PgSize() > 0) {
    const p = kernel.Pg(Math.min(activePg, kernel.PgSize() - 1));
    const pc = PG_COLORS[p.color] || 0xffffff;
    const seen = new Set();
    for (const dir of MOVES) {
      if (!kernel.canMove(activePg, dir)) continue;
      const dest = kernel._nextRoom(p.position, dir);
      if (!dest) continue;
      const key = dest.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const hint = new THREE.Mesh(
        new THREE.TorusGeometry(BOX * 0.36, BOX * 0.06, 8, 20),
        new THREE.MeshBasicMaterial({ color: pc, transparent: true, opacity: 0.9, toneMapped: false }),
      );
      hint.position.copy(cellPos(dest[0], dest[1], dest[2])).add(new THREE.Vector3(0, BOX * 0.5 + 0.15, 0));
      hint.rotation.x = Math.PI / 2;
      decorGroup.add(hint);
    }
  }

  updateHud();
}

// ------------------------------------------------------------------ tweening

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function tween(duration, onUpdate, onDone) {
  animating = true;
  activeTween = { start: performance.now(), duration, onUpdate, onDone };
}

function stepTween(now) {
  if (!activeTween) return;
  const t = Math.min(1, (now - activeTween.start) / activeTween.duration);
  activeTween.onUpdate(easeInOut(t));
  if (t >= 1) {
    const done = activeTween.onDone;
    activeTween = null;
    animating = false;
    if (done) done();
  }
}

// -------------------------------------------------------------- particelle

function spawnBurst(origin, baseColor, count, opts = {}) {
  const speedMin = opts.speedMin ?? 1.5;
  const speedMax = opts.speedMax ?? 3.8;
  const life = opts.life ?? 2.6;
  const size = opts.size ?? 0.18;
  const gravity = opts.gravity ?? 4.5;
  const gdir = kernel ? kernel.gravityDirection : "down";
  const gvec = gdir === "up" ? [0, 1, 0] : gdir === "no" ? [0, 0, 0] : [0, -1, 0];
  const tintColor = new THREE.Color(opts.tint ?? 0xffe066);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const vels = [];
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
    dir.normalize();
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    vels.push(dir.multiplyScalar(speed));

    positions[i * 3] = origin.x;
    positions[i * 3 + 1] = origin.y;
    positions[i * 3 + 2] = origin.z;

    c.copy(baseColor).lerp(tintColor, Math.random() * 0.7);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
  });

  const points = new THREE.Points(geom, mat);
  scene.add(points);
  bursts.push({ points, vels, life: 0, maxLife: life, baseSize: size, gravity, gvec });
}

function celebrate() {
  if (!kernel) return;
  for (let i = 0; i < kernel.PgSize(); i++) {
    const p = kernel.Pg(i);
    const origin = cellPos(p.exitPosition[0], p.exitPosition[1], p.exitPosition[2]);
    spawnBurst(origin, new THREE.Color(PG_COLORS[p.color] || 0x5fe08a), 150);
  }
  spawnBurst(new THREE.Vector3(0, 0, 0), new THREE.Color(0xffe066), 220);
}

function updateBursts(dt) {
  for (let bi = bursts.length - 1; bi >= 0; bi--) {
    const b = bursts[bi];
    b.life += dt;
    const t = b.life / b.maxLife;
    if (t >= 1) {
      scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
      bursts.splice(bi, 1);
      continue;
    }
    const pos = b.points.geometry.attributes.position;
    for (let i = 0; i < b.vels.length; i++) {
      const v = b.vels[i];
      v.x += b.gvec[0] * b.gravity * dt;
      v.y += b.gvec[1] * b.gravity * dt;
      v.z += b.gvec[2] * b.gravity * dt;
      v.multiplyScalar(0.985);  // attrito
      pos.array[i * 3] += v.x * dt;
      pos.array[i * 3 + 1] += v.y * dt;
      pos.array[i * 3 + 2] += v.z * dt;
    }
    pos.needsUpdate = true;
    b.points.material.opacity = 1 - t;
    b.points.material.size = b.baseSize * (1 - t * 0.6);
  }
}

function clearBursts() {
  for (const b of bursts) {
    scene.remove(b.points);
    b.points.geometry.dispose();
    b.points.material.dispose();
  }
  bursts.length = 0;
}

// -------------------------------------------------- sfondo: stelle e gravità

function makeStars() {
  const N = 500, R = 32;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * R;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * R;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * R;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fb8ff, size: 0.14, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  stars = new THREE.Points(geom, mat);
  scene.add(stars);
}

// Le stelle scorrono in direzione OPPOSTA alla gravità (se cadiamo giù, salgono),
// così si percepisce "in che verso cade" il mondo.
function updateStars(dt) {
  if (!stars) return;
  const gd = kernel ? kernel.gravityDirection : "no";
  let vy = 0;
  const speed = 2.2;
  if (gd === "down") vy = speed;
  else if (gd === "up") vy = -speed;
  if (vy === 0) return;
  const p = stars.geometry.attributes.position;
  const R = 32;
  for (let i = 0; i < p.count; i++) {
    let y = p.array[i * 3 + 1] + vy * dt;
    if (y > R) y -= 2 * R; else if (y < -R) y += 2 * R;
    p.array[i * 3 + 1] = y;
  }
  p.needsUpdate = true;
}

// ---------------------------------------------------------- switch livelli

function switchLevel(delta) {
  if (animating || manifest.length === 0) return;
  const i = manifest.findIndex((l) => l.path === levelPath);
  const ni = ((i < 0 ? 0 : i) + delta + manifest.length) % manifest.length;
  loadFromPath(manifest[ni].path);
}

// ------------------------------------------- anteprima rotazioni (freccia/spirale)

function markPendingButtons() {
  document.querySelectorAll("#rotpan button").forEach((b) => {
    const match = pendingRot &&
      b.dataset.kind === pendingRot.kind &&
      b.dataset.axis === pendingRot.axis &&
      (b.dataset.verse === "1") === pendingRot.verse;
    b.classList.toggle("pending", !!match);
  });
}

function clearPending() {
  if (!pendingRot) return;
  if (pendingRot.indicator) {
    scene.remove(pendingRot.indicator);
    disposeTree(pendingRot.indicator);
  }
  pendingRot = null;
  markPendingButtons();
}

function requestRotation(kind, axis, a, b, c, verse) {
  if (animating) return;
  if (kind === "column" && axis !== "y") return; // solo colonne verticali (asse Y)
  const sig = `${kind}|${axis}|${a}|${b}|${c}|${verse}`;
  if (pendingRot && pendingRot.sig === sig) {
    clearPending();
    if (kind === "face") performRotateFace(axis, a, verse);
    else performRotateColumn(axis, a, b, c, verse);
    return;
  }
  clearPending();
  pendingRot = { sig, kind, axis, a, b, c, verse };
  pendingRot.indicator = kind === "face"
    ? showFaceArrow(axis, a, verse)
    : showColumnSpiral(axis, a, b, c, verse);
  scene.add(pendingRot.indicator);
  markPendingButtons();
}

function showFaceArrow(axis, who, verse) {
  const off = (kernel.size - 1) / 2;
  const g = new THREE.Group();
  const layer = (who - off) * CELL;
  g.position.set(axis === "x" ? layer : 0, axis === "y" ? layer : 0, axis === "z" ? layer : 0);
  g.quaternion.setFromUnitVectors(zAxis, AXIS_VEC[axis]);

  const R = Math.max(1.2, kernel.size * CELL * 0.34);
  const color = 0x9fe8ff;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false, depthTest: false });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.035, 8, 64), mat);
  ring.renderOrder = 999;
  g.add(ring);

  const rot = rotationSign(axis, verse); // +1 = antiorario attorno ad +axis
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 14), mat);
  cone.renderOrder = 999;
  cone.position.set(0, R, 0);
  const tangent = new THREE.Vector3(-rot, 0, 0); // in alto: ccw => -X
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  g.add(cone);

  return g;
}

function showColumnSpiral(axis, x, y, z, verse) {
  const off = (kernel.size - 1) / 2;
  const base = new THREE.Vector3((x - off) * CELL, (y - off) * CELL, (z - off) * CELL);
  const L = kernel.size * CELL;
  const r = CELL * 0.28;
  const turns = 2.5;
  const rot = rotationSign(axis, verse);
  const pts = [];
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const s = (t - 0.5) * L;
    const th = rot * t * turns * Math.PI * 2;
    let px, py, pz;
    if (axis === "x") { px = s; py = base.y + r * Math.cos(th); pz = base.z + r * Math.sin(th); }
    else if (axis === "y") { px = base.x + r * Math.cos(th); py = s; pz = base.z + r * Math.sin(th); }
    else { px = base.x + r * Math.cos(th); py = base.y + r * Math.sin(th); pz = s; }
    pts.push(new THREE.Vector3(px, py, pz));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 140, 0.035, 6, false),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, toneMapped: false, depthTest: false }),
  );
  tube.renderOrder = 999;
  const g = new THREE.Group();
  g.add(tube);
  return g;
}

// ------------------------------------------------------------------- azioni

function performMove(dir) {
  if (animating || !kernel.canMove(activePg, dir)) return false;
  clearPending();
  const i = Math.min(activePg, kernel.PgSize() - 1);
  const g = playerGroups[i];
  if (!g) return false;

  const res = kernel.Move(activePg, dir);
  const p = kernel.Pg(i);
  const color = new THREE.Color(PG_COLORS[p.color] || 0xffffff);

  // piccolo burst per ogni chiave raccolta (colore del PG)
  if (res && res.nGrabbedKeys > 0) {
    for (let k = 0; k < res.nGrabbedKeys; k++) {
      const kp = res.grabbedKeys[k];
      spawnBurst(cellPos(kp[0], kp[1], kp[2]), color, 70, {
        speedMin: 0.7, speedMax: 2.2, life: 1.1, size: 0.13, gravity: 2.8, tint: color.getHex(),
      });
    }
  }

  // percorso completo (movimento + fall attraverso la gravità)
  const path = (res && res.path && res.path.length > 1) ? res.path : [p.position];
  const pts = path.map((c) => cellPos(c[0], c[1], c[2]));
  if (pts.length < 2) { build(); return true; }

  const segLen = [];
  let total = 0;
  for (let s = 1; s < pts.length; s++) {
    const d = pts[s].distanceTo(pts[s - 1]);
    segLen.push(d);
    total += d;
  }
  if (total < 1e-6) total = 1;

  const duration = Math.min(1100, Math.max(200, (pts.length - 1) * 150));
  tween(duration, (e) => {
    let target = e * total;
    let s = 0;
    while (s < segLen.length && target > segLen[s]) { target -= segLen[s]; s++; }
    if (s >= segLen.length) { g.position.copy(pts[pts.length - 1]); return; }
    const tt = segLen[s] > 0 ? target / segLen[s] : 1;
    g.position.lerpVectors(pts[s], pts[s + 1], tt);
  }, () => build());
  return true;
}

function performRotateFace(axis, who, verse) {
  if (animating) return;
  const off = (kernel.size - 1) / 2;
  const pivot = new THREE.Group();
  pivot.position.copy(
    axis === "x" ? new THREE.Vector3((who - off) * CELL, 0, 0)
      : axis === "y" ? new THREE.Vector3(0, (who - off) * CELL, 0)
        : new THREE.Vector3(0, 0, (who - off) * CELL),
  );
  board.add(pivot);
  const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;

  for (const [key, g] of roomGroups) {
    if (Number(key.split(",")[idx]) === who) pivot.attach(g);
  }
  for (const g of playerGroups) {
    const c = g.userData.cell;
    if (c && c[idx] === who) pivot.attach(g);
  }

  decorGroup.visible = false;
  kernel.rotateFace(axis, who, verse);

  const angle = rotationSign(axis, verse) * (Math.PI / 2);
  tween(280, (e) => { pivot.rotation[axis] = angle * e; }, () => {
    disposeTree(pivot);
    board.remove(pivot);
    build();
  });
}

function performRotateColumn(axis, x, y, z, verse) {
  if (animating) return;
  const groups = [];
  for (const [key, g] of roomGroups) {
    const c = key.split(",").map(Number);
    const inCol = axis === "x" ? (c[1] === y && c[2] === z)
      : axis === "y" ? (c[0] === x && c[2] === z)
        : (c[0] === x && c[1] === y);
    if (inCol) groups.push(g);
  }

  decorGroup.visible = false;
  kernel.rotateColumn(axis, x, y, z, verse);

  const angle = rotationSign(axis, verse) * (Math.PI / 2);
  tween(280, (e) => { for (const g of groups) g.rotation[axis] = angle * e; }, () => build());
}

// -------------------------------------------------------------------- input

function handleClick(e) {
  if (animating || !kernel) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(roomObjects, false);
  if (!hits.length) return;
  const cell = hits[0].object.userData.cell;
  if (!cell) return;
  if (tryMoveToCell(cell)) {
    // l'animazione e' gia' partita dentro tryMoveToCell
  }
}

function tryMoveToCell(cell) {
  if (kernel.PgSize() === 0) return false;
  const pg = kernel.Pg(Math.min(activePg, kernel.PgSize() - 1));
  if (pg.end || pg.dead) return false;

  const options = [];
  for (const dir of MOVES) {
    if (!kernel.canMove(activePg, dir)) continue;
    const dest = kernel._nextRoom(pg.position, dir);
    if (!dest) continue;
    const dist = Math.abs(dest[0] - cell[0]) + Math.abs(dest[1] - cell[1]) + Math.abs(dest[2] - cell[2]);
    options.push({ dir, dist });
  }
  options.sort((a, b) => a.dist - b.dist);
  if (options.length === 0 || options[0].dist > 1) return false;
  return performMove(options[0].dir);
}

function onKey(e) {
  if (!kernel || kernel.PgSize() === 0) return;
  if (e.key === "Tab") { if (animating) return; clearPending(); activePg = (activePg + 1) % kernel.PgSize(); e.preventDefault(); build(); return; }
  if (e.key === "r" || e.key === "R") { if (!animating) loadFromPath(levelPath); return; }
  if (animating) return;

  const pg = Math.min(activePg, kernel.PgSize() - 1);
  const p = kernel.Pg(pg);
  const px = p.position[0], py = p.position[1], pz = p.position[2];

  switch (e.key) {
    case "w": case "W": performMove("forward"); break;
    case "s": case "S": performMove("back"); break;
    case "a": case "A": performMove("left"); break;
    case "d": case "D": performMove("right"); break;
    case "q": case "Q": performMove("up"); break;
    case "e": case "E": performMove("down"); break;
    case "1": requestRotation("face", "x", px, 0, 0, false); break;
    case "2": requestRotation("face", "x", px, 0, 0, true); break;
    case "3": requestRotation("face", "y", py, 0, 0, false); break;
    case "4": requestRotation("face", "y", py, 0, 0, true); break;
    case "5": requestRotation("face", "z", pz, 0, 0, false); break;
    case "6": requestRotation("face", "z", pz, 0, 0, true); break;
    case "9": requestRotation("column", "y", px, py, pz, false); break;
    case "0": requestRotation("column", "y", px, py, pz, true); break;
    case "[": switchLevel(-1); break;
    case "]": switchLevel(1); break;
  }
}

function updateHud() {
  if (!kernel || kernel.PgSize() === 0) return;
  const p = kernel.Pg(Math.min(activePg, kernel.PgSize() - 1));
  hudInfo.textContent =
    `Livello: ${levelLabel} · PG ${activePg} (${p.color}) · chiavi ${p.keys}/${p.neededKeys} · gravità ${kernel.gravityDirection}`;

  let won = true, dead = false;
  for (let i = 0; i < kernel.PgSize(); i++) {
    const q = kernel.Pg(i);
    if (q.dead) dead = true;
    if (!q.end) won = false;
  }
  hudStatus.textContent = dead ? "HAI PERSO — premi R" : (won ? "LIVELLO COMPLETATO!" : "");
  hudStatus.style.color = dead ? "#ff6b6b" : "#5fe08a";

  if (won && !levelWon) { levelWon = true; celebrate(); }
  else if (!won) levelWon = false;
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  stepTween(now);
  updateBursts(dt);
  updateStars(dt);
  controls.update();
  renderer.render(scene, camera);
}
