// The ki blasts of the skills (skills.json step `blast`, sent by systems/skills.js), made of cubes:
//   charge: a ball of ki grows in the hands of the human (its `hand` point: the open palm of the Kikoha, the hands at
//   the hip of the Kamehameha), and small cubes fly into it;
//   a ball (Kikoha) leaves the palm at `fire`, flies forward going down (`drop`, so it hits the ground at the end of
//   its range) and bursts on the first monster on its way: every monster within `blow` is hit (a Swing,
//   systems/combat.js), its cubes fly away, and it digs its hole there;
//   a beam (Kamehameha) leaves the hands at `fire` and grows forward to its range, going down a little (`drop`). Each
//   monster it touches is hit once, and its hole is dug all along under it from `digFrom`. At `end` it shrinks and is
//   gone.
// The holes (lib/craters.js dig) are the `holes` of skills.json: a blast names one (`hole`), so it is one word to swap:
// width (its radius), deep (cubes deep in its middle), ragged. The dirt and grass fly out, and the grass there is gone
// (a Footprint).
// The cubes are snapped on a grid, so the ki is cubes like the rest of the world in the Voxel look (in the Normal look
// too). They are drawn each frame as instances of one cube in the fine pass, in their own colours, not lit by the sun
// (render/shaders.js KI_FRAG). If the skill stops (the human dies), its blast fades at once.
import * as THREE from 'three';
import { query, getComponent, getResource, sendEvent, spawn, destroyEntity } from '../ecs/world.js';
import { Blast, Player, Skills, Monster, Footprint } from '../components.js';
import { Ki, Time, Gpu, Voxels, Craters, Settings, Random, Skillbook } from '../resources.js';
import { Swing } from '../events.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';
import { paletteAdd } from '../lib/voxels.js';
import { dig, CELL } from '../lib/craters.js';
import { nextRandom } from '../lib/random.js';
import { groundAt as paintAt } from '../gen/ground.js';
import { heightAt } from '../gen/terrain.js';

const CAP = 40000;        // cubes drawn at most
const KI = 0.05;          // the edge of a cube of ki (world units); a beam: BEAM
const BEAM = 0.07;
const STEP = 0.12;        // a beam digs its trench this often along its way
const GRASS = 0.3;        // and takes the grass away this often
const FADE = 0.3;         // seconds a beam takes to shrink at its end
const GRAVITY = 14;
// the colours of the dirt that flies out of a trench, by the paint of the ground there (assets/palettes.json ground)
const DIRT = { grass: ['#3c9f62', '#51b568', '#907060', '#a8866a'], sand: ['#ceb08c', '#e2c8a0', '#b4987e'],
  dirt: ['#907060', '#a8866a', '#76605e'], pavement: ['#a0a8b6', '#868ea0', '#907060'], field: ['#866246', '#9a7452'] };

export function blastSystem(world) {
  const ki = getResource(world, Ki), dt = getResource(world, Time).dt, rng = getResource(world, Random);
  const rand = () => nextRandom(rng);
  const human = query(world, [Player, Skills])[0];
  const p = human === undefined ? null : getComponent(world, human, Player);
  const active = human === undefined ? null : getComponent(world, human, Skills).active;
  const out = [], seen = new Set(), color = colorOf(world), holes = getResource(world, Skillbook).holes ?? {};
  // one cube on the grid of its size (two cubes of one size never in one cell)
  const put = (x, y, z, size, c) => {
    const ix = Math.floor(x / size), iy = Math.floor(y / size), iz = Math.floor(z / size);
    const key = `${size}:${ix}:${iy}:${iz}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push((ix + 0.5) * size, (iy + 0.5) * size, (iz + 0.5) * size, size, c);
  };

  for (const e of query(world, [Blast])) {
    const b = getComponent(world, e, Blast), s = b.spec, [core, mid, edge] = s.colors.map(color), hole = s.hole ? holes[s.hole] : null;
    b.t += dt * b.rate;
    const playing = p && p.dead <= 0 && active?.skill.steps[active.step].blast === s;
    if (!playing && b.phase === 'charge') { destroyEntity(world, e); continue; }
    const fx = p ? Math.sin(p.rot) : 0, fz = p ? Math.cos(p.rot) : 1;
    const at = ([r, u, f]) => [p.x - fz * r + fx * f, (p.y ?? 0) + u, p.z + fx * r + fz * f];

    if (b.phase === 'charge') {
      const [c0, c1] = s.charge;
      if (b.t >= c0) {
        const k = Math.min(1, (b.t - c0) / (c1 - c0)), r = s.radius * (0.25 + 0.75 * k) * (s.kind === 'beam' ? 1.2 : 1);
        const [x, y, z] = at(s.hand);
        ball(put, x, y, z, r, KI, core, mid, edge, rand);
        // the ki that gathers: small cubes flying into the ball
        for (let i = 0; i < 14; i++) {
          const a = i * 2.39996, f = 1 - ((b.t * 1.6 + i * 0.37) % 1), d = r + 0.9 * f * (s.kind === 'beam' ? 1.4 : 1);
          const h = Math.cos(i * 1.7) * 0.8;
          put(x + Math.cos(a + b.t) * d * Math.sqrt(1 - h * h), y + h * d, z + Math.sin(a + b.t) * d * Math.sqrt(1 - h * h), KI, f > 0.5 ? edge : mid);
        }
      }
      if (b.t >= s.fire) {
        [b.x, b.y, b.z] = at(s.from ?? s.hand);
        b.dx = fx; b.dz = fz;
        b.phase = s.kind === 'ball' ? 'fly' : 'beam';
      }
      continue;
    }

    if (b.phase === 'fly') {
      b.head += s.speed * dt;
      const x = b.x + b.dx * b.head, z = b.z + b.dz * b.head, y = b.y - (s.drop ?? 0) * Math.min(1, b.head / s.range);
      const struck = query(world, [Monster]).some((m) => {
        const mo = getComponent(world, m, Monster);
        return mo.mode !== 'dead' && Math.hypot(mo.x - x, mo.z - z) < s.radius + mo.radius;
      });
      if (struck || b.head >= s.range) {
        sendEvent(world, Swing, { x, z, rot: 0, range: s.blow, arc: 360, power: b.power, around: true });
        burst(ki, x, y, z, [core, mid, edge, edge], 90, 4, rand);
        if (hole) {
          dig(getResource(world, Craters), x, z, hole.width, hole.deep, rand);
          spawn(world, [Footprint, { x, z, r: hole.width }]);
          flyDirt(world, ki, rand, [x, z]);
        }
        destroyEntity(world, e);
        continue;
      }
      ball(put, x, y, z, s.radius, KI, core, mid, edge, rand);
      // a short tail
      for (let i = 1; i <= 8; i++) put(x - b.dx * i * KI * 1.4 + (rand() - 0.5) * 0.1, y + (rand() - 0.5) * 0.1, z - b.dz * i * KI * 1.4 + (rand() - 0.5) * 0.1, KI, i < 3 ? mid : edge);
      continue;
    }

    // a beam: it grows, hits, digs, then shrinks at its end
    if (b.phase === 'beam') {
      b.head = Math.min(s.range, b.head + s.speed * dt);
      if (b.t >= s.end || !playing) { b.phase = 'fade'; b.fade = FADE; }
    } else if ((b.fade -= dt) <= 0) { destroyEntity(world, e); continue; }
    const shrink = b.phase === 'fade' ? Math.max(0, b.fade / FADE) : 1;
    const yAt = (d) => b.y - (s.drop ?? 0) * (d / s.range);
    for (const m of query(world, [Monster])) {
      const mo = getComponent(world, m, Monster);
      if (mo.mode === 'dead' || b.hit.includes(m)) continue;
      const along = (mo.x - b.x) * b.dx + (mo.z - b.z) * b.dz, side = Math.abs((mo.x - b.x) * b.dz - (mo.z - b.z) * b.dx);
      if (along < 0 || along > b.head + mo.radius || side > s.radius + mo.radius) continue;
      b.hit.push(m);
      sendEvent(world, Swing, { x: mo.x, z: mo.z, rot: 0, range: 0.01, arc: 360, power: b.power, target: m });
    }
    if (hole && b.phase === 'beam') digUnder(world, ki, b, hole, s.digFrom ?? 0, rand);
    beam(put, b, yAt, s.radius * shrink, core, mid, edge, rand);
  }

  sparks(world, ki, dt, put);
  draw(world, ki, out);
}

// the palette colour of '#rrggbb' (lib/voxels.js paletteAdd), as its uv in the palette texture
function colorOf(world) {
  const pal = getResource(world, Voxels).palette;
  return (hex) => {
    const i = paletteAdd(pal, parseInt(hex.slice(1), 16));
    return [((i % 256) + 0.5) / 256, (Math.floor(i / 256) + 0.5) / 256];
  };
}

// a ball of ki: a full core and an edge with holes (the core shines through), a little different each frame
function ball(put, x, y, z, r, size, core, mid, edge, rand) {
  const shell = Math.max(12, Math.ceil((4 * Math.PI * r * r) / (size * size) * 1.6));
  for (let i = 0; i < shell; i++) {
    const h = 1 - (2 * (i + 0.5)) / shell, a = i * 2.39996, w = Math.sqrt(1 - h * h), rr = r * (1 + (rand() - 0.5) * 0.25);
    if (rand() < 0.22) continue;
    put(x + Math.cos(a) * w * rr, y + h * rr, z + Math.sin(a) * w * rr, size, rand() < 0.7 ? edge : mid);
  }
  const rc = r * 0.6, inner = Math.max(6, Math.ceil((4 * Math.PI * rc * rc) / (size * size) * 1.6));
  for (let i = 0; i < inner; i++) {
    const h = 1 - (2 * (i + 0.5)) / inner, a = i * 2.39996, w = Math.sqrt(1 - h * h);
    put(x + Math.cos(a) * w * rc, y + h * rc, z + Math.sin(a) * w * rc, size, core);
  }
}

// a beam from where it left to its head: a core, a waving edge with holes, a big ball at its head and one in the hands
function beam(put, b, yAt, r, core, mid, edge, rand) {
  if (r <= 0.01) return;
  const s = BEAM, len = b.head, ux = -b.dz, uz = b.dx;    // u: its side, flat; v: up (nearly: it goes down a little)
  for (let l = 0; l <= len; l += s * 0.8) {
    const x = b.x + b.dx * l, y = yAt(l), z = b.z + b.dz * l;
    const rr = r * (1 + 0.1 * Math.sin(b.t * 30 - l * 2.5));
    for (const [rad, c, holes] of [[rr, null, 0.4], [rr * 0.6, core, 0]]) {
      const n = Math.ceil((2 * Math.PI * rad) / (s * 0.8));
      for (let i = 0; i < n; i++) {
        if (holes && rand() < holes) continue;
        const a = (i / n) * 2 * Math.PI + l * 0.7, cx = Math.cos(a) * rad, cy = Math.sin(a) * rad;
        put(x + ux * cx, y + cy, z + uz * cx, s, c ?? (rand() < 0.5 ? edge : mid));
      }
    }
  }
  ball(put, b.x + b.dx * len, yAt(len), b.z + b.dz * len, r * 1.5, s, core, mid, edge, rand);
  ball(put, b.x, b.y, b.z, r * 1.2, s, core, mid, edge, rand);
}

// the beam digs its hole up to its head, from `from`; the grass there is gone, and dirt flies out of the new holes
function digUnder(world, ki, b, hole, from, rand) {
  const craters = getResource(world, Craters);
  let grass = Math.floor(b.dug / GRASS);
  for (; b.dug + STEP <= b.head; b.dug += STEP) {
    if (b.dug < from) continue;
    const x = b.x + b.dx * b.dug, z = b.z + b.dz * b.dug;
    dig(craters, x, z, hole.width, hole.deep, rand);
    if (Math.floor(b.dug / GRASS) > grass) { grass = Math.floor(b.dug / GRASS); spawn(world, [Footprint, { x, z, r: hole.width }]); }
  }
  flyDirt(world, ki, rand, null, [b.dx, b.dz]);
}

// dirt and grass fly out of the cells just dug (the Craters resource `fresh`), in the colours of the ground there: away
// from the middle of a crater (centre [x, z]), or to both sides of a trench (way [dx, dz])
function flyDirt(world, ki, rand, centre, way = null) {
  const craters = getResource(world, Craters), { ground, terrain } = getResource(world, Settings).land, color = colorOf(world);
  for (const [x, z] of craters.fresh.splice(0)) {
    if (rand() > 0.35) continue;
    const kinds = DIRT[ground ? paintAt(ground, x, z) : 'grass'] ?? DIRT.grass;
    let vx, vz;
    if (way) {
      const out = rand() < 0.5 ? -1 : 1, side = 1 + rand() * 2;
      vx = way[1] * out * side + way[0] * rand() * 2; vz = -way[0] * out * side + way[1] * rand() * 2;
    } else {
      const d = Math.hypot(x - centre[0], z - centre[1]) || 1, v = 1.5 + rand() * 2.5;
      vx = ((x - centre[0]) / d) * v; vz = ((z - centre[1]) / d) * v;
    }
    ki.sparks.push({ x, y: heightAt(terrain, x, z), z, vx, vy: 2.5 + rand() * 3.5, vz,
      size: CELL * (0.6 + rand() * 0.5), color: color(kinds[Math.floor(rand() * kinds.length)]), life: 0.7 + rand() * 0.7 });
  }
}

// a ball bursts: n cubes of its colours fly away from (x, y, z)
function burst(ki, x, y, z, colors, n, speed, rand) {
  for (let i = 0; i < n; i++) {
    const h = rand() * 2 - 1, a = rand() * 2 * Math.PI, w = Math.sqrt(1 - h * h), v = speed * (0.4 + rand() * 0.6);
    ki.sparks.push({ x, y, z, vx: Math.cos(a) * w * v, vy: h * v + 1.5, vz: Math.sin(a) * w * v, size: KI, color: colors[Math.floor(rand() * colors.length)], life: 0.35 + rand() * 0.4 });
  }
}

// the cubes that fly: they fall, shrink at their end, and are gone
function sparks(world, ki, dt, put) {
  const terrain = getResource(world, Settings).land.terrain;
  ki.sparks = ki.sparks.filter((s) => {
    s.life -= dt;
    s.vy -= GRAVITY * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    if (s.life <= 0 || s.y < heightAt(terrain, s.x, s.z) - 0.6) return false;
    put(s.x, s.y, s.z, s.life < 0.25 ? Math.max(0.02, s.size * (s.life / 0.25)) : s.size, s.color);
    return true;
  });
}

// the cubes of this frame (x, y, z, size, uv; 5 each) as the instances of one mesh in the fine pass
function draw(world, ki, out) {
  const gpu = getResource(world, Gpu);
  if (!ki.mesh) {
    if (!out.length || !gpu.fine) return;
    const cube = new THREE.BoxGeometry(1, 1, 1), geometry = new THREE.BufferGeometry();
    for (const n of ['position', 'normal']) geometry.setAttribute(n, cube.getAttribute(n));
    geometry.setIndex(cube.index);
    geometry.setAttribute('iUv', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 2), 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('iNrm', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3));
    const material = shaderMaterial(gpu.shared, S.FINE_VERT, S.KI_FRAG,
      { uMap: { value: getResource(world, Voxels).palette.texture }, uFaces: { value: 1 }, ...gpu.fine.uniforms });
    ki.mesh = new THREE.InstancedMesh(geometry, material, CAP);
    ki.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ki.mesh.frustumCulled = false;
    ki.mesh.layers.set(2);      // the fine pass
    gpu.scene.add(ki.mesh);
  }
  const n = Math.min(CAP, out.length / 5), M = ki.mesh.instanceMatrix.array, uv = ki.mesh.geometry.getAttribute('iUv');
  for (let q = 0; q < n; q++) {
    const o = q * 5, size = out[o + 3];
    M.fill(0, q * 16, q * 16 + 16);
    M[q * 16] = M[q * 16 + 5] = M[q * 16 + 10] = size;
    M[q * 16 + 12] = out[o]; M[q * 16 + 13] = out[o + 1]; M[q * 16 + 14] = out[o + 2]; M[q * 16 + 15] = 1;
    uv.array[q * 2] = out[o + 4][0]; uv.array[q * 2 + 1] = out[o + 4][1];
  }
  ki.mesh.count = n;
  ki.mesh.visible = n > 0;
  ki.mesh.instanceMatrix.needsUpdate = true;
  uv.needsUpdate = true;
}
