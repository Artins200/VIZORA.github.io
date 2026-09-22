/**
 * BlockWorld — original voxel sandbox (Electron + Three.js)
 * Not affiliated with Minecraft, Mojang, or Microsoft.
 */

import * as THREE from 'three';
import { World, SEA_LEVEL } from './world.js';
import { Player } from './player.js';
import { HOTBAR, BLOCKS, makeIcon } from './blocks.js';

// ── DOM ──────────────────────────────────────────────
const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const loadFill = document.getElementById('load-fill');
const loadText = document.getElementById('load-text');
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const fpsEl = document.getElementById('fps');
const coordsEl = document.getElementById('coords');
const chunkInfoEl = document.getElementById('chunk-info');
const hotbarEl = document.getElementById('hotbar');
const btnResume = document.getElementById('btn-resume');
const btnNew = document.getElementById('btn-new');
const optRender = document.getElementById('opt-render');
const optRenderVal = document.getElementById('opt-render-val');
const optSens = document.getElementById('opt-sens');
const optSensVal = document.getElementById('opt-sens-val');
const optShadows = document.getElementById('opt-shadows');
const optFog = document.getElementById('opt-fog');

// ── Renderer ─────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,          // big perf win for voxels
  powerPreference: 'high-performance',
  stencil: false,
  depth: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false; // optional soft feel via lighting only

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e0);

// Fog doubles as soft LOD / distance fade (cheap)
let fogEnabled = true;
const fogColor = new THREE.Color(0x87b8e0);
scene.fog = new THREE.Fog(fogColor, 40, 120);

// ── Camera ───────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 256);
camera.rotation.order = 'YXZ';

// ── Lights ───────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0xb1d0ff, 0x3d5c3a, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d4, 0.95);
sun.position.set(40, 80, 20);
scene.add(sun);
scene.add(sun.target);

// ambient fill
scene.add(new THREE.AmbientLight(0x8899aa, 0.25));

// ── World / Player ───────────────────────────────────
let world = new World(scene, THREE, { renderDistance: 8 });
let player = null;
let selectedSlot = 0;
let paused = true;
let debugVisible = true;
let breakCooldown = 0;
let placeCooldown = 0;
let mouseLeft = false;
let mouseRight = false;

// Highlight box for targeted block
const highlightGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
const highlightMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  wireframe: true,
  transparent: true,
  opacity: 0.45,
  depthTest: true,
});
const highlight = new THREE.Mesh(highlightGeo, highlightMat);
highlight.visible = false;
scene.add(highlight);

// ── Hotbar UI ────────────────────────────────────────
function buildHotbar() {
  hotbarEl.innerHTML = '';
  HOTBAR.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === selectedSlot ? ' active' : '');
    slot.dataset.index = i;
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = String(i + 1);
    slot.appendChild(key);
    const icon = makeIcon(id);
    if (icon) {
      icon.style.width = '36px';
      icon.style.height = '36px';
      icon.style.imageRendering = 'pixelated';
      slot.appendChild(icon);
    }
    hotbarEl.appendChild(slot);
  });
}

function setSlot(i) {
  selectedSlot = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
  [...hotbarEl.children].forEach((el, idx) => {
    el.classList.toggle('active', idx === selectedSlot);
  });
}

// ── Settings ─────────────────────────────────────────
function applySettings() {
  const rd = +optRender.value;
  optRenderVal.textContent = rd;
  world.setRenderDistance(rd);
  const fogFar = rd * 16 * 0.95;
  if (fogEnabled) {
    scene.fog.near = fogFar * 0.45;
    scene.fog.far = fogFar;
  }
  camera.far = Math.max(160, rd * 16 + 32);
  camera.updateProjectionMatrix();

  const sens = +optSens.value / 10;
  optSensVal.textContent = sens.toFixed(1);
  player.sensitivity = 0.0008 * (+optSens.value);

  // "shadows" toggle → stronger directional contrast
  sun.intensity = optShadows.checked ? 0.95 : 0.65;
  hemi.intensity = optShadows.checked ? 0.55 : 0.75;
}

optRender.addEventListener('input', applySettings);
optSens.addEventListener('input', applySettings);
optShadows.addEventListener('change', applySettings);
optFog.addEventListener('change', () => {
  fogEnabled = optFog.checked;
  scene.fog = fogEnabled ? new THREE.Fog(fogColor, 40, 120) : null;
  applySettings();
});

// ── Pointer lock / menu ──────────────────────────────
function lockPointer() {
  canvas.requestPointerLock();
}

function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  player.lookLocked = locked;
  if (locked) {
    paused = false;
    menu.classList.add('hidden');
    hud.classList.remove('hidden');
  } else {
    paused = true;
    menu.classList.remove('hidden');
  }
});

btnResume.addEventListener('click', () => {
  lockPointer();
});

btnNew.addEventListener('click', async () => {
  menu.classList.add('hidden');
  loading.classList.remove('hidden');
  hud.classList.add('hidden');
  await startNewWorld();
  lockPointer();
});

canvas.addEventListener('click', () => {
  if (paused) lockPointer();
});

// ── Input ────────────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  if (!player.lookLocked) return;
  player.onMouseMove(e.movementX, e.movementY);
});

document.addEventListener('mousedown', (e) => {
  if (paused) return;
  if (e.button === 0) mouseLeft = true;
  if (e.button === 2) mouseRight = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseLeft = false;
  if (e.button === 2) mouseRight = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (player) player.setKey(e.code, true);

  if (e.code === 'Escape') {
    if (document.pointerLockElement) unlockPointer();
    return;
  }
  if (paused) return;

  if (e.code === 'F3') {
    debugVisible = !debugVisible;
    document.getElementById('info').style.display = debugVisible ? 'flex' : 'none';
  }
  if (e.code === 'KeyF' && !e.repeat) {
    player.flying = !player.flying;
  }
  // hotbar 1-9
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= HOTBAR.length) setSlot(n - 1);
  }
});

document.addEventListener('keyup', (e) => {
  if (player) player.setKey(e.code, false);
});

document.addEventListener('wheel', (e) => {
  if (paused) return;
  if (e.deltaY > 0) setSlot(selectedSlot + 1);
  else setSlot(selectedSlot - 1);
});

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
});

// ── Block interact ───────────────────────────────────
function tryBreak() {
  if (breakCooldown > 0) return;
  const dir = player.getLookDir();
  const hit = world.raycast(player.eyeX, player.eyeY, player.eyeZ, dir.x, dir.y, dir.z, 6);
  if (!hit) return;
  // Don't break bottom layer
  if (hit.y <= 0) return;
  world.setBlock(hit.x, hit.y, hit.z, 0);
  breakCooldown = 0.18;
}

function tryPlace() {
  if (placeCooldown > 0) return;
  const dir = player.getLookDir();
  const hit = world.raycast(player.eyeX, player.eyeY, player.eyeZ, dir.x, dir.y, dir.z, 6);
  if (!hit) return;
  const px = hit.x + hit.nx;
  const py = hit.y + hit.ny;
  const pz = hit.z + hit.nz;
  if (py < 0 || py >= 96) return;
  // Don't place inside player
  const box = player.aabb();
  if (
    px + 1 > box.minX && px < box.maxX &&
    py + 1 > box.minY && py < box.maxY &&
    pz + 1 > box.minZ && pz < box.maxZ
  ) return;

  const id = HOTBAR[selectedSlot];
  world.setBlock(px, py, pz, id);
  placeCooldown = 0.18;
}

function updateHighlight() {
  const dir = player.getLookDir();
  const hit = world.raycast(player.eyeX, player.eyeY, player.eyeZ, dir.x, dir.y, dir.z, 6);
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else {
    highlight.visible = false;
  }
}

// ── Boot ─────────────────────────────────────────────
async function startNewWorld(seed) {
  loadText.textContent = 'Генерация ландшафта…';
  loadFill.style.width = '5%';

  world.reset(seed);
  // Reuse player instance so input bindings stay single
  if (!player) player = new Player(camera, world);
  else {
    player.world = world;
    player.flying = false;
    player.yaw = 0;
    player.pitch = 0;
  }
  applySettings();

  // Temporary spawn, then find real one after some chunks
  player.setPosition(0.5, SEA_LEVEL + 30, 0.5);

  await world.preload(0, 0, 3, (p) => {
    loadFill.style.width = (p * 70) + '%';
    loadText.textContent = p < 0.5 ? 'Генерация чанков…' : 'Построение мешей…';
  });

  const spawn = world.findSpawn();
  player.setPosition(spawn.x, spawn.y, spawn.z);

  loadFill.style.width = '100%';
  loadText.textContent = 'Готово!';
  await new Promise((r) => setTimeout(r, 200));
  loading.classList.add('hidden');
  hud.classList.remove('hidden');
  menu.classList.remove('hidden');
  paused = true;
}

async function boot() {
  buildHotbar();
  applySettings();
  loadText.textContent = 'Инициализация…';
  loadFill.style.width = '10%';
  await startNewWorld();
}

// ── Main loop ────────────────────────────────────────
let last = performance.now();
let frames = 0;
let fpsT = 0;
let fps = 60;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;
  fpsT += dt;
  if (fpsT >= 0.5) {
    fps = Math.round(frames / fpsT);
    frames = 0;
    fpsT = 0;
    fpsEl.textContent = fps + ' FPS';
  }

  if (!paused) {
    player.update(dt);
    world.update(player.x, player.z);

    if (breakCooldown > 0) breakCooldown -= dt;
    if (placeCooldown > 0) placeCooldown -= dt;
    if (mouseLeft) tryBreak();
    if (mouseRight) tryPlace();

    updateHighlight();

    // sun follows-ish for nicer shading without shadows
    sun.position.set(player.x + 60, 100, player.z + 30);
    sun.target.position.set(player.x, 0, player.z);
    sun.target.updateMatrixWorld();

    coordsEl.textContent =
      `${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}` +
      (player.flying ? ' ✈' : '');
    chunkInfoEl.textContent = `chunks: ${world.chunkCount}  seed: ${world.seed}`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

boot().then(() => requestAnimationFrame(frame));
