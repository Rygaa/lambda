// Objects that burn voxel by voxel (a world with "burn": true or { "wet": 0.3 }, like worlds/burn-test.json and
// worlds/burn-forest.json: the button at the top, or B). An object becomes voxels of the fire (PX voxels of the look
// each, lib/voxels.js lookOf). Each voxel has a material (assets/materials.json: by the role of its part, or the palette
// of a stone part) and a temperature, water and fuel: systems/fireSim.js steps the fire (heat, water, fuel, rain; the
// states normal, heating, burning, embers, burnt, ash, gone). This file:
//   - the fire worker (lib/fireWorker.js) makes the voxels of an object away from the page, and their water: a wet
//     object (a part `wet` of the objects of the world, by a hash of its place) has WET_WATER times the water of its
//     materials, and the water changes a little in patches of PATCH voxels;
//   - B or the button lights the voxels around the point of the object nearest to the human (MATCH cells);
//   - a burning object heats the objects near it (radiate): by how many of its outside voxels burn and the gap to that
//     object, on the TARGET_CELLS outside voxels of it that face the fire. So a dry tree near a big fire catches, a wet
//     tree or one across a clearing does not. Sparks fly to show that heat (they decide nothing);
//   - a piece of voxels of a material that is gone at the end (the leaves) no longer joined, voxel by voxel, to a material
//     that stays (the wood) or to the ground falls as one piece (a small one slower); a short drop onto the object (a
//     canopy that sinks onto its trunk) rests there, a real fall breaks up where it lands;
//   - draws the voxels (one instanced mesh in the G-buffer, render/shaders.js BURN_VERT, BURN_FRAG; the post pass colours
//     them by their heat, burnColor), the leaf clumps (one goes when the voxel under it catches fire), the cubes of fire,
//     embers and flakes of ash in the wind (systems/blasts.js burnCube) and the lamp of the fire (systems/clouds.js).
// When nothing changes any more, what is left stays (the black wood, the stone; it still stops a walker); an object that
// was only warmed and never caught fire goes back to how it was.
import * as THREE from 'three';
import { query, getComponent, hasComponent, getResource } from '../ecs/world.js';
import { Prop, SceneObject, Player, Transform, CameraRig } from '../components.js';
import { Gpu, Settings, Input, Time } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';
import { paletteNames } from '../gen/palettes.js';
import { lookOf, triangles } from '../lib/voxels.js';
import { burnCube } from './blasts.js';
import * as Fire from './fireSim.js';

export const { STATE } = Fire;
const { normal: NORMAL, heating: HEATING, burning: BURNING, embers: EMBERS, burnt: BURNT, ash: ASH, gone: GONE } = STATE;

const PX = 2;            // a voxel of the fire: PX voxels of the look on each side
const H = 1 / Fire.STEP; // seconds of one step of the fire
const MATCH = 3;         // cells: B lights the voxels this near the point
const PATCH = 4;         // voxels: the size of the patches where the water changes
const PATCH_WATER = 0.3; // ... from 1 - this to 1 + this times the water of the material
const WET_WATER = 20;    // a wet object has this many times the water of its materials
const RADIATE_EVERY = 0.25;  // seconds between two times the burning objects heat the objects near them
const RADIATE = 0.05;    // degrees a second an outside burning voxel gives a voxel of an object near it, at a gap of 0...
const GAP0 = 1.5;        // ... divided by 1 + (gap / this)², gap in world units from the fire to the edge of that object
const HEAT_RANGE = 4;    // world units: no heat further than this
const TARGET_CELLS = 40; // the outside voxels of that object that get the heat (the ones nearest to the fire)
const WAKE_HEAT = 20;    // degrees: an object gets its voxels of the fire once this much heat came to it
const RED_FROM = 120;    // degrees: a heated voxel starts to turn red here (red at its ignite temperature)
const WIND = [0.92, 0.39];   // where the wind blows to (x, z in the world; the rain slants the same way)
const WIND_SPEED = 0.5;  // world units a second: the fire cubes, the embers and the flakes of ash go with the wind
const FLAKE_FALL = 0.4;  // world units a second: a flake of ash drifts down this fast
const JOIN_EVERY = 0.15; // seconds: which voxels are still joined to the wood or the ground is looked at again (when one went)
const GRAVITY = 9;       // world units a second, a second: a piece that falls
const REST_DROP = 8;     // cells: a piece that drops less than this onto the object (not the ground) rests there
const FALL_MAX = 1.2;    // world units a second: a piece falls at most this fast times 1 + the cube root of its voxels
const SPARK_TIME = 0.7;  // seconds a spark flies
const RAIN_DROPS = 320;  // drops of rain a second
const RAIN_RADIATE = 0.3;    // in the rain a fire heats the objects near it this much
const SHADOW_EVERY = 0.3;    // seconds: the shadow of a burning object is drawn again
const FIRE = ['#fff2a0', '#ffc040', '#ff8a20', '#e04a10'];
const LAMP = new THREE.Color(1, 0.42, 0.08);

// assets/materials.json: name -> material (with its defaults), and which material a part has
const json = await fetch(new URL('../../assets/materials.json', import.meta.url)).then((r) => r.json());
const MATERIALS = Object.entries(json.materials).map(([name, m]) => ({
  name, burns: !!m.burns, ignite: m.ignite ?? Infinity, flame: m.flame ?? 0, fuel: m.fuel ?? 0, water: m.water ?? 0, conduct: m.conduct ?? 0,
  after: m.after ?? 'char', charTime: (m.after ?? 'char') === 'gone' ? m.charTime ?? 0 : Infinity, stays: (m.after ?? 'char') !== 'gone',
}));
const byName = new Map(MATERIALS.map((m, i) => [m.name, i]));

// the material of a part of an object (an index in MATERIALS), or -1 (its sprites: the leaf clumps)
function materialOf({ mesh, role }) {
  if (role === 'leaves') return -1;
  let name = json.parts[role];
  if (role === 'stone') name = json.palettes[paletteNames('stone')[mesh.material.uniforms.uPal?.value ?? 0]] ?? name;
  return byName.get(name) ?? byName.get('stone');
}
const canBurn = (so) => so.meshes.some((p) => MATERIALS[materialOf(p)]?.burns);

const fires = new Map();    // object entity -> its fire
fires.ms = [];              // (the tests) milliseconds of the fire, the last frames
const heatIn = new Map();   // object entity without voxels of the fire -> heat that came to it (degrees)
fires.heatIn = heatIn;      // (the tests)
const sparks = [];          // sparks on their way (they only show the heat): { from, to, t }
const ready = new Map();    // object entity -> its voxels from the fire worker (lib/fireWorker.js), not used yet
const making = new Map();   // job id -> the object entity the worker makes the voxels of
const lights = [];          // fires to light once the voxels of their object are ready: { e, at, near }
let worker = null, jobs = 0;
let shadowIn = 0, radiateIn = 0;
let bar = null, button = null, rainButton = null, clicked = false;   // the buttons of a burn world (top of the screen)
let rain = false;           // it rains (the rain button)

// the buttons: "Set fire to the nearest (B)" while something can burn, "Burning…" while it burns, then "Grow it all
// back" (it reloads); and the rain, on or off
function showButton(world) {
  if (!bar) {
    bar = document.createElement('div');
    Object.assign(bar.style, { position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 20, display: 'flex', gap: '8px' });
    const make = (id, bg, edge) => {
      const b = document.createElement('button');
      b.id = id;
      Object.assign(b.style, { font: 'bold 15px monospace', padding: '8px 16px', color: '#fff4e0', background: bg,
        border: `2px solid ${edge}`, borderRadius: '6px', cursor: 'pointer' });
      bar.append(b);
      return b;
    };
    button = make('burn', '#b8401a', '#ffb060');
    rainButton = make('rain', '#2a5a8a', '#8cc4ff');
    button.addEventListener('click', () => {
      button.blur();
      if (button.dataset.state === 'gone') location.reload();
      else clicked = true;
    });
    rainButton.addEventListener('click', () => { rainButton.blur(); rain = !rain; });
    document.body.append(bar);
  }
  rainButton.textContent = rain ? 'Rain: on' : 'Rain: off';
  const left = query(world, [Prop, SceneObject]).some((e) => !fires.get(e)?.burnt && canBurn(getComponent(world, e, SceneObject)));
  const state = lights.length || [...fires.values()].some((f) => !f.done && f.burnt) ? 'fire' : left ? 'some' : 'gone';
  if (button.dataset.state === state) return;
  button.dataset.state = state;
  button.textContent = { some: 'Set fire to the nearest (B)', fire: 'Burning…', gone: 'Grow it all back' }[state];
  button.disabled = state === 'fire';
  button.style.opacity = state === 'fire' ? '0.6' : '1';
}

export function burnSystem(world) {
  const settings = getResource(world, Settings), gpu = getResource(world, Gpu), input = getResource(world, Input);
  if (settings.land.burn) {
    if (clicked || input.pressed.some(({ key }) => key.toLowerCase() === 'b')) lightNearest(world);
    clicked = false;
    showButton(world);
  }
  gpu.fireLamps = [];
  const dt = Math.min(0.05, getResource(world, Time).dt);
  if (rain) rainDrops(world, dt);
  flySparks(world, dt);
  for (let i = lights.length - 1; i >= 0; i--) {
    const l = lights[i];
    if (!hasComponent(world, l.e, SceneObject)) { lights.splice(i, 1); continue; }
    if (fires.has(l.e) || ready.has(l.e)) { lights.splice(i, 1); ignite(world, l.e, l.at, l.near); }
  }
  if (!fires.size) return;
  const t0 = performance.now();
  let changing = false;
  for (const [entity, f] of fires) {
    if (!hasComponent(world, entity, SceneObject)) { drop(f); fires.delete(entity); continue; }
    if (f.done) { for (const mesh of f.hidden) mesh.visible = false; continue; }   // what is left
    for (f.acc += dt; f.acc >= H; f.acc -= H) { Fire.step(f, H, rain); went(f); }
    fall(f, dt);
    draw(world, f, gpu);
    changing = true;
    if (f.awakeN || f.pieces.length || f.breaking.length || f.cut) continue;   // (cut: joined is looked at once more)
    // nothing changes any more: what is left stays; an object only warmed goes back to how it was
    if (!f.burnt) { forget(f); fires.delete(entity); continue; }
    f.done = true;
    gpu.shadowsDirty = true;
  }
  if (changing && (radiateIn -= dt) <= 0) { radiateIn = RADIATE_EVERY; radiate(world); }
  if (changing && (shadowIn -= dt) <= 0) { shadowIn = SHADOW_EVERY; gpu.shadowsDirty = true; }
  fires.ms.push(performance.now() - t0);
  if (fires.ms.length > 600) fires.ms.shift();
}

// rain: drops fall fast around the camera
function rainDrops(world, dt) {
  const rig = query(world, [CameraRig])[0];
  if (rig === undefined) return;
  const [x, y, z] = getComponent(world, rig, CameraRig).target;
  for (let n = Math.floor(RAIN_DROPS * dt + Math.random()); n > 0; n--) {
    // a drop: a short streak of 3 cubes, slanted a little by the wind
    const dx = (Math.random() - 0.5) * 20, dz = (Math.random() - 0.5) * 16, top = y + 5 + Math.random() * 2;
    const color = Math.random() < 0.6 ? '#b4d2f5' : '#e2eeff';
    for (let i = 0; i < 3; i++) burnCube(world, x + dx - i * 0.01 * WIND[0], top + i * 0.07, z + dz - i * 0.01 * WIND[1], 0.045, color, 0.85, WIND[0] * 0.6, -9, WIND[1] * 0.6, true);
  }
}

// how far an object reaches from its centre over the ground (its leaves, not only its trunk): from its shapes, once
function reach(so) {
  if (so.reach !== undefined) return so.reach;
  let r = 0;
  for (const { mesh, role } of so.meshes) {
    if (role === 'leaves' || role === 'water') continue;
    const g = mesh.userData.shape ?? mesh.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox;
    r = Math.max(r, -b.min.x, b.max.x, -b.min.z, b.max.z);
  }
  return (so.reach = r);
}

// the voxels that went in the last step: they hide, the ones they hid show, and some leave a flake of ash
function went(f) {
  for (const c of f.goneNow) {
    f.cut = true;
    if (f.slot[c] >= 0 && f.bits.length < 60 && Math.random() < 0.04) f.bits.push({ c, kind: 'flake' });
    hide(f, c);
    for (const o of Fire.offsets(f)) { const d = f.grid[f.at[c] + o]; if (d >= 0) show(f, d); }
  }
  f.goneNow.length = 0;
}

// the burning objects heat the objects that can burn near them: by how many of their outside voxels burn and the gap
function radiate(world) {
  const targets = [];
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    const so = getComponent(world, e, SceneObject);
    if (!canBurn(so)) continue;
    const t = getComponent(world, e, Transform);
    targets.push({ e, x: t.x, z: t.z, r: reach(so) });
  }
  const v = new THREE.Vector3();
  for (const [source, f] of [...fires]) {
    if (f.done || !f.burning) continue;
    // its outside burning voxels: how many, and up to 300 of them (where they are in the world)
    const pts = [];
    let out = 0;
    for (let i = 0; i < f.awakeN; i++) {
      const c = f.awake[i];
      if (!f.burn[c] || f.slot[c] < 0) continue;
      out++;
      if (pts.length < 300) pts.push(c);
      else if (Math.random() < 300 / out) pts[Math.floor(Math.random() * 300)] = c;
    }
    if (!out) continue;
    const g = f.so.group.matrixWorld, at = pts.map((c) => cellPos(f, c, new THREE.Vector3()).applyMatrix4(g));
    for (const t of targets) {
      if (t.e === source) continue;
      let gap = Infinity, from = null;
      for (const p of at) {
        const d = Math.hypot(p.x - t.x, p.z - t.z) - t.r;
        if (d < gap) { gap = d; from = p; }
      }
      if (gap >= HEAT_RANGE) continue;
      prepare(world, t.e);   // its voxels, made before the heat is enough
      const flux = RADIATE * out / (1 + (Math.max(0, gap) / GAP0) ** 2) * (rain ? RAIN_RADIATE : 1), heat = flux * RADIATE_EVERY;
      let tf = fires.get(t.e);
      if (!tf) {
        const sum = (heatIn.get(t.e) ?? 0) + heat;
        heatIn.set(t.e, sum);
        if (sum < WAKE_HEAT || !(tf = fireOf(world, t.e))) continue;
        heatIn.delete(t.e);
      }
      tf.done = false;
      // its outside voxels nearest to the fire get the heat
      const local = tf.so.group.worldToLocal(from.clone()), near = [];   // [distance², cell], the nearest first
      for (let s = 0, step = Math.max(1, Math.floor(tf.count / 2000)); s < tf.count; s += step) {   // (about 2000 of them)
        const c = tf.cellAt[s], d = cellPos(tf, c, v).distanceToSquared(local);
        if (near.length === TARGET_CELLS && d >= near[TARGET_CELLS - 1][0]) continue;
        let i = near.length < TARGET_CELLS ? near.length : TARGET_CELLS - 1;
        while (i > 0 && near[i - 1][0] > d) { near[i] = near[i - 1]; i--; }
        near[i] = [d, c];
      }
      for (const [, c] of near) Fire.warm(tf, c, heat);
      // sparks fly there: more for more heat
      if (near.length && Math.random() < flux / 40) {
        cellPos(tf, near[0][1], v).applyMatrix4(tf.so.group.matrixWorld);
        sparks.push({ from: from.clone(), to: v.clone(), t: 0 });
      }
    }
  }
}

// the sparks on their way: a glowing cube that flies in an arc and leaves a short trail
function flySparks(world, dt) {
  const v = new THREE.Vector3();
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i], k = Math.min(1, (s.t += dt) / SPARK_TIME);
    v.lerpVectors(s.from, s.to, k);
    v.y += Math.sin(Math.PI * k) * 0.6;
    burnCube(world, v.x, v.y, v.z, 0.07, FIRE[Math.floor(Math.random() * 2)], 0.12, 0, 0, 0, true);
    if (Math.random() < 0.5) burnCube(world, v.x, v.y, v.z, 0.04, FIRE[2], 0.3 + Math.random() * 0.2, 0, 0.2, 0, true);
    if (k >= 1) sparks.splice(i, 1);
  }
}

// B or the button: the nearest object that can burn and is not burning (any distance) catches fire at the voxel nearest
// to the chest of the human (one with fuel left)
function lightNearest(world) {
  const human = query(world, [Player])[0];
  if (human === undefined) return;
  const p = getComponent(world, human, Player);
  const near = [];
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    const f = fires.get(e);
    if ((f && !f.done && f.burning) || !canBurn(getComponent(world, e, SceneObject))) continue;
    const t = getComponent(world, e, Transform);
    near.push([Math.hypot(t.x - p.x, t.z - p.z), e]);
  }
  near.sort((a, b) => a[0] - b[0]);
  const chest = new THREE.Vector3(p.x, (p.group?.position.y ?? 0) + 0.6, p.z);
  for (const [, e] of near) if (ignite(world, e, chest)) return;
}

// the object entity catches fire at the voxel with fuel nearest to the point at (world units): its voxels in MATCH
// cells around it burn. near: the nearest voxel whatever its material, else the solid part first. -> it caught fire
export function ignite(world, entity, at, near = false) {
  const f = fires.get(entity) ?? fireOf(world, entity);
  if (!f) {
    // its voxels are not made yet: it catches fire when they are
    if (!canBurn(getComponent(world, entity, SceneObject))) return false;
    if (!lights.some((l) => l.e === entity)) lights.push({ e: entity, at: at.clone(), near });
    return true;
  }
  const first = firstCell(f, f.so.group.worldToLocal(at.clone()), near);
  if (first < 0) return false;
  const [x, y, z] = [f.xyz[first * 3], f.xyz[first * 3 + 1], f.xyz[first * 3 + 2]];
  for (let c = 0; c < f.n; c++) {
    const dx = f.xyz[c * 3] - x, dy = f.xyz[c * 3 + 1] - y, dz = f.xyz[c * 3 + 2] - z;
    if (dx * dx + dy * dy + dz * dz <= MATCH * MATCH) Fire.light(f, c);
  }
  f.done = false;
  return true;
}

// the fire worker makes the voxels of an object (once), with their water: a wet object (a part `wet` of the objects of
// the world, by a hash of its place, so a world always has the same wet objects) has WET_WATER times the water of its
// materials, and the water changes a little in patches
function prepare(world, entity) {
  if (fires.has(entity) || ready.has(entity) || [...making.values()].includes(entity)) return;
  const so = getComponent(world, entity, SceneObject), settings = getResource(world, Settings);
  if (!canBurn(so)) return;
  const parts = so.meshes.filter((p) => p.role !== 'leaves' && p.role !== 'water');
  const t = getComponent(world, entity, Transform), hash = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
  const wet = hash < (settings.land.burnWet ?? 0) ? WET_WATER : 1, size = (lookOf(world)?.world.size ?? 1 / settings.ppu) * PX;
  if (!worker) {
    worker = new Worker(new URL('../lib/fireWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const job = making.get(data.id);
      making.delete(data.id);
      if (data.count) ready.set(job.entity, { ...data, ...job });
    };
  }
  const canopy = byName.get(json.parts.canopy);
  const sent = parts.map((p) => {
    const { p: P, nrm } = triangles(p.mesh.userData.shape ?? p.mesh.geometry, p.mesh.matrix), m = MATERIALS[materialOf(p)];
    return { p: P, nrm, stays: m.stays, water: m.water, leaves: materialOf(p) === canopy };
  });
  // the leaf clumps (sprites): where each is, in the units of the object
  const clumps = [], spots = [], v = new THREE.Vector3();
  for (const { mesh, role } of so.meshes) {
    if (role !== 'leaves') continue;
    const pos = mesh.geometry.getAttribute('iPos');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
      clumps.push(v.x, v.y, v.z);
      spots.push({ mesh, i });
    }
  }
  const id = jobs++, at = Float32Array.from(clumps);
  making.set(id, { entity, parts, size, wet: wet > 1, spots });
  worker.postMessage({ id, size, parts: sent, wet, seed: Math.floor(hash * 1e9), patch: PATCH, patchWater: PATCH_WATER, clumps: at },
    [...sent.flatMap((m) => [m.p.buffer, m.nrm.buffer]), at.buffer]);
}

// the fire of an object, from its voxels the worker made: their materials, water and fuel, the mesh that shows them in
// place of the object, and its leaf clumps. null: not made yet (they are asked for), or nothing of it burns
function fireOf(world, entity) {
  if (fires.has(entity)) return fires.get(entity);
  const d = ready.get(entity);
  if (!d) { prepare(world, entity); return null; }
  ready.delete(entity);
  const so = getComponent(world, entity, SceneObject), gpu = getResource(world, Gpu), { parts, size, count: n } = d;
  const [nx, ny, nz] = d.n;
  const f = {
    entity, so, size, nx, ny, nz, grid: d.grid, n, done: false, acc: 0, materials: MATERIALS, wet: d.wet,
    at: d.at, xyz: d.xyz, mat: new Uint8Array(n), jitter: new Float32Array(n), min: d.min, nrm: d.nrm, held: d.held,
    slot: new Int32Array(n).fill(-1), cellAt: new Int32Array(n), count: 0, moved: new Uint8Array(n), dirty: new Int32Array(n), dirtyN: 0,
    joined: new Uint8Array(n).fill(1), cut: false, joinIn: 0, loose: new Uint8Array(n), off: new Float32Array(n),
    piece: new Int32Array(n), pieces: [], pieceId: 0, breaks: new Float32Array(n), breaking: [],
    mid: new Float32Array(n), row: new Float32Array(n), hidden: parts.map(({ mesh }) => mesh), sprites: [], clumpsOf: [], bits: [],
  };
  const looks = parts.map((p) => ({ mat: materialOf(p), mid: p.mesh.material.uniforms.uMid?.value ?? 4, row: p.mesh.material.uniforms.uPal?.value ?? 0 }));
  for (let c = 0; c < n; c++) {
    const l = looks[d.part[c]];
    f.mat[c] = l.mat;
    f.mid[c] = l.mid;
    f.row[c] = l.row;
    f.jitter[c] = Math.random();
  }
  const w = new THREE.Vector3(WIND[0], 0, WIND[1]).transformDirection(so.group.matrixWorld.clone().invert());
  Fire.makeFire(f, (c) => d.water[c], w.x, w.z);
  // the mesh: room for every voxel; only the ones that show are drawn (the first `count`)
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  f.nrmAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  f.matAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  f.matAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iNrm', f.nrmAttr);
  geometry.setAttribute('iMat', f.matAttr);
  const mesh = new THREE.InstancedMesh(geometry, shaderMaterial(gpu.shared, S.BURN_VERT, S.BURN_FRAG), n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.layers.enable(1);      // it casts a shadow
  mesh.count = 0;
  so.group.add(mesh);
  so.group.updateMatrixWorld(true);
  f.mesh = mesh;
  // the voxels that show: the ones next to an empty cell
  for (const c of d.shown) show(f, c);
  // the leaf clumps: their own copy of the sprites, each goes with the voxel of the canopy under it
  for (const { mesh } of d.spots) if (!mesh.userData.burnCopy) { mesh.geometry = mesh.geometry.clone(); mesh.userData.burnCopy = true; }
  d.spots.forEach(({ mesh, i }, s) => {
    const attr = mesh.geometry.getAttribute('iPos'), cell = d.clumpAt[s];
    // (y0: its height in the mesh; per: mesh units a world unit up, so it can go down with its voxel when that falls)
    const sp = { attr, i, cell, y0: attr.getY(i), cy: cell >= 0 ? f.xyz[cell * 3 + 1] : 0, per: 1 / (mesh.matrix.elements[5] || 1) };
    f.sprites.push(sp);
    if (cell >= 0) (f.clumpsOf[cell] ??= []).push(sp);
  });
  draw(world, f, gpu);
  fires.set(entity, f);
  window.__burn = fires;   // for the tests
  return f;
}

// an object that was only warmed: its voxels go and it shows as it was
function forget(f) {
  drop(f);
  for (const mesh of f.hidden) mesh.visible = true;
}

// ------------------------------------------------------------------ the voxels
const mat = (f, c) => MATERIALS[f.mat[c]];

// a cell of the grid next to an empty one (the grid has an empty border, so k + o is always in it)
function open(f, k) {
  for (const o of Fire.offsets(f)) { const d = f.grid[k + o]; if (d < 0 || f.state[d] === GONE) return true; }
  return false;
}

function show(f, c) {
  if (f.slot[c] >= 0 || f.state[c] === GONE) return;
  const s = f.count++;
  f.slot[c] = s;
  f.cellAt[s] = c;
  mark(f, s);
  f.nrmAttr.array.set(f.nrm.subarray(c * 3, c * 3 + 3), s * 3);
  f.nrmAttr.needsUpdate = true;
}

// a slot of the mesh whose voxel changed (a new one, it moved): its place, size and colour are written at the next draw
function mark(f, s) {
  if (f.moved[s]) return;
  f.moved[s] = 1;
  f.dirty[f.dirtyN++] = s;
}

function hide(f, c) {
  const s = f.slot[c];
  if (s < 0) return;
  const last = --f.count, moved = f.cellAt[last];
  if (moved !== c) {
    f.cellAt[s] = moved;
    f.slot[moved] = s;
    mark(f, s);
    f.nrmAttr.array.copyWithin(s * 3, last * 3, last * 3 + 3);
    f.nrmAttr.needsUpdate = true;
  }
  f.slot[c] = -1;
}

// the pieces that fall: each one as one piece, faster and faster, until a voxel of it lands on the ground or on a voxel
// that is not of a piece; there it breaks up. off: how far it fell since its cells (drawn lower by that much); it moves
// down a cell each time it passes one
function fall(f, dt) {
  const { grid, nx } = f, offs = Fire.offsets(f), floor = Math.max(1, Math.ceil(-f.min[1] - 0.5));
  if (f.cut && ((f.joinIn -= dt) <= 0 || !f.awakeN)) {   // (at once when nothing else changes, so the fire does not end first)
    join(f, floor); f.cut = false; f.joinIn = JOIN_EVERY;
  }
  breakUp(f, dt);
  f.pieces = f.pieces.filter((p) => {
    p.cells = p.cells.filter((c) => f.state[c] !== GONE);
    if (!p.cells.length) return false;
    // the air holds a small piece back (a bit of a leaf drifts down, a big piece drops)
    p.vel = Math.min(p.vel + GRAVITY * dt, FALL_MAX * (1 + Math.cbrt(p.cells.length)));
    p.off += p.vel * dt;
    while (p.off >= f.size) {
      // under it: the ground or a voxel (it lands), or a piece that falls too (it waits on it)
      let under = 0, ground = false;
      for (const c of p.cells) {
        if (f.xyz[c * 3 + 1] <= floor) { under = 2; ground = true; break; }
        const d = grid[f.at[c] - nx];
        if (d < 0 || f.state[d] === GONE || f.piece[d] === p.id) continue;
        under = f.piece[d] ? Math.max(under, 1) : 2;
        if (under === 2) break;
      }
      if (under === 2) {
        // a short drop onto the object (a canopy that sinks onto its trunk): it rests there; else it breaks up
        if (!ground && p.drop < REST_DROP) rest(f, p); else land(f, p);
        return false;
      }
      if (under === 1) { p.off = f.size * 0.99; break; }
      p.off -= f.size;
      p.drop++;
      // one cell down, the bottom ones first (the cells are from the bottom up)
      for (const c of p.cells) { const k = f.at[c]; if (grid[k] === c) grid[k] = -1; grid[k - nx] = c; f.at[c] = k - nx; f.xyz[c * 3 + 1]--; }
      // the voxels next to the cells it left show
      for (const c of p.cells) {
        const k = f.at[c] + nx;
        if (grid[k] >= 0) continue;
        for (const o of offs) { const d = grid[k + o]; if (d >= 0 && f.piece[d] !== p.id) show(f, d); }
      }
    }
    for (const c of p.cells) { f.off[c] = p.off; if (f.slot[c] >= 0) mark(f, f.slot[c]); moveClumps(f, c); }
    return true;
  });
}

// a piece sank a little onto the object: it rests there, as it is, and is joined again
function rest(f, p) {
  for (const c of p.cells) {
    f.off[c] = 0;
    f.piece[c] = 0;
    if (f.slot[c] >= 0) mark(f, f.slot[c]);
    moveClumps(f, c);
  }
  f.cut = true;
}

// the leaf clumps of a voxel that fell go down with it
function moveClumps(f, c) {
  for (const sp of f.clumpsOf[c] ?? []) {
    if (sp.gone) continue;
    sp.attr.setY(sp.i, sp.y0 - ((sp.cy - f.xyz[c * 3 + 1]) * f.size + f.off[c]) * sp.per);
    sp.attr.needsUpdate = true;
  }
}

// a piece landed: it breaks up. What burns burns on there (it does not join the rest again); green leaves fall apart
// (they shrink and are gone, not all at once); the rest crumbles to ash; and some of it flies off in bits
function land(f, p) {
  for (const c of p.cells) {
    f.off[c] = 0;
    f.piece[c] = 0;
    f.loose[c] = 1;
    show(f, c);
    mark(f, f.slot[c]);
    if (f.burn[c]) continue;
    const s = f.out[c] ? BURNT : f.state[c];
    if (s < BURNING) { f.breaks[c] = 0.3 + Math.random() * 1.5; f.breaking.push(c); }
    else Fire.crumble(f, c);
    if (f.slot[c] < 0 || f.bits.length >= 120 || Math.random() > 0.25) continue;
    f.bits.push({ c, kind: 'bit', color: s < BURNING ? '#4a7a3c' : s === EMBERS ? '#ff7a20' : s === ASH ? '#6a6460' : '#2a2422' });
    if (s < BURNING) f.breaks[c] = 0.001; else Fire.crumble(f, c, 0.001);   // it is that bit now
  }
}

// the green leaves of a piece that landed: each shrinks and is gone at its time (unless it caught fire: then it burns)
function breakUp(f, dt) {
  const offs = Fire.offsets(f);
  f.breaking = f.breaking.filter((c) => {
    if (f.state[c] >= BURNING) { f.breaks[c] = 0; return false; }
    if ((f.breaks[c] -= dt) > 0) return true;
    f.breaks[c] = 0;
    f.state[c] = GONE;
    f.cut = true;
    hide(f, c);
    for (const o of offs) { const d = f.grid[f.at[c] + o]; if (d >= 0) show(f, d); }
    return false;
  });
}

// which voxels are joined, voxel by voxel (the 6 next to each), to a voxel of a material that stays (the wood, stone) or
// to the ground (a voxel that broke up on the ground is not joined again), or are a bit that the shape itself holds
// (held: joined to nothing from the start, lib/fireWorker.js); the others make pieces that fall (each the voxels joined
// to one another), their cells from the bottom up
function join(f, floor) {
  const { grid, n } = f, offs = Fire.offsets(f), stack = new Int32Array(n);
  const free = (c) => f.state[c] !== GONE && !f.loose[c] && !f.piece[c];
  let top = 0;
  f.joined.fill(0);
  for (let c = 0; c < n; c++) {
    if (!free(c) || (!mat(f, c).stays && f.xyz[c * 3 + 1] > floor && !f.held[c])) continue;
    f.joined[c] = 1;
    stack[top++] = c;
  }
  while (top) {
    const k = f.at[stack[--top]];
    for (const o of offs) {
      const d = grid[k + o];
      if (d < 0 || f.joined[d] || !free(d)) continue;
      f.joined[d] = 1;
      stack[top++] = d;
    }
  }
  for (let c = 0; c < n; c++) {
    if (f.joined[c] || !free(c)) continue;
    const id = ++f.pieceId, cells = [c];
    f.piece[c] = id;
    for (let i = 0; i < cells.length; i++) {
      const k = f.at[cells[i]];
      for (const o of offs) {
        const d = grid[k + o];
        if (d < 0 || f.joined[d] || !free(d)) continue;
        f.piece[d] = id;
        cells.push(d);
      }
    }
    cells.sort((a, b) => f.xyz[a * 3 + 1] - f.xyz[b * 3 + 1]);
    f.pieces.push({ id, cells, vel: 0, off: 0, drop: 0 });
  }
}

// the heat of a voxel for the post pass (render/shaders.js burnColor), and its size (it shrinks as ash), by its state
function heatOf(f, c, now) {
  const s = f.state[c], m = mat(f, c), j = f.jitter[c];
  if (s < BURNING && f.breaks[c] > 0) return [0, Math.min(1, f.breaks[c] / 0.4)];   // green, falling apart: it shrinks
  if (s === NORMAL) return [0, 1];
  if (s === HEATING) return [0.22 * Math.min(1, Math.max(0, (f.T[c] - RED_FROM) / (m.ignite - RED_FROM))), 1];
  if (s === BURNING) {
    // each voxel its own colour (red, yellow, orange), and it flickers
    const k = 1 - f.F[c] / m.fuel, flick = 0.07 * Math.sin(now * (9 + j * 7) + j * 40);
    return [Math.min(0.495, Math.max(0.251, 0.25 + 0.25 * (k * 0.65 + j * 0.35) + flick)), 1];
  }
  // embers: about half the voxels glow; the others are black at once
  if (s === EMBERS) return [j < 0.55 ? 0.79 : 0.5 + 0.3 * (1 - f.F[c] / (m.fuel * Fire.EMBER)), 1];
  if (f.out[c] || f.left[c] < 0) return [0.8, 1];   // black (the wood, or put out by the rain)
  // black, then grey ash that shrinks, then gone
  const k = Math.min(1, Math.max(0, 1 - f.left[c] / (m.charTime * (0.8 + 0.4 * j))));
  return [0.8 + 0.2 * k, k < 0.75 ? 1 : 1 - (k - 0.75) * 2.8];
}

function draw(world, f, gpu) {
  const now = performance.now() / 1000, M = f.mesh.instanceMatrix.array, A = f.matAttr.array, size = f.size;
  const [mx, my, mz] = f.min, nxy = f.nx * f.ny;
  // a slot: its colour, and its place and size when it moved or is not at its full size
  const put = (s, place) => {
    const c = f.cellAt[s], [h, scale] = heatOf(f, c, now);
    A[s * 3] = f.mid[c]; A[s * 3 + 1] = f.row[c]; A[s * 3 + 2] = h;
    if (!place && scale === 1) return;
    const k = f.at[c], x = k % f.nx, y = Math.floor(k / f.nx) % f.ny, z = Math.floor(k / nxy), e = size * scale, o = s * 16;
    M[o] = e; M[o + 1] = M[o + 2] = M[o + 3] = M[o + 4] = 0; M[o + 5] = e; M[o + 6] = M[o + 7] = M[o + 8] = M[o + 9] = 0;
    M[o + 10] = e; M[o + 11] = 0;
    M[o + 12] = (x + mx + 0.5) * size; M[o + 13] = (y + my + 0.5) * size - (size - e) * 0.5 - f.off[c]; M[o + 14] = (z + mz + 0.5) * size; M[o + 15] = 1;
  };
  // only what can change: the slots that moved, the voxels that are awake (systems/fireSim.js), the green ones that fall
  // apart. A voxel asleep looks the same from frame to frame
  for (let i = 0; i < f.dirtyN; i++) { const s = f.dirty[i]; f.moved[s] = 0; if (s < f.count) put(s, true); }
  f.dirtyN = 0;
  for (let i = 0; i < f.awakeN; i++) { const s = f.slot[f.awake[i]]; if (s >= 0) put(s, false); }
  for (const c of f.breaking) if (f.slot[c] >= 0) put(f.slot[c], false);
  f.mesh.count = f.count;
  f.mesh.instanceMatrix.needsUpdate = true;
  f.matAttr.needsUpdate = true;
  for (const mesh of f.hidden) mesh.visible = false;

  // the leaf clumps over a voxel that caught fire (or broke up) go; a voxel only heated keeps its clumps, and one that
  // falls takes them with it
  for (const sp of f.sprites) {
    if (sp.gone || sp.cell < 0) continue;
    const c = sp.cell;
    if (f.state[c] < BURNING && !f.loose[c]) continue;
    sp.gone = true;
    sp.attr.setX(sp.i, 1e5);
    sp.attr.needsUpdate = true;
  }

  const g = f.so.group.matrixWorld, v = new THREE.Vector3(), mid = new THREE.Vector3();
  // flakes of ash drift down with the wind, swinging; the bits of a piece that broke up fly off
  for (const { c, kind, color } of f.bits.splice(0)) {
    cellPos(f, c, v).applyMatrix4(g);
    if (kind === 'flake') flake(world, v, size, Math.random() < 0.7 ? '#5a5450' : '#2a2422');
    else {
      const a = Math.random() * 6.3, sp = 0.4 + Math.random() * 0.9;
      burnCube(world, v.x, v.y, v.z, size, color, 0.4 + Math.random() * 0.4, Math.cos(a) * sp, 1 + Math.random() * 1.5, Math.sin(a) * sp, false);
    }
  }
  // the burning voxels that show: the lamp at their middle, cubes of fire from some of them
  const lit = [];
  for (let i = 0; i < f.awakeN; i++) {
    const c = f.awake[i];
    if (f.state[c] === BURNING && f.slot[c] >= 0) { lit.push(c); cellPos(f, c, v); mid.add(v); }
  }
  if (!lit.length) return;
  mid.divideScalar(lit.length).applyMatrix4(g);
  // by day the lamp is faint (it would paint the whole object orange), at night it lights around it
  const strength = Math.min(1, lit.length / 1500), night = getResource(world, Settings).land.night ?? 0;
  gpu.fireLamps.push({ x: mid.x, y: mid.y, z: mid.z, r: 1.6 + 2.6 * strength, color: LAMP, k: (0.15 + 0.4 * strength) * (0.35 + 0.65 * night), flicker: true, ph: f.entity });
  const cubes = Math.min(30, Math.ceil(lit.length / 60));
  for (let i = 0; i < cubes; i++) {
    cellPos(f, lit[Math.floor(Math.random() * lit.length)], v).applyMatrix4(g);
    const r = Math.random();
    // they rise and lean with the wind
    burnCube(world, v.x, v.y + size, v.z, size * (1 + Math.random() * 1.5), FIRE[Math.floor(r * r * FIRE.length)], 0.35 + Math.random() * 0.5,
      WIND[0] * WIND_SPEED + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 1.2, WIND[1] * WIND_SPEED + (Math.random() - 0.5) * 0.3, true);
  }
  // embers rise from the fire with the hot air; flakes of ash drift down
  if (Math.random() < Math.min(0.8, lit.length / 2000)) {
    cellPos(f, lit[Math.floor(Math.random() * lit.length)], v).applyMatrix4(g);
    if (Math.random() < 0.5) burnCube(world, v.x, v.y, v.z, size * 0.6, '#ff7a20', 0.8 + Math.random() * 0.8,
      WIND[0] * WIND_SPEED, 0.8 + Math.random() * 0.6, WIND[1] * WIND_SPEED, true, 0.4);
    else flake(world, v, size, '#3a3431');
  }
}

// a flake of ash: small, it drifts down slowly with the wind and swings from side to side
function flake(world, v, size, color) {
  const k = 0.7 + Math.random() * 0.6;
  burnCube(world, v.x, v.y, v.z, size * 0.6, color, 1.6 + Math.random() * 1.6,
    WIND[0] * WIND_SPEED * k, -FLAKE_FALL * k, WIND[1] * WIND_SPEED * k, true, 0.5);
}

// the centre of a voxel, in the units of the object
function cellPos(f, c, out) {
  const k = f.at[c], [mx, my, mz] = f.min;
  return out.set((k % f.nx + mx + 0.5) * f.size, (Math.floor(k / f.nx) % f.ny + my + 0.5) * f.size, (Math.floor(k / (f.nx * f.ny)) + mz + 0.5) * f.size);
}

// the first voxel to burn, for a fire lit at a point (units of the object): the nearest voxel that shows, can burn and
// has fuel; near: whatever its material, else the height counting 3 times, of a material that stays if there is one
// (the trunk in front of the human, not a leaf over it); -1: none
function firstCell(f, p, near) {
  const v = new THREE.Vector3();
  let best = -1, bestD = Infinity, solid = false;
  for (let s = 0; s < f.count; s++) {
    const c = f.cellAt[s], m = mat(f, c);
    if (!m.burns || f.F[c] <= 0 || f.burn[c] || (solid && !m.stays)) continue;
    cellPos(f, c, v);
    if (near) {
      const d = v.distanceToSquared(p);
      if (d < bestD) { bestD = d; best = c; }
      continue;
    }
    const d = (v.x - p.x) ** 2 + 9 * (v.y - p.y) ** 2 + (v.z - p.z) ** 2;
    if ((m.stays && !solid) || d < bestD) { bestD = d; best = c; solid = m.stays; }
  }
  return best;
}

function drop(f) {
  f.mesh.parent?.remove(f.mesh);
  f.mesh.geometry.dispose();
  f.mesh.material.dispose();
}
