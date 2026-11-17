// Objects that burn voxel by voxel (a world with "burn": true, like worlds/burn-test.json: the button at the top, or B).
// An object becomes voxels of the fire (PX voxels of the look each, lib/voxels.js lookOf). Each voxel has a material
// (assets/materials.json: by the role of its part, or the palette of a stone part) that says what fire does to it, and a
// state (STATE):
//   normal   it does not burn (and a material that does not burn stays so: stone, water)
//   heating  the fire next to it heats it: it turns red; with enough heat it catches fire
//   burning  red, yellow, orange; it gives heat to the voxels next to it, most to the one above (fire goes up), least
//            to the one under it, and some to the ones 2 away
//   embers   about half of them glow, then go dark
//   burnt    black. A material with after "char" stays so (the wood)
//   ash      (after "gone") grey, it shrinks
//   gone     (after "gone") nothing: the voxels it hid show
// A voxel of a material that falls (the leaves), once it caught fire, falls when the voxel under it is gone, and breaks
// up as it falls. The fire starts at the voxel nearest to the human. The voxels are one instanced mesh in the G-buffer
// (render/shaders.js BURN_VERT, BURN_FRAG); the post pass colours them by their heat (burnColor). The leaves (sprites)
// go when the voxel under them catches fire. Cubes of fire rise from the voxels that burn (systems/blasts.js
// burnCube), ash falls, and one lamp of the fire lights around it (systems/clouds.js lampSystem). When nothing burns
// any more, what is left stays (the black wood, the stone; it still stops a walker).
import * as THREE from 'three';
import { query, getComponent, hasComponent, getResource } from '../ecs/world.js';
import { Prop, SceneObject, Player, Transform } from '../components.js';
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
const INNER = 0.25;      // a voxel hidden inside the shape at first takes this much of the heat: the fire runs over the
                         // outside, and the inside burns after (else it goes up through the inside first and the whole
                         // outside catches fire at once)
const FAR = 0.35;        // ... and the voxels 2 away get this much of it, so a voxel heats (turns red) before the fire reaches it
const CRUMBLE = 0.06;    // (after "gone") seconds more black for each voxel under the top of its material (and a random
                         // part): it crumbles more from the top down (it caught fire from the bottom up)
const GRAVITY = 9;       // world units a second, a second: a voxel that falls
const SHADOW_EVERY = 0.3;   // seconds: the shadow of a burning object is drawn again
const FIRE = ['#fff2a0', '#ffc040', '#ff8a20', '#e04a10'];
const LAMP = new THREE.Color(1, 0.42, 0.08);

// assets/materials.json: name -> material (with its defaults), and which material a part has
const json = await fetch(new URL('../../assets/materials.json', import.meta.url)).then((r) => r.json());
const MATERIALS = Object.entries(json.materials).map(([name, m]) => ({
  name, burns: !!m.burns, catches: m.catches ?? 0, burnTime: m.burnTime ?? 0, emberTime: m.emberTime ?? 0,
  after: m.after ?? 'char', charTime: m.after === 'gone' ? m.charTime ?? 0 : Infinity, falls: !!m.falls,
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
let shadowIn = 0;
let button = null, clicked = false;   // the button of a burn world (top of the screen)

// the button: "Set fire (B)" while something can burn; while it burns, it waits; then "Grow it all back" reloads
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
  const state = [...fires.values()].some((f) => !f.done) ? 'fire' : left ? 'some' : 'gone';
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
  if (!fires.size) return;
  const dt = Math.min(0.05, getResource(world, Time).dt);
  let burning = false;
  for (const [entity, fire] of fires) {
    if (!hasComponent(world, entity, SceneObject)) { drop(fire); fires.delete(entity); continue; }
    if (fire.done) { for (const mesh of fire.hidden) mesh.visible = false; continue; }   // what is left
    step(fire, dt);
    draw(world, fire, gpu);
    burning = true;
    if (!fire.live) { fire.done = true; gpu.shadowsDirty = true; }
  }
  if (burning && (shadowIn -= dt) <= 0) { shadowIn = SHADOW_EVERY; gpu.shadowsDirty = true; }
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
  ignite(world, best, new THREE.Vector3(p.x, (p.group?.position.y ?? 0) + 0.6, p.z));
}

// the object entity catches fire at the voxel that can burn nearest to the point at (world units)
export function ignite(world, entity, at) {
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
    vel: new Float32Array(n), loose: new Uint8Array(n), off: new Float32Array(n), jitter: new Float32Array(n),
    mid: new Float32Array(n), row: new Float32Array(n), hidden: parts.map(({ mesh }) => mesh), sprites: [], fell: [],
  };
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
    fire.need[c] = 0.55 + Math.random() * 0.9;
    fire.jitter[c] = Math.random();
    const code = vol.normals?.[k] ?? 0;
    if (code) nrm.set(decodeNormal(code, dec), c * 3);   // 0: it was filled in (inside the shape)
  }
  fire.min = vol.min;
  // a material that is gone at the end crumbles more from its top down
  const tops = MATERIALS.map(() => -Infinity);
  for (let c = 0; c < n; c++) tops[fire.mat[c]] = Math.max(tops[fire.mat[c]], fire.xyz[c * 3 + 1]);
  for (let c = 0; c < n; c++) if (mat(fire, c).after === 'gone') fire.more[c] = (tops[fire.mat[c]] - fire.xyz[c * 3 + 1]) * CRUMBLE + Math.random() * 2;
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
  const first = firstCell(fire, so.group.worldToLocal(at.clone()));
  if (first < 0) return drop(fire);
  for (const c of [first, ...neighbours(fire, first)]) if (c >= 0) light(fire, c);
  fires.set(entity, fire);
  window.__burn = fires;   // for the tests
}

// the voxels of the parts of an object, filled: each part alone (filled as one shape, so its inside takes its own
// material: in one volume the inside of the leaves next to the trunk took the colour of the trunk, a branch that is not
// there), then all in one grid (the grid starts at 0 in the units of the object for every part); where they meet, a
// material that does not fall wins (the trunk goes on inside the leaves). -> { min, n, data (part + 1, 0: empty),
// normals } like voxelize, or null
function partsVolume(parts, size) {
  const vols = parts.map(({ mesh }) => voxelize([{ tris: oneSided(triangles(mesh.userData.shape ?? mesh.geometry, mesh.matrix)), color: 0 }],
    size, { normals: true, fill: true, view: [0, 1, 0] }));
  const some = vols.filter(Boolean);
  if (!some.length) return null;
  const min = [0, 1, 2].map((a) => Math.min(...some.map((v) => v.min[a])));
  const n = [0, 1, 2].map((a) => Math.max(...some.map((v) => v.min[a] + v.n[a])) - min[a]);
  const data = new Uint32Array(n[0] * n[1] * n[2]), normals = new Uint16Array(data.length);
  const holds = (c) => (MATERIALS[materialOf(parts[c])]?.falls ? 0 : 1);
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

// ------------------------------------------------------------------ the voxels
const offsets = (f) => [1, -1, f.nx, -f.nx, f.nx * f.ny, -f.nx * f.ny];
const weight = [SIDE, SIDE, UP, DOWN, SIDE, SIDE];
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

// a voxel catches fire (if its material burns and it did not yet)
function light(f, c) {
  if (f.state[c] > HEATING || !mat(f, c).burns) return;
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
  if (t < m.burnTime) return BURNING;
  if (t < m.burnTime + emberOf(f, c)) return EMBERS;
  if (t >= total(f, c)) return GONE;
  // black, then grey ash for the end of its time
  return m.after === 'gone' && t >= total(f, c) - (total(f, c) - m.burnTime - emberOf(f, c)) * 0.45 ? ASH : BURNT;
}

// the fire moves on: the burning voxels heat the ones next to them; each voxel that caught fire goes from state to state
function step(f, dt) {
  const offs = offsets(f), born = [];
  let keep = 0;
  for (let i = 0; i < f.live; i++) {
    const c = f.active[i], t = (f.lit[c] += dt), s = (f.state[c] = stateAt(f, c, t));
    if (s === BURNING) {
      const k = f.at[c];
      for (let j = 0; j < 12; j++) {
        const o = j < 6 ? offs[j] : offs[j - 6] * 2;
        if (j >= 6) {   // 2 away: still in the grid?
          const a = (j - 6) >> 1, q = f.xyz[c * 3 + a] + ((j - 6) & 1 ? -2 : 2);
          if (q < 0 || q >= [f.nx, f.ny, f.nz][a]) continue;
        }
        const d = f.grid[k + o];
        if (d < 0 || f.state[d] > HEATING || !mat(f, d).burns) continue;
        f.state[d] = HEATING;
        f.heat[d] += HEAT * weight[j % 6] * (j < 6 ? 1 : FAR) * dt * mat(f, d).catches * (f.inner[d] ? INNER : 1);
        if (f.heat[d] >= f.need[d]) born.push(d);
      }
    }
    if (s === GONE) {
      if (f.slot[c] >= 0 && f.fell.length < 40 && Math.random() < 0.1) f.fell.push(c);   // falls as ash
      hide(f, c);
      for (const o of offs) { const d = f.grid[f.at[c] + o]; if (d >= 0) show(f, d); }
    } else if (s === BURNT && mat(f, c).after === 'char' && t >= mat(f, c).burnTime + mat(f, c).emberTime * 1.4) {
      // black for good: it does not change any more
    } else f.active[keep++] = c;
  }
  f.live = keep;
  for (const c of born) light(f, c);
  // nothing burns but voxels that heated are left (the fire did not reach them): the hottest one catches fire
  if (!f.live) {
    let best = -1;
    for (let c = 0; c < f.n; c++) if (f.state[c] === HEATING && (best < 0 || f.heat[c] > f.heat[best])) best = c;
    if (best >= 0) light(f, best);
  }
  fall(f, dt);
}

// a voxel of a material that falls, once it caught fire, falls when the voxel under it is gone (the leaves hang as one
// piece: the bottom of the leaves over the air holds), and falls on (faster and faster) until it lands on a voxel or the
// ground: so the burnt leaves sink as the ones under them go, and never float over nothing. The rows are seen from the
// bottom up, so a voxel lands on the ones that already fell. off: how far it fell since its cell (drawn lower by that
// much), it moves down a cell each time it passes one
function fall(f, dt) {
  const { nx, ny, nz, grid } = f, nxy = nx * ny, floor = Math.max(1, Math.ceil(-f.min[1] - 0.5)), offs = offsets(f);
  const held = (k) => { const d = grid[k]; return d >= 0 && f.state[d] !== GONE; };
  f.was ??= Uint8Array.from(grid, (d) => (d >= 0 ? 1 : 0));   // where a voxel was at first
  for (let y = 1; y < ny - 1; y++) for (let z = 1; z < nz - 1; z++) for (let x = 1, k = x + nx * y + nxy * z; x < nx - 1; x++, k++) {
    const c = grid[k];
    if (c < 0 || f.state[c] < BURNING || f.state[c] === GONE || !mat(f, c).falls) continue;
    if (y <= floor || held(k - nx) || (!f.was[k - nx] && !f.loose[c])) { f.vel[c] = f.off[c] = 0; continue; }
    if (!f.loose[c]) {
      // once it falls, it holds only on what is under it; it breaks up: grey ash in about a second, then gone
      f.loose[c] = 1;
      f.lit[c] = Math.max(f.lit[c], total(f, c) - (0.5 + Math.random() * 0.9));
    }
    f.vel[c] += GRAVITY * dt;
    f.off[c] += f.vel[c] * dt;
    let at = k, cy = y;
    while (f.off[c] >= f.size) {
      if (cy <= floor || held(at - nx)) { f.vel[c] = f.off[c] = 0; break; }
      f.off[c] -= f.size;
      grid[at] = -1;
      grid[at - nx] = c;
      // the voxels next to the cell it left show
      for (const o of offs) { const d = grid[at + o]; if (d >= 0) show(f, d); }
      at -= nx;
      cy--;
    }
    if (at !== k) {
      f.at[c] = at;
      f.xyz[c * 3 + 1] = cy;
      show(f, c);
    }
  }
}

// the heat of a voxel for the post pass (render/shaders.js burnColor), and its size (it shrinks as ash), by its state
function heatOf(f, c, now) {
  const s = f.state[c], t = f.lit[c], m = mat(f, c), j = f.jitter[c];
  if (s === NORMAL) return [0, 1];
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

  // the leaf clumps over a voxel that caught fire (or has most of the heat it needs) go
  for (const sp of f.sprites) {
    if (sp.gone || sp.cell < 0 || (f.state[sp.cell] < BURNING && f.heat[sp.cell] < f.need[sp.cell] * 0.6)) continue;
    sp.gone = true;
    sp.attr.setX(sp.i, 1e5);
    sp.attr.needsUpdate = true;
  }

  // the fire: cubes rise from voxels that burn and show; the lamp at their middle
  const g = f.so.group.matrixWorld, v = new THREE.Vector3(), mid = new THREE.Vector3();
  for (const c of f.fell.splice(0)) {
    cellPos(f, c, v).applyMatrix4(g);
    burnCube(world, v.x, v.y, v.z, size, Math.random() < 0.7 ? '#4a4440' : '#2a2422', 0.6 + Math.random() * 0.8,
      (Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3, false);
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
    burnCube(world, v.x, v.y + size, v.z, size * (1 + Math.random() * 1.5), FIRE[Math.floor(r * r * FIRE.length)], 0.35 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3, true);
  }
  // ash and embers fall from the char
  if (Math.random() < Math.min(0.6, burning / 3000)) {
    const c = f.active[Math.floor(Math.random() * f.live)];
    if (f.slot[c] >= 0) {
      cellPos(f, c, v).applyMatrix4(g);
      burnCube(world, v.x, v.y, v.z, size, Math.random() < 0.5 ? '#3a3431' : '#ff7a20', 0.8 + Math.random() * 0.6,
        (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, false);
    }
  }
}

// the centre of a voxel, in the units of the object
function cellPos(f, c, out) {
  const k = f.at[c], [mx, my, mz] = f.min;
  return out.set((k % f.nx + mx + 0.5) * f.size, (Math.floor(k / f.nx) % f.ny + my + 0.5) * f.size, (Math.floor(k / (f.nx * f.ny)) + mz + 0.5) * f.size);
}

// the first voxel to burn, for a fire lit at a point (units of the object): the nearest voxel that shows and can burn,
// the height counting 3 times, of a material that does not fall if there is one (the trunk in front of the human, not a
// leaf over it); -1: none
function firstCell(f, p) {
  const v = new THREE.Vector3();
  let best = -1, bestD = Infinity, solid = false;
  for (let s = 0; s < f.count; s++) {
    const c = f.cellAt[s], m = mat(f, c);
    if (!m.burns || (solid && m.falls)) continue;
    cellPos(f, c, v);
    const d = (v.x - p.x) ** 2 + 9 * (v.y - p.y) ** 2 + (v.z - p.z) ** 2;
    if ((!m.falls && !solid) || d < bestD) { bestD = d; best = c; solid = !m.falls; }
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
