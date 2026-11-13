// The hair of the gold form (lib/form.js), like Super Saiyan in Dragon Ball: the free hair of a VRoid sample model
// (assets/character/player/vroid/hair.glb, CC0), its strands fitted on the FlyFF head at rest. It turns: each strand
// bends where it leaves the scalp and its end stands up as a gold spike, fanned out by where it grows (the strands of
// the back bend lower, so the back of the head stays covered; the strands of the nape go up the back of the head),
// the spikes of the top grow longer; it shakes while it lifts. pose() bends it as far as the transformation has gone
// (systems/transform.js): lift 0 its dark hair as it is, 1 the spikes; the gold is drawn by the fine pass
// (render/shaders.js FINE_FRAG uGold). All in the units of the human at rest (y up, the face +z).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const URL = '../assets/character/player/vroid/hair.glb';
const O = new THREE.Vector3(0, 1.42, 0);   // the middle of the skull
const PIVOT = 0.45;   // where a strand bends: this much of its length from its root
const BACK = 0.5;     // the strands of the back bend this much lower
const FAN = 2.5;      // how much the spikes open out, from where they grow
const GROW = 0.7;     // the spikes of the top grow up to this much longer
const SHAKE = 0.06;   // radians of the shaking

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let loaded = null;    // the hair, loaded once: { geometry: all its strands in one, texture, strands }

// the hair, and how each strand bends -> { geometry (at rest, indexed, uv), texture, strands: [{ start, count, pivot,
// q (the turn of its end, to its spike), grow, phase }], weight (per vertex: 0 before the bend, 1 past it) }
export function loadHair() {
  loaded ??= new GLTFLoader().loadAsync(URL).then((gltf) => {
    const parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
    const texture = parts[0].material.map;
    texture.colorSpace = THREE.NoColorSpace;   // its bytes as they are: the fine pass makes them linear (like lib/bake.js)
    texture.magFilter = THREE.NearestFilter;
    const n = parts.reduce((s, m) => s + m.geometry.getAttribute('position').count, 0);
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), index = [];
    const weight = new Float32Array(n), strands = [], v = new THREE.Vector3();
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let start = 0;
    for (const m of parts) {
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld), P = g.getAttribute('position'), count = P.count;
      pos.set(P.array, start * 3); nrm.set(g.getAttribute('normal').array, start * 3); uv.set(g.getAttribute('uv').array, start * 2);
      for (const i of g.index.array) index.push(start + i);
      // its root: its highest point; its tip: its point the farthest from the root
      let root = null, tip = null, far = 0;
      for (let i = 0; i < count; i++) { v.fromBufferAttribute(P, i); if (!root || v.y > root.y) root = v.clone(); }
      for (let i = 0; i < count; i++) { v.fromBufferAttribute(P, i); const d = v.distanceTo(root); if (d > far) { far = d; tip = v.clone(); } }
      const dir = tip.clone().sub(root).normalize(), piv = PIVOT + BACK * sm(0.02, 0.1, -tip.z);
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(P, i);
        weight[start + i] = sm(PIVOT - 0.12, PIVOT + 0.04, Math.max(0, v.sub(root).dot(dir) / far) - piv + PIVOT);
      }
      const pivot = root.clone().addScaledVector(dir, piv * far), end = tip.clone().sub(pivot).normalize();
      // its spike: up, opened out from where it grows, a little to the back; under the middle of the skull, up the back
      const low = 1 - sm(O.y - 0.02, O.y + 0.06, pivot.y);
      const spike = new THREE.Vector3((pivot.x - O.x) * FAN, 1, (pivot.z - O.z) * FAN * 0.7 - 0.25).normalize()
        .lerp(new THREE.Vector3((pivot.x - O.x) * 4, 1, -1.1).normalize(), low).normalize();
      const grow = -0.2 * (1 - sm(O.y - 0.07, O.y - 0.01, pivot.y)) + GROW * sm(O.y, O.y + 0.09, pivot.y) * (0.7 + 0.6 * rnd());
      strands.push({ start, count, pivot, q: new THREE.Quaternion().setFromUnitVectors(end, spike), grow, phase: rnd() * Math.PI * 2 });
      start += count;
      g.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(index);
    return { geometry, texture, strands, weight };
  });
  return loaded;
}

const I = new THREE.Quaternion(), q = new THREE.Quaternion(), wob = new THREE.Quaternion(), shook = new THREE.Quaternion();
const e = new THREE.Euler(), v = new THREE.Vector3();

// the hair bent as far as { lift, shake, time } -> into `out` (a geometry like hair.geometry: its positions, normals)
export function pose(hair, out, { lift, shake, time }) {
  const P0 = hair.geometry.getAttribute('position').array, N0 = hair.geometry.getAttribute('normal').array;
  const P = out.getAttribute('position'), N = out.getAttribute('normal'), p = P.array, n = N.array, W = hair.weight;
  const up = sm(0.2, 1, lift);   // the spikes grow as the hair bursts up
  for (const s of hair.strands) {
    const j = shake * SHAKE * Math.sin(time * 55 + s.phase);
    wob.setFromEuler(e.set(j, j * 0.7, -j));
    const grow = 1 + s.grow * up, { x, y, z } = s.pivot;
    for (let i = s.start; i < s.start + s.count; i++) {
      const w = W[i], k = i * 3;
      if (w <= 0) { p[k] = P0[k]; p[k + 1] = P0[k + 1]; p[k + 2] = P0[k + 2]; n[k] = N0[k]; n[k + 1] = N0[k + 1]; n[k + 2] = N0[k + 2]; continue; }
      q.slerpQuaternions(I, s.q, Math.min(1.1, lift) * w).multiply(shook.slerpQuaternions(I, wob, w));
      v.set(P0[k] - x, P0[k + 1] - y, P0[k + 2] - z).multiplyScalar(1 + (grow - 1) * w).applyQuaternion(q);
      p[k] = v.x + x; p[k + 1] = v.y + y; p[k + 2] = v.z + z;
      v.set(N0[k], N0[k + 1], N0[k + 2]).applyQuaternion(q);
      n[k] = v.x; n[k + 1] = v.y; n[k + 2] = v.z;
    }
  }
  P.needsUpdate = true;
  N.needsUpdate = true;
}

// a geometry to pose the hair into (its own positions and normals; its uv and index shared)
export function poseGeometry(hair) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', hair.geometry.getAttribute('position').clone());
  g.setAttribute('normal', hair.geometry.getAttribute('normal').clone());
  g.setAttribute('uv', hair.geometry.getAttribute('uv'));
  g.setIndex(hair.geometry.index);
  return g;
}
