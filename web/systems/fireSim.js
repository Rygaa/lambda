// The fire of an object, voxel by voxel (systems/burn.js makes the voxels, draws them and lets the cut-off leaves go).
// One model: each voxel has a temperature (T, degrees), water (W, the degrees of heat it takes to dry it) and fuel
// (F, seconds of burning in the open air). No other rule decides if the fire goes on.
//   heat moves  a voxel gives heat to the 6 next to it, by how much hotter it is: most up, least down
//   hot air     a burning voxel also heats the first voxel over it across empty cells (PLUME high, leaning with the wind)
//   water first a voxel stays at BOIL until its water is gone
//   catching    dry, with fuel, at the ignite temperature of its material: it burns
//   burning     it is pulled to the flame temperature of its material and uses fuel by how much air it gets (its open
//               faces; inside it smoulders: SMOULDER); the last EMBER part of its fuel it glows as embers
//   cooling     a voxel that does not burn loses heat to the air, more with more open faces
//   no fuel     after "char": black, it stays (the wood); after "gone": black, grey ash, then gone (the leaves)
//   rain        an outside voxel gets wet and cold; a burning voxel that gets more water than its flame dries goes out
//               (black, with its fuel left: dry and hot again, it burns again)
// Only the voxels that are hot or that change are stepped (the awake ones); a voxel falls asleep once it is cold again.
// The steps are fixed (systems/burn.js runs STEP of them a second), so the fire goes as fast at any frame rate.
export const STATE = { normal: 0, heating: 1, burning: 2, embers: 3, burnt: 4, ash: 5, gone: 6 };
const { normal: NORMAL, heating: HEATING, burning: BURNING, embers: EMBERS, burnt: BURNT, ash: ASH, gone: GONE } = STATE;

export const STEP = 30;    // steps a second
export const AIR = 20;     // degrees: the air, and a voxel at the start
const BOIL = 100;          // degrees: a wet voxel stays here until its water is gone
const FLAME = 2.5;         // a burning voxel heats a voxel next to it by this part of the difference a second (times the
                           // way below), times the open faces / 6 of that voxel + FLAME_IN: the flame touches the outside
                           // of things, the inside of a trunk or a canopy heats little
const FLAME_IN = 0.08;
// (and through the material: a voxel gives a colder one next to it the mean `conduct` of their materials, part of the
// difference a second, times the way: wood passes heat, leaves hardly do: there is air between them)
const UP = 2, SIDE = 1.5, DOWN = 0.5;
const WIND_SPREAD = 0.4;   // to the side the wind blows to: SIDE times 1 + this; against it, 1 - this
const PULL = 4;            // a burning voxel goes to its flame temperature this fast (part of the difference, a second)
const SMOULDER = 0.15;     // a burning voxel with no open face uses fuel (and dries) this fast, as if it had this much air
const COOL = 0.25;         // a voxel that does not burn loses this part of its heat over the air a second, times its open
                           // faces / 6 + 0.2 (the inside too, slower)
const PLUME = 6;           // cells: how high the hot air of a burning voxel reaches across empty cells...
const PLUME_FLOW = 1.2;    // ... it gives the first voxel there this part of the difference a second (less higher up)
const LEAN = 0.3;          // ... and it leans this many cells with the wind for each cell up
export const EMBER = 0.25;        // the last part of its fuel a voxel glows as embers
const ASH_PART = 0.45;     // after "gone": the last part of its time black it is grey ash
const RAIN_COOL = 6;       // in the rain a voxel that does not burn loses this part of its heat a second (open faces / 6 + 0.3:
                           // the water goes in a little)
const RAIN_WET = 40;       // ... and gets this much water a second (times its open faces + 0.3)
const RAIN_FLAME = 0.3;     // in the rain a flame heats the voxels next to it this much (the rain cools the air of the flame)
const DRY_FLAME = 15;      // a burning voxel dries this much water a second (times its air + 0.1)
const OUT_WATER = 30;      // a burning voxel with this much water goes out
const MIN_DIFF = 1;        // degrees: heat moves between two voxels only when one is this much hotter
const BURNT_COLD = 150;    // degrees: a voxel with no fuel left this cold falls asleep
const ASLEEP = 3;          // degrees over the air: a voxel this cold that does not change falls asleep

// the arrays of the fire of an object f (f has n, nx, ny, nz, grid, at, xyz, mat, jitter, materials) and its wind (wx, wz
// in its units); water(c) gives the water of a voxel at the start
export function makeFire(f, water, wx = 0, wz = 0) {
  const n = f.n;
  Object.assign(f, {
    state: new Uint8Array(n), T: new Float32Array(n).fill(AIR), W: new Float32Array(n), F: new Float32Array(n),
    left: new Float32Array(n).fill(-1), burn: new Uint8Array(n), out: new Uint8Array(n),
    awake: new Int32Array(n), awakeN: 0, isAwake: new Uint8Array(n), woke: new Int32Array(n), wokeN: 0, stepping: false, goneNow: [], burnt: false, burning: 0,
  });
  for (let c = 0; c < n; c++) {
    const m = f.materials[f.mat[c]];
    f.W[c] = m.burns ? water(c) : 0;
    f.F[c] = m.burns ? m.fuel : 0;
  }
  f.weight = [SIDE * (1 + WIND_SPREAD * wx), SIDE * (1 - WIND_SPREAD * wx), UP, DOWN, SIDE * (1 + WIND_SPREAD * wz), SIDE * (1 - WIND_SPREAD * wz)];
  f.plume = [];
  for (let h = 1; h <= PLUME; h++) {
    const dx = Math.round(h * LEAN * wx), dz = Math.round(h * LEAN * wz);
    f.plume.push({ dx, dy: h, dz, o: dx + h * f.nx + dz * f.nx * f.ny });
  }
}

export const offsets = (f) => [1, -1, f.nx, -f.nx, f.nx * f.ny, -f.nx * f.ny];

export function wake(f, c) {
  if (f.isAwake[c] || f.state[c] === GONE) return;
  f.isAwake[c] = 1;
  if (f.stepping) f.woke[f.wokeN++] = c;   // woken in a step: stepped from the next one
  else f.awake[f.awakeN++] = c;
}

// a voxel catches fire now (a match: the human, or a test)
export function light(f, c) {
  const m = f.materials[f.mat[c]];
  if (!m.burns || f.F[c] <= 0 || f.state[c] === GONE) return;
  f.W[c] = 0;
  f.T[c] = Math.max(f.T[c], m.flame);
  catchFire(f, c);
}

function catchFire(f, c) {
  f.burn[c] = 1;
  f.out[c] = 0;
  f.state[c] = BURNING;
  f.burnt = true;
  wake(f, c);
}

// heat that comes from outside (a fire near it): degrees for the voxel c
export function warm(f, c, degrees) {
  if (f.state[c] === GONE) return;
  f.T[c] += degrees;
  wake(f, c);
}

// the seconds a voxel of a material that is gone stays black and ash
const charOf = (f, c) => f.materials[f.mat[c]].charTime * (0.8 + 0.4 * f.jitter[c]);

// one step of h seconds; rain: it rains. The voxels that went are in f.goneNow (for systems/burn.js)
export function step(f, h, rain) {
  const { T, W, F, grid, state, materials } = f, offs = offsets(f), w = f.weight, nx = f.nx, ny = f.ny, nz = f.nz;
  let keep = 0, burning = 0;
  f.stepping = true;
  for (let i = 0; i < f.awakeN; i++) {
    const c = f.awake[i];
    if (state[c] === GONE) { f.isAwake[c] = 0; continue; }
    const m = materials[f.mat[c]], k = f.at[c];
    // heat to the 6 next to it (the colder ones): a little through the wood or the leaves; much more from a flame to their
    // outside. And its open faces
    let openFaces = 0;
    const lit = f.burn[c], flame = rain ? RAIN_FLAME : 1;
    for (let j = 0; j < 6; j++) {
      const kd = k + offs[j], d = grid[kd];
      if (d < 0 || state[d] === GONE) { openFaces++; continue; }
      if (T[c] - T[d] < MIN_DIFF) continue;   // (almost the same: nothing moves, so cold voxels do not wake each other)
      let flow = (m.conduct + materials[f.mat[d]].conduct) * 0.5 * w[j] * (T[c] - T[d]) * h;
      T[c] -= flow;
      if (lit) {
        let o = 0;
        for (let q = 0; q < 6; q++) { const e = grid[kd + offs[q]]; if (e < 0 || state[e] === GONE) o++; }
        flow += FLAME * w[j] * (T[c] - T[d]) * (o / 6 + FLAME_IN) * h * flame;
      }
      T[d] = Math.min(T[d] + flow, T[c]);
      if (!f.isAwake[d]) wake(f, d);
    }
    const air = openFaces / 6;
    if (f.burn[c]) {
      burning++;
      const a = Math.max(SMOULDER, air);
      T[c] += (m.flame - T[c]) * PULL * h;
      // the hot air: the first voxel over it across empty cells
      if (openFaces) {
        const x = f.xyz[c * 3], y = f.xyz[c * 3 + 1], z = f.xyz[c * 3 + 2];
        for (const p of f.plume) {
          if (y + p.dy >= ny || x + p.dx < 0 || x + p.dx >= nx || z + p.dz < 0 || z + p.dz >= nz) break;
          const d = grid[k + p.o];
          if (d < 0 || state[d] === GONE) continue;
          if (p.dy === 1) break;   // right over it: the heat of the 6 next to it does it
          if (T[d] < T[c]) { T[d] += PLUME_FLOW * (T[c] - T[d]) * h / p.dy; if (!f.isAwake[d]) wake(f, d); }
          break;
        }
      }
      // the rain wets it; its flame dries it; too wet, it goes out
      if (rain) W[c] += RAIN_WET * (air + 0.3) * h;
      if (W[c] > 0) W[c] = Math.max(0, W[c] - DRY_FLAME * (a + 0.1) * h);
      if (W[c] >= OUT_WATER) {
        // out (steam)
        T[c] = Math.min(T[c], BOIL);
        f.burn[c] = 0; f.out[c] = 1; state[c] = BURNT;
      }
      else if ((F[c] -= a * h) <= 0) {
        // its fuel is gone
        F[c] = 0;
        f.burn[c] = 0;
        state[c] = BURNT;
        if (m.after === 'gone') f.left[c] = charOf(f, c);
      } else state[c] = F[c] < m.fuel * EMBER ? EMBERS : BURNING;
    } else {
      T[c] -= COOL * (air + 0.2) * (T[c] - AIR) * h;
      if (rain) { T[c] -= RAIN_COOL * (air + 0.3) * (T[c] - AIR) * h; W[c] += RAIN_WET * (air + 0.3) * h; }
      if (T[c] > BOIL && W[c] > 0) { const dry = Math.min(W[c], T[c] - BOIL); W[c] -= dry; T[c] -= dry; }
      if (m.burns && F[c] > 0 && W[c] <= 0 && T[c] >= m.ignite && state[c] !== ASH) catchFire(f, c);
      else if (state[c] === NORMAL && T[c] > AIR + 30) state[c] = HEATING;
      else if (state[c] === HEATING && T[c] < AIR + 15) state[c] = NORMAL;
    }
    // after "gone": black, then ash, then gone
    if (f.left[c] >= 0 && !f.burn[c]) {
      f.left[c] -= h;
      if (f.left[c] <= 0) { state[c] = GONE; f.isAwake[c] = 0; f.goneNow.push(c); continue; }
      if (f.left[c] < charOf(f, c) * ASH_PART) state[c] = ASH;
    }
    // asleep: cold again, or burnt out and too cold to light anything (black wood that slowly cools)
    if (!f.burn[c] && f.left[c] < 0 && (T[c] < AIR + ASLEEP || (F[c] <= 0 && T[c] < BURNT_COLD))) { f.isAwake[c] = 0; continue; }
    f.awake[keep++] = c;
  }
  f.stepping = false;
  for (let i = 0; i < f.wokeN; i++) f.awake[keep++] = f.woke[i];
  f.wokeN = 0;
  f.awakeN = keep;
  f.burning = burning;
}
