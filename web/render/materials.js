// Shader materials. A piece material exists once per colour palette of its role
// (uPal = palette row, written to the G-buffer for the post pass).
import * as THREE from 'three';
import * as S from './shaders.js';
import { spriteUniforms } from '../lib/sprites.js';
import { paletteNames } from '../gen/palettes.js';

export function shaderMaterial(shared, vertexShader, fragmentShader, extra = {}, opts = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader,
    uniforms: { ...shared, ...extra }, ...opts,
  });
}

function paletted(shared, vs, fs, extra = () => ({}), rows = 1, opts = {}) {
  return Array.from({ length: rows }, (_, i) => shaderMaterial(shared, vs, fs, { ...extra(), uPal: { value: i } }, opts));
}

// role -> palette row -> material
export function pieceMaterials(shared, assets, ppu) {
  const MID = assets.meta.mid;
  const rows = (family) => paletteNames(family).length;
  return {
    stone: paletted(shared, S.MESH_VERT, S.SOLID_FRAG, () => ({ uMid: { value: MID.rock } }), rows('stone')),
    trunk: paletted(shared, S.MESH_VERT, S.SOLID_FRAG, () => ({ uMid: { value: MID.trunk } }), rows('trunk')),
    canopy: paletted(shared, S.MESH_VERT, S.CANOPY_FRAG, undefined, rows('canopy')),
    leaves: paletted(shared, S.SPRITE_VERT, S.SPRITE_FRAG,
      () => spriteUniforms(assets.tex.clumps, assets.meta.sprites.clumps, 1, -0.5, ppu), rows('canopy')),
    // just over the ground; the offset keeps it in front of the ground
    water: paletted(shared, S.WATER_VERT, S.WATER_FRAG, undefined, rows('water'),
      { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  };
}
