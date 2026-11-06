import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Kernel, rotationSign } from "./logic.js";
import {
  createEditorLevel, deserializeLevel, serializeLevel, levelToXml, validateLevel,
  resizeLevel, toggleRoom, setFace, setStart, setExit, toggleKey, addPg, removePg,
  roomAt, cellKey, DIRECTIONS, PG_COLORS as EDITOR_PG_COLORS,
} from "./editor.js";

const body = document.body;
const hudInfo = document.getElementById("info");
const hudStatus = document.getElementById("status");
const levelSelect = document.getElementById("level");
const btnSwitch = document.getElementById("btnSwitch");
const btnReset = document.getElementById("btnReset");
const btnEditor = document.getElementById("btnEditor");
const editorEl = document.getElementById("editor");
const editorStatus = document.getElementById("editorStatus");
const editorSize = document.getElementById("editorSize");
const editorGravity = document.getElementById("editorGravity");
const editorTools = document.getElementById("editorTools");
const editorFaceDir = document.getElementById("editorFaceDir");
const editorSymbol = document.getElementById("editorSymbol");
const editorPg = document.getElementById("editorPg");
const editorPgColor = document.getElementById("editorPgColor");
const editorAddPg = document.getElementById("editorAddPg");
const editorDelPg = document.getElementById("editorDelPg");
const editorTest = document.getElementById("editorTest");
const editorExport = document.getElementById("editorExport");
const editorNew = document.getElementById("editorNew");
const editorClose = document.getElementById("editorClose");

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
let portals = [];
let portalActive = [];
let pendingRot = null;
let activeArrow = null;
const deadAnimated = new Set();
const deathQueue = [];
let levelDimmed = false;
let switchPulseAt = 0;
let levelLoads = 0;
let endMessage = null;
let endMessageState = "";

// ------------------------------------------------ stato del level editor
const EDITOR_STORAGE = "quat3rnion.editor.v1";
let editor = null;
let editorActive = false;
let editorPlaying = false;
let editorObjects = [];
const editorTexCache = new Map();
const PG_LABELS = { red: "rosso", blue: "blu", pink: "rosa", orange: "arancio" };

const AXIS_IDX = { x: 0, y: 1, z: 2 };
const AXIS_VEC = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

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
    initEditor();

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

    btnSwitch.addEventListener("click", switchPlayer);
    btnReset.addEventListener("click", resetLevel);

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

    if (location.search.includes("uitest") && kernel && kernel.PgSize() > 0) {
      const res = { buttons: !!(btnSwitch && btnReset), before: activePg, after: null, arrow: false, arrowAbove: false, reset: false, error: null };
      try {
        const loadsBefore = levelLoads;
        btnSwitch.click();
        res.after = activePg;
        res.arrow = !!activeArrow;
        if (activeArrow) {
          const p = kernel.Pg(Math.min(activePg, kernel.PgSize() - 1));
          res.arrowAbove = activeArrow.position.y > cellPos(p.position[0], p.position[1], p.position[2]).y;
        }
        btnReset.click();
        res.reset = levelLoads > loadsBefore;
      } catch (e) { res.error = String((e && e.stack) || e); }
      body.dataset.uitest = JSON.stringify(res);
    }

    if (location.search.includes("deathtest") && kernel && kernel.PgSize() > 0) {
      const res = { started: false, shrinking: false, gone: false, burst: false, dimmed: false, error: null };
      try {
        kernel.Pg(0).dead = true;
        build();
        res.started = animating && levelDimmed;
        const g = playerGroups[0];
        // avanza il tween a mano: in headless il rAF non è affidabile
        if (activeTween) {
          stepTween(activeTween.start + 260);
          res.shrinking = !!g && g.visible && g.scale.x > 0 && g.scale.x < 1;
          stepTween(activeTween.start + 600);
        }
        res.gone = !!g && !g.visible;
        res.burst = bursts.length > 0;
        res.dimmed = levelDimmed;
        res.loseOverlay = endMessageState === "lose";
        res.loseText = endMessage ? endMessage.title.textContent : null;
      } catch (e) {
        res.error = String((e && e.stack) || e);
      }
      body.dataset.deathtest = JSON.stringify(res);
    }

    if (location.search.includes("wintest") && kernel && kernel.PgSize() > 0) {
      const res = { overlay: false, text: null, burst: 0, error: null };
      try {
        for (let i = 0; i < kernel.PgSize(); i++) kernel.Pg(i).end = true;
        build();
        res.overlay = endMessageState === "win";
        res.text = endMessage ? endMessage.title.textContent : null;
        res.burst = bursts.length;
      } catch (e) {
        res.error = String((e && e.stack) || e);
      }
      body.dataset.wintest = JSON.stringify(res);
    }

    if (location.search.includes("editortest")) {
      const res = { active: false, playing: false, xml: null, parsed: false, rooms: 0, toolPlaced: false, error: null };
      try {
        editor = createEditorLevel(3);
        syncEditorUI();
        btnEditor.click();
        res.active = editorActive;
        // Disegna una stanza e una faccia per verificare il flusso di click.
        editor.tool = "room";
        editorClick([0, 0, 0]);
        editor.tool = "symbol";
        editor.faceDir = "right";
        editor.symbol = 3;
        editorClick([0, 0, 0]);
        res.toolPlaced = !!roomAt(editor, [0, 0, 0]) && roomAt(editor, [0, 0, 0]).faces.right === "S3";
        res.xml = levelToXml(editor);
        const k = new Kernel(res.xml);
        res.parsed = k.PgSize() >= 1 && k.size === editor.size;
        res.rooms = Object.keys(editor.rooms).length;
        editorTest.click();
        res.playing = editorPlaying;
        editorTest.click();
        res.editingAgain = !editorPlaying && editorActive;
      } catch (e) {
        res.error = String((e && e.stack) || e);
      }
      body.dataset.editortest = JSON.stringify(res);
    }

    if (location.search.includes("portaltest") && kernel && kernel.PgSize() > 0) {
      const res = { portals: 0, bursts: 0, error: null };
      try {
        const p = kernel.Pg(0);
        p.keys = p.neededKeys;
        build();
        res.portals = portals.length;
        res.bursts = bursts.length;
      } catch (e) { res.error = String((e && e.stack) || e); }
      body.dataset.portaltest = JSON.stringify(res);
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
  levelSelect.addEventListener("change", () => {
    if (editorActive) { levelSelect.value = levelPath; return; }
    if (!animating) loadFromPath(levelSelect.value);
  });
}

// ------------------------------------------------------------- level editor

function initEditor() {
  editor = loadEditorState() || createEditorLevel(3);
  bindEditorUI();
  syncEditorUI();
}

function loadEditorState() {
  try {
    const raw = localStorage.getItem(EDITOR_STORAGE);
    return raw ? deserializeLevel(raw) : null;
  } catch {
    return null;
  }
}

function saveEditorState() {
  try { localStorage.setItem(EDITOR_STORAGE, serializeLevel(editor)); } catch { /* storage piena/negata */ }
}

function bindEditorUI() {
  btnEditor.addEventListener("click", () => { if (editorActive) closeEditor(); else openEditor(); });
  editorClose.addEventListener("click", closeEditor);
  editorNew.addEventListener("click", () => {
    editor = createEditorLevel(editor.size);
    saveEditorState();
    syncEditorUI();
    renderEditor();
    frameCameraFor(editor.size);
    setEditorStatus("nuovo livello");
  });

  editorSize.addEventListener("change", () => {
    resizeLevel(editor, parseInt(editorSize.value, 10));
    saveEditorState();
    syncEditorUI();
    renderEditor();
    frameCameraFor(editor.size);
    setEditorStatus("cubo " + editor.size + "×" + editor.size + "×" + editor.size);
  });
  editorGravity.addEventListener("change", () => {
    editor.gravity = editorGravity.value;
    saveEditorState();
    setEditorStatus("gravità: " + editor.gravity);
  });
  editorFaceDir.addEventListener("change", () => {
    editor.faceDir = editorFaceDir.value;
    saveEditorState();
  });
  editorSymbol.addEventListener("change", () => {
    editor.symbol = parseInt(editorSymbol.value, 10);
    saveEditorState();
  });

  editorTools.querySelectorAll("button[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editor.tool = btn.dataset.tool;
      saveEditorState();
      syncEditorUI();
    });
  });

  editorPg.addEventListener("change", () => {
    editor.activePg = parseInt(editorPg.value, 10);
    saveEditorState();
    syncEditorUI();
  });
  editorPgColor.addEventListener("change", () => {
    const pg = editor.pgs[editor.activePg];
    if (!pg) return;
    const wanted = editorPgColor.value;
    const other = editor.pgs.find((p, i) => i !== editor.activePg && p.color === wanted);
    if (other) other.color = pg.color; // scambia i colori per tenerli unici
    pg.color = wanted;
    saveEditorState();
    syncEditorUI();
    renderEditor();
  });
  editorAddPg.addEventListener("click", () => {
    const i = addPg(editor);
    if (i == null) { setEditorStatus("massimo 4 PG"); return; }
    editor.activePg = i;
    saveEditorState();
    syncEditorUI();
    renderEditor();
    setEditorStatus("PG " + (i + 1) + " aggiunto");
  });
  editorDelPg.addEventListener("click", () => {
    if (!removePg(editor, editor.activePg)) { setEditorStatus("serve almeno un PG"); return; }
    editor.activePg = Math.max(0, Math.min(editor.activePg, editor.pgs.length - 1));
    saveEditorState();
    syncEditorUI();
    renderEditor();
  });

  editorTest.addEventListener("click", toggleEditorTest);
  editorExport.addEventListener("click", exportEditorXml);
}

function setEditorStatus(msg) {
  editorStatus.textContent = msg || "";
}

function syncEditorUI() {
  if (!editor) return;
  btnEditor.textContent = editorActive ? "Chiudi editor" : "Editor livelli";
  editorEl.classList.toggle("open", editorActive);
  for (const b of editorTools.querySelectorAll("button[data-tool]")) {
    b.classList.toggle("active", b.dataset.tool === editor.tool);
  }
  editorSize.value = String(editor.size);
  editorGravity.value = editor.gravity || "down";
  editorFaceDir.value = editor.faceDir;
  editorSymbol.value = String(editor.symbol);
  editorPg.replaceChildren();
  editor.pgs.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${i + 1} · ${PG_LABELS[p.color] || p.color}`;
    editorPg.appendChild(o);
  });
  editor.activePg = Math.max(0, Math.min(editor.activePg, editor.pgs.length - 1));
  editorPg.value = String(editor.activePg);
  editorPgColor.value = editor.pgs[editor.activePg].color;
  editorTest.textContent = editorPlaying ? "Modifica" : "Prova";
  editorDelPg.disabled = editor.pgs.length <= 1;
  editorAddPg.disabled = editor.pgs.length >= EDITOR_PG_COLORS.length;
}

function openEditor() {
  if (editorActive) return;
  editorActive = true;
  editorPlaying = false;
  body.classList.add("editing");
  levelSelect.disabled = true;
  clearPending();
  clearBursts();
  resetDeathFx();
  portalActive = [];
  levelWon = false;
  saveEditorState();
  syncEditorUI();
  renderEditor();
  frameCameraFor(editor.size);
  setEditorStatus("scegli uno strumento e clicca le celle");
}

function closeEditor() {
  if (!editorActive) return;
  editorActive = false;
  editorPlaying = false;
  body.classList.remove("editing");
  editorEl.classList.remove("open");
  levelSelect.disabled = false;
  syncEditorUI();
  setEditorStatus("");
  loadFromPath(levelPath);
}

function toggleEditorTest() {
  if (!editorActive) return;
  if (editorPlaying) {
    editorPlaying = false;
    levelWon = false;
    clearPending();
    clearBursts();
    resetDeathFx();
    renderEditor();
    frameCameraFor(editor.size);
    syncEditorUI();
    setEditorStatus("torna a modificare");
    return;
  }
  const v = validateLevel(editor);
  if (!v.ok) {
    setEditorStatus(v.errors[0]);
    hudStatus.textContent = v.errors[0];
    hudStatus.style.color = "#ff6b6b";
    return;
  }
  const xml = levelToXml(editor);
  try {
    kernel = new Kernel(xml);
  } catch (e) {
    setEditorStatus("XML non valido: " + (e && e.message));
    return;
  }
  editorPlaying = true;
  levelLabel = "Livello editor";
  activePg = Math.min(editor.activePg, kernel.PgSize() - 1);
  clearPending();
  clearBursts();
  resetDeathFx();
  portalActive = [];
  levelWon = false;
  build();
  frameCameraFor(kernel.size);
  syncEditorUI();
  setEditorStatus("prova in corso · clicca Modifica per tornare");
}

function exportEditorXml() {
  const v = validateLevel(editor);
  if (!v.ok) { setEditorStatus(v.errors[0]); return; }
  const xml = levelToXml(editor);
  const blob = new Blob([xml], { type: "application/xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "livello-personalizzato.xml";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setEditorStatus("XML esportato");
}

function editorClick(cell) {
  if (!editorActive || editorPlaying) return;
  const pos = cell.slice();
  let msg = "";
  switch (editor.tool) {
    case "room":
      msg = roomAt(editor, pos) ? "stanza rimossa" : "stanza aggiunta";
      toggleRoom(editor, pos);
      break;
    case "symbol":
      setFace(editor, pos, editor.faceDir, "S" + editor.symbol);
      msg = `S${editor.symbol} su ${editor.faceDir}`;
      break;
    case "trap":
      setFace(editor, pos, editor.faceDir, "T1");
      msg = "trappola su " + editor.faceDir;
      break;
    case "erase":
      setFace(editor, pos, editor.faceDir, null);
      msg = "faccia rimossa";
      break;
    case "key":
      toggleKey(editor, editor.activePg, pos);
      msg = "chiave per PG " + (editor.activePg + 1);
      break;
    case "start":
      setStart(editor, editor.activePg, pos);
      msg = "partenza PG " + (editor.activePg + 1);
      break;
    case "exit":
      setExit(editor, editor.activePg, pos);
      msg = "uscita PG " + (editor.activePg + 1);
      break;
  }
  saveEditorState();
  renderEditor();
  setEditorStatus(msg);
}

function editorFaceTexture(code) {
  const trap = code[0] === "T";
  const symbol = trap ? 1 : parseInt(code.slice(1), 10) || 1;
  const key = trap ? "trap" : "s" + symbol;
  if (editorTexCache.has(key)) return editorTexCache.get(key);
  const t = faceTexture({ type: trap ? 2 : 1, symbol });
  editorTexCache.set(key, t);
  return t;
}

function renderEditor() {
  clearBoard();
  decorGroup = new THREE.Group();
  board.add(decorGroup);
  activeArrow = null;
  editorObjects = [];

  const n = editor.size;
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
    const key = cellKey(x, y, z);
    const room = editor.rooms[key];
    const pos = cellPos(x, y, z, n);
    const g = new THREE.Group();
    g.position.copy(pos);
    board.add(g);

    const geom = new THREE.BoxGeometry(BOX, BOX, BOX);
    const box = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color: room ? 0x7d9bd9 : 0x33415c,
      transparent: true,
      opacity: room ? 0.18 : 0.045,
      depthWrite: false,
    }));
    box.userData.cell = [x, y, z];
    g.add(box);
    editorObjects.push(box);

    g.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: room ? 0x9fc2ff : 0x344563, transparent: true, opacity: room ? 0.8 : 0.32 }),
    ));

    if (!room) continue;
    for (const dir of DIRECTIONS) {
      const code = room.faces && room.faces[dir];
      if (!code) continue;
      const nv = NORMAL[dir];
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(BOX * 0.92, BOX * 0.92),
        new THREE.MeshBasicMaterial({ map: editorFaceTexture(code), side: THREE.DoubleSide, toneMapped: false }),
      );
      quad.position.copy(nv).multiplyScalar(BOX * 0.5 + 0.01);
      quad.quaternion.setFromUnitVectors(zAxis, nv);
      g.add(quad);
    }
  }

  for (const [i, pg] of editor.pgs.entries()) {
    const col = PG_COLORS[pg.color] || 0xffffff;
    const isActive = i === editor.activePg;
    for (const k of pg.keys) {
      const key = new THREE.Mesh(
        new THREE.SphereGeometry(BOX * 0.2, 14, 10),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: isActive ? 0.95 : 0.55 }),
      );
      key.position.copy(cellPos(k[0], k[1], k[2], n)).add(new THREE.Vector3(0, isActive ? 0.16 : -0.16, 0));
      decorGroup.add(key);
    }
    if (pg.start) {
      const start = new THREE.Mesh(
        new THREE.ConeGeometry(BOX * 0.22, BOX * 0.42, 12),
        new THREE.MeshBasicMaterial({ color: col, toneMapped: false }),
      );
      start.rotation.z = Math.PI;
      start.position.copy(cellPos(pg.start[0], pg.start[1], pg.start[2], n)).add(new THREE.Vector3(0, BOX * 0.34, 0));
      decorGroup.add(start);
      if (isActive) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(BOX * 0.42, BOX * 0.045, 8, 28),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, toneMapped: false }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(cellPos(pg.start[0], pg.start[1], pg.start[2], n));
        decorGroup.add(ring);
      }
    }
    if (pg.exit) {
      const exit = new THREE.Mesh(
        new THREE.TorusGeometry(BOX * 0.3, BOX * 0.055, 8, 28),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, toneMapped: false }),
      );
      exit.rotation.x = Math.PI / 2;
      exit.position.copy(cellPos(pg.exit[0], pg.exit[1], pg.exit[2], n)).add(new THREE.Vector3(0, -BOX * 0.2, 0));
      decorGroup.add(exit);
    }
  }

  updateEditorHud();
}

function updateEditorHud() {
  const pg = editor.pgs[editor.activePg];
  hudInfo.textContent =
    `Editor · cubo ${editor.size}³ · ${Object.keys(editor.rooms).length} stanze · ` +
    `PG ${editor.activePg + 1}/${editor.pgs.length} (${pg ? pg.color : "?"})`;
  hudStatus.textContent = "";
}

async function loadFromPath(path) {
  levelLoads++;
  levelWon = false;
  clearBursts();
  clearPending();
  resetDeathFx();
  portalActive = [];
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
  frameCameraFor(kernel ? kernel.size : editor.size);
}

function frameCameraFor(size) {
  const d = Math.max(7, size * 3.1);
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
  portals = [];
  editorObjects = [];
}

function cellPos(x, y, z, size = kernel ? kernel.size : (editor ? editor.size : 3)) {
  const off = (size - 1) / 2;
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

function makePortal(col) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(BOX * 0.26, 16, 12),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, toneMapped: false }),
  );
  g.add(core);
  for (const ry of [0, Math.PI / 2]) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(BOX * 0.45, BOX * 0.055, 10, 32),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.3 }),
    );
    hoop.rotation.y = ry;
    g.add(hoop);
  }
  g.add(new THREE.PointLight(col, 1.8, CELL * 3, 2));
  return g;
}

// Freccia sopra il Cub1X attivo: indicatore sempre visibile, "pulsa" al cambio.
function makeActiveArrow(col) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: col, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false,
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(BOX * 0.24, BOX * 0.46, 14), mat);
  cone.rotation.z = Math.PI;
  cone.renderOrder = 999;
  g.add(cone);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(BOX * 0.5, BOX * 0.04, 8, 28), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = BOX * 0.32;
  ring.renderOrder = 999;
  g.add(ring);
  return g;
}

function build() {
  clearBoard();
  decorGroup = new THREE.Group();
  board.add(decorGroup);
  activeArrow = null;

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

    // portale: appare SOLO quando il PG ha tutte le chiavi, con burst iniziale
    const portalOn = p.keys >= p.neededKeys && !p.end;
    if (portalOn) {
      const exitPos = cellPos(p.exitPosition[0], p.exitPosition[1], p.exitPosition[2]);
      exitPos.x += spread;
      const portal = makePortal(col);
      portal.position.copy(exitPos);
      decorGroup.add(portal);
      portals.push(portal);
      if (!portalActive[i]) {
        spawnBurst(exitPos, new THREE.Color(col), 120, {
          speedMin: 0.8, speedMax: 2.8, life: 1.6, size: 0.16, gravity: 1.5, tint: col,
        });
      }
      portalActive[i] = true;
    } else {
      portalActive[i] = false;
    }
  }

  const dying = [];
  for (let i = 0; i < kernel.PgSize(); i++) {
    const p = kernel.Pg(i);
    const c = PG_COLORS[p.color] || 0xffffff;
    const isActive = i === activePg;
    const g = new THREE.Group();
    g.position.copy(cellPos(p.position[0], p.position[1], p.position[2]));
    g.userData.cell = p.position.slice();

    // già dissolto in un build precedente: mantieni l'indice ma niente mesh
    if (p.dead && deadAnimated.has(i)) {
      g.visible = false;
      g.scale.setScalar(0);
      board.add(g);
      playerGroups.push(g);
      continue;
    }

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
    if (p.dead) dying.push(i);
  }

  // Un Cub1X appena morto si rimpicciolisce fino a sparire, poi esplode
  // nel suo colore; il livello resta desaturato/scurito fino al reset.
  for (const i of dying) {
    deadAnimated.add(i);
    queueDeathFx(i);
  }

  if (kernel.PgSize() > 0 && !kernel.Pg(Math.min(activePg, kernel.PgSize() - 1)).dead) {
    const p = kernel.Pg(Math.min(activePg, kernel.PgSize() - 1));
    const pc = PG_COLORS[p.color] || 0xffffff;

    // Indicatore del giocatore attivo: freccia sopra la sua casella.
    activeArrow = makeActiveArrow(pc);
    activeArrow.position.copy(cellPos(p.position[0], p.position[1], p.position[2]))
      .add(new THREE.Vector3(0, BOX * 0.85, 0));
    activeArrow.userData.baseY = activeArrow.position.y;
    decorGroup.add(activeArrow);

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
  showEndMessage("win");
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

// ------------------------------------------------------------ morte di un Cub1X

// ------------------------------------------------------- messaggio a tutto schermo

function ensureEndMessage() {
  if (endMessage) return endMessage;
  const wrap = document.createElement("div");
  wrap.id = "bigmsg";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "assertive");
  Object.assign(wrap.style, {
    position: "fixed", inset: "0", zIndex: "40", display: "flex",
    flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: "2vmin", pointerEvents: "none", textAlign: "center",
    opacity: "0", transform: "scale(0.65)",
    transition: "opacity 320ms ease, transform 520ms cubic-bezier(.2,1.5,.4,1)",
    userSelect: "none", padding: "4vmin", boxSizing: "border-box",
  });
  const title = document.createElement("div");
  Object.assign(title.style, {
    fontWeight: "900", lineHeight: "0.9", letterSpacing: "0.035em",
    fontSize: "clamp(56px, 15vw, 210px)", whiteSpace: "nowrap",
  });
  const sub = document.createElement("div");
  Object.assign(sub.style, {
    fontWeight: "700", letterSpacing: "0.12em", textTransform: "uppercase",
    fontSize: "clamp(13px, 2.1vw, 26px)", opacity: "0.9",
  });
  wrap.append(title, sub);
  document.body.appendChild(wrap);
  endMessage = { wrap, title, sub };
  return endMessage;
}

function showEndMessage(kind) {
  if (endMessageState === kind) return;
  endMessageState = kind;
  const win = kind === "win";
  const { wrap, title, sub } = ensureEndMessage();

  title.textContent = win ? "YOU WIN" : "YOU LOSE";
  sub.textContent = win ? "Livello completato" : "Premi R per ricominciare";
  title.style.color = win ? "#5fe08a" : "#ff6b6b";
  sub.style.color = win ? "#c8f7db" : "#ffc9c9";
  title.style.textShadow = win
    ? "0 0 18px #5fe08ab0, 0 0 70px #5fe08a55, 0 8px 40px #000"
    : "0 0 18px #ff6b6bb0, 0 0 70px #ff6b6b55, 0 8px 40px #000";
  wrap.style.background = win
    ? "radial-gradient(circle at center, rgba(95,224,138,.16), rgba(11,14,20,.55) 72%)"
    : "radial-gradient(circle at center, rgba(255,70,70,.16), rgba(11,14,20,.62) 72%)";

  // riavvia l'entrata (scala + dissolvenza)
  wrap.style.transition = "none";
  wrap.style.opacity = "0";
  wrap.style.transform = "scale(0.65)";
  void wrap.offsetWidth;
  wrap.style.transition = "opacity 320ms ease, transform 520ms cubic-bezier(.2,1.5,.4,1)";
  wrap.style.opacity = "1";
  wrap.style.transform = "scale(1)";
}

function clearEndMessage() {
  endMessageState = "";
  if (!endMessage) return;
  endMessage.wrap.style.opacity = "0";
  endMessage.wrap.style.transform = "scale(0.85)";
}

function setLevelDim(on) {
  if (!renderer) return;
  levelDimmed = on;
  const canvas = renderer.domElement;
  canvas.style.transition = "filter 650ms ease";
  canvas.style.filter = on ? "saturate(0.2) brightness(0.55)" : "none";
}

function resetDeathFx() {
  deadAnimated.clear();
  deathQueue.length = 0;
  setLevelDim(false);
  clearEndMessage();
}

function queueDeathFx(i) {
  deathQueue.push(i);
  if (deathQueue.length === 1) runDeathFx();
}

function runDeathFx() {
  const i = deathQueue[0];
  const g = playerGroups[i];
  const p = kernel ? kernel.Pg(i) : null;
  if (!g || !p) { deathQueue.shift(); if (deathQueue.length) runDeathFx(); return; }

  const color = new THREE.Color(PG_COLORS[p.color] || 0xffffff);
  const origin = g.position.clone();

  // il livello si spegne mentre il Cub1X si restringe
  setLevelDim(true);
  tween(520, (e) => {
    g.scale.setScalar(Math.max(0, 1 - e));
  }, () => {
    board.remove(g);
    disposeTree(g);
    g.visible = false;
    // scomparso: esplode con il colore del PG
    spawnBurst(origin, color, 170, {
      speedMin: 1.1, speedMax: 3.2, life: 1.9, size: 0.16, gravity: 2.4, tint: color.getHex(),
    });
    showEndMessage("lose");
    deathQueue.shift();
    if (deathQueue.length) runDeathFx();
  });
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
  if (editorActive || animating || manifest.length === 0) return;
  const i = manifest.findIndex((l) => l.path === levelPath);
  const ni = ((i < 0 ? 0 : i) + delta + manifest.length) % manifest.length;
  loadFromPath(manifest[ni].path);
}

function switchPlayer() {
  if ((editorActive && !editorPlaying) || animating || !kernel || kernel.PgSize() === 0) return;
  clearPending();
  activePg = (activePg + 1) % kernel.PgSize();
  switchPulseAt = performance.now();
  build();
}

function resetLevel() {
  if (editorPlaying) { toggleEditorTest(); toggleEditorTest(); return; }
  if (editorActive || animating || !kernel) return;
  loadFromPath(levelPath);
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
  if (editorActive && !editorPlaying) {
    if (animating) return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(editorObjects, false);
    if (!hits.length) return;
    const cell = hits[0].object.userData.cell;
    if (cell) editorClick(cell);
    return;
  }

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
  if (editorActive && !editorPlaying) {
    if (e.key === "Escape") closeEditor();
    return;
  }
  if (!kernel || kernel.PgSize() === 0) return;
  if (e.key === "Tab") { e.preventDefault(); switchPlayer(); return; }
  if (e.key === "r" || e.key === "R") { resetLevel(); return; }
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
    `Livello: ${levelLabel} · PG ${activePg + 1}/${kernel.PgSize()} (${p.color}) · chiavi ${p.keys}/${p.neededKeys} · gravità ${kernel.gravityDirection}`;

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
  for (const g of portals) g.rotation.y += dt * 1.2;
  if (activeArrow) {
    const pulse = Math.max(0, 1 - (now - switchPulseAt) / 650);
    activeArrow.position.y = activeArrow.userData.baseY + Math.sin(now * 0.004) * 0.045 + pulse * 0.18;
    activeArrow.scale.setScalar(1 + Math.sin(now * 0.004) * 0.04 + pulse * 0.35);
    activeArrow.rotation.y += dt * 1.1;
  }
  controls.update();
  renderer.render(scene, camera);
}
