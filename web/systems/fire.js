// Trees on fire, voxel by voxel (a world with "burn": true, like worlds/burn-test.json: the button at the top, or B).
// An object that can burn becomes voxels (PX voxels of the look each, made by the fire worker, lib/fireWorker.js) of 3
// materials, by the role of its part: wood (the trunk; a stone part with a wood palette: the palm trunk, the crates),
// leaves (the canopy), stone (it does not burn). Once an object catches fire it burns to the end:
//   - catching fire: when B lights it (or a tree near it), the time each voxel catches fire is found once, the shortest
//     way from the first voxel (LEAF_SPEED in the leaves, WOOD_SPEED in the wood; up costs UP times, down DOWN times;
//     with the wind WIND_WITH, against it WIND_AGAINST). Before that it turns red (HEAT_T), then it burns;
//   - wood: flames WOOD_FLAME s, embers WOOD_EMBER s, then black, and it stays;
//   - leaves: flames (LEAF_FLAME s at least, until their time to go), then it glows red (ASH_T), and it is gone,
//     where it is.
//     A leaf voxel goes only once every leaf voxel it holds is gone: each holds the ones whose shortest way to the wood
//     (or to the ground: a bush) goes through it (holders). So the leaves go from their tips back to the wood, and what
//     is left is always joined to it: nothing floats, whatever the shape of the tree. A leaf burns on until it goes,
//     so the leaves look like a ball of fire that shrinks back onto the wood (RETREAT);
//   - a tree whose leaves burn lights each tree near it with a chance a second (SPREAD): more when it is near (RANGE),
//     more downwind (the world field "wind": { dir, speed }), less against the wind.
// It draws the voxels (one instanced mesh in the G-buffer, render/shaders.js BURN_VERT, BURN_FRAG; the post pass colours
// them by their heat, burnColor), the cubes of fire, the embers and the flakes of ash (systems/blasts.js burnCube) and
// the lamp of the fire (systems/clouds.js). When a tree is done, what is left stays (the black wood; it still stops a
// walker).
import * as THREE from 'three';
import { query, getComponent, hasComponent, getResource } from '../ecs/world.js';
import { Prop, SceneObject, Player, Transform } from '../components.js';
import { Gpu, Settings, Input, Time } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';
import { paletteNames } from '../gen/palettes.js';
import { lookOf, triangles } from '../lib/voxels.js';
import { burnCube } from './blasts.js';

const PX = 2;              // a voxel of the fire: PX voxels of the look on each side
const MATCH = 2;           // cells: B lights the voxels this near the first one at once
const LEAF_SPEED = 0.6;    // world units a second the fire goes through leaves (to the side)
const WOOD_SPEED = 0.15;   // ... through wood
const UP = 0.5;            // times: a step up (fire climbs)
const DOWN = 2;            // times: a step down
const WIND_WITH = 0.7;     // times: a step with the wind (at full wind)
const WIND_AGAINST = 1.4;  // times: a step against the wind
const HEAT_T = 0.6;        // seconds a voxel turns red before it catches fire
const LEAF_FLAME = 1.5;    // seconds a leaf voxel burns at least (on, until its time to go)
const ASH_T = 0.3;         // seconds a leaf voxel glows red before it is gone
const RETREAT = 0.35;      // world units a second: the leaves go back from their tips to the wood at most this fast
const WOOD_FLAME = 6;      // seconds a wood voxel burns
const WOOD_EMBER = 2.5;    // seconds it glows after; then it is black for good
const SPREAD_EVERY = 1;    // seconds between two tries of a burning tree to light the trees near it
const SPREAD = 0.35;       // chance a try lights a tree right next to it (no wind)...
const RANGE = 3;           // ... and none at this gap (world units, from the edge of its leaves to the edge of the other)
const SPREAD_DOWNWIND = 2; // times the chance for a tree downwind at full wind...
const SPREAD_UPWIND = 0.3; // ... and for one against the wind
const FULL_WIND = 0.5;     // wind speed that counts as full wind
const FLAKE_CHANCE = 0.015;    // a leaf voxel that goes drops a flake of ash this often
const FLAKE_FALL = 0.4;    // world units a second: a flake of ash drifts down this fast
const SHADOW_EVERY = 0.3;  // seconds: the shadow of a burning object is drawn again
const FIRE = ['#fff2a0', '#ffc040', '#ff8a20', '#e04a10'];
const LAMP = new THREE.Color(1, 0.42, 0.08);
const LEAF = 0, WOOD = 1, STONE = 2;   // the materials of a voxel
const CORE = 1.5;          // cells: the core of an object, around the upright line through its middle...
const CORE_COST = 0.1;     // ... a step in it counts this much (the leaves go back toward it, and it goes last, fast)
const WOODS = new Set(['wood', 'wood-dark', 'palm']);   // the stone palettes that are wood

// the material of a part of an object, or -1 (its leaf clumps, water)
function materialOf({ mesh, role }) {
  if (role === 'trunk') return WOOD;
  if (role === 'canopy') return LEAF;
  if (role === 'stone') return WOODS.has(paletteNames('stone')[mesh.material.uniforms.uPal?.value ?? 0]) ? WOOD : STONE;
  return -1;
}
const canBurn = (so) => so.meshes.some((p) => { const m = materialOf(p); return m === LEAF || m === WOOD; });

const fires = new Map();    // object entity -> its fire
fires.ms = [];              // (the tests) milliseconds of the fire, the last frames
const ready = new Map();    // object entity -> its voxels from the fire worker, not used yet
const making = new Map();   // job id -> { entity, parts, size, spots }: the voxels of an object being made
const timing = new Map();   // job id -> the fire whose times (lib/fireTimes.js) are being found
const lights = [];          // fires to light once the voxels of their object are ready: { e, at, near }
let worker = null, jobs = 0, shadowIn = 0, spreadIn = 0;
let button = null, clicked = false;
let wind = { x: 0, z: 0, k: 0 };   // where the wind blows to (world, unit) and how strong (0..1 of FULL_WIND)

// the button: "Set fire to the nearest (B)" while something can burn, "Burning…" while it burns, then "Grow it all
// back" (it reloads)
function showButton(world) {
  if (!button) {
    button = document.createElement('button');
    button.id = 'burn';
    Object.assign(button.style, { position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 20,
      font: 'bold 15px monospace', padding: '8px 16px', color: '#fff4e0', background: '#b8401a', border: '2px solid #ffb060',
      borderRadius: '6px', cursor: 'pointer' });
    button.addEventListener('click', () => {
      button.blur();
      if (button.dataset.state === 'gone') location.reload();
      else clicked = true;
    });
    document.body.append(button);
  }
  const left = query(world, [Prop, SceneObject]).some((e) => !fires.has(e) && canBurn(getComponent(world, e, SceneObject)));
  const state = lights.length || [...fires.values()].some((f) => !f.done) ? 'fire' : left ? 'some' : 'gone';
  if (button.dataset.state === state) return;
  button.dataset.state = state;
  button.textContent = { some: 'Set fire to the nearest (B)', fire: 'Burning…', gone: 'Grow it all back' }[state];
  button.disabled = state === 'fire';
  button.style.opacity = state === 'fire' ? '0.6' : '1';
}

export function fireSystem(world) {
  const settings = getResource(world, Settings), gpu = getResource(world, Gpu), input = getResource(world, Input);
  gpu.fireLamps = [];
  if (!settings.land.burn) return;
  const w = settings.land.wind ?? { dir: 0, speed: 0 }, a = (w.dir * Math.PI) / 180;
  wind = { x: Math.cos(a), z: Math.sin(a), k: Math.min(1, w.speed / FULL_WIND) };
  if (clicked || input.pressed.some(({ key }) => key.toLowerCase() === 'b')) lightNearest(world);
  clicked = false;
  showButton(world);
  window.__fire ??= { fires, light: (e) => ignite(world, e, centre(world, e), false),   // (the tests)
    props: () => query(world, [Prop, Transform, SceneObject]).map((e) => ({ e, name: getComponent(world, e, Prop).name, ...getComponent(world, e, Transform) })) };
  const dt = Math.min(0.05, getResource(world, Time).dt);
  for (let i = lights.length - 1; i >= 0; i--) {
    const l = lights[i];
    if (!hasComponent(world, l.e, SceneObject)) { lights.splice(i, 1); continue; }
    if (ready.has(l.e)) { lights.splice(i, 1); ignite(world, l.e, l.at, l.near); }
  }
  const t0 = performance.now();
  let changing = false;
  for (const [entity, f] of fires) {
    if (!hasComponent(world, entity, SceneObject)) { drop(f); fires.delete(entity); continue; }
    for (const mesh of f.hidden) mesh.visible = false;
    if (f.done || !f.started) continue;
    f.t += dt;
    step(world, f);
    changing = true;
    if (f.next >= f.order.length && !f.active.length) { f.done = true; gpu.shadowsDirty = true; }
  }
  if (changing && (spreadIn -= dt) <= 0) { spreadIn = SPREAD_EVERY; spread(world); }
  if (changing && (shadowIn -= dt) <= 0) { shadowIn = SHADOW_EVERY; gpu.shadowsDirty = true; }
  fires.ms.push(performance.now() - t0);
  if (fires.ms.length > 600) fires.ms.shift();
}

// ------------------------------------------------------------------ lighting
// B or the button: the nearest object that can burn and is not on fire (any distance) catches fire at the voxel nearest
// to the chest of the human (of the wood if it is about as near)
function lightNearest(world) {
  const human = query(world, [Player])[0];
  if (human === undefined) return;
  const p = getComponent(world, human, Player), near = [];
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    if (fires.has(e) || !canBurn(getComponent(world, e, SceneObject))) continue;
    const t = getComponent(world, e, Transform);
    near.push([Math.hypot(t.x - p.x, t.z - p.z), e]);
  }
  near.sort((a, b) => a[0] - b[0]);
  const chest = new THREE.Vector3(p.x, (p.group?.position.y ?? 0) + 0.6, p.z);
  for (const [, e] of near) if (ignite(world, e, chest)) return;
}

// the middle of an object, a little over the ground (world units)
function centre(world, e) {
  const t = getComponent(world, e, Transform);
  return new THREE.Vector3(t.x, (t.y ?? 0) + 0.8, t.z);
}

// the object catches fire at its voxel nearest to the point at (world units; near: whatever its material, else the
// wood first). An object on fire burns on as it is. -> it caught fire (or will, once its voxels are made)
export function ignite(world, entity, at, near = false) {
  if (fires.has(entity)) return false;
  const so = getComponent(world, entity, SceneObject);
  if (!canBurn(so)) return false;
  if (!ready.has(entity)) {
    prepare(world, entity);
    if (!lights.some((l) => l.e === entity)) lights.push({ e: entity, at: at.clone(), near });
    return true;
  }
  const f = fireOf(world, entity);
  const first = firstCell(f, f.so.group.worldToLocal(at.clone()), near);
  if (first < 0) { drop(f); fires.delete(entity); return false; }
  startTimes(f, first);
  return true;
}

// the fire worker makes the voxels of an object (once)
function prepare(world, entity) {
  if (fires.has(entity) || ready.has(entity) || [...making.values()].some((j) => j.entity === entity)) return;
  const so = getComponent(world, entity, SceneObject), settings = getResource(world, Settings);
  const parts = so.meshes.filter((p) => materialOf(p) >= 0);
  if (!parts.length) return;
  const size = (lookOf(world)?.world.size ?? 1 / settings.ppu) * PX;
  if (!worker) {
    worker = new Worker(new URL('../lib/fireWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'times') {
        const f = timing.get(data.id);
        timing.delete(data.id);
        Object.assign(f, { catchT: data.catchT, goneT: data.goneT, order: data.order, leafFirst: data.leafFirst, started: true });
        return;
      }
      const job = making.get(data.id);
      making.delete(data.id);
      if (data.count) ready.set(job.entity, { ...data, ...job });
      else for (let i = lights.length - 1; i >= 0; i--) if (lights[i].e === job.entity) lights.splice(i, 1);   // nothing to burn
    };
  }
  const sent = parts.map((p) => {
    const { p: P, nrm } = triangles(p.mesh.userData.shape ?? p.mesh.geometry, p.mesh.matrix), m = materialOf(p);
    return { p: P, nrm, stays: m !== LEAF, water: 0, leaves: m === LEAF };
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
  making.set(id, { entity, parts, size, spots });
  worker.postMessage({ id, size, parts: sent, wet: 1, seed: 1, patch: 4, patchWater: 0, clumps: at },
    [...sent.flatMap((m) => [m.p.buffer, m.nrm.buffer]), at.buffer]);
}

// the fire of an object, from its voxels: their materials, the mesh that shows them in place of the object, its clumps
function fireOf(world, entity) {
  const d = ready.get(entity);
  ready.delete(entity);
  const so = getComponent(world, entity, SceneObject), gpu = getResource(world, Gpu), { parts, size, count: n } = d;
  const [nx, ny, nz] = d.n;
  const f = {
    entity, so, size, nx, ny, nz, n, grid: d.grid, at: d.at, xyz: d.xyz, nrm: d.nrm, min: d.min, done: false, t: 0,
    offs: [1, -1, nx, -nx, nx * ny, -nx * ny],
    kind: new Uint8Array(n), mid: new Float32Array(n), row: new Float32Array(n), jitter: new Float32Array(n),
    catchT: null, goneT: null, gone: new Uint8Array(n), order: null, next: 0, active: [], started: false, leavesBurning: 0,
    slot: new Int32Array(n).fill(-1), cellAt: new Int32Array(n), count: 0, moved: new Uint8Array(n), dirty: new Int32Array(n), dirtyN: 0,
    hidden: parts.map(({ mesh }) => mesh), sprites: [], clumpsOf: [],
  };
  const looks = parts.map((p) => ({ kind: materialOf(p), mid: p.mesh.material.uniforms.uMid?.value ?? 4, row: p.mesh.material.uniforms.uPal?.value ?? 0 }));
  for (let c = 0; c < n; c++) {
    const l = looks[d.part[c]];
    f.kind[c] = l.kind;
    f.mid[c] = l.mid;
    f.row[c] = l.row;
    f.jitter[c] = Math.random();
  }
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
  for (const c of d.shown) show(f, c);
  // the leaf clumps: their own copy of the sprites, each goes when the voxel under it catches fire
  for (const { mesh: m } of d.spots) if (!m.userData.burnCopy) { m.geometry = m.geometry.clone(); m.userData.burnCopy = true; }
  d.spots.forEach(({ mesh: m, i }, s) => {
    const sp = { attr: m.geometry.getAttribute('iPos'), i, cell: d.clumpAt[s] };
    f.sprites.push(sp);
    if (sp.cell >= 0) (f.clumpsOf[sp.cell] ??= []).push(sp);
  });
  fires.set(entity, f);
  return f;
}

// the first voxel to burn, for a fire lit at a point (units of the object): the nearest voxel that can burn; near:
// whatever its material, else the height counting 3 times, of the wood if there is any (the trunk in front of the
// human, not a leaf over it); -1: none
function firstCell(f, p, near) {
  const v = new THREE.Vector3();
  let best = -1, bestD = Infinity, wood = false;
  for (let s = 0; s < f.count; s++) {
    const c = f.cellAt[s], k = f.kind[c];
    if (k === STONE || (wood && k !== WOOD)) continue;
    cellPos(f, c, v);
    const d = near ? v.distanceToSquared(p) : (v.x - p.x) ** 2 + 9 * (v.y - p.y) ** 2 + (v.z - p.z) ** 2;
    if ((!near && k === WOOD && !wood) || d < bestD) { bestD = d; best = c; if (!near) wood = k === WOOD; }
  }
  return best;
}

// ------------------------------------------------------------------ when each voxel catches fire and goes
// the fire worker finds the times (lib/fireTimes.js); the fire starts when they come back
function startTimes(f, first) {
  // the wind in the units of the object
  const w = new THREE.Vector3(wind.x, 0, wind.z).transformDirection(f.so.group.matrixWorld.clone().invert());
  const id = jobs++;
  timing.set(id, f);
  worker.postMessage({ type: 'times', id, n: f.n, grid: f.grid, at: f.at, xyz: f.xyz, kind: f.kind, nx: f.nx, ny: f.ny,
    minY: f.min[1], ax: -f.min[0] - 0.5, az: -f.min[2] - 0.5, first, match: MATCH,
    up: UP, down: DOWN, wx: w.x, wz: w.z, windK: wind.k, windWith: WIND_WITH, windAgainst: WIND_AGAINST,
    leafStep: f.size / LEAF_SPEED, woodStep: f.size / WOOD_SPEED, size: f.size, retreat: RETREAT,
    leafMin: LEAF_FLAME + ASH_T, core: CORE, coreCost: CORE_COST });
}

// ------------------------------------------------------------------ each frame
// the heat of a voxel at the time t, for the post pass (render/shaders.js burnColor)
function heatOf(f, c, t, now) {
  const k = f.kind[c], ct = f.catchT[c], j = f.jitter[c];
  if (k === STONE || t < ct - HEAT_T) return 0;
  if (t < ct) return 0.22 * (t - ct + HEAT_T) / HEAT_T;   // it turns red
  const flame = flameOf(f, c);
  if (t < ct + flame) {
    // each voxel its own colour (red, yellow, orange), and it flickers
    const a = (t - ct) / flame, flick = 0.07 * Math.sin(now * (9 + j * 7) + j * 40);
    return Math.min(0.495, Math.max(0.251, 0.25 + 0.25 * (a * 0.65 + j * 0.35) + flick));
  }
  // a leaf: it glows red, darker and darker, like the edge of burning paper, and goes (it never turns black: the leaves
  // are a ball of fire to the end)
  if (k === LEAF) return 0.52 + 0.16 * Math.min(1, (t - ct - flame) / ASH_T);
  // wood: embers (about half the voxels glow; the others are black at once), then black
  if (t < ct + flame + WOOD_EMBER) return j < 0.55 ? 0.79 : 0.5 + 0.3 * (t - ct - flame) / WOOD_EMBER;
  return 0.8;
}

// seconds a voxel burns: wood WOOD_FLAME; a leaf until ASH_T before its time to go
const flameOf = (f, c) => (f.kind[c] === LEAF ? f.goneT[c] - ASH_T - f.catchT[c] : WOOD_FLAME);

// the time of a voxel when it changes no more (the wood black, a leaf gone)
const endOf = (f, c) => (f.kind[c] === LEAF ? f.goneT[c] : f.catchT[c] + WOOD_FLAME + WOOD_EMBER);

function step(world, f) {
  const t = f.t, now = performance.now() / 1000, gpu = getResource(world, Gpu);
  while (f.next < f.order.length && f.catchT[f.order[f.next]] - HEAT_T <= t) f.active.push(f.order[f.next++]);
  const g = f.so.group.matrixWorld, v = new THREE.Vector3(), mid = new THREE.Vector3(), lit = [];
  let leaves = 0;
  f.active = f.active.filter((c) => {
    const s = f.slot[c];
    if (f.kind[c] === LEAF && t >= f.goneT[c]) {
      // gone, where it is: the voxels it hid show; sometimes a flake of ash
      if (s >= 0 && Math.random() < FLAKE_CHANCE) flake(world, cellPos(f, c, v).applyMatrix4(g), f.size, Math.random() < 0.7 ? '#5a5450' : '#2a2422');
      f.gone[c] = 1;
      hide(f, c);
      for (const o of f.offs) { const d = f.grid[f.at[c] + o]; if (d >= 0) show(f, d); }
      return false;
    }
    if (s >= 0) put(f, s, false, t, now);
    if (t >= f.catchT[c]) {
      for (const sp of f.clumpsOf[c] ?? []) clump(sp);
      const burning = t < f.catchT[c] + flameOf(f, c);
      if (burning && f.kind[c] === LEAF) leaves++;
      if (burning && s >= 0) { lit.push(c); cellPos(f, c, v); mid.add(v); }
    }
    return t < endOf(f, c);
  });
  f.leavesBurning = leaves;
  if (t >= f.leafFirst) for (const sp of f.sprites) if (sp.cell < 0) clump(sp);
  // the slots that moved
  for (let i = 0; i < f.dirtyN; i++) { const s = f.dirty[i]; f.moved[s] = 0; if (s < f.count) put(f, s, true, t, now); }
  f.dirtyN = 0;
  f.mesh.count = f.count;
  f.mesh.instanceMatrix.needsUpdate = true;
  f.matAttr.needsUpdate = true;
  if (!lit.length) return;
  // the lamp at the middle of the burning voxels that show; by day faint, at night it lights around it
  mid.divideScalar(lit.length).applyMatrix4(g);
  const strength = Math.min(1, lit.length / 1500), night = getResource(world, Settings).land.night ?? 0;
  gpu.fireLamps.push({ x: mid.x, y: mid.y, z: mid.z, r: 1.6 + 2.6 * strength, color: LAMP, k: (0.15 + 0.4 * strength) * (0.35 + 0.65 * night), flicker: true, ph: f.entity });
  // cubes of fire rise from some of them and lean with the wind
  const wx = wind.x * wind.k * 0.5, wz = wind.z * wind.k * 0.5;
  for (let i = Math.min(30, Math.ceil(lit.length / 60)); i > 0; i--) {
    cellPos(f, lit[Math.floor(Math.random() * lit.length)], v).applyMatrix4(g);
    const r = Math.random();
    burnCube(world, v.x, v.y + f.size, v.z, f.size * (1 + Math.random() * 1.5), FIRE[Math.floor(r * r * FIRE.length)], 0.35 + Math.random() * 0.5,
      wx + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 1.2, wz + (Math.random() - 0.5) * 0.3, true);
  }
  // embers rise with the hot air; flakes of ash drift down
  if (Math.random() < Math.min(0.8, lit.length / 2000)) {
    cellPos(f, lit[Math.floor(Math.random() * lit.length)], v).applyMatrix4(g);
    if (Math.random() < 0.5) burnCube(world, v.x, v.y, v.z, f.size * 0.6, '#ff7a20', 0.8 + Math.random() * 0.8, wx, 0.8 + Math.random() * 0.6, wz, true, 0.4);
    else flake(world, v, f.size, '#3a3431');
  }
}

// a slot: its colour, and its place when another voxel took it (place)
function put(f, s, place, t, now) {
  const c = f.cellAt[s], A = f.matAttr.array;
  A[s * 3] = f.mid[c]; A[s * 3 + 1] = f.row[c]; A[s * 3 + 2] = heatOf(f, c, t, now);
  if (!place) return;
  const M = f.mesh.instanceMatrix.array, e = f.size, [mx, my, mz] = f.min, k = f.at[c];
  const x = k % f.nx, y = Math.floor(k / f.nx) % f.ny, z = Math.floor(k / (f.nx * f.ny)), o = s * 16;
  M[o] = e; M[o + 1] = M[o + 2] = M[o + 3] = M[o + 4] = 0; M[o + 5] = e; M[o + 6] = M[o + 7] = M[o + 8] = M[o + 9] = 0;
  M[o + 10] = e; M[o + 11] = 0;
  M[o + 12] = (x + mx + 0.5) * e; M[o + 13] = (y + my + 0.5) * e; M[o + 14] = (z + mz + 0.5) * e; M[o + 15] = 1;
}

// a leaf clump goes
function clump(sp) {
  if (sp.gone) return;
  sp.gone = true;
  sp.attr.setX(sp.i, 1e5);
  sp.attr.needsUpdate = true;
}

// a flake of ash: small, it drifts down slowly with the wind and swings from side to side
function flake(world, v, size, color) {
  const k = 0.7 + Math.random() * 0.6;
  burnCube(world, v.x, v.y, v.z, size * 0.6, color, 1.6 + Math.random() * 1.6,
    wind.x * wind.k * 0.5 * k, -FLAKE_FALL * k, wind.z * wind.k * 0.5 * k, true, 0.5);
}

// ------------------------------------------------------------------ tree to tree
// each tree whose leaves burn tries to light each tree near it that is not on fire: SPREAD times how near it is, more
// downwind, less against the wind. A tree near enough gets its voxels made now, so they are ready
function spread(world) {
  const targets = [];
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    if (fires.has(e) || lights.some((l) => l.e === e)) continue;
    const so = getComponent(world, e, SceneObject);
    if (!canBurn(so)) continue;
    const t = getComponent(world, e, Transform);
    targets.push({ e, x: t.x, z: t.z, r: reach(so) });
  }
  for (const [source, f] of fires) {
    if (f.done || !f.leavesBurning) continue;
    const st = getComponent(world, source, Transform), sr = reach(f.so);
    for (const t of targets) {
      const dx = t.x - st.x, dz = t.z - st.z, d = Math.hypot(dx, dz), gap = d - sr - t.r;
      if (gap > RANGE + 1) continue;
      prepare(world, t.e);
      if (gap >= RANGE) continue;
      const along = d > 0 ? (dx * wind.x + dz * wind.z) / d : 0;
      const w = 1 + wind.k * (along > 0 ? (SPREAD_DOWNWIND - 1) * along : (1 - SPREAD_UPWIND) * along);
      if (Math.random() >= SPREAD * (1 - Math.max(0, gap) / RANGE) * w) continue;
      ignite(world, t.e, centre(world, source), true);
      t.lit = true;
    }
    for (let i = targets.length - 1; i >= 0; i--) if (targets[i].lit) targets.splice(i, 1);
  }
}

// how far an object reaches from its middle over the ground (its leaves, not only its trunk): from its shapes, once
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

// ------------------------------------------------------------------ the voxels in the mesh
function show(f, c) {
  if (f.slot[c] >= 0 || f.gone[c]) return;
  const s = f.count++;
  f.slot[c] = s;
  f.cellAt[s] = c;
  mark(f, s);
  f.nrmAttr.array.set(f.nrm.subarray(c * 3, c * 3 + 3), s * 3);
  f.nrmAttr.needsUpdate = true;
}

// a slot whose voxel changed (a new one, or another voxel took it): its place, size and colour are written this frame
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

// the centre of a voxel, in the units of the object
function cellPos(f, c, out) {
  const k = f.at[c], [mx, my, mz] = f.min;
  return out.set((k % f.nx + mx + 0.5) * f.size, (Math.floor(k / f.nx) % f.ny + my + 0.5) * f.size, (Math.floor(k / (f.nx * f.ny)) + mz + 0.5) * f.size);
}

function drop(f) {
  f.mesh.parent?.remove(f.mesh);
  f.mesh.geometry.dispose();
  f.mesh.material.dispose();
}
