// Slime shapes: pure functions of the kind, the clip and the frame shown.
// Units and axes of the Blender script (prefabs/slime.js): z up, facing -y.
//   W / H: body radius and height, b: how much of the height is the round
//   bottom, tip: pointed top, lean: top pushed forward, wob / wph: wavy rim,
//   z: hop height, sx: side shake
//   mat: body colour (body | ghost), tint: hurt | gray | null
//   eyes: open | closed | slit | angry | none; brows, mouth (0..1), teeth, bone, flames
//   drops [x, y, z, radius, stretch], spikes [azimuth, elevation (deg), length, width],
//   pillars [x, y, height, width], cracks [angle (deg), length, width]
//   crackW: share of the magma slime's faces that glow
//   frame: the frame shown (the flames flicker with it)

export const baseShape = (kind) => ({
  W: 0.5, H: 0.62, b: 0.3, tip: 0, lean: 0, wob: 0, wph: 0, z: 0, sx: 0, mat: 'body', tint: null,
  eyes: 'open', brows: false, mouth: 0, teeth: false, bone: kind === 'undead', flames: kind === 'magma',
  drops: [], spikes: [], pillars: [], cracks: [], crackW: 0.05, frame: 0,
});

// small seeded random numbers: the same splash every time a frame is shown
function rng(seed) {
  let s = seed * 9301 + 49297;
  return (lo, hi) => {
    s = (s * 9301 + 49297) % 233280;
    return lo + (hi - lo) * (s / 233280);
  };
}

// n drops around the slime at about this distance and height
function ring(n, dist, z, r, { off = 0, stretch = 1, seed = 0 } = {}) {
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + off)) / n + rnd(-0.25, 0.25);
    const d = dist * rnd(0.85, 1.15);
    out.push([Math.cos(a) * d, Math.sin(a) * d, Math.max(z * rnd(0.7, 1.2), r), r, stretch]);
  }
  return out;
}

const RUN = [
  { W: 0.6, H: 0.48 }, { W: 0.44, H: 0.82, tip: 0.45, z: 0.08, lean: 0.15 },
  { W: 0.38, H: 0.95, tip: 0.6, z: 0.42, lean: 0.3 }, { W: 0.42, H: 0.8, tip: 0.35, z: 0.3, lean: 0.15 },
  { W: 0.55, H: 0.5, z: 0.02 }, { W: 0.82, H: 0.18, wob: 0.08 }, { W: 0.66, H: 0.34 }, { W: 0.55, H: 0.52 },
];
const HURT = [
  { W: 0.58, H: 0.48, sx: 0.04, tint: 'hurt', eyes: 'closed' },
  { W: 0.62, H: 0.42, sx: -0.04, tint: 'gray', eyes: 'closed' },
  { W: 0.6, H: 0.46, tint: 'hurt', eyes: 'closed' },
  { W: 0.52, H: 0.58 },
];
const DEATH = [
  { W: 0.48, H: 0.66, eyes: 'closed' },
  { W: 0.45, H: 0.74, eyes: 'closed', tint: 'gray' },
  { W: 0.62, H: 0.55, wob: 0.25, eyes: 'closed', tint: 'hurt' },
  { W: 0.76, H: 0.26, wob: 0.15, eyes: 'none', tint: 'gray' },
  { W: 0.78, H: 0.15, wob: 0.1, eyes: 'none' }, { W: 0.8, H: 0.1, wob: 0.06, eyes: 'none' },
  { W: 0.8, H: 0.07, wob: 0.04, eyes: 'none' }, { W: 0.8, H: 0.06, wob: 0.04, eyes: 'none' },
];

// clip: idle | walk | run | attack | hurt | death; f: frame, n: frames in the clip
export function shapeAt(kind, clip, f, n) {
  const s = baseShape(kind);
  s.frame = f;
  const t = f / n;
  const w = Math.sin(2 * Math.PI * t);
  const magma = kind === 'magma';
  if (clip === 'idle') {
    Object.assign(s, { W: 0.5 * (1 - 0.04 * w), H: 0.62 * (1 + 0.07 * w) });
    if (!magma) for (const ph of [0, 0.5]) {     // bubbles rising from the top
      const u = (t + ph) % 1;
      s.drops.push([0.28 - 0.1 * ph, 0.1, 0.72 + u * 0.35, 0.05 * (1 - u) + 0.015, 1]);
    }
  } else if (clip === 'walk') {
    Object.assign(s, { W: 0.5 * (1 - 0.14 * w), H: 0.62 * (1 + 0.22 * w), tip: 0.3 * Math.max(0, w),
      z: 0.08 * Math.max(0, Math.sin(2 * Math.PI * t - 0.5)), lean: 0.1 * Math.cos(2 * Math.PI * t) });
    if (!magma && f >= 2 && f <= 4) {
      const u = (f - 2) / 3;
      s.drops.push([0.3, 0.15, 0.75 + 0.2 * u, 0.045 * (1 - u) + 0.015, 1]);
    }
  } else if (clip === 'run') {
    Object.assign(s, RUN[f]);
    if (f === 5 || f === 6) s.drops = ring(5, 0.75 + 0.2 * (f - 5), 0.15 - 0.1 * (f - 5), 0.045, { seed: f });
  } else if (clip === 'hurt') {
    Object.assign(s, HURT[f]);
    if (f === 1 || f === 2) s.drops = [[-0.45, 0.1, 0.6 + 0.1 * f, 0.05, 1], [0.42, 0, 0.55 + 0.15 * f, 0.045, 1]];
  } else if (clip === 'death') {
    Object.assign(s, DEATH[f]);
    s.flames = magma && f < 2;
    if (f >= 2 && f <= 6) {
      const k = f - 2;
      s.drops = ring(7, 0.4 + 0.25 * k, Math.max(0.5 - 0.12 * k, 0.03), 0.06 - 0.007 * k, { seed: 3 });
    }
  } else if (clip === 'attack') {
    ATTACKS[kind](s, f);
  }
  return s;
}

// the three attacks: a splash of spikes, a roaring ball that slams the ground,
// and lava pillars bursting from cracks
const ATTACKS = {
  green(s, f) {
    Object.assign(s, [
      {}, { W: 0.66, H: 0.3 }, { W: 0.4, H: 0.9, tip: 0.5, z: 0.2 }, { W: 0.36, H: 1.0, tip: 0.6, z: 0.45 },
      { W: 0.7, H: 0.26, wob: 0.15 }, { W: 0.72, H: 0.24, eyes: 'closed' }, { W: 0.74, H: 0.22, eyes: 'closed' },
      { W: 0.62, H: 0.32, eyes: 'closed' }, { W: 0.56, H: 0.42, eyes: 'closed' }, { W: 0.52, H: 0.54, eyes: 'closed' },
    ][f]);
    const L = { 4: 0.25, 5: 0.5, 6: 0.85 }[f] || 0;
    if (L) {
      for (let i = 0; i < 6; i++) s.spikes.push([60 * i + 15, 22, L, 0.13]);
      s.spikes.push([0, 90, L * 0.9, 0.14]);
    }
    if (f >= 7) {
      const k = f - 7;
      s.drops = ring(6, 0.85 + 0.3 * k, Math.max(0.32 - 0.14 * k, 0.03), 0.06 - 0.01 * k, { off: 0.2, seed: 5 });
      s.drops.push([0, 0, 0.9 - 0.25 * k, 0.05, 1]);
    }
  },
  undead(s, f) {
    const ball = { b: 0.5, mat: 'ghost', eyes: 'angry', brows: true, bone: false };
    Object.assign(s, [
      {}, { W: 0.6, H: 0.36 }, { W: 0.66, H: 0.22, eyes: 'slit' },
      { ...ball, W: 0.45, H: 0.9 },
      { ...ball, W: 0.58, H: 1.16, mouth: 0.6 },
      { ...ball, W: 0.68, H: 1.34, mouth: 1, teeth: true },
      { ...ball, W: 0.82, H: 0.86, b: 0.35, mouth: 1, teeth: true, wob: 0.06 },
      { W: 0.5, H: 0.3, mat: 'ghost', bone: false, wob: 0.2 },
      { W: 0.52, H: 0.42 }, { W: 0.5, H: 0.56 },
    ][f]);
    if (f >= 6 && f <= 8)
      for (let a = 10; a < 360; a += 40) s.cracks.push([a, 0.35 + 0.25 * Math.min(f - 6, 1), 0.04]);
    if (f >= 7) {
      const k = f - 7;
      s.drops = ring(10, 0.6 + 0.35 * k, Math.max(0.6 - 0.25 * k, 0.03), 0.06, { stretch: 2, seed: 9 });
    }
  },
  magma(s, f) {
    Object.assign(s, [
      {}, { W: 0.56, H: 0.52, crackW: 0.07 }, { W: 0.62, H: 0.44, crackW: 0.09 }, { W: 0.6, H: 0.46, crackW: 0.11 },
      { W: 0.58, H: 0.5, crackW: 0.11 }, { W: 0.58, H: 0.5, crackW: 0.1 }, { W: 0.56, H: 0.54, crackW: 0.08 },
      { W: 0.53, H: 0.58, crackW: 0.06 }, { W: 0.5, H: 0.6 }, {},
    ][f]);
    if (f >= 1 && f <= 7) {
      const L = Math.min(0.25 + 0.2 * (f - 1), 0.9);
      s.cracks = [15, 70, 135, 195, 250, 315].map((a) => [a, L, 0.045]);
    }
    const rnd = rng(4);
    const spots = [20, 75, 140, 200, 255, 320, 105].map((a) => [((a + rnd(-10, 10)) * Math.PI) / 180, rnd(0.62, 0.85)]);
    const hgt = { 2: 0.15, 3: 0.45, 4: 0.8, 5: 1.05 }[f];
    if (hgt) s.pillars = spots.map(([a, d]) => [Math.cos(a) * d, Math.sin(a) * d, hgt * rnd(0.8, 1.15), 0.12]);
    if (f >= 6 && f <= 8) {
      const k = f - 6;
      for (const [a, d] of spots)
        for (const z of [Math.max(0.9 - 0.35 * k, 0.04), Math.max(0.45 - 0.2 * k, 0.03)])
          s.drops.push([Math.cos(a) * d * (1 + 0.2 * k), Math.sin(a) * d * (1 + 0.2 * k), z, 0.055 - 0.01 * k, 1.6]);
    }
  },
};
