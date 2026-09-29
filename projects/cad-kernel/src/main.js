// Car engine: the engine that cad-kernel (a CAD kernel written from scratch in Rust) builds, shown
// with Three.js. The first view is the display cache the native kernel wrote, and the crank turns
// with the joint solutions the native kernel computed every degree, so both are instant. "Rebuild
// on this phone" runs the kernel's WebAssembly build in a worker, checks every result file
// against the native build's digests, and from then on the crank solves the joints in the
// phone's own kernel. Automated checks drive it through window.__cadk.
import '../../../ds/ds.css';
import './app.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;
const MODEL = `${BASE}model`;
const $ = (id) => document.getElementById(id);
const state = (window.__cadk = { done: false, mode: 'native', angle: 0 });
const status = (text) => ($('status').textContent = text);

// ---- The scene ----------------------------------------------------------------------------

const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.domElement.setAttribute('aria-label', 'The engine in 3D: drag to turn it, pinch to zoom, tap a part for its name');
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const background = () => {
  scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#F6F4EE');
};
background();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', background);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(0.5, 1.0, 0.7);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(35, 1, 1, 10);
const controls = new OrbitControls(camera, renderer.domElement);

function resize() {
  const w = view.clientWidth || 1;
  const h = view.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();

// Frame a bounding sphere so it fits the narrower of the two fields of view (portrait phones).
function frame(box) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const narrow = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
  const distance = (radius / Math.sin(narrow)) * 1.05;
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.position.copy(center).add(new THREE.Vector3(0.8, 0.6, 1.0).normalize().multiplyScalar(distance));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---- The engine ---------------------------------------------------------------------------

let gltf = null;
let root = null;
const nodes = new Map();
let motion = null;

// Persistent names from the EXT_structural_metadata property table a primitive points at.
function nameTables() {
  const meta = gltf.parser.json.extensions?.EXT_structural_metadata;
  const cache = new Map();
  return async (tableIndex) => {
    if (!meta) return [];
    if (cache.has(tableIndex)) return cache.get(tableIndex);
    const prop = meta.propertyTables[tableIndex].properties.name;
    const values = new Uint8Array(await gltf.parser.getDependency('bufferView', prop.values));
    const offs = new Uint32Array(await gltf.parser.getDependency('bufferView', prop.stringOffsets));
    const dec = new TextDecoder();
    const list = [];
    for (let i = 0; i + 1 < offs.length; i++) list.push(dec.decode(values.subarray(offs[i], offs[i + 1])));
    cache.set(tableIndex, list);
    return list;
  };
}

const raycaster = new THREE.Raycaster();
let names = null;

// Raycasts see hidden objects too; a pick must not.
function shown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

// The part and face along a ray: the instance, the face's persistent name, and the hit point in
// the part's own coordinates.
async function pickRay(origin, dir) {
  raycaster.set(origin, dir.normalize());
  const hit = raycaster.intersectObject(gltf.scene, true).find((h) => h.object.isMesh && shown(h.object));
  if (!hit) return null;
  const assoc = gltf.parser.associations.get(hit.object);
  const prim = gltf.parser.json.meshes[assoc.meshes].primitives[assoc.primitives];
  const fids = prim.extensions?.EXT_mesh_features;
  const attr = hit.object.geometry.getAttribute('_feature_id_0');
  let name = null;
  if (fids && attr) name = (await names(fids.featureIds[0].propertyTable))[attr.getX(hit.face.a)];
  const p = hit.object.worldToLocal(hit.point.clone());
  return { instance: hit.object.parent.name, name, hint: [p.x, p.y, p.z].map((v) => Math.round(v * 1e4) / 1e4) };
}

// A ray in package coordinates (millimetres, z up), before the root node's unit and axis change;
// `screen` is where the hit point draws, in CSS pixels.
state.pick = async (origin, dir) => {
  const r = await pickRay(new THREE.Vector3(...origin).applyMatrix4(root.matrixWorld), new THREE.Vector3(...dir).transformDirection(root.matrixWorld));
  if (r) r.screen = toScreen(raycaster.intersectObject(gltf.scene, true).find((h) => h.object.isMesh && shown(h.object)).point);
  return r;
};

function toScreen(p) {
  const rect = renderer.domElement.getBoundingClientRect();
  const q = p.clone().project(camera);
  return [rect.left + ((q.x + 1) / 2) * rect.width, rect.top + ((1 - q.y) / 2) * rect.height];
}

// Where the engine draws, in CSS pixels (its bounding box's corners, projected), and how many
// triangles the last frame drew.
state.layout = () => {
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const xs = [];
  const ys = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const [sx, sy] = toScreen(new THREE.Vector3(x, y, z));
        xs.push(sx);
        ys.push(sy);
      }
  const center = toScreen(box.getCenter(new THREE.Vector3()));
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), center, triangles: renderer.info.render.triangles };
};

// A tap (not a drag) picks what is under the finger.
let down = null;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  down = ev.isPrimary ? { x: ev.clientX, y: ev.clientY, t: performance.now() } : null;
});
renderer.domElement.addEventListener('pointerup', async (ev) => {
  if (!down || !gltf || !ev.isPrimary) return;
  const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
  const quick = performance.now() - down.t < 600;
  down = null;
  if (moved > 8 || !quick) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const r = await pickRay(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
  state.lastPick = r;
  $('pick').textContent = r ? `${r.instance} · ${r.name ?? 'unnamed face'}` : 'Nothing there. Tap a part to see its name.';
});

// ---- The crank ----------------------------------------------------------------------------

// Placements from the native kernel's solutions, every degree through two revolutions.
function placeNative(deg) {
  const k = ((Math.round(deg) % 720) + 720) % 720;
  for (const [id, m] of Object.entries(motion.moving)) {
    const node = nodes.get(id);
    if (!node) continue;
    const t = m.t.length === 3 ? m.t : m.t.slice(3 * k, 3 * k + 3);
    const r = m.r.length === 4 ? m.r : m.r.slice(4 * k, 4 * k + 4);
    node.position.set(t[0], t[1], t[2]);
    node.quaternion.set(r[0], r[1], r[2], r[3]);
  }
}

function placeLive(placements) {
  for (const [id, p] of Object.entries(placements)) {
    const node = nodes.get(id);
    if (!node) continue;
    node.position.set(...p.translation);
    node.quaternion.set(...p.rotation);
  }
}

function showAngle(deg) {
  state.angle = deg;
  $('crank').value = String(deg);
  $('angle').textContent = `${deg}°`;
}

// Live solves go one at a time; while one runs, only the latest angle asked for waits.
let inFlight = false;
let wanted = null;
const waiters = [];

function requestAngle(deg) {
  deg = ((Math.round(deg) % 720) + 720) % 720;
  return new Promise((resolve) => {
    if (state.mode === 'native') {
      placeNative(deg);
      showAngle(deg);
      resolve({ deg, mode: 'native' });
      return;
    }
    waiters.push({ deg, resolve });
    wanted = deg;
    if (!inFlight) sendSolve();
  });
}
state.setAngle = requestAngle;
// An instance's position in package coordinates (millimetres, z up).
state.position = (id) => {
  const n = nodes.get(id);
  return n ? [n.position.x, n.position.y, n.position.z] : null;
};

function sendSolve() {
  if (wanted === null) return;
  inFlight = true;
  worker.postMessage({ type: 'solve', deg: wanted });
  wanted = null;
}

function solved(msg) {
  inFlight = false;
  placeLive(msg.placements);
  showAngle(msg.deg);
  state.lastSolve = { deg: msg.deg, residual: msg.residual, dof: msg.dof, unsatisfied: msg.unsatisfied };
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].deg === msg.deg) waiters.splice(i, 1)[0].resolve({ deg: msg.deg, mode: 'live', residual: msg.residual });
  }
  sendSolve();
}

$('crank').addEventListener('input', () => requestAngle(Number($('crank').value)));

// Play turns the crank a degree a frame; a live solve sets the pace in the phone's kernel.
let playing = false;
function tick() {
  if (!playing) return;
  if (!inFlight) requestAngle(state.angle + (state.mode === 'native' ? 2 : 1));
  requestAnimationFrame(tick);
}
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').setAttribute('aria-pressed', String(playing));
  $('play').textContent = playing ? 'Pause' : 'Play';
  if (playing) requestAnimationFrame(tick);
});

// Show inside hides the parts that close the engine up, so the crank, rods and pistons show.
const COVERS = ['block_1', 'head_1', 'valve_cover_1', 'oil_pan_1', 'intake_manifold_1'];
function setInside(on) {
  state.inside = on;
  for (const id of COVERS) {
    const n = nodes.get(id);
    if (n) n.visible = !on;
  }
  $('inside').setAttribute('aria-pressed', String(on));
}
state.setInside = setInside;
$('inside').addEventListener('click', () => setInside(!state.inside));

// ---- The kernel, on this phone --------------------------------------------------------------

let worker = null;
let ready = null;

// Start the worker and load the WebAssembly kernel in it; resolves with its name and tier.
function startKernel() {
  if (ready) return ready;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') resolve(data);
      else if (data.type === 'rebuilt') rebuilt(data);
      else if (data.type === 'solved') solved(data);
      else if (data.type === 'error') {
        inFlight = false;
        reject(new Error(data.message));
        failed(data.message);
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || 'the kernel worker failed to start'));
      failed(e.message || 'the kernel worker failed to start');
    };
  });
  worker.postMessage({ type: 'init', base: BASE });
  return ready;
}
state.kernelInfo = async () => (await startKernel()).info;

let started = 0;
let timer = 0;

function failed(message) {
  clearInterval(timer);
  state.rebuild = { error: message };
  // Back to the native solutions, so the crank keeps turning.
  state.mode = 'native';
  inFlight = false;
  wanted = null;
  while (waiters.length) {
    const w = waiters.pop();
    placeNative(w.deg);
    showAngle(w.deg);
    w.resolve({ deg: w.deg, mode: 'native' });
  }
  status(`The kernel stopped: ${message}`);
  $('rebuild').disabled = false;
  $('rebuild').textContent = 'Try again';
  worker?.terminate();
  worker = null;
  ready = null;
}

async function recipe() {
  const get = async (p) => {
    const r = await fetch(`${MODEL}/${p}`);
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r.text();
  };
  const manifest = await get('manifest.json');
  const files = { 'manifest.json': manifest };
  await Promise.all(JSON.parse(manifest).files.map(async (p) => (files[p] = await get(p))));
  return files;
}

async function rebuildHere() {
  $('rebuild').disabled = true;
  $('rebuild').textContent = 'Rebuilding…';
  status('Loading the kernel…');
  try {
    const [{ info }, files] = await Promise.all([startKernel(), recipe()]);
    state.kernel = info;
    started = performance.now();
    const tick = () => status(`Rebuilding the engine on this phone with ${info.name} ${info.version}… ${Math.round((performance.now() - started) / 1000)} s`);
    tick();
    timer = setInterval(tick, 1000);
    worker.postMessage({ type: 'rebuild', files });
  } catch (e) {
    failed(e.message);
  }
}
state.rebuildHere = rebuildHere;
$('rebuild').addEventListener('click', rebuildHere);

async function rebuilt(msg) {
  clearInterval(timer);
  const native = (await (await fetch(`${MODEL}/digests.json`)).json()).files;
  const paths = Object.keys(native);
  const same = paths.filter((p) => msg.digests[p] === native[p]).length;
  const extra = Object.keys(msg.digests).filter((p) => !(p in native)).length;
  const errors = Object.values(msg.summary).reduce((n, part) => n + part.errors.length, 0);
  state.rebuild = { ms: msg.ms, files: paths.length, same, extra, errors };
  const seconds = (msg.ms / 1000).toFixed(msg.ms < 10_000 ? 1 : 0);
  const verdict = same === paths.length && extra === 0 ? `all ${same} result files match the native build` : `${same} of ${paths.length} result files match the native build`;
  status(`Rebuilt on this phone in ${seconds} s: ${verdict}. The crank now solves the joints here.`);
  $('rebuild').textContent = 'Rebuilt here';
  state.mode = 'live';
  requestAngle(state.angle);
}

// ---- Start --------------------------------------------------------------------------------

try {
  const loader = new GLTFLoader();
  const [g, m] = await Promise.all([
    loader.loadAsync(`${MODEL}/display.glb`, (e) => {
      if (e.total) status(`Loading the engine… ${Math.round((100 * e.loaded) / e.total)}%`);
    }),
    fetch(`${MODEL}/motion.json`).then((r) => r.json()),
  ]);
  gltf = g;
  motion = m;
  names = nameTables();
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  root = gltf.scene.children[0];
  root.traverse((o) => {
    if (o !== root && o.parent === root) nodes.set(o.name, o);
  });
  frame(new THREE.Box3().setFromObject(gltf.scene));
  let triangles = 0;
  gltf.scene.traverse((o) => {
    if (o.isMesh) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3;
  });
  state.parts = nodes.size;
  state.triangles = triangles;
  status(`${nodes.size} parts, as the native kernel built them. Drag to turn it, pinch to zoom.`);
  for (const id of ['crank', 'inside', 'play', 'rebuild']) $(id).disabled = false;
} catch (e) {
  state.error = String(e?.stack || e);
  status(`The engine didn't load: ${e?.message || e}`);
}
state.done = true;
