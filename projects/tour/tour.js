// TOUR: a to-scale 3D model of a cryogenic air separation unit, with a 12-stage guided tour.
//
// The plant is model.json (written by tools/export_model.py from tools/asu_scene.py): meters, Y up,
// X along the plant, Z toward the viewer. This file draws it and steps through it.
//
// The header and the controls sit over the canvas. camera.setViewOffset() moves the picture's
// centre into the gap between them, and fit() sizes every shot to that gap, so on a phone the
// subject never hides under the bars.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const token = (name) => getComputedStyle(root).getPropertyValue(name).trim();
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ui = {
  canvas: $('view'), labels: $('labels'), top: $('top'), bottom: $('bottom'), info: $('info'),
  views: $('views'), layersBtn: $('layersBtn'), layers: $('layers'), idle: $('idle'), tourBtn: $('tourBtn'),
  tour: $('tour'), title: $('tTitle'), count: $('tCount'), text: $('tText'), dots: $('tDots'),
  back: $('tBack'), next: $('tNext'), exit: $('tExit'),
};

// Without WebGL, three.js logs an error and throws. Check quietly first and say so on the page.
function unavailable(message) {
  ui.info.textContent = message;
  ui.info.hidden = false;
  ui.idle.hidden = true;
  ui.views.hidden = true;
  ui.layersBtn.hidden = true;
  root.dataset.state = 'unavailable';
}

const probe = document.createElement('canvas');
if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) {
  unavailable('This page needs WebGL, and this browser has it turned off.');
} else {
  let model = null;
  try {
    const res = await fetch('model.json');
    if (res.ok) model = await res.json();
  } catch {
    // Offline, or a damaged file: the message below covers both.
  }
  if (model) start(model);
  else unavailable('The plant model did not load. Check the connection, then reload.');
}

function start(MODEL) {
  // ---------- renderer, scene, camera ----------
  const canvas = ui.canvas;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above the ground
  controls.minDistance = 4;
  controls.maxDistance = 1500;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9cfbf, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-10, 150, 60); // key light from the front left, so shadows fall toward the viewer
  sun.target.position.set(82, 16, -7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 90, bottom: -90, near: 10, far: 500 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // ---------- materials and bookkeeping ----------
  const PAL = MODEL.colors;
  const color = (hex) => new THREE.Color(hex);
  const std = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: color(hex), roughness: 0.9, metalness: 0, ...extra });
  const edgeMat = () => new THREE.LineBasicMaterial({ color: color(PAL.edge), transparent: true, opacity: 0.55 });
  const dashEdge = (hex) => new THREE.LineDashedMaterial({ color: color(hex), dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.8 });

  const groups = { eq: new THREE.Group(), pipes: new THREE.Group(), boxes: new THREE.Group(), grid: new THREE.Group() };
  Object.values(groups).forEach((g) => scene.add(g));
  const pickables = [];
  const staged = []; // everything the tour fades: { obj, stage, cur, target }
  const mats = (obj) => (Array.isArray(obj.material) ? obj.material : [obj.material]);
  function reg(obj, stage) {
    if (stage == null) return obj;
    for (const m of mats(obj)) {
      m.userData.baseOpacity = m.opacity;
      m.userData.baseTransparent = m.transparent;
    }
    obj.userData.stage = stage;
    obj.userData.baseCast = obj.castShadow;
    staged.push({ obj, stage, cur: 1, target: 1 });
    return obj;
  }
  function edges(geom, mat, pos) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(geom), mat);
    if (mat.isLineDashedMaterial) l.computeLineDistances();
    l.position.copy(pos);
    return l;
  }
  // The main heat exchanger's sides: warm at the top, cold at the bottom.
  function gradientTexture(top, bottom) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---------- boxes ----------
  for (const b of MODEL.boxes) {
    const size = new THREE.Vector3().subVectors(new THREE.Vector3(...b.max), new THREE.Vector3(...b.min));
    const pos = new THREE.Vector3(...b.min).add(size.clone().multiplyScalar(0.5));
    const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
    let mesh;
    let parent = groups.eq;
    if (b.style === 'cold') {
      mesh = new THREE.Mesh(geom, std(PAL.box, { transparent: true, opacity: 0.16, depthWrite: false }));
      parent = groups.boxes;
      parent.add(reg(edges(geom, dashEdge(PAL.boxEdge), pos), b.stage));
    } else if (b.style === 'bld') {
      mesh = new THREE.Mesh(geom, std(PAL.bld, { transparent: true, opacity: 0.22, depthWrite: false }));
      parent.add(reg(edges(geom, dashEdge(PAL.edge), pos), b.stage));
    } else if (b.style === 'mhe') {
      const side = new THREE.MeshStandardMaterial({ map: gradientTexture(PAL.mheTop, PAL.mheBot), roughness: 0.85 });
      mesh = new THREE.Mesh(geom, [side, side, std(PAL.mheTop), std(PAL.mheBot), side, side]);
      parent.add(reg(edges(geom, edgeMat(), pos), b.stage));
    } else {
      mesh = new THREE.Mesh(geom, std(b.style === 'cond' ? PAL.cond : PAL.eq));
      parent.add(reg(edges(geom, edgeMat(), pos), b.stage));
    }
    mesh.position.copy(pos);
    if (b.style !== 'cold' && b.style !== 'bld') {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    mesh.userData.name = b.name;
    mesh.userData.glass = b.style === 'cold';
    mesh.userData.dims = `${size.x.toFixed(1)} × ${size.z.toFixed(1)} m footprint, ${size.y.toFixed(1)} m tall`;
    parent.add(reg(mesh, b.stage));
    if (b.style !== 'bld') pickables.push(mesh);
  }

  // ---------- cylinders: one band per composition zone ----------
  for (const c of MODEL.cyls) {
    const total = c.top - c.bot;
    for (const band of c.bands) {
      const h = band.top - band.bot;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, h, 40, 1, false), std(band.color, { roughness: 0.8 }));
      m.position.set(c.cx, band.bot + h / 2, c.cz);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.name = c.name;
      m.userData.dims = `Ø ${(2 * c.r).toFixed(1)} m, ${total.toFixed(1)} m tall`;
      groups.eq.add(reg(m, c.stage));
      pickables.push(m);
    }
    if (c.bot > 0.05 && total > 4) {
      // A vessel on a skirt: close the gap to the ground.
      const s = new THREE.Mesh(new THREE.CylinderGeometry(c.r * 0.85, c.r * 0.85, c.bot, 32, 1, true), std(PAL.eq, { side: THREE.DoubleSide }));
      s.position.set(c.cx, c.bot / 2, c.cz);
      s.castShadow = true;
      s.receiveShadow = true;
      s.userData.name = `${c.name} skirt`;
      s.userData.dims = `${c.bot.toFixed(1)} m high`;
      groups.eq.add(reg(s, c.stage));
      pickables.push(s);
    }
  }

  // ---------- pipes: tubes with rounded bends; the dashes move with the flow ----------
  function pipePath(pts, rBend) {
    const v = pts.map((p) => new THREE.Vector3(...p));
    const path = new THREE.CurvePath();
    let prev = v[0];
    for (let i = 1; i < v.length; i++) {
      const a = prev;
      const b = v[i];
      if (i === v.length - 1) {
        path.add(new THREE.LineCurve3(a, b));
        break;
      }
      const d1 = b.clone().sub(a);
      const d2 = v[i + 1].clone().sub(b);
      const r = Math.min(rBend, d1.length() * 0.45, d2.length() * 0.45);
      const p1 = b.clone().sub(d1.clone().setLength(r));
      const p2 = b.clone().add(d2.clone().setLength(r));
      if (p1.distanceTo(a) > 1e-4) path.add(new THREE.LineCurve3(a, p1));
      path.add(new THREE.QuadraticBezierCurve3(p1, b, p2));
      prev = p2;
    }
    return path;
  }
  // gas fast, liquid slow, pumped liquid in between
  const KIND = { gas: { dash: 7, gap: 7, speed: 1.0 }, liq: { dash: 4, gap: 10, speed: 0.38 }, hp: { dash: 5, gap: 9, speed: 0.6 } };
  const PERIOD = 1.4; // meters of pipe per dash + gap
  const flows = [];
  const pretty = (s) => s.replace(/N2/g, 'N₂').replace(/^./, (ch) => ch.toUpperCase());
  for (const p of MODEL.pipes) {
    const k = KIND[p.k];
    const hex = MODEL.T[p.t];
    const path = pipePath(p.pts, 0.8);
    const len = path.getLength();
    const geom = new THREE.TubeGeometry(path, Math.max(8, Math.round(len / 0.25)), p.r, 10, false);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.repeat.set(len / PERIOD, 1);
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
    mesh.userData.name = pretty(p.name || 'stream');
    mesh.userData.dims = `${len.toFixed(0)} m run, ${p.k === 'gas' ? 'gas' : p.k === 'hp' ? 'pumped liquid' : 'liquid'}`;
    groups.pipes.add(reg(mesh, p.stage));
    pickables.push(mesh);
    flows.push({ tex, canvas: c, hex, k });
    if (p.end) {
      const tip = path.getPoint(1);
      const dir = path.getTangent(1).normalize();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(p.r * 2.4, p.r * 6, 16), std(hex, { roughness: 0.6 }));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cone.position.copy(tip).add(dir.clone().multiplyScalar(p.r * 3));
      groups.pipes.add(reg(cone, p.stage));
    }
  }
  // One period of the dash pattern: the stream's color, then the same color faded toward the ground.
  function paintDashes(groundHex) {
    const ground = color(groundHex);
    for (const f of flows) {
      const g = f.canvas.getContext('2d');
      g.fillStyle = `#${color(f.hex).lerp(ground, 0.68).getHexString()}`;
      g.fillRect(0, 0, 64, 1);
      g.fillStyle = f.hex;
      g.fillRect(0, 0, Math.round((64 * f.k.dash) / (f.k.dash + f.k.gap)), 1);
      f.tex.needsUpdate = true;
    }
  }
  {
    // Rich liquid cools the argon condenser: heat exchange, not flow, so a plain dashed line.
    const g = new THREE.BufferGeometry().setFromPoints(MODEL.tie.map((p) => new THREE.Vector3(...p)));
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: color(PAL.edge), dashSize: 0.3, gapSize: 0.3 }));
    l.computeLineDistances();
    groups.pipes.add(reg(l, MODEL.tieStage));
  }

  // ---------- ground, 10 m grid, a 1.8 m figure for scale ----------
  const E = MODEL.extent;
  const groundMat = std('#ECE7DC', { roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(E.x[1] - E.x[0] + 16, E.z[1] - E.z[0] + 10), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((E.x[0] + E.x[1]) / 2, -0.01, (E.z[0] + E.z[1]) / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  const gridMat = new THREE.LineBasicMaterial({ color: color('#E3DED3') });
  {
    const pts = [];
    for (let x = E.x[0]; x <= E.x[1]; x += 10) pts.push(new THREE.Vector3(x, 0, E.z[0] - 5), new THREE.Vector3(x, 0, E.z[1] + 5));
    for (let z = E.z[1] + 5; z >= E.z[0] - 5; z -= 10) pts.push(new THREE.Vector3(E.x[0] - 8, 0, z), new THREE.Vector3(E.x[1] + 8, 0, z));
    groups.grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  {
    const person = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.36, 4, 12), std('#8A8275'));
    person.position.set(11.5, 0.9, 0.8);
    person.castShadow = true;
    person.userData.name = 'Scale figure';
    person.userData.dims = '1.8 m tall';
    groups.eq.add(person);
    pickables.push(person);
  }

  // ---------- labels: HTML, projected every frame ----------
  const labels = MODEL.labels.map((l) => {
    const big = /box|pipeline/.test(l.t);
    const el = document.createElement('div');
    el.className = big ? 'lbl big' : 'lbl';
    el.textContent = l.t;
    ui.labels.appendChild(el);
    return { el, big, stage: l.stage, p: new THREE.Vector3(...l.p) };
  });

  // ---------- the gap between the bars, and framing a box inside it ----------
  let off = 0; // current vertical view offset, in CSS px
  let offGoal = 0;
  function freeArea() {
    const h = canvas.clientHeight;
    const top = Math.max(0, ui.top.getBoundingClientRect().bottom);
    const bottom = Math.min(h, ui.bottom.getBoundingClientRect().top);
    return bottom - top > h * 0.2 ? { top, bottom } : { top: 0, bottom: h };
  }
  function applyOffset() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.setViewOffset(w, h, 0, off, w, h);
  }
  // Puts the picture's centre (where the orbit target draws) in the middle of the gap.
  function measure() {
    const f = freeArea();
    offGoal = canvas.clientHeight / 2 - (f.top + f.bottom) / 2;
  }
  function snapOffset() {
    measure();
    off = offGoal;
    applyOffset();
  }
  const UP = new THREE.Vector3(0, 1, 0);
  const corners = (box) => {
    const out = [];
    for (const x of [box[0][0], box[1][0]]) for (const y of [box[0][1], box[1][1]]) for (const z of [box[0][2], box[1][2]]) out.push([x, y, z]);
    return out;
  };
  const centre = (box) => box[0].map((a, i) => (a + box[1][i]) / 2);
  // The camera along `dir` from the box's centre, just far enough back that every corner draws
  // inside the gap and the screen's width.
  function fit(box, dirArr, margin = 1.08) {
    const c = new THREE.Vector3(...centre(box));
    const dir = new THREE.Vector3(...dirArr).normalize();
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const f = freeArea();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = t * camera.aspect;
    const tanV = t * ((f.bottom - f.top) / canvas.clientHeight);
    let d = 0;
    for (const p of corners(box)) {
      const q = new THREE.Vector3(...p).sub(c);
      const toward = q.dot(dir);
      d = Math.max(d, toward + (Math.abs(q.dot(right)) * margin) / tanH, toward + (Math.abs(q.dot(up)) * margin) / tanV);
    }
    const pos = c.clone().add(dir.multiplyScalar(d));
    pos.y = Math.max(pos.y, 3);
    return { pos, tgt: c };
  }
  let flight = null;
  function flyTo(to, jump) {
    if (jump || reduce) {
      flight = null;
      camera.position.copy(to.pos);
      controls.target.copy(to.tgt);
      controls.update();
      return;
    }
    flight = { from: { pos: camera.position.clone(), tgt: controls.target.clone() }, to, t0: performance.now(), d: 1000 };
  }

  // ---------- views ----------
  const PLANT = MODEL.tour[0].box;
  const VIEWS = {
    iso: { box: PLANT, dir: [0.62, 0.45, 0.64] },
    front: { box: PLANT, dir: [0, 0.12, 1] },
    plan: { box: PLANT, dir: [0, 1, 0.22] },
    columns: { box: [[96, 0, -10], [124, 60, -2]], dir: [0.62, 0.4, 0.68] },
    warm: { box: [[3, 0, -14], [82, 40, 0]], dir: [0.55, 0.42, 0.72] },
  };
  let viewBox = PLANT;
  const viewButtons = [...ui.views.querySelectorAll('button[data-view]')];
  function goView(name, jump = false) {
    const v = VIEWS[name];
    viewBox = v.box;
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === name));
    if (jump) snapOffset();
    else measure();
    flyTo(fit(v.box, v.dir), jump);
  }
  for (const b of viewButtons) b.addEventListener('click', () => goView(b.dataset.view));
  // Once the camera is moved by hand, no preset is the current view.
  controls.addEventListener('start', () => {
    flight = null;
    for (const b of viewButtons) b.setAttribute('aria-pressed', 'false');
  });

  // ---------- layers ----------
  const layers = { flow: !reduce, pipes: true, boxes: true, labels: true, grid: true };
  const layerButtons = [...ui.layers.querySelectorAll('button[data-layer]')];
  function applyLayers() {
    groups.pipes.visible = layers.pipes;
    groups.boxes.visible = layers.boxes;
    groups.grid.visible = layers.grid;
    ui.labels.hidden = !layers.labels;
    for (const b of layerButtons) b.setAttribute('aria-pressed', String(layers[b.dataset.layer]));
  }
  for (const b of layerButtons) {
    b.addEventListener('click', () => {
      layers[b.dataset.layer] = !layers[b.dataset.layer];
      applyLayers();
    });
  }
  ui.layersBtn.addEventListener('click', () => {
    const open = ui.layers.hidden;
    ui.layers.hidden = !open;
    ui.layersBtn.setAttribute('aria-expanded', String(open));
    measure();
  });

  // ---------- the tour ----------
  const TOUR = MODEL.tour;
  const DEFAULT_DIR = [0.62, 0.45, 0.64];
  const DIRS = { 8: [0.78, 0.3, 0.55], 9: [0.55, 0.32, 0.77], 11: [0.45, 0.5, 0.74] }; // low and close where it helps
  let tourOn = false;
  let stage = 0;
  // Progress dots, not buttons: twelve 44 pt targets don't fit a 440 pt screen. Back and Next step.
  for (let i = 0; i < TOUR.length; i++) {
    const d = document.createElement('span');
    d.className = 'dot';
    ui.dots.appendChild(d);
  }
  // The current stage's parts at full strength, earlier stages half, later stages faint.
  const factorFor = (k) => (TOUR[stage].all || k == null ? 1 : k === stage ? 1 : k < stage ? 0.5 : 0.12);
  function paintFade(e) {
    for (const m of mats(e.obj)) m.opacity = m.userData.baseOpacity * e.cur;
  }
  function setStage(n, jump = false) {
    stage = ((n % TOUR.length) + TOUR.length) % TOUR.length;
    const s = TOUR[stage];
    ui.title.textContent = `${stage + 1}. ${s.t}`;
    ui.count.textContent = `${stage + 1} / ${TOUR.length}`;
    ui.text.replaceChildren(...s.l.map((line) => Object.assign(document.createElement('p'), { textContent: line })));
    [...ui.dots.children].forEach((d, i) => d.classList.toggle('on', i === stage));
    for (const e of staged) {
      e.target = factorFor(e.stage);
      e.obj.castShadow = e.obj.userData.baseCast && e.target > 0.2;
      if (jump || reduce) {
        e.cur = e.target;
        paintFade(e);
      }
    }
    if (jump) snapOffset();
    else measure();
    flyTo(fit(s.box, DIRS[stage] ?? DEFAULT_DIR), jump);
  }
  function startTour() {
    tourOn = true;
    ui.idle.hidden = true;
    ui.views.hidden = true;
    ui.info.hidden = true; // a tap on a part shows it again
    ui.tour.hidden = false;
    for (const e of staged) {
      for (const m of mats(e.obj)) {
        m.transparent = true;
        m.needsUpdate = true; // the shader was built opaque: rebuild it once so opacity applies
      }
    }
    setStage(0);
    ui.next.focus({ preventScroll: true });
  }
  function exitTour() {
    tourOn = false;
    ui.tour.hidden = true;
    ui.idle.hidden = false;
    ui.views.hidden = false;
    ui.info.hidden = false;
    for (const e of staged) {
      for (const m of mats(e.obj)) {
        m.opacity = m.userData.baseOpacity;
        m.transparent = m.userData.baseTransparent;
        m.needsUpdate = true;
      }
      e.obj.castShadow = e.obj.userData.baseCast;
      e.cur = 1;
      e.target = 1;
    }
    measure();
    ui.tourBtn.focus({ preventScroll: true });
  }
  function tickFades(dt) {
    const k = Math.min(1, dt * 7);
    for (const e of staged) {
      if (Math.abs(e.target - e.cur) < 1e-3) continue;
      e.cur += (e.target - e.cur) * k;
      paintFade(e);
    }
  }
  ui.tourBtn.addEventListener('click', startTour);
  ui.exit.addEventListener('click', exitTour);
  ui.back.addEventListener('click', () => setStage(stage - 1));
  ui.next.addEventListener('click', () => setStage(stage + 1));
  addEventListener('keydown', (e) => {
    if (!tourOn || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === ' ' && e.target instanceof Element && e.target.closest('button')) return; // the button handles it
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') setStage(stage + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setStage(stage - 1);
    else if (e.key === 'Escape') exitTour();
    else return;
    e.preventDefault();
  });

  // ---------- tap a part for its size ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    down = null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // Skip the parts the tour has faded to ghosts, and look through the glass cold boxes.
    const live = pickables.filter((o) => o.visible && o.parent.visible && (!tourOn || o.userData.stage == null || factorFor(o.userData.stage) > 0.2));
    const hits = ray.intersectObjects(live, false);
    const hit = hits.find((h) => !h.object.userData.glass) ?? hits[0];
    if (!hit) return;
    ui.info.textContent = `${hit.object.userData.name} · ${hit.object.userData.dims}`;
    ui.info.hidden = false;
  });

  // ---------- labels each frame ----------
  const tmp = new THREE.Vector3();
  function placeLabels() {
    if (!layers.labels) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const far = camera.position.distanceTo(controls.target) > 150; // zoomed out: only the big labels
    for (const l of labels) {
      tmp.copy(l.p).project(camera);
      let vis = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05 && (!far || l.big);
      if (tourOn && !TOUR[stage].all && l.stage != null) {
        if (l.stage > stage) vis = false;
        l.el.style.opacity = l.stage === stage ? '1' : '0.55';
      } else {
        l.el.style.opacity = '';
      }
      l.el.hidden = !vis;
      if (vis) {
        // Keep the whole label on screen: a label at the edge slides in rather than being cut off.
        l.w ||= l.el.offsetWidth;
        const half = l.w / 2 + 4;
        const x = Math.min(Math.max(((tmp.x + 1) / 2) * w, half), w - half);
        l.el.style.left = `${x}px`;
        l.el.style.top = `${((1 - tmp.y) / 2) * h - 6}px`;
      }
    }
  }

  // ---------- theme: the scene follows the design system's light and dark tokens ----------
  function applyTheme() {
    renderer.setClearColor(color(token('--bg') || '#F6F4EE'));
    const g = token('--tour-ground') || '#ECE7DC';
    groundMat.color.set(g);
    gridMat.color.set(token('--line') || '#E3DED3');
    paintDashes(g);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // ---------- size, and the loop ----------
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    snapOffset(); // also updates the projection
  }
  addEventListener('resize', resize);
  const watch = new ResizeObserver(() => measure());
  watch.observe(ui.top);
  watch.observe(ui.bottom);

  applyTheme();
  applyLayers();
  resize();
  goView('iso', true);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (flight) {
      let p = Math.min(1, (now - flight.t0) / flight.d);
      p = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      camera.position.lerpVectors(flight.from.pos, flight.to.pos, p);
      controls.target.lerpVectors(flight.from.tgt, flight.to.tgt, p);
      if (p >= 1) flight = null;
    }
    if (Math.abs(offGoal - off) > 0.25) {
      off = reduce ? offGoal : off + (offGoal - off) * Math.min(1, dt * 8);
      applyOffset();
    }
    if (layers.flow) for (const f of flows) f.tex.offset.x -= f.k.speed * dt;
    if (tourOn) tickFades(dt);
    controls.update();
    renderer.render(scene, camera);
    placeLabels();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- test hook (test/e2e.mjs): where things draw, without reading pixels ----------
  const screenOf = (p) => {
    camera.updateMatrixWorld(); // a jump moves the camera between frames; project() reads its matrix
    const v = new THREE.Vector3(...p).project(camera);
    return [((v.x + 1) / 2) * canvas.clientWidth, ((1 - v.y) / 2) * canvas.clientHeight];
  };
  window.__tour = {
    ready: true,
    stages: TOUR.length,
    titles: TOUR.map((s) => s.t),
    stage: () => (tourOn ? stage : -1),
    // The camera has arrived: no flight running, and the picture's centre is in the gap.
    settled: () => flight === null && Math.abs(offGoal - off) < 0.5,
    go: (n) => setStage(n, true),
    view: (name) => goView(name, true),
    screenOf,
    // The subject's box (the stage's, or the last preset's) on screen, and the gap it must sit in.
    layout() {
      const box = tourOn ? TOUR[stage].box : viewBox;
      const pts = corners(box).map(screenOf);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const f = freeArea();
      return {
        centre: screenOf(centre(box)),
        left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
        gapTop: f.top, gapBottom: f.bottom, width: canvas.clientWidth, height: canvas.clientHeight,
        triangles: renderer.info.render.triangles,
      };
    },
    // Per stage: the fade targets of its parts, [lowest, highest].
    fades() {
      const out = {};
      for (const e of staged) {
        const r = (out[e.stage] ??= [1, 0]);
        r[0] = Math.min(r[0], e.target);
        r[1] = Math.max(r[1], e.target);
      }
      return out;
    },
    // True when every faded material is back to how it was built.
    restored: () => staged.every((e) => mats(e.obj).every((m) => m.opacity === m.userData.baseOpacity && m.transparent === m.userData.baseTransparent)),
  };
  root.dataset.state = 'ready';
}
