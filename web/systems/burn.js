// Objects that burn voxel by voxel (a world with "burn": true, like worlds/burn-test.json: the button at the top, or B).
// An object becomes voxels of the fire (PX voxels of the look each, lib/voxels.js lookOf). Each voxel has a material
// (assets/materials.json: by the role of its part, or the palette of a stone part) that says what fire does to it, and a
// state (STATE):
//   normal   it does not burn (and a material that does not burn stays so: stone, water)
//   heating  the fire near it heats it: it turns red; with enough heat it catches fire; with less it cools down again
//   burning  red, yellow, orange; it gives heat to the voxels next to it (most to the one above, least to the one under
//            it, more to the one the wind blows to) and some to the ones 2 away; hot air goes up, so it also heats the
//            voxels over it up to CLIMB high (leaning with the wind): the fire climbs in tongues
//   embers   about half of them glow, then go dark
//   burnt    black. A material with after "char" stays so (the wood)
//   ash      (after "gone") grey, it shrinks
//   gone     (after "gone") nothing, where it was: the voxels it hid show
// Each part of an object is dry in some places and wet in others (patches of PATCH voxels): a dry voxel catches fire
// sooner, a wet one needs more heat and resists more. A fire can die out by itself: a voxel with enough heat may resist
// (material resists: it does not catch fire this time, loses its heat and needs more next time); each voxel keeps only
// part of the strength of the fire that lit it (material keeps), and a fire too weak (under MIN_POWER) gives no heat.
// A burning object sends a spark to an object that can burn near it (a gap under JUMP_MAX), more often when the gap is
// small, the fire strong and the wind blows that way; where the spark lands a weaker fire starts (JUMP_KEEP): so a forest
// fire gets weaker from tree to tree, and a clearing, a path or water stops it. Rain (the second button) puts the
// burning voxels out (they stay black), and the fire gives less heat and jumps less.
// A piece of voxels of a material that is gone at the end (the leaves) that is no longer joined, voxel by voxel, to a
// material that stays (the wood) or to the ground falls as one piece, faster and faster, and breaks up where it lands
// (what burns there burns on a little). The fire starts at the voxel nearest to the human. The voxels are one instanced
// mesh in the G-buffer (render/shaders.js BURN_VERT, BURN_FRAG); the post pass colours them by their heat (burnColor).
// The leaves (sprites) go when the voxel under them catches fire. Cubes of fire rise from the voxels that burn
// (systems/blasts.js burnCube), embers rise and flakes of ash drift down with the wind, and one lamp of the fire lights
// around it (systems/clouds.js lampSystem). When nothing burns any more, what is left stays (the black wood, the stone;
// it still stops a walker).
import * as THREE from 'three';
import { query, getComponent, hasComponent, getResource } from '../ecs/world.js';
import { Prop, SceneObject, Player, Transform, CameraRig } from '../components.js';
import { Gpu, Settings, Input, Time } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';
import { paletteNames } from '../gen/palettes.js';
import { voxelize, decodeNormal } from '../lib/voxelCore.js';
import { lookOf, triangles, oneSided } from '../lib/voxels.js';
import { burnCube } from './blasts.js';

export const STATE = { normal: 0, heating: 1, burning: 2, embers: 3, burnt: 4, ash: 5, gone: 6 };
const { normal: NORMAL, heating: HEATING, burning: BURNING, embers: EMBERS, burnt: BURNT, ash: ASH, gone: GONE } = STATE;

const PX = 2;            // a voxel of the fire: PX voxels of the look on each side
const HEAT = 4;          // heat a burning voxel gives a voxel next to it, a second (at 1 it catches fire, about)
const UP = 2.5, SIDE = 1, DOWN = 0.7;   // ... times this, by where that voxel is
const INNER = 0.3;       // a voxel hidden inside the shape takes this much of the heat: the fire runs over the outside, and
                         // the inside burns after, once the voxels over it are gone (else it goes up through the inside
                         // first and the whole outside catches fire at once)
const FAR = 0.35;        // ... and the voxels 2 away (to the sides and under it) get this much of it, so a voxel heats
                         // (turns red) before the fire reaches it
const CLIMB = 5;         // hot air goes up: a burning voxel also heats the voxels over it, up to this many voxels high...
const CLIMB_HEAT = 0.9;  // ... the one 2 over it UP times this much of the heat, and less higher up (divided by the height - 1)
const PATCH = 4;         // voxels: the size of the dry and wet patches of an object
const COOL = 0.35;       // a heated voxel loses this part of its heat a second (it cools down when the fire near it goes)
const WIND = [0.92, 0.39];   // where the wind blows to (x, z in the world; the rain slants the same way)
const WIND_SPREAD = 0.6; // the fire spreads 1 + this as fast to the voxel the wind blows to, 1 - this to the one against it
const WIND_LEAN = 0.3;   // the hot air over a fire moves this many voxels with the wind for each voxel up
const WIND_SPEED = 0.5;  // world units a second: the fire cubes, the embers and the flakes of ash go with the wind
const FLAKE_FALL = 0.4;  // world units a second: a flake of ash drifts down this fast
const JOIN_EVERY = 0.15;  // seconds: which voxels are still joined to the wood or the ground is looked at again (when one went)
const GRAVITY = 9;       // world units a second, a second: a piece that falls
const FALL_MAX = 1.2;    // world units a second: a piece falls at most this fast times 1 + the cube root of its voxels
const MIN_POWER = 0.2;    // a burning voxel weaker than this gives no heat
const JUMP_MAX = 2;      // world units: a burning object sets fire to an object at most this far (from a burning voxel to
                         // the edge of that object)
const JUMP_RATE = 0.8;   // times a second it does, at a gap of 0 and full strength (less with a bigger gap, a weaker fire)
const JUMP_KEEP = 0.65;  // the strength the new fire keeps
const JUMP_EVERY = 0.25; // seconds between two looks for an object to jump to
const SPARK_TIME = 0.7;  // seconds the spark of a fire that jumps flies to the object it sets fire to
const RAIN_HEAT = 0.35;  // in the rain a burning voxel gives this much of its heat
const RAIN_OUT = 0.6;    // ... and goes out (it stays black) this many times a second
const RAIN_JUMP = 0.2;   // ... and a fire jumps this much as often
const RAIN_DROPS = 320;  // drops of rain a second
const SHADOW_EVERY = 0.3;   // seconds: the shadow of a burning object is drawn again
const FIRE = ['#fff2a0', '#ffc040', '#ff8a20', '#e04a10'];
const LAMP = new THREE.Color(1, 0.42, 0.08);

// assets/materials.json: name -> material (with its defaults), and which material a part has
const json = await fetch(new URL('../../assets/materials.json', import.meta.url)).then((r) => r.json());
const MATERIALS = Object.entries(json.materials).map(([name, m]) => ({
  name, burns: !!m.burns, catches: m.catches ?? 0, burnTime: m.burnTime ?? 0, emberTime: m.emberTime ?? 0,
  after: m.after ?? 'char', charTime: m.after === 'gone' ? m.charTime ?? 0 : Infinity, stays: (m.after ?? 'char') !== 'gone',
  resists: m.resists ?? 0, keeps: m.keeps ?? 1,
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
let shadowIn = 0, jumpIn = 0;
const sparks = [];          // sparks of fires that jump, on their way: { e, from, to, t, power }
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
  const left = query(world, [Prop, SceneObject]).some((e) => !fires.has(e) && canBurn(getComponent(world, e, SceneObject)));
  const state = [...fires.values()].some((f) => !f.done) || sparks.length ? 'fire' : left ? 'some' : 'gone';
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
  if (!fires.size) return;
  let burning = false;
  for (const [entity, fire] of fires) {
    if (!hasComponent(world, entity, SceneObject)) { drop(fire); fires.delete(entity); continue; }
    if (fire.done) { for (const mesh of fire.hidden) mesh.visible = false; continue; }   // what is left
    step(fire, dt);
    draw(world, fire, gpu);
    burning = true;
    if (!fire.live && !fire.pieces.length && !fire.breaking.length) { cool(fire); draw(world, fire, gpu); fire.done = true; gpu.shadowsDirty = true; }
  }
  if (burning && (jumpIn -= dt) <= 0) { jumpIn = JUMP_EVERY; jumps(world); }
  if (burning && (shadowIn -= dt) <= 0) { shadowIn = SHADOW_EVERY; gpu.shadowsDirty = true; }
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

// a fire died out: the voxels it heated but did not light cool down
function cool(f) {
  for (let c = 0; c < f.n; c++) if (f.state[c] === HEATING) { f.state[c] = NORMAL; f.heat[c] = 0; }
}

// a burning object sets fire to the objects that can burn near it: for each, the burning voxel nearest to it (over the
// ground), the gap to its edge, and a chance by the gap and the strength of that voxel
function jumps(world) {
  const v = new THREE.Vector3(), targets = [];
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    if (fires.has(e) || sparks.some((s) => s.e === e) || !canBurn(getComponent(world, e, SceneObject))) continue;
    const t = getComponent(world, e, Transform);
    targets.push({ e, x: t.x, z: t.z, r: reach(getComponent(world, e, SceneObject)) });
  }
  if (!targets.length) return;
  for (const f of [...fires.values()]) {
    if (f.done) continue;
    const g = f.so.group.matrixWorld;
    for (const t of targets) {
      if (fires.has(t.e) || sparks.some((s) => s.e === t.e)) continue;
      let gap = Infinity, power = 0;
      const at = new THREE.Vector3();
      for (let i = 0; i < f.live; i++) {
        const c = f.active[i];
        if (f.state[c] !== BURNING || f.power[c] < MIN_POWER) continue;
        cellPos(f, c, v).applyMatrix4(g);
        const d = Math.hypot(v.x - t.x, v.z - t.z) - t.r;
        if (d < gap) { gap = d; power = f.power[c]; at.copy(v); }
      }
      if (gap >= JUMP_MAX) continue;
      // more often when the wind blows from the fire to that object
      const dx = t.x - at.x, dz = t.z - at.z, dl = Math.hypot(dx, dz) || 1;
      const wind = Math.max(0.2, 1 + WIND_SPREAD * (dx * WIND[0] + dz * WIND[1]) / dl);
      const rate = JUMP_RATE * power * (1 - Math.max(0, gap) / JUMP_MAX) * wind * (rain ? RAIN_JUMP : 1);
      if (Math.random() >= 1 - Math.exp(-rate * JUMP_EVERY)) continue;
      // a spark flies from that voxel to the side of the object that faces it
      const to = new THREE.Vector3(t.x - (dx / dl) * t.r * 0.6, Math.max(0.3, at.y), t.z - (dz / dl) * t.r * 0.6);
      sparks.push({ e: t.e, from: at.clone(), to, t: 0, power: power * JUMP_KEEP });
    }
  }
}

// the sparks on their way: a glowing cube that flies in an arc and leaves a short trail; where it lands, the object
// catches fire
function flySparks(world, dt) {
  const v = new THREE.Vector3();
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i], k = Math.min(1, (s.t += dt) / SPARK_TIME);
    v.lerpVectors(s.from, s.to, k);
    v.y += Math.sin(Math.PI * k) * 0.6;
    burnCube(world, v.x, v.y, v.z, 0.07, FIRE[Math.floor(Math.random() * 2)], 0.12, 0, 0, 0, true);
    if (Math.random() < 0.5) burnCube(world, v.x, v.y, v.z, 0.04, FIRE[2], 0.3 + Math.random() * 0.2, 0, 0.2, 0, true);
    if (k < 1) continue;
    sparks.splice(i, 1);
    if (hasComponent(world, s.e, SceneObject)) ignite(world, s.e, s.to, s.power, true);
  }
}

// B or the button: the nearest object that can burn (any distance) catches fire at the voxel nearest to the chest of
// the human
function lightNearest(world) {
  const human = query(world, [Player])[0];
  if (human === undefined) return;
  const p = getComponent(world, human, Player);
  let best = -1, bestD = Infinity;
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    if (fires.has(e) || !canBurn(getComponent(world, e, SceneObject))) continue;
    const t = getComponent(world, e, Transform), d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best < 0) return;
  ignite(world, best, new THREE.Vector3(p.x, (p.group?.position.y ?? 0) + 0.6, p.z), 1, false);
}

// the object entity catches fire at the voxel that can burn nearest to the point at (world units), with this strength
// (1: a new fire); near: the nearest voxel whatever its material (a fire that jumps), else the solid part first
export function ignite(world, entity, at, power = 1, near = false) {
  if (fires.has(entity)) return;
  const so = getComponent(world, entity, SceneObject), settings = getResource(world, Settings), gpu = getResource(world, Gpu);
  if (!canBurn(so)) return;
  const size = (lookOf(world)?.world.size ?? 1 / settings.ppu) * PX;
  const parts = so.meshes.filter((p) => p.role !== 'leaves' && p.role !== 'water');
  const vol = partsVolume(parts, size);
  if (!vol) return;
  const [nx, ny, nz] = vol.n, grid = new Int32Array(nx * ny * nz).fill(-1);
  let n = 0;
  for (let k = 0; k < grid.length; k++) if (vol.data[k]) grid[k] = n++;
  const fire = {
    entity, so, size, nx, ny, nz, grid, n, done: false,
    at: new Int32Array(n), xyz: new Int16Array(n * 3), mat: new Uint8Array(n), state: new Uint8Array(n), inner: new Uint8Array(n),
    more: new Float32Array(n), heat: new Float32Array(n), need: new Float32Array(n), lit: new Float32Array(n).fill(-1),
    slot: new Int32Array(n).fill(-1), cellAt: new Int32Array(n), count: 0, active: new Int32Array(n), live: 0,
    joined: new Uint8Array(n).fill(1), cut: true, joinIn: 0,
    power: new Float32Array(n), src: new Float32Array(n), out: new Uint8Array(n),
    loose: new Uint8Array(n), off: new Float32Array(n), jitter: new Float32Array(n), dry: new Float32Array(n),
    warm: new Int32Array(n), warmN: 0, piece: new Int32Array(n), pieces: [], pieceId: 0, breaks: new Float32Array(n), breaking: [],
    mid: new Float32Array(n), row: new Float32Array(n), hidden: parts.map(({ mesh }) => mesh), sprites: [], bits: [],
  };
  const dryAt = patches(Math.floor(Math.random() * 1e9));
  const nrm = new Float32Array(n * 3), dec = [0, 0, 0];
  const looks = parts.map((p) => ({ mat: materialOf(p), mid: p.mesh.material.uniforms.uMid?.value ?? 4, row: p.mesh.material.uniforms.uPal?.value ?? 0 }));
  for (let k = 0; k < grid.length; k++) {
    const c = grid[k];
    if (c < 0) continue;
    const l = looks[vol.data[k] - 1];
    fire.at[c] = k;
    fire.xyz.set([k % nx, Math.floor(k / nx) % ny, Math.floor(k / (nx * ny))], c * 3);
    fire.mat[c] = l.mat;
    fire.mid[c] = l.mid;
    fire.row[c] = l.row;
    // dry: from 0.5 (a wet patch: it takes half the heat, needs more and resists more) to 1.5 (a dry patch)
    const dry = Math.min(1, Math.max(0, (dryAt(fire.xyz[c * 3], fire.xyz[c * 3 + 1], fire.xyz[c * 3 + 2]) - 0.5) * 1.8 + 0.5));
    fire.dry[c] = 0.5 + dry;
    fire.need[c] = (0.6 + 0.9 * (1 - dry)) * (0.85 + Math.random() * 0.3);
    fire.jitter[c] = Math.random();
    const code = vol.normals?.[k] ?? 0;
    if (code) nrm.set(decodeNormal(code, dec), c * 3);   // 0: it was filled in (inside the shape)
  }
  fire.min = vol.min;
  // a material that is gone at the end: not all its voxels at the same time
  for (let c = 0; c < n; c++) if (mat(fire, c).after === 'gone') fire.more[c] = Math.random() * 0.6;
  // the mesh: room for every voxel; only the ones that show are drawn (the first `count`)
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  fire.nrmAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  fire.matAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  fire.matAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iNrm', fire.nrmAttr);
  geometry.setAttribute('iMat', fire.matAttr);
  fire.nrm = nrm;
  const mesh = new THREE.InstancedMesh(geometry, shaderMaterial(gpu.shared, S.BURN_VERT, S.BURN_FRAG), n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.layers.enable(1);      // it casts a shadow
  mesh.count = 0;
  so.group.add(mesh);
  so.group.updateMatrixWorld(true);
  fire.mesh = mesh;
  windOf(fire);
  // the voxels that show: the ones next to an empty cell
  for (let c = 0; c < n; c++) if (open(fire, fire.at[c])) show(fire, c); else fire.inner[c] = 1;
  // the leaf clumps: their own copy of the sprites, each goes with the voxel of the canopy under it
  const canopy = byName.get(json.parts.canopy);
  for (const { mesh: leaves, role } of so.meshes) {
    if (role !== 'leaves') continue;
    leaves.geometry = leaves.geometry.clone();
    const pos = leaves.geometry.getAttribute('iPos'), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(leaves.matrix);
      fire.sprites.push({ attr: pos, i, cell: nearestCell(fire, v, canopy) });
    }
  }
  // the first voxel, and the ones around it
  const first = firstCell(fire, so.group.worldToLocal(at.clone()), near);
  if (first < 0) return drop(fire);
  for (const c of [first, ...neighbours(fire, first)]) if (c >= 0) { fire.src[c] = power; light(fire, c); }
  fires.set(entity, fire);
  window.__burn = fires;   // for the tests
}

// the voxels of the parts of an object, filled: each part alone (filled as one shape, so its inside takes its own
// material: in one volume the inside of the leaves next to the trunk took the colour of the trunk, a branch that is not
// there), then all in one grid (the grid starts at 0 in the units of the object for every part); where they meet, a
// material that stays wins (the trunk goes on inside the leaves). -> { min, n, data (part + 1, 0: empty),
// normals } like voxelize, or null
function partsVolume(parts, size) {
  const vols = parts.map(({ mesh }) => voxelize([{ tris: oneSided(triangles(mesh.userData.shape ?? mesh.geometry, mesh.matrix)), color: 0 }],
    size, { normals: true, fill: true, view: [0, 1, 0] }));
  const some = vols.filter(Boolean);
  if (!some.length) return null;
  const min = [0, 1, 2].map((a) => Math.min(...some.map((v) => v.min[a])));
  const n = [0, 1, 2].map((a) => Math.max(...some.map((v) => v.min[a] + v.n[a])) - min[a]);
  const data = new Uint32Array(n[0] * n[1] * n[2]), normals = new Uint16Array(data.length);
  const holds = (c) => (MATERIALS[materialOf(parts[c])]?.stays ? 1 : 0);
  const order = parts.map((_, c) => c).sort((a, b) => holds(a) - holds(b));
  for (const c of order) {
    const v = vols[c];
    if (!v) continue;
    const [vx, vy, vz] = v.n, [ox, oy, oz] = [0, 1, 2].map((a) => v.min[a] - min[a]);
    for (let z = 0; z < vz; z++) for (let y = 0; y < vy; y++) for (let x = 0; x < vx; x++) {
      const k = x + vx * (y + vy * z);
      if (!v.data[k]) continue;
      const K = x + ox + n[0] * (y + oy + n[1] * (z + oz));
      data[K] = c + 1;
      normals[K] = v.normals[k];
    }
  }
  return { min, n, data, normals };
}

// the wind in the units of the object (it may be turned): how much heat goes to each of the 6 voxels next to a burning
// one (more to the one the wind blows to), and the voxels over it that the hot air heats (leaning with the wind)
function windOf(f) {
  const w = new THREE.Vector3(WIND[0], 0, WIND[1]).transformDirection(f.so.group.matrixWorld.clone().invert());
  f.weight = [SIDE * (1 + WIND_SPREAD * w.x), SIDE * (1 - WIND_SPREAD * w.x), UP, DOWN, SIDE * (1 + WIND_SPREAD * w.z), SIDE * (1 - WIND_SPREAD * w.z)];
  f.climb = [];
  for (let h = 2; h <= CLIMB; h++) {
    const dx = Math.round(h * WIND_LEAN * w.x), dz = Math.round(h * WIND_LEAN * w.z);
    f.climb.push({ dx, dy: h, dz, o: dx + h * f.nx + dz * f.nx * f.ny, w: (UP * CLIMB_HEAT) / (h - 1) });
  }
}

// smooth noise from 0 to 1 that changes over about PATCH voxels (the dry and wet patches): a function of a cell
function patches(seed) {
  const hash = (x, y, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const ease = (t) => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
  return (x, y, z) => {
    x /= PATCH; y /= PATCH; z /= PATCH;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = ease(x - X), v = ease(y - Y), w = ease(z - Z);
    const at = (i, j, k) => hash(X + i, Y + j, Z + k);
    return lerp(lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
      lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w);
  };
}

// ------------------------------------------------------------------ the voxels
const offsets = (f) => [1, -1, f.nx, -f.nx, f.nx * f.ny, -f.nx * f.ny];
const mat = (f, c) => MATERIALS[f.mat[c]];
const total = (f, c) => { const m = mat(f, c); return m.burnTime + m.emberTime + m.charTime + f.more[c]; };
const emberOf = (f, c) => mat(f, c).emberTime * (0.6 + 0.8 * f.jitter[c]);   // some embers glow longer than others

function neighbours(f, c) {
  const k = f.at[c];
  return offsets(f).map((o) => f.grid[k + o]);
}

// a cell of the grid next to an empty one (the grid has an empty border, so k + o is always in it)
function open(f, k) {
  for (const o of offsets(f)) { const d = f.grid[k + o]; if (d < 0 || f.state[d] === GONE) return true; }
  return false;
}

// a voxel catches fire (if its material burns and it did not yet), with the strength of the fire that lit it (src)
// times what its material keeps
function light(f, c) {
  if (f.state[c] > HEATING || !mat(f, c).burns) return;
  f.power[c] = f.src[c] * mat(f, c).keeps;
  f.state[c] = BURNING;
  f.lit[c] = 0;
  f.heat[c] = f.need[c];
  f.active[f.live++] = c;
}

function show(f, c) {
  if (f.slot[c] >= 0 || f.state[c] === GONE) return;
  const s = f.count++;
  f.slot[c] = s;
  f.cellAt[s] = c;
  f.nrmAttr.array.set(f.nrm.subarray(c * 3, c * 3 + 3), s * 3);
  f.nrmAttr.needsUpdate = true;
}

function hide(f, c) {
  const s = f.slot[c];
  if (s < 0) return;
  const last = --f.count, moved = f.cellAt[last];
  if (moved !== c) {
    f.cellAt[s] = moved;
    f.slot[moved] = s;
    f.nrmAttr.array.copyWithin(s * 3, last * 3, last * 3 + 3);
    f.nrmAttr.needsUpdate = true;
  }
  f.slot[c] = -1;
}

// the state of a voxel that caught fire, by the seconds since (and its material)
function stateAt(f, c, t) {
  const m = mat(f, c);
  if (f.out[c]) return BURNT;   // the rain put it out
  if (t < m.burnTime) return BURNING;
  if (t < m.burnTime + emberOf(f, c)) return EMBERS;
  if (t >= total(f, c)) return GONE;
  // black, then grey ash for the end of its time
  return m.after === 'gone' && t >= total(f, c) - (total(f, c) - m.burnTime - emberOf(f, c)) * 0.45 ? ASH : BURNT;
}

// the fire moves on: the heated voxels cool a little; the burning voxels heat the ones near them; each voxel that caught
// fire goes from state to state
function step(f, dt) {
  const offs = offsets(f), born = [], wet = rain ? RAIN_HEAT : 1, out = 1 - Math.exp(-RAIN_OUT * dt), keepHeat = Math.exp(-COOL * dt);
  let w = 0;
  for (let i = 0; i < f.warmN; i++) {
    const c = f.warm[i];
    if (f.state[c] !== HEATING) continue;
    if ((f.heat[c] *= keepHeat) < 0.03) { f.heat[c] = 0; f.state[c] = NORMAL; continue; }   // cold again
    f.warm[w++] = c;
  }
  f.warmN = w;
  let keep = 0;
  for (let i = 0; i < f.live; i++) {
    const c = f.active[i], t = (f.lit[c] += dt);
    let s = (f.state[c] = stateAt(f, c, t));
    // the rain puts a burning voxel out (not one that already broke up on the ground)
    if (rain && s === BURNING && !f.loose[c] && Math.random() < out) { f.out[c] = 1; s = f.state[c] = BURNT; }
    if (f.out[c]) continue;   // put out: black, it does not change any more
    if (s === BURNING && f.power[c] >= MIN_POWER) {
      const k = f.at[c], x = f.xyz[c * 3], y = f.xyz[c * 3 + 1], z = f.xyz[c * 3 + 2], pw = f.power[c] * wet;
      // the 6 next to it, and the ones 2 away to the sides and under it
      for (let j = 0; j < 12; j++) {
        if (j === 8) continue;   // 2 over it: the hot air (below)
        if (j >= 6) {   // 2 away: still in the grid?
          const a = (j - 6) >> 1, q = f.xyz[c * 3 + a] + ((j - 6) & 1 ? -2 : 2);
          if (q < 0 || q >= [f.nx, f.ny, f.nz][a]) continue;
        }
        heatUp(f, c, f.grid[k + (j < 6 ? offs[j] : offs[j - 6] * 2)], f.weight[j % 6] * (j < 6 ? 1 : FAR) * pw * dt, born);
      }
      // the hot air: the voxels over it, leaning with the wind
      for (const u of f.climb) {
        if (y + u.dy >= f.ny || x + u.dx < 0 || x + u.dx >= f.nx || z + u.dz < 0 || z + u.dz >= f.nz) continue;
        heatUp(f, c, f.grid[k + u.o], u.w * pw * dt, born);
      }
    }
    if (s === GONE) {
      f.cut = true;
      if (f.slot[c] >= 0 && f.bits.length < 60 && Math.random() < 0.04) f.bits.push({ c, kind: 'flake' });   // a flake of ash
      hide(f, c);
      for (const o of offs) { const d = f.grid[f.at[c] + o]; if (d >= 0) { show(f, d); f.inner[d] = 0; } }   // it is outside now
    } else if (s === BURNT && mat(f, c).after === 'char' && t >= mat(f, c).burnTime + mat(f, c).emberTime * 1.4) {
      // black for good: it does not change any more
    } else f.active[keep++] = c;
  }
  f.live = keep;
  for (const c of born) light(f, c);
  fall(f, dt);
}

// the burning voxel c gives heat to the voxel d (by this much, before what d takes of it: its material, dry or wet, inside
// or outside); with enough heat d catches fire (born), or it resists: it loses its heat and needs more next time
function heatUp(f, c, d, much, born) {
  if (d < 0 || f.state[d] > HEATING || !mat(f, d).burns) return;
  if (f.state[d] === NORMAL) { f.state[d] = HEATING; f.warm[f.warmN++] = d; }
  f.heat[d] += HEAT * much * mat(f, d).catches * f.dry[d] * (f.inner[d] ? INNER : 1);
  if (f.power[c] > f.src[d]) f.src[d] = f.power[c];
  if (f.heat[d] < f.need[d]) return;
  // a wet voxel resists more often
  if (Math.random() < mat(f, d).resists * (2.5 - f.dry[d] * 1.5)) { f.heat[d] = 0; f.need[d] *= 1.6; } else born.push(d);
}

// the pieces that fall: each one as one piece, faster and faster, until a voxel of it lands on the ground or on a voxel
// that is not of a piece; there it breaks up. off: how far it fell since its cells (drawn lower by that much); it moves
// down a cell each time it passes one
function fall(f, dt) {
  const { grid, nx } = f, offs = offsets(f), floor = Math.max(1, Math.ceil(-f.min[1] - 0.5));
  if (f.cut && ((f.joinIn -= dt) <= 0 || !f.live)) {   // (at once when nothing else changes, so the fire does not end first)
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
      // under it: the ground or a voxel that stays (it lands), or a piece that falls too (it waits on it)
      let under = 0;
      for (const c of p.cells) {
        if (f.xyz[c * 3 + 1] <= floor) { under = 2; break; }
        const d = grid[f.at[c] - nx];
        if (d < 0 || f.state[d] === GONE || f.piece[d] === p.id) continue;
        under = f.piece[d] ? Math.max(under, 1) : 2;
        if (under === 2) break;
      }
      if (under === 2) { land(f, p); return false; }
      if (under === 1) { p.off = f.size * 0.99; break; }
      p.off -= f.size;
      // one cell down, the bottom ones first (the cells are from the bottom up)
      for (const c of p.cells) { const k = f.at[c]; if (grid[k] === c) grid[k] = -1; grid[k - nx] = c; f.at[c] = k - nx; f.xyz[c * 3 + 1]--; }
      // the voxels next to the cells it left show
      for (const c of p.cells) {
        const k = f.at[c] + nx;
        if (grid[k] >= 0) continue;
        for (const o of offs) { const d = grid[k + o]; if (d >= 0 && f.piece[d] !== p.id) show(f, d); }
      }
    }
    for (const c of p.cells) f.off[c] = p.off;
    return true;
  });
}

// a piece landed: it breaks up. What burns burns on there (a little: it does not join the rest again); green leaves
// fall apart (they shrink and are gone, not all at once); the rest crumbles to ash; and some of it flies off in bits
function land(f, p) {
  for (const c of p.cells) {
    f.off[c] = 0;
    f.piece[c] = 0;
    f.loose[c] = 1;
    show(f, c);
    if (f.state[c] === BURNING && !f.out[c]) continue;
    const s = f.out[c] ? BURNT : f.state[c];
    if (s < BURNING) { f.breaks[c] = 0.3 + Math.random() * 1.5; f.breaking.push(c); }
    else crumble(f, c);
    if (f.slot[c] < 0 || f.bits.length >= 120 || Math.random() > 0.25) continue;
    f.bits.push({ c, kind: 'bit', color: s < BURNING ? '#4a7a3c' : s === EMBERS ? '#ff7a20' : s === ASH ? '#6a6460' : '#2a2422' });
    if (s < BURNING) f.breaks[c] = 0.001; else f.lit[c] = total(f, c);   // it is that bit now
  }
}

// the green leaves of a piece that landed: each shrinks and is gone at its time (unless it caught fire: then it burns)
function breakUp(f, dt) {
  const offs = offsets(f);
  f.breaking = f.breaking.filter((c) => {
    if (f.state[c] >= BURNING) { f.breaks[c] = 0; return false; }
    if ((f.breaks[c] -= dt) > 0) return true;
    f.breaks[c] = 0;
    f.state[c] = GONE;
    f.cut = true;
    hide(f, c);
    for (const o of offs) { const d = f.grid[f.at[c] + o]; if (d >= 0) { show(f, d); f.inner[d] = 0; } }
    return false;
  });
}

// a voxel breaks up: grey ash in about a second, then gone (one that did not burn, or that the rain put out, goes back
// to the voxels that change); from now on it is not joined to anything
function crumble(f, c) {
  f.loose[c] = 1;
  if (f.state[c] < BURNING || f.out[c]) { f.out[c] = 0; f.lit[c] = 0; f.state[c] = ASH; f.active[f.live++] = c; }
  f.lit[c] = Math.max(f.lit[c], total(f, c) - (0.5 + Math.random() * 0.9));
}

// which voxels are joined, voxel by voxel (the 6 next to each), to a voxel of a material that stays (the wood, stone) or
// to the ground (a voxel that broke up on the ground is not joined again); the others make pieces that fall (each the
// voxels joined to one another), their cells from the bottom up
function join(f, floor) {
  const { grid, n } = f, offs = offsets(f), stack = new Int32Array(n);
  const free = (c) => f.state[c] !== GONE && !f.loose[c] && !f.piece[c];
  let top = 0;
  f.joined.fill(0);
  for (let c = 0; c < n; c++) {
    if (!free(c) || (!mat(f, c).stays && f.xyz[c * 3 + 1] > floor)) continue;
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
    f.pieces.push({ id, cells, vel: 0, off: 0 });
  }
}

// the heat of a voxel for the post pass (render/shaders.js burnColor), and its size (it shrinks as ash), by its state
function heatOf(f, c, now) {
  const s = f.state[c], t = f.lit[c], m = mat(f, c), j = f.jitter[c];
  if (s < BURNING && f.breaks[c] > 0) return [0, Math.min(1, f.breaks[c] / 0.4)];   // green, falling apart: it shrinks
  if (s === NORMAL) return [0, 1];
  if (f.out[c]) return [0.8, 1];   // put out by the rain: black
  if (s === HEATING) return [0.22 * Math.min(1, f.heat[c] / f.need[c]), 1];
  if (s === BURNING) {
    // each voxel its own colour (red, yellow, orange), and it flickers
    const k = t / m.burnTime, flick = 0.07 * Math.sin(now * (9 + j * 7) + j * 40);
    return [Math.min(0.495, Math.max(0.251, 0.25 + 0.25 * (k * 0.65 + j * 0.35) + flick)), 1];
  }
  const e = emberOf(f, c);
  // embers: about half the voxels glow; the others are black at once
  if (s === EMBERS) return [j < 0.55 ? 0.79 : 0.5 + 0.3 * ((t - m.burnTime) / e), 1];
  if (m.after === 'char') return [0.8, 1];
  const k = Math.min(1, (t - m.burnTime - e) / Math.max(0.05, total(f, c) - m.burnTime - e));
  return [0.8 + 0.2 * k, k < 0.75 ? 1 : 1 - (k - 0.75) * 2.8];
}

function draw(world, f, gpu) {
  const now = performance.now() / 1000, M = f.mesh.instanceMatrix.array, A = f.matAttr.array, size = f.size;
  const [mx, my, mz] = f.min, nxy = f.nx * f.ny;
  for (let s = 0; s < f.count; s++) {
    const c = f.cellAt[s], k = f.at[c], [h, scale] = heatOf(f, c, now);
    const x = k % f.nx, y = Math.floor(k / f.nx) % f.ny, z = Math.floor(k / nxy), e = size * scale, o = s * 16;
    M[o] = e; M[o + 1] = M[o + 2] = M[o + 3] = M[o + 4] = 0; M[o + 5] = e; M[o + 6] = M[o + 7] = M[o + 8] = M[o + 9] = 0;
    M[o + 10] = e; M[o + 11] = 0;
    M[o + 12] = (x + mx + 0.5) * size; M[o + 13] = (y + my + 0.5) * size - (size - e) * 0.5 - f.off[c]; M[o + 14] = (z + mz + 0.5) * size; M[o + 15] = 1;
    A[s * 3] = f.mid[c]; A[s * 3 + 1] = f.row[c]; A[s * 3 + 2] = h;
  }
  f.mesh.count = f.count;
  f.mesh.instanceMatrix.needsUpdate = true;
  f.matAttr.needsUpdate = true;
  for (const mesh of f.hidden) mesh.visible = false;

  // the leaf clumps over a voxel that caught fire (or has most of the heat it needs, or falls) go
  for (const sp of f.sprites) {
    if (sp.gone || sp.cell < 0) continue;
    const c = sp.cell;
    if (f.state[c] < BURNING && f.heat[c] < f.need[c] * 0.6 && !f.piece[c] && !f.loose[c]) continue;
    sp.gone = true;
    sp.attr.setX(sp.i, 1e5);
    sp.attr.needsUpdate = true;
  }

  // the fire: cubes rise from voxels that burn and show; the lamp at their middle
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
  let burning = 0;
  for (let i = 0; i < f.live; i++) {
    const c = f.active[i];
    if (f.state[c] === BURNING) { burning++; cellPos(f, c, v); mid.add(v); }
  }
  if (!burning) return;
  mid.divideScalar(burning).applyMatrix4(g);
  // by day the lamp is faint (it would paint the whole object orange), at night it lights around it
  const strength = Math.min(1, burning / 1500), night = getResource(world, Settings).land.night ?? 0;
  gpu.fireLamps.push({ x: mid.x, y: mid.y, z: mid.z, r: 1.6 + 2.6 * strength, color: LAMP, k: (0.15 + 0.4 * strength) * (0.35 + 0.65 * night), flicker: true, ph: f.entity });
  const cubes = Math.min(30, Math.ceil(burning / 60));
  for (let i = 0; i < cubes; i++) {
    const c = f.active[Math.floor(Math.random() * f.live)];
    if (f.slot[c] < 0 || f.state[c] !== BURNING) continue;
    cellPos(f, c, v).applyMatrix4(g);
    const r = Math.random();
    // they rise and lean with the wind
    burnCube(world, v.x, v.y + size, v.z, size * (1 + Math.random() * 1.5), FIRE[Math.floor(r * r * FIRE.length)], 0.35 + Math.random() * 0.5,
      WIND[0] * WIND_SPEED + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 1.2, WIND[1] * WIND_SPEED + (Math.random() - 0.5) * 0.3, true);
  }
  // embers rise from the fire with the hot air; flakes of ash drift down
  if (Math.random() < Math.min(0.8, burning / 2000)) {
    const c = f.active[Math.floor(Math.random() * f.live)];
    if (f.slot[c] >= 0) {
      cellPos(f, c, v).applyMatrix4(g);
      if (Math.random() < 0.5) burnCube(world, v.x, v.y, v.z, size * 0.6, '#ff7a20', 0.8 + Math.random() * 0.8,
        WIND[0] * WIND_SPEED, 0.8 + Math.random() * 0.6, WIND[1] * WIND_SPEED, true, 0.4);
      else flake(world, v, size, '#3a3431');
    }
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

// the first voxel to burn, for a fire lit at a point (units of the object): the nearest voxel that shows and can burn;
// near: whatever its material, else the height counting 3 times, of a material that stays if there is one (the
// trunk in front of the human, not a leaf over it); -1: none
function firstCell(f, p, near) {
  const v = new THREE.Vector3();
  let best = -1, bestD = Infinity, solid = false;
  for (let s = 0; s < f.count; s++) {
    const c = f.cellAt[s], m = mat(f, c);
    if (!m.burns || (solid && !m.stays)) continue;
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

// the voxel of a material nearest to a point (units of the object): first in the cells around it, else among all; -1
// when there is none
function nearestCell(f, p, want) {
  const [mx, my, mz] = f.min, s = f.size;
  const gx = Math.floor(p.x / s) - mx, gy = Math.floor(p.y / s) - my, gz = Math.floor(p.z / s) - mz;
  let best = -1, bestD = Infinity;
  const R = 4;
  for (let z = gz - R; z <= gz + R; z++) for (let y = gy - R; y <= gy + R; y++) for (let x = gx - R; x <= gx + R; x++) {
    if (x < 0 || y < 0 || z < 0 || x >= f.nx || y >= f.ny || z >= f.nz) continue;
    const c = f.grid[x + f.nx * (y + f.ny * z)];
    if (c < 0 || f.mat[c] !== want) continue;
    const d = (x - gx) ** 2 + (y - gy) ** 2 + (z - gz) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best >= 0) return best;
  const v = new THREE.Vector3();
  for (let c = 0; c < f.n; c++) {
    if (f.mat[c] !== want) continue;
    const d = cellPos(f, c, v).distanceToSquared(p);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function drop(f) {
  f.mesh.parent?.remove(f.mesh);
  f.mesh.geometry.dispose();
  f.mesh.material.dispose();
}
