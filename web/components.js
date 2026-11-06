// Components: plain data only. Systems in systems/ give them meaning.
import { defineComponent } from './ecs/world.js';
import { restPose } from './lib/poses.js';

// position on the ground and turn around the up axis
export const Transform = defineComponent('Transform', () => ({ x: 0, z: 0, rotY: 0 }));

// a generated object (gen/): variant `variant` of the shape set `set`;
// palette: material role family -> palette row (gen/palettes.js)
export const Prop = defineComponent('Prop', () => ({ kind: '', set: '', variant: 0, palette: {} }));
// grass and flowers do not grow inside this circle
export const Footprint = defineComponent('Footprint', () => ({ x: 0, z: 0, r: 0 }));
// nothing walks through this standing cylinder (radius r, height h); only on
// things that are tall enough (gen/collision.js)
export const Blocker = defineComponent('Blocker', () => ({ x: 0, z: 0, r: 0, h: 1 }));
export const ShadowCaster = defineComponent('ShadowCaster');

// the character the player walks around with
//   yaw / pitch: where it looks in the first-person view
//   moving / running: what it did this frame (the animation system reads it)
export const Player = defineComponent('Player', () => ({ speed: 2.6, radius: 0.24, yaw: 0, pitch: 0, moving: false, running: false }));

// how a character looks (choices: prefabs/character.js LOOK_OPTIONS)
//   model: 'sprite' = the 2D sprite (prefabs/character.js SPRITE), 'rig' = the 3D rig
//          '3d_new' = the FlyFF character in the same pixel style (assets/chars/3d_new.js)
export const Character = defineComponent('Character', () => ({
  model: 'sprite', hair: 'short', hairColor: 'h_brown', beard: 'none', beardColor: 'h_brown', outfit: 'adventurer',
}));
// the clip that plays: idle | walk | run | jump | attack | defend; time: seconds
// since it started; guard: 0..1, how far the shield is up; guardHeld: its key is down
export const Animator = defineComponent('Animator', () => ({ clip: 'idle', time: 0, guard: 0, guardHeld: false }));
// the current pose: joint angles and offsets (fields: lib/poses.js restPose)
export const Pose = defineComponent('Pose', restPose);

// a slime mob: kind = green | undead | magma (prefabs/slime.js SLIME_KINDS)
export const Slime = defineComponent('Slime', () => ({ kind: 'green', hp: 3 }));
// what a slime wants: mode = wander | chase; home: the spot it wanders around;
// target: where it walks to; wait: seconds it still stands there;
// cooldown: seconds until it can attack again
export const SlimeBrain = defineComponent('SlimeBrain', () => ({ mode: 'wander', home: [0, 0], target: [0, 0], wait: 0, cooldown: 0 }));
// the clip that plays: idle | walk | run | attack | hurt | death; time: seconds
// since it started; shown: the clip and frame the shape was made for
export const SlimeAnim = defineComponent('SlimeAnim', () => ({ clip: 'idle', time: 0, shown: '' }));
// the shape of the frame shown (fields: lib/slimeShapes.js baseShape)
export const SlimeShape = defineComponent('SlimeShape');
// pushed by a hit: speed on the ground (units / s) and seconds left
export const Knockback = defineComponent('Knockback', () => ({ vx: 0, vz: 0, time: 0 }));

// Three.js handles, filled in by the mesh system
//   meshes: [{ mesh, role }] with role = stone | trunk | canopy | leaves | char_<colour>
//   rig: a character's joints (lib/character.js buildRig) or a slime's meshes
//        (lib/slime.js buildSlimeRig), else null
export const SceneObject = defineComponent('SceneObject', () => ({ group: null, meshes: [], rig: null }));

// the big ground plane
export const GroundPlane = defineComponent('GroundPlane');

// one instance layer of grass tufts or flowers
//   home: draw positions, light: where each instance samples light,
//   params: [atlas cell, material id, 0, 0], grid: cell key -> instance indices
export const GroundCover = defineComponent('GroundCover', () => ({
  kind: 'grass', home: null, pos: null, light: null, params: null, grid: null,
}));

// floating dust motes, shown only inside light beams
export const DustField = defineComponent('DustField', () => ({ positions: null, boxMin: [0, 0, 0], boxSize: [1, 1, 1] }));

// the camera: where it looks, idle walk direction, and mode:
//   'top' = free camera, 'third' = behind the player's back,
//   'fps' = first person through the player's eyes
// focus: the point the third-person camera looks at (it trails the player);
// distance: how far behind it is; crownsHidden: some tree crowns are
// hidden because they stood between it and the player; follow: the top view
// stays on the player (the arrows turn it off, walking turns it on)
export const CameraRig = defineComponent('CameraRig', () => ({
  target: [0, 0, 0], driftPhase: 0.6, lastInput: -1e9, snap: [0, 0], mode: 'top', focus: null, distance: 3.2,
  crownsHidden: false, follow: true,
}));
export const OrthoView = defineComponent('OrthoView', () => ({ camera: null }));
export const PerspView = defineComponent('PerspView', () => ({ camera: null }));

// canopy / cloud shadows that drift with the wind
export const CloudLayer = defineComponent('CloudLayer', () => ({
  offset: [0, 0], wind: [0.16, 0.05], scale: 0.23, lo: -0.05, hi: 0.02, moving: true,
}));
// a clearing where light falls through the canopy
export const Glade = defineComponent('Glade', () => ({ x: 0, z: 0, r: 1, k: 0 }));
