// Clips made of key poses (character.json poses), for moves no free clip has (the Kamehameha: the hands cupped at the
// hip, then both arms pushed forward). A key starts from the pose of a clip at a time (base), then points bones:
// each bone named in `point` turns so it goes to its child along a direction of the body, [right, up, forward]
// (parents first, so a forearm points from where its upper arm put it; a bone with no child, a hand, points its own
// length axis: +x, as every bone of a 3ds Max biped), and each bone named in `turn` turns about
// the up axis by degrees (+: to its left). Between keys the bones turn smoothly (slerp); the hips stay as in the base.
import * as THREE from 'three';

// the bone each bone of ours points to (as lib/retarget.js)
const CHILD = {
  'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck', 'Neck': 'Head',
  'L Clavicle': 'L UpperArm', 'L UpperArm': 'L ForeArm', 'L ForeArm': 'L Hand',
  'R Clavicle': 'R UpperArm', 'R UpperArm': 'R ForeArm', 'R ForeArm': 'R Hand',
  'L Thigh': 'L Calf', 'L Calf': 'L Foot', 'R Thigh': 'R Calf', 'R Calf': 'R Foot',
};
const name = (n) => THREE.PropertyBinding.sanitizeNodeName('Bip02 ' + n);

// the clip `id` of the keys `keys` on our skeleton `ours` (the scene of mvr_male.glb, at rest); find: a clip by name
export function posedClip(id, keys, ours, find) {
  const hips = ours.getObjectByName('Bip02'), bones = [];
  hips.traverse((o) => { if (!o.isMesh) bones.push(o); });   // parents before children
  const mixer = new THREE.AnimationMixer(ours), rest = new Map(bones.map((b) => [b, [b.quaternion.clone(), b.position.clone()]]));
  const up = new THREE.Vector3(0, 1, 0), times = keys.map((k) => k.at);
  const quats = new Map(bones.map((b) => [b, new Float32Array(keys.length * 4)])), hipPos = new Float32Array(keys.length * 3);
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion()), wp = (o) => o.getWorldPosition(new THREE.Vector3());
  keys.forEach((key, k) => {
    for (const [b, [q, p]] of rest) { b.quaternion.copy(q); b.position.copy(p); }
    mixer.stopAllAction();
    if (key.base) {
      const [clip, time = 0] = key.base, c = find(clip);
      mixer.clipAction(c).reset().play();
      mixer.setTime(Math.min(time, c.duration - 1e-4));
    }
    ours.updateMatrixWorld(true);
    // a bone gets the world rotation q: its local rotation from its parent
    const setWorld = (b, q) => { b.quaternion.copy(wq(b.parent).invert().multiply(q)); b.updateMatrixWorld(true); };
    for (const b of bones) {
      const n = b.name.replace(/^Bip02_?/, '').replace(/_/g, ' ');
      if (key.turn?.[n] !== undefined) setWorld(b, new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(key.turn[n])).multiply(wq(b)));
      const dir = key.point?.[n];
      if (!dir) continue;
      const child = CHILD[n] && ours.getObjectByName(name(CHILD[n]));
      // [right, up, forward] in our model: it faces +z, its left is +x
      const want = new THREE.Vector3(-dir[0], dir[1], dir[2]).normalize();
      const have = child ? wp(child).sub(wp(b)).normalize() : new THREE.Vector3(1, 0, 0).applyQuaternion(wq(b));
      setWorld(b, new THREE.Quaternion().setFromUnitVectors(have, want).multiply(wq(b)));
    }
    for (const b of bones) b.quaternion.toArray(quats.get(b), k * 4);
    hips.position.toArray(hipPos, k * 3);
  });
  mixer.stopAllAction();
  for (const [b, [q, p]] of rest) { b.quaternion.copy(q); b.position.copy(p); }
  ours.updateMatrixWorld(true);
  const tracks = bones.map((b) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, quats.get(b)));
  tracks.push(new THREE.VectorKeyframeTrack(hips.name + '.position', times, hipPos));
  return new THREE.AnimationClip(id, times[times.length - 1], tracks);
}
