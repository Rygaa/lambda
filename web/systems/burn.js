// A tree that burns voxel by voxel (a world with "burn": true, like worlds/burn-test.json: B near a tree). The tree
// becomes voxels of the fire (PX voxels of the look each, lib/voxels.js lookOf). The fire starts at the voxel nearest to
// the human and spreads: a burning voxel gives heat to the 6 voxels next to it, most to the one above (fire goes up),
// least to the one under it; a voxel catches fire when it has enough heat (the leaves sooner than the wood). Each voxel:
//   it heats: it turns red;  it burns: red, yellow, orange, it gives heat;  embers: the glow goes dark;
//   char: black. A leaf voxel then turns to grey ash, shrinks and is gone (the voxels it hid show); the wood stays black.
// The voxels are one instanced mesh in the G-buffer (render/shaders.js BURN_VERT, BURN_FRAG); the post pass colours them
// by their heat (burnColor). The leaves (sprites) go when the voxel under them catches fire. Cubes of fire rise from the
// voxels that burn (systems/blasts.js burnCube), ash falls, and one lamp of the fire lights around it (systems/clouds.js
// lampSystem). When the leaves are gone and nothing burns, the black trunk and branches stay (they still stop a walker).
import * as THREE from 'three';
import { query, getComponent, hasComponent, getResource } from '../ecs/world.js';
import { Prop, SceneObject, Player, Transform } from '../components.js';
import { Gpu, Settings, Input, Time } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';
import { voxelize, decodeNormal } from '../lib/voxelCore.js';
import { lookOf, triangles, oneSided } from '../lib/voxels.js';
import { burnCube, ashCube } from './blasts.js';

const PX = 2;            // a voxel of the fire: PX voxels of the look on each side
const TREE = /^plant\//;
const HEAT = 4;          // heat a burning voxel gives a voxel next to it, a second (at 1 it catches fire, about)
const UP = 2.5, SIDE = 1, DOWN = 0.7;   // ... times this, by where that voxel is
const INNER = 0.25;      // a voxel hidden inside the shape at first takes this much of the heat: the fire runs over the
                         // outside of the tree, as it would over leaves, and the inside burns after (else it goes up through
                         // the inside first and the whole outside catches fire at once)
const FAR = 0.35;        // ... and the voxels 2 away get this much of it, so a voxel heats (turns red) before the fire reaches it
// by material: take (how much of the heat it takes), then the seconds it burns, its embers glow, its char lasts
const WOOD = { take: 0.55, burn: 4, ember: 3, char: Infinity };   // the wood stays black: it is never gone
const LEAF = { take: 0.75, burn: 1.6, ember: 1.6, char: 4.5 };   // the black leaves hold until the fire is over them
const CRUMBLE = 0.06;     // seconds more of char for each voxel under the top of the leaves (and a random part): they
                         // crumble more from the top down (they caught fire from the bottom up, so without it the top
                         // floats over nothing)
const SHADOW_EVERY = 0.3;   // seconds: the shadow of the burning tree is drawn again
const FIRE = ['#fff2a0', '#ffc040', '#ff8a20', '#e04a10'];
const LAMP = new THREE.Color(1, 0.42, 0.08);

const fires = new Map();    // tree entity -> its fire
let shadowIn = 0;
let button = null, clicked = false;   // the button of a burn world (top of the screen): burn the tree, then grow it back

// the button: "Burn the tree (B)"; while it burns, it waits; when no tree is left, "Grow the tree back" reloads the page
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
  const trees = query(world, [Prop, SceneObject]).filter((e) => TREE.test(getComponent(world, e, Prop).set));
  const state = [...fires.values()].some((f) => !f.done) ? 'fire' : trees.some((e) => !fires.has(e)) ? 'tree' : 'gone';
  if (button.dataset.state === state) return;
  button.dataset.state = state;
  button.textContent = { tree: 'Burn the tree (B)', fire: 'Burning…', gone: 'Grow the tree back' }[state];
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
    if (fire.done) { for (const mesh of fire.hidden) mesh.visible = false; continue; }   // the black wood that is left
    step(fire, dt);
    draw(world, fire, gpu);
    burning = true;
    if (!fire.live && !fire.unlit) { fire.done = true; gpu.shadowsDirty = true; }
  }
  if (burning && (shadowIn -= dt) <= 0) { shadowIn = SHADOW_EVERY; gpu.shadowsDirty = true; }
}

// B or the button: the nearest tree (any distance) catches fire at the voxel nearest to the chest of the human
function lightNearest(world) {
  const human = query(world, [Player])[0];
  if (human === undefined) return;
  const p = getComponent(world, human, Player);
  let best = -1, bestD = Infinity;
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    if (!TREE.test(getComponent(world, e, Prop).set) || fires.has(e)) continue;
    const t = getComponent(world, e, Transform), d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best < 0) return;
  const y = (p.group?.position.y ?? 0) + 0.6;
  ignite(world, best, new THREE.Vector3(p.x, y, p.z));
}

// the tree entity catches fire at the voxel nearest to the point at (world units)
export function ignite(world, entity, at) {
  if (fires.has(entity)) return;
  const so = getComponent(world, entity, SceneObject), settings = getResource(world, Settings), gpu = getResource(world, Gpu);
  const size = (lookOf(world)?.world.size ?? 1 / settings.ppu) * PX;
  const parts = so.meshes.filter(({ role }) => role !== 'leaves' && role !== 'water');
  const vol = partsVolume(parts, size);
  if (!vol) return;
  const [nx, ny, nz] = vol.n, grid = new Int32Array(nx * ny * nz).fill(-1);
  let n = 0;
  for (let k = 0; k < grid.length; k++) if (vol.data[k]) grid[k] = n++;
  const fire = {
    entity, so, size, nx, ny, nz, grid, n, unlit: n, done: false,
    at: new Int32Array(n), xyz: new Int16Array(n * 3), leaf: new Uint8Array(n), inner: new Uint8Array(n), more: new Float32Array(n), heat: new Float32Array(n), need: new Float32Array(n),
    lit: new Float32Array(n).fill(-1), gone: new Uint8Array(n), slot: new Int32Array(n).fill(-1), cellAt: new Int32Array(n), count: 0,
    active: new Int32Array(n), live: 0, jitter: new Float32Array(n), mid: new Float32Array(n), row: new Float32Array(n),
    hidden: parts.map(({ mesh }) => mesh), sprites: [], fell: [],
  };
  const nrm = new Float32Array(n * 3), dec = [0, 0, 0];
  const mats = parts.map(({ mesh, role }) => ({ leaf: role === 'canopy', mid: mesh.material.uniforms.uMid?.value ?? 4, row: mesh.material.uniforms.uPal?.value ?? 0 }));
  for (let k = 0; k < grid.length; k++) {
    const c = grid[k];
    if (c < 0) continue;
    const m = mats[vol.data[k] - 1];
    fire.at[c] = k;
    fire.xyz.set([k % nx, Math.floor(k / nx) % ny, Math.floor(k / (nx * ny))], c * 3);
    fire.leaf[c] = m.leaf ? 1 : 0;
    fire.mid[c] = m.mid;
    fire.row[c] = m.row;
    fire.need[c] = 0.55 + Math.random() * 0.9;
    fire.jitter[c] = Math.random();
    const code = vol.normals?.[k] ?? 0;
    if (code) nrm.set(decodeNormal(code, dec), c * 3);   // 0: it was filled in (inside the shape)
  }
  fire.min = vol.min;
  let top = 0;
  for (let c = 0; c < n; c++) if (fire.leaf[c]) top = Math.max(top, fire.xyz[c * 3 + 1]);
  for (let c = 0; c < n; c++) if (fire.leaf[c]) fire.more[c] = (top - fire.xyz[c * 3 + 1]) * CRUMBLE + Math.random() * 2;
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
  // the leaves: their own copy of the sprites, each goes with the voxel under it
  for (const { mesh: leaves, role } of so.meshes) {
    if (role !== 'leaves') continue;
    leaves.geometry = leaves.geometry.clone();
    const pos = leaves.geometry.getAttribute('iPos'), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(leaves.matrix);
      fire.sprites.push({ attr: pos, i, cell: nearestCell(fire, v, 1), x: v.x, y: v.y, z: v.z });
    }
  }
  // the first voxel, and the ones around it
  const first = firstCell(fire, so.group.worldToLocal(at.clone()));
  for (const c of [first, ...neighbours(fire, first)]) if (c >= 0) light(fire, c);
  fires.set(entity, fire);
  window.__burn = fires;   // for the tests
}

// the voxels of the parts of a tree, filled: each part alone (filled as one shape, so its inside takes its own colour:
// in one volume the inside of the leaves next to the trunk took the colour of the trunk, a branch that is not there),
// then all in one grid (the grid starts at 0 in the units of the tree for every part); the wood wins where they meet
// (the trunk goes on inside the leaves). -> { min, n, data (part + 1, 0: empty), normals } like voxelize, or null
function partsVolume(parts, size) {
  const vols = parts.map(({ mesh }) => voxelize([{ tris: oneSided(triangles(mesh.userData.shape ?? mesh.geometry, mesh.matrix)), color: 0 }],
    size, { normals: true, fill: true, view: [0, 1, 0] }));
  if (!vols.some(Boolean)) return null;
  const min = [0, 1, 2].map((a) => Math.min(...vols.filter(Boolean).map((v) => v.min[a])));
  const n = [0, 1, 2].map((a) => Math.max(...vols.filter(Boolean).map((v) => v.min[a] + v.n[a])) - min[a]);
  const data = new Uint32Array(n[0] * n[1] * n[2]), normals = new Uint16Array(data.length);
  const order = parts.map((_, c) => c).sort((a, b) => (parts[a].role === 'trunk') - (parts[b].role === 'trunk'));
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

function neighbours(f, c) {
  const k = f.at[c];
  return offsets(f).map((o) => f.grid[k + o]);
}

// a cell of the grid next to an empty one (the grid has an empty border, so k + o is always in it)
function open(f, k) {
  for (const o of offsets(f)) { const d = f.grid[k + o]; if (d < 0 || f.gone[d]) return true; }
  return false;
}

function light(f, c) {
  if (f.lit[c] >= 0 || f.gone[c]) return;
  f.lit[c] = 0;
  f.unlit--;
  f.heat[c] = f.need[c];
  f.active[f.live++] = c;
}

function show(f, c) {
  if (f.slot[c] >= 0 || f.gone[c]) return;
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

const life = (f, c) => (f.leaf[c] ? LEAF : WOOD);
const total = (f, c) => { const m = life(f, c); return m.burn + m.ember + m.char + f.more[c]; };

// the fire moves on: the burning voxels heat the ones next to them; the ones at the end of their char are gone
function step(f, dt) {
  const offs = offsets(f), born = [];
  let keep = 0;
  for (let i = 0; i < f.live; i++) {
    const c = f.active[i], m = life(f, c), t = (f.lit[c] += dt);
    if (t < m.burn) {
      const k = f.at[c];
      for (let j = 0; j < 12; j++) {
        const o = j < 6 ? offs[j] : offs[j - 6] * 2;
        if (j >= 6) {   // 2 away: still in the grid?
          const a = (j - 6) >> 1, q = f.xyz[c * 3 + a] + ((j - 6) & 1 ? -2 : 2);
          if (q < 0 || q >= [f.nx, f.ny, f.nz][a]) continue;
        }
        const d = f.grid[k + o];
        if (d < 0 || f.lit[d] >= 0 || f.gone[d]) continue;
        f.heat[d] += HEAT * weight[j % 6] * (j < 6 ? 1 : FAR) * dt * life(f, d).take * (f.inner[d] ? INNER : 1);
        if (f.heat[d] >= f.need[d]) born.push(d);
      }
    }
    if (t >= total(f, c)) {
      f.gone[c] = 1;
      if (f.slot[c] >= 0 && f.fell.length < 40 && Math.random() < 0.03) f.fell.push(c);   // falls as ash
      hide(f, c);
      for (const o of offs) { const d = f.grid[f.at[c] + o]; if (d >= 0) show(f, d); }
    } else if (!f.leaf[c] && t >= m.burn + m.ember * 1.4) {
      // black wood: it does not change any more
    } else f.active[keep++] = c;
  }
  f.live = keep;
  for (const c of born) light(f, c);
  // nothing burns but voxels are left (a part the fire cannot reach): the hottest one catches fire
  if (!f.live && f.unlit > 0) {
    let best = -1;
    for (let c = 0; c < f.n; c++) if (!f.gone[c] && f.lit[c] < 0 && (best < 0 || f.heat[c] > f.heat[best])) best = c;
    if (best >= 0) light(f, best);
  }
}

// the heat of a voxel for the post pass (render/shaders.js burnColor), and its size (it shrinks as ash)
function heatOf(f, c, now) {
  const t = f.lit[c];
  if (t < 0) return [0.22 * Math.min(1, f.heat[c] / f.need[c]), 1];
  const m = life(f, c), j = f.jitter[c];
  if (t < m.burn) {
    // it burns: it flickers
    // it burns: each voxel its own colour (red, yellow, orange), and it flickers
    const k = t / m.burn, flick = 0.07 * Math.sin(now * (9 + j * 7) + j * 40);
    return [Math.min(0.495, Math.max(0.251, 0.25 + 0.25 * (k * 0.65 + j * 0.35) + flick)), 1];
  }
  // embers: about half the voxels glow, longer or shorter; the others are black at once
  const e = m.ember * (0.6 + 0.8 * j);
  if (t < m.burn + e) return [j < 0.55 ? 0.79 : 0.5 + 0.3 * ((t - m.burn) / e), 1];
  const k = Math.min(1, (t - m.burn - e) / Math.max(0.05, total(f, c) - m.burn - e));
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
    M[o + 12] = (x + mx + 0.5) * size; M[o + 13] = (y + my + 0.5) * size - (size - e) * 0.5; M[o + 14] = (z + mz + 0.5) * size; M[o + 15] = 1;
    A[s * 3] = f.mid[c]; A[s * 3 + 1] = f.row[c]; A[s * 3 + 2] = h;
  }
  f.mesh.count = f.count;
  f.mesh.instanceMatrix.needsUpdate = true;
  f.matAttr.needsUpdate = true;
  for (const mesh of f.hidden) mesh.visible = false;

  // the leaves over a voxel that caught fire go
  for (const sp of f.sprites) {
    if (sp.gone || sp.cell < 0 || (f.lit[sp.cell] < 0 && f.heat[sp.cell] < f.need[sp.cell] * 0.6)) continue;
    sp.gone = true;
    sp.attr.setX(sp.i, 1e5);
    sp.attr.needsUpdate = true;
  }

  // the fire: cubes rise from voxels that burn and show; the lamp at their middle
  const g = f.so.group.matrixWorld, v = new THREE.Vector3(), mid = new THREE.Vector3();
  for (const c of f.fell.splice(0)) {
    cellPos(f, c, v).applyMatrix4(g);
    ashCube(world, v.x, v.y, v.z, size, Math.random() < 0.7 ? '#4a4440' : '#2a2422', 0.8 + Math.random() * 1.2);
  }
  let burning = 0;
  for (let i = 0; i < f.live; i++) {
    const c = f.active[i];
    if (f.lit[c] < life(f, c).burn) { burning++; cellPos(f, c, v); mid.add(v); }
  }
  if (!burning) return;
  mid.divideScalar(burning).applyMatrix4(g);
  // by day the lamp is faint (it would paint the whole tree orange), at night it lights around the tree
  const strength = Math.min(1, burning / 1500), night = getResource(world, Settings).land.night ?? 0;
  gpu.fireLamps.push({ x: mid.x, y: mid.y, z: mid.z, r: 1.6 + 2.6 * strength, color: LAMP, k: (0.15 + 0.4 * strength) * (0.35 + 0.65 * night), flicker: true, ph: f.entity });
  const cubes = Math.min(30, Math.ceil(burning / 60));
  for (let i = 0; i < cubes; i++) {
    const c = f.active[Math.floor(Math.random() * f.live)];
    if (f.slot[c] < 0 || f.lit[c] >= life(f, c).burn) continue;
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
      ashCube(world, v.x, v.y, v.z, size, Math.random() < 0.5 ? '#3a3431' : '#ff7a20', 0.3 + Math.random() * 0.6);
    }
  }
}

// the centre of a voxel, in the units of the tree
function cellPos(f, c, out) {
  const k = f.at[c], [mx, my, mz] = f.min;
  return out.set((k % f.nx + mx + 0.5) * f.size, (Math.floor(k / f.nx) % f.ny + my + 0.5) * f.size, (Math.floor(k / (f.nx * f.ny)) + mz + 0.5) * f.size);
}

// the first voxel to burn, for a fire lit at a point (units of the tree): the nearest wood voxel that shows, the height
// counting 3 times (so the trunk in front of the human, not a branch hidden in the leaves); else the nearest that shows
function firstCell(f, p) {
  const v = new THREE.Vector3();
  let best = -1, bestD = Infinity, wood = false;
  for (let s = 0; s < f.count; s++) {
    const c = f.cellAt[s], w = !f.leaf[c];
    if (wood && !w) continue;
    cellPos(f, c, v);
    const d = (v.x - p.x) ** 2 + 9 * (v.y - p.y) ** 2 + (v.z - p.z) ** 2;
    if ((w && !wood) || d < bestD) { bestD = d; best = c; wood = w; }
  }
  return best;
}

// the voxel nearest to a point (units of the tree): first in the cells around it, else among all. want: 1 leaves only,
// 0 wood only, -1 any; -1 back when there is none
function nearestCell(f, p, want) {
  const [mx, my, mz] = f.min, s = f.size;
  const gx = Math.floor(p.x / s) - mx, gy = Math.floor(p.y / s) - my, gz = Math.floor(p.z / s) - mz;
  let best = -1, bestD = Infinity;
  const R = 4;
  for (let z = gz - R; z <= gz + R; z++) for (let y = gy - R; y <= gy + R; y++) for (let x = gx - R; x <= gx + R; x++) {
    if (x < 0 || y < 0 || z < 0 || x >= f.nx || y >= f.ny || z >= f.nz) continue;
    const c = f.grid[x + f.nx * (y + f.ny * z)];
    if (c < 0 || (want >= 0 && f.leaf[c] !== want)) continue;
    const d = (x - gx) ** 2 + (y - gy) ** 2 + (z - gz) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best >= 0) return best;
  const v = new THREE.Vector3();
  for (let c = 0; c < f.n; c++) {
    if (want >= 0 && f.leaf[c] !== want) continue;
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
