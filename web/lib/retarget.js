// Clips of another skeleton moved onto the FlyFF male (assets/character/player/ual: the Universal Animation Library 1
// and 2 of Quaternius, CC0). Each bone of ours that has a bone of theirs (RIGS) turns like it: first the two skeletons
// are put in the same pose (ours is turned bone by bone so each arm, leg and spine part points like theirs in their
// rest pose, a T), then at each frame a bone of ours turns from that pose as theirs turns from their rest pose. The
// hips also move up and down like theirs (scaled to our size), never forward: the game moves the human. The other
// bones of ours (ponytail, cloak) stay as at rest.
import * as THREE from 'three';

// their bone -> our bone. ue: the Unreal names of UAL 2; rigify: the Blender names of UAL 1
const RIGS = {
  ue: {
    pelvis: 'Bip02', spine_01: 'Bip02 Spine', spine_02: 'Bip02 Spine1', spine_03: 'Bip02 Spine2',
    neck_01: 'Bip02 Neck', Head: 'Bip02 Head',
    clavicle_l: 'Bip02 L Clavicle', upperarm_l: 'Bip02 L UpperArm', lowerarm_l: 'Bip02 L ForeArm', hand_l: 'Bip02 L Hand',
    clavicle_r: 'Bip02 R Clavicle', upperarm_r: 'Bip02 R UpperArm', lowerarm_r: 'Bip02 R ForeArm', hand_r: 'Bip02 R Hand',
    thigh_l: 'Bip02 L Thigh', calf_l: 'Bip02 L Calf', foot_l: 'Bip02 L Foot',
    thigh_r: 'Bip02 R Thigh', calf_r: 'Bip02 R Calf', foot_r: 'Bip02 R Foot',
  },
  rigify: {
    'DEF-hips': 'Bip02', 'DEF-spine.001': 'Bip02 Spine', 'DEF-spine.002': 'Bip02 Spine1',
    'DEF-spine.003': 'Bip02 Spine2', 'DEF-neck': 'Bip02 Neck', 'DEF-head': 'Bip02 Head',
    'DEF-shoulder.L': 'Bip02 L Clavicle', 'DEF-upper_arm.L': 'Bip02 L UpperArm', 'DEF-forearm.L': 'Bip02 L ForeArm', 'DEF-hand.L': 'Bip02 L Hand',
    'DEF-shoulder.R': 'Bip02 R Clavicle', 'DEF-upper_arm.R': 'Bip02 R UpperArm', 'DEF-forearm.R': 'Bip02 R ForeArm', 'DEF-hand.R': 'Bip02 R Hand',
    'DEF-thigh.L': 'Bip02 L Thigh', 'DEF-shin.L': 'Bip02 L Calf', 'DEF-foot.L': 'Bip02 L Foot',
    'DEF-thigh.R': 'Bip02 R Thigh', 'DEF-shin.R': 'Bip02 R Calf', 'DEF-foot.R': 'Bip02 R Foot',
  },
};
// the bone that points each bone of ours (bone -> its child in the chain), to put both skeletons in the same pose
const CHILD = {
  'Bip02 Spine': 'Bip02 Spine1', 'Bip02 Spine1': 'Bip02 Spine2', 'Bip02 Spine2': 'Bip02 Neck', 'Bip02 Neck': 'Bip02 Head',
  'Bip02 L Clavicle': 'Bip02 L UpperArm', 'Bip02 L UpperArm': 'Bip02 L ForeArm', 'Bip02 L ForeArm': 'Bip02 L Hand',
  'Bip02 R Clavicle': 'Bip02 R UpperArm', 'Bip02 R UpperArm': 'Bip02 R ForeArm', 'Bip02 R ForeArm': 'Bip02 R Hand',
  'Bip02 L Thigh': 'Bip02 L Calf', 'Bip02 L Calf': 'Bip02 L Foot', 'Bip02 R Thigh': 'Bip02 R Calf', 'Bip02 R Calf': 'Bip02 R Foot',
};
const FPS = 30;
const name = (n) => THREE.PropertyBinding.sanitizeNodeName(n);

// the clips `names` of the file `gltf` (rig: a key of RIGS) on our skeleton `ours` (the scene of mvr_male.glb, at rest)
export function retarget(gltf, rig, ours, names) {
  const map = Object.entries(RIGS[rig]).map(([s, t]) => [gltf.scene.getObjectByName(name(s)), ours.getObjectByName(name(t))]);
  const theirsOf = new Map(map.map(([s, t]) => [t, s]));
  const src = gltf.scene, root = src.getObjectByName('root');
  const hipsT = ours.getObjectByName('Bip02'), hipsS = map.find(([, t]) => t === hipsT)[0];
  const bones = [];
  hipsT.traverse((o) => { if (!o.isMesh) bones.push(o); });   // parents before children

  // rest: world rotations and places of both
  src.updateMatrixWorld(true); ours.updateMatrixWorld(true);
  const W = (o) => ({ q: o.getWorldQuaternion(new THREE.Quaternion()), p: o.getWorldPosition(new THREE.Vector3()) });
  const restS = new Map([...map.map(([s]) => [s, W(s)]), [root, W(root)]]), restT = new Map(bones.map((b) => [b, W(b)]));
  // C: their world to ours (they may face another way)
  const basis = (up, left) => { const u = up.normalize(), f = new THREE.Vector3().crossVectors(left, u).normalize(), l = new THREE.Vector3().crossVectors(u, f);
    return new THREE.Matrix4().makeBasis(l, u, f); };
  const posS = (n) => restS.get(map.find(([, t]) => t.name === name(n))[0]).p.clone(), posT = (n) => restT.get(ours.getObjectByName(name(n))).p.clone();
  const Bs = basis(posS('Bip02 Head').sub(posS('Bip02')), posS('Bip02 L UpperArm').sub(posS('Bip02 R UpperArm')));
  const Bt = basis(posT('Bip02 Head').sub(posT('Bip02')), posT('Bip02 L UpperArm').sub(posT('Bip02 R UpperArm')));
  const C = new THREE.Quaternion().setFromRotationMatrix(Bt.clone().multiply(Bs.clone().transpose())), Ci = C.clone().invert();
  const scale = restT.get(hipsT).p.y / restS.get(hipsS).p.y;

  // ours in their pose: each bone of a chain turned to point like theirs
  const ref = new Map();
  for (const b of bones) {
    const parentQ = ref.get(b.parent)?.q ?? b.parent.getWorldQuaternion(new THREE.Quaternion());
    const parentP = ref.get(b.parent)?.p ?? b.parent.getWorldPosition(new THREE.Vector3());
    const q = parentQ.clone().multiply(b.quaternion), p = b.position.clone().applyQuaternion(parentQ).add(parentP);
    const child = CHILD[b.name.replace(/_/g, ' ')] && ours.getObjectByName(name(CHILD[b.name.replace(/_/g, ' ')]));
    const s = theirsOf.get(b), sc = child && theirsOf.get(child);
    if (s && sc) {
      const want = restS.get(sc).p.clone().sub(restS.get(s).p).applyQuaternion(C).normalize();
      const have = child.position.clone().applyQuaternion(q).normalize();
      q.premultiply(new THREE.Quaternion().setFromUnitVectors(have, want));
    }
    ref.set(b, { q, p });
  }

  const mixer = new THREE.AnimationMixer(src), out = [];
  for (const clip of gltf.animations.filter((c) => names.includes(c.name))) {
    const n = Math.max(2, Math.round(clip.duration * FPS) + 1), times = new Float32Array(n);
    const quats = new Map(bones.map((b) => [b, new Float32Array(n * 4)])), hips = new Float32Array(n * 3);
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().play();
    for (let k = 0; k < n; k++) {
      const t = Math.min(clip.duration, k / FPS);
      times[k] = t;
      mixer.setTime(Math.min(t, clip.duration - 1e-4));   // at its very end a clip starts again
      src.updateMatrixWorld(true);
      const world = new Map();
      for (const b of bones) {
        const parentQ = world.get(b.parent) ?? b.parent.getWorldQuaternion(new THREE.Quaternion()), s = theirsOf.get(b);
        let q;
        if (s) {
          const delta = s.getWorldQuaternion(new THREE.Quaternion()).multiply(restS.get(s).q.clone().invert());
          q = C.clone().multiply(delta).multiply(Ci).multiply(ref.get(b).q);
        } else q = parentQ.clone().multiply(b.quaternion);
        world.set(b, q);
        parentQ.clone().invert().multiply(q).toArray(quats.get(b), k * 4);
      }
      // the hips: up and down like theirs, not forward (from their root)
      const d = hipsS.getWorldPosition(new THREE.Vector3()).sub(restS.get(hipsS).p);
      const r = root.getWorldPosition(new THREE.Vector3()).sub(restS.get(root).p);
      d.x -= r.x; d.z -= r.z;
      d.x *= 0.3; d.z *= 0.3;     // a little of the sway, not the steps
      const p = restT.get(hipsT).p.clone().add(d.applyQuaternion(C).multiplyScalar(scale));
      hipsT.parent.worldToLocal(p).toArray(hips, k * 3);
    }
    const tracks = bones.map((b) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, quats.get(b)));
    tracks.push(new THREE.VectorKeyframeTrack(hipsT.name + '.position', times, hips));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  mixer.stopAllAction();
  return out;
}
