// Character poses: pure functions of the clip and its progress.
// Angles in degrees, offsets in rig units (see prefabs/character.js).
//   a*: shoulder swing (negative = forward), l*: leg swing, S = sword side, H = shield side
//   lean: chest forward, twist: chest turn (sword shoulder back), neck: head nod
//   w / swy: sword in the hand, syaw: shield heading, slash: [from, to] arm angles of the trail
//   sx / sz: squash and stretch, dz / dy: hips up / back

export const restPose = () => ({
  sx: 1, sz: 1, dz: 0, dy: 0, lean: 0, twist: 0, neck: 0, aS: 0, aH: 0, aSz: 0, aHz: 0,
  lS: 0, lH: 0, w: 15, swy: 12, syaw: -90, slash: null,
});

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;

// clip: idle | walk | run | jump | attack | defend; t: 0..1 through the clip;
// guard: 0..1, how far the shield is up (defend)
export function poseAt(clip, t, guard = 0) {
  const p = restPose();
  const s = Math.sin(2 * Math.PI * t);
  if (clip === 'idle') {
    Object.assign(p, { dz: 0.012 * s, aS: 3 * s, aH: -3 * s, neck: 2 * s });
  } else if (clip === 'walk') {
    Object.assign(p, { lH: 28 * s, lS: -28 * s, aH: -24 * s, aS: 24 * s, dz: 0.012 - 0.04 * s * s, lean: 3 });
  } else if (clip === 'run') {
    Object.assign(p, { lH: 50 * s, lS: -50 * s, aH: -58 * s, aS: 58 * s, dz: 0.03 - 0.11 * s * s,
      lean: 14, neck: -8, aHz: -8, aSz: 8 });
  } else if (clip === 'jump') {
    if (t < 0.15) {                       // crouch
      const k = ease(t / 0.15);
      Object.assign(p, { sz: 1 - 0.18 * k, sx: 1 + 0.09 * k, aS: 40 * k, aH: 40 * k, lean: 12 * k });
    } else if (t < 0.75) {                // in the air
      const u = (t - 0.15) / 0.6, arc = Math.sin(Math.PI * u), sz = 1.1 - 0.1 * arc;
      Object.assign(p, { dz: 0.75 * 4 * u * (1 - u), sz, sx: 1 / Math.sqrt(sz),
        aS: lerp(40, -150, arc), aH: lerp(40, -150, arc), aSz: 10 * arc, aHz: -10 * arc,
        lH: -35 * arc, lS: 20 * arc, neck: -6 * arc });
    } else {                              // landing
      const v = (t - 0.75) / 0.25, sq = 0.2 * (1 - v) ** 1.5;
      Object.assign(p, { sz: 1 - sq, sx: 1 + sq * 0.5, aS: 30 * (1 - v), aH: 30 * (1 - v), lean: 12 * (1 - v) });
    }
  } else if (clip === 'attack') {
    if (t < 0.35) {                       // wind up: sword over the head, behind
      const k = ease(t / 0.35);
      Object.assign(p, { aS: lerp(0, -205, k), w: lerp(15, 90, k), swy: lerp(12, 0, k),
        lean: -8 * k, twist: 15 * k, aH: -15 * k, lH: -6 * k, lS: 5 * k });
    } else if (t < 0.55) {                // the slash
      const k = 1 - (1 - (t - 0.35) / 0.2) ** 2;
      Object.assign(p, { aS: lerp(-205, -35, k), w: lerp(90, 160, k), swy: 0,
        lean: lerp(-8, 18, k), twist: lerp(15, -25, k), aH: lerp(-15, 20, k),
        lH: lerp(-6, -20, k), lS: lerp(5, 16, k), dz: -0.04 * k });
      p.slash = [Math.max(-205, p.aS - 120), p.aS];
    } else {                              // back to rest; the trail fades
      const k = ease((t - 0.55) / 0.45);
      Object.assign(p, { aS: lerp(-35, 0, k), w: lerp(160, 15, k), swy: lerp(0, 12, k),
        lean: lerp(18, 0, k), twist: lerp(-25, 0, k), aH: lerp(20, 0, k),
        lH: lerp(-20, 0, k), lS: lerp(16, 0, k), dz: lerp(-0.04, 0, k) });
      if (t < 0.66) p.slash = [p.aS - 120 * (0.66 - t) / 0.11, p.aS];
    }
  } else if (clip === 'defend') {
    const k = ease(guard);
    Object.assign(p, { aH: -82 * k, aHz: 32 * k, syaw: lerp(-90, -12, k), lean: 6 * k,
      sz: 1 - 0.05 * k, sx: 1 + 0.03 * k, aS: 25 * k, w: 15 + 20 * k, lH: -14 * k, lS: 12 * k, dz: -0.03 * k });
  }
  return p;
}
