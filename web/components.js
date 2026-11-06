// Components: plain data only. Systems in systems/ give them meaning.
import { defineComponent } from './ecs/world.js';

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

// Three.js handles, filled in by the mesh system
//   meshes: [{ mesh, role }] with role = stone | trunk | canopy | leaves | water
export const SceneObject = defineComponent('SceneObject', () => ({ group: null, meshes: [] }));

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

// the top-view camera: where it looks, and its idle walk
//   snap: the pixel-snap error the blit pass shifts by; follow: false once the
//   arrows (or a script) move it, so it stops its idle walk
export const CameraRig = defineComponent('CameraRig', () => ({
  target: [0, 0, 0], driftPhase: 0.6, lastInput: -1e9, snap: [0, 0], follow: true,
}));
export const OrthoView = defineComponent('OrthoView', () => ({ camera: null }));

// canopy / cloud shadows that drift with the wind
export const CloudLayer = defineComponent('CloudLayer', () => ({
  offset: [0, 0], wind: [0.16, 0.05], scale: 0.23, lo: -0.05, hi: 0.02, moving: true,
}));
// a clearing where light falls through the canopy
export const Glade = defineComponent('Glade', () => ({ x: 0, z: 0, r: 1, k: 0 }));
