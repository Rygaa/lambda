// GLSL for the pixel-art pipeline. Same model as the Blender build:
//   scene pass  -> G-buffer (light value, material id, up, view normal, depth)
//   water pass  -> the same G-buffer seen from the camera mirrored in the water plane
//   post pass   -> palette bands, 1px outlines, water, raymarched god rays
//   blit        -> integer upscale with sub-pixel camera offset

import { CHAR_MID } from '../prefabs/character.js';
import { paletteNames } from '../gen/palettes.js';

// material id of water: after the Blender ids (assets.json "mid": 1-8), before the character's
export const WATER_MID = 9;

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function hexToLin(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));
}

const vec3 = (hex) => `vec3(${hexToLin(hex).map((v) => v.toFixed(6)).join(', ')})`;

function rampFn(name, stops) {
  let body = `vec3 ${name}(float v) {\n  vec3 c = ${vec3(stops[0][1])};\n`;
  for (const [pos, hex] of stops.slice(1)) body += `  if (v >= ${pos.toFixed(4)}) c = ${vec3(hex)};\n`;
  return body + '  return c;\n}\n';
}

// one ramp per palette row: name0, name1, ... and name(v, row) picks one
function rampRows(name, rows) {
  let out = rows.map((stops, i) => rampFn(name + i, stops)).join('');
  out += `vec3 ${name}(float v, float row) {\n  int i = int(row + 0.5);\n`;
  for (let i = rows.length - 1; i > 0; i--) out += `  if (i == ${i}) return ${name}${i}(v);\n`;
  return out + `  return ${name}0(v);\n}\n`;
}

// stone palettes as GLSL arrays (gen/palettes.js)
function stoneGlsl(rows) {
  const arr = (name, key) => `const vec3 ${name}[STONE_N] = vec3[](${rows.map((r) => vec3(r[key])).join(', ')});`;
  return [`const int STONE_N = ${rows.length};`, arr('STONE_LIT', 'lit'), arr('STONE_UP', 'up'),
    arr('STONE_SHADE', 'shade'), arr('STONE_HI', 'hi'),
    'int stoneRow(float row) { return clamp(int(row + 0.5), 0, STONE_N - 1); }'].join('\n') + '\n';
}

// water palettes as one GLSL array: row * 10 + tone * 2 + (in shade ? 1 : 0)
const WATER_TONES = ['deep', 'mid', 'shallow', 'foam', 'wave'];
function waterGlsl(rows) {
  const all = rows.flatMap((r) => WATER_TONES.flatMap((t) => r[t].map(vec3)));
  return [`const int WATER_N = ${rows.length};`, `const vec3 WATER[WATER_N * 10] = vec3[](${all.join(', ')});`,
    'const int DEEP = 0, MID = 1, SHALLOW = 2, FOAM = 3, WAVE = 4;',
    'vec3 waterTone(int row, int tone, float lit) { return WATER[row * 10 + tone * 2 + (lit > 0.5 ? 0 : 1)]; }',
    'int waterRow(float row) { return clamp(int(row + 0.5), 0, WATER_N - 1); }'].join('\n') + '\n';
}

// ------------------------------------------------------------------ shared
export const COMMON = /* glsl */ `
uniform vec3 uSunL;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform vec2 uCloudOffset;
uniform float uCloudScale;
uniform float uCloudLo;
uniform float uCloudHi;
uniform vec4 uGlades[4];   // x, z, radius, strength
uniform float uNearCull;   // first person: hide sprites closer than this to the eye
uniform float uTexel;      // first person: world size of one surface pixel (0 = top view: the screen is the grid)
uniform float uPxAngle;    // first person: world size of one screen pixel per unit of distance
uniform float uLineWorld;  // first person: outline width in the world
uniform float uLineMax;    // first person: thickest outline near the eye (screen pixels)
uniform float uClipY;      // water pass: nothing under the water plane is drawn

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(hash2(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 1.0, s = 0.0, n = 0.0;
  for (int k = 0; k < 3; k++) { s += a * gnoise(p); n += a; a *= 0.55; p *= 2.0; }
  return s / n;
}
// Canopy / cloud shadow: noise on the ground plane, projected along the sun.
float cloudCover(vec3 P) {
  vec2 G = P.xz - uSunL.xz * (P.y / uSunL.y);
  float v = fbm((G + uCloudOffset) * uCloudScale);
  for (int i = 0; i < 4; i++) {
    vec2 d = G - uGlades[i].xy;
    v -= uGlades[i].w * exp(-dot(d, d) / (uGlades[i].z * uGlades[i].z));
  }
  return smoothstep(uCloudLo, uCloudHi, v);
}
float cloudLight(vec3 P) { return 1.0 - cloudCover(P); }

// First person: pixels belong to the surfaces, like the texels of a texture.
// Each surface is cut into a fixed grid of uTexel-sized pixels and every pixel
// is lit once, at its centre. The grid moves with the object, so pixels never
// slide while you walk, and a far object is the near one, only smaller
// (the blit pass softens it once its details get smaller than screen pixels).
// centre of the surface pixel that P is in, on a grid of size t laid on the
// plane through P (normal N). Pixel rows follow the plane's level direction,
// so they run along the edges of walls and bevels (no saw teeth on thin faces)
// and continue around corners at the same heights.
vec3 texelU(vec3 N) { return abs(N.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(N.z, 0.0, -N.x)); }
vec3 texelCentre(vec3 P, vec3 N, float t) {
  vec3 u = texelU(N), v = cross(N, u);
  vec2 c = vec2(dot(P, u), dot(P, v));
  vec2 g = (floor(c / t) + 0.5) * t;
  return P + u * (g.x - c.x) + v * (g.y - c.y);
}

vec3 shadowCoord(vec3 P) { return (uShadowMatrix * vec4(P, 1.0)).xyz * 0.5 + 0.5; }
float shadowHard(vec3 P) {
  vec3 sc = shadowCoord(P + uSunL * 0.03);
  if (any(lessThan(sc.xy, vec2(0.0))) || any(greaterThan(sc.xy, vec2(1.0)))) return 1.0;
  return sc.z <= textureLod(uShadowMap, sc.xy, 0.0).r ? 1.0 : 0.0;
}
const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
float shadowSoft(vec3 P) {
  vec3 sc = shadowCoord(P + uSunL * 0.03);
  if (any(lessThan(sc.xy, vec2(0.0))) || any(greaterThan(sc.xy, vec2(1.0)))) return 1.0;
  float s = 0.0;
  for (int i = 0; i < 12; i++) {
    s += sc.z <= textureLod(uShadowMap, sc.xy + POISSON[i] * 1.6 * uShadowTexel, 0.0).r ? 1.0 : 0.0;
  }
  return s / 12.0;
}
`;

const GBUF_OUT = /* glsl */ `
layout(location = 0) out vec4 gData;   // light value, material id, world up, palette row
layout(location = 1) out vec4 gNorm;   // view normal (0 = none), linear depth
layout(location = 2) out vec4 gStep;   // first person, outlined surfaces: screen step (NDC) of one surface pixel along its two grid axes (0 = none)
`;

// ------------------------------------------------------------------ meshes
export const MESH_VERT = /* glsl */ `
out vec3 vW;
out vec3 vN;
out vec3 vO;       // object space, for the surface pixel grid
out vec3 vNo;
out float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vO = position;
  vNo = normal;
  vec4 v = viewMatrix * w;
  vDepth = -v.z;
  gl_Position = projectionMatrix * v;
}
`;

// stones, pillars, trunks: N.L * shadow, flat faces, outlines in post
export const SOLID_FRAG = COMMON + GBUF_OUT + /* glsl */ `
uniform float uMid;
uniform float uPal;
uniform mat4 modelMatrix;
uniform mat4 projectionMatrix;
in vec3 vW; in vec3 vN; in vec3 vO; in vec3 vNo; in float vDepth;
void main() {
  if (vW.y < uClipY) discard;
  vec3 N = normalize(vN);
  vec3 P = vW;
  gStep = vec4(0.0);
  if (uTexel > 0.0) {
    float t = uTexel;
    vec3 No = normalize(vNo), u = texelU(No);
    mat3 m = mat3(modelMatrix);
    P = (modelMatrix * vec4(texelCentre(vO, No, t), 1.0)).xyz;
    // how far one (base size) surface pixel along the grid goes on screen:
    // outlines in the post pass are that thick, also on slanted faces
    mat4 vp = projectionMatrix * viewMatrix;
    vec4 c = vp * vec4(vW, 1.0), cu = vp * vec4(vW + m * u * uTexel, 1.0), cv = vp * vec4(vW + m * cross(No, u) * uTexel, 1.0);
    vec2 ndc = c.xy / c.w;
    gStep = vec4(cu.xy / cu.w - ndc, cv.xy / cv.w - ndc);
  }
  float ndl = dot(N, uSunL);
  float lv = 0.0;
  // hard shadow: a soft one, cut into lit / shade, makes jagged edges on faces
  if (ndl > 0.0) lv = ndl * cloudLight(P) * shadowHard(P + N * 0.02);
  gData = vec4(lv, uMid, N.y, uPal);
  gNorm = vec4(normalize(mat3(viewMatrix) * N), vDepth);
}
`;

// The ground: grass, or the paint of gen/ground.js there (palette row of the
// ground family). Pavement has tile joints, fields have furrows.
const GROUND_ROW = Object.fromEntries(paletteNames('ground').map((name, i) => [name, i.toFixed(1)]));
export const GROUND_FRAG = COMMON + GBUF_OUT + /* glsl */ `
uniform sampler2D uGround;   // one paint per channel (sand, dirt, pavement, field), 0.5 on its edge
uniform vec3 uGroundBox;     // x, z of its corner, its size (world units)
in vec3 vW; in vec3 vN; in float vDepth;
void main() {
  vec3 P = vW;
  if (uTexel > 0.0) {
    P.xz = (floor(vW.xz / uTexel) + 0.5) * uTexel;
  }
  vec4 g = texture(uGround, (P.xz - uGroundBox.xy) / uGroundBox.z);
  float row = 0.0, most = 0.5;
  if (g.r > most) { most = g.r; row = ${GROUND_ROW.sand}; }
  if (g.g > most) { most = g.g; row = ${GROUND_ROW.dirt}; }
  if (g.b > most) { most = g.b; row = ${GROUND_ROW.pavement}; }
  if (g.a > most) { most = g.a; row = ${GROUND_ROW.field}; }
  // one pixel wide lines: tile joints every 1.5 units, furrows every half unit
  vec2 px = uTexel > 0.0 ? vec2(uTexel) : fwidth(P.xz) * 1.5;
  if (row == ${GROUND_ROW.pavement}) {
    vec2 f = abs(fract(P.xz / 1.5 + 0.5) - 0.5) * 1.5;
    if (f.x < px.x || f.y < px.y) row = ${GROUND_ROW.tile};
  }
  if (row == ${GROUND_ROW.field} && fract(P.z / 0.5) < 0.4) row = ${GROUND_ROW.furrow};
  gData = vec4(cloudLight(P) * shadowSoft(P), 1.0, 1.0, row);
  gNorm = vec4(0.0, 0.0, 0.0, vDepth);
  gStep = vec4(0.0);
}
`;

export const CANOPY_FRAG = COMMON + GBUF_OUT + /* glsl */ `
uniform float uPal;
in vec3 vW; in vec3 vN; in float vDepth;
void main() {
  if (vW.y < uClipY) discard;
  vec3 N = normalize(vN);
  vec3 P = uTexel > 0.0 ? (floor(vW / uTexel) + 0.5) * uTexel : vW;
  float h = dot(N, uSunL) * 0.5 + 0.5;
  float lv = h * (0.78 + 0.22 * cloudLight(P)) - 0.10;
  gData = vec4(lv, 4.0, 1.0, uPal);
  gNorm = vec4(0.0, 0.0, 0.0, vDepth);
  gStep = vec4(0.0);
}
`;

// ------------------------------------------------------------------ water
// The surface of a water shape (gen/kinds/water.js): aShore is the distance to
// the shore, below 0 is dry ground. G-buffer: light, WATER_MID, shore distance
// (instead of "up"), palette row. The post pass paints it.
export const WATER_VERT = /* glsl */ `
in float aShore;
out vec3 vW;
out float vShore;
out float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vShore = aShore;
  vec4 v = viewMatrix * w;
  vDepth = -v.z;
  gl_Position = projectionMatrix * v;
}
`;

export const WATER_FRAG = COMMON + GBUF_OUT + /* glsl */ `
uniform float uPal;
in vec3 vW; in float vShore; in float vDepth;
void main() {
  vec3 P = vW;
  float s = vShore;
  if (uTexel > 0.0) {
    // first person: the surface pixel's centre, and the shore distance there
    // (from its slope on screen), so the shore and the bands follow the pixels
    P.xz = (floor(vW.xz / uTexel) + 0.5) * uTexel;
    vec2 ex = dFdx(vW.xz), ey = dFdy(vW.xz);
    float det = ex.x * ey.y - ex.y * ey.x;
    if (abs(det) > 1e-12) {
      float sx = dFdx(vShore), sy = dFdy(vShore);
      s += dot(vec2(ey.y * sx - ex.y * sy, ex.x * sy - ey.x * sx) / det, P.xz - vW.xz);
    }
  }
  if (s < 0.0) discard;
  gData = vec4(cloudLight(P) * shadowSoft(P), ${WATER_MID.toFixed(1)}, s, uPal);
  gNorm = vec4(0.0, 0.0, 0.0, vDepth);
  gStep = vec4(0.0);
}
`;

// ------------------------------------------------------------------ sprites
// Camera-facing quads lit once, at their base point (like the article's
// LIGHT_VERTEX trick), so they blend into the terrain.
export const SPRITE_VERT = COMMON + /* glsl */ `
in vec3 iPos;      // where the quad is drawn
in vec3 iLight;    // where its light is sampled
in vec4 iParam;    // atlas cell, material id, N.L (leaves), random
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec2 uSize;
uniform float uPivotY;
uniform int uKind;   // 0 grass/decor, 1 leaves
out vec2 vUv;
flat out float vLv;
flat out float vMid;
flat out float vCell;
flat out float vRow;
out float vDepth;
void main() {
  // instances live in the mesh's space, so a tree's leaves move with it
  vec3 base = (modelMatrix * vec4(iPos, 1.0)).xyz;
  vec3 lightAt = (modelMatrix * vec4(iLight, 1.0)).xyz;
  if ((uNearCull > 0.0 && distance(base, cameraPosition) < uNearCull) || base.y < uClipY - 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 w = base + uCamR * (position.x * uSize.x) + uCamU * ((position.y + uPivotY) * uSize.y);
  float cl = cloudLight(lightAt);
  float sh = shadowSoft(lightAt);
  if (uKind == 1) {
    float h = iParam.z * 0.5 + 0.5;
    vLv = h * (0.65 + 0.35 * sh) * (0.78 + 0.22 * cl) + iParam.w * 0.12 - 0.06;
  } else {
    vLv = cl * sh;
  }
  vMid = iParam.y;
  vCell = iParam.x;
  vRow = uKind == 1 ? 0.0 : iParam.z;   // grass: the ground palette row it grows on
  vUv = uv;
  vec4 v = viewMatrix * vec4(w, 1.0);
  vDepth = -v.z;
  gl_Position = projectionMatrix * v;
}
`;

export const SPRITE_FRAG = GBUF_OUT + /* glsl */ `
uniform sampler2D uAtlas;
uniform float uCells;
uniform float uPal;
in vec2 vUv;
flat in float vLv;
flat in float vMid;
flat in float vCell;
flat in float vRow;
in float vDepth;
void main() {
  if (texture(uAtlas, vec2((vUv.x + vCell) / uCells, vUv.y)).a < 0.5) discard;
  gData = vec4(vLv, vMid, 1.0, uPal + vRow);
  gNorm = vec4(0.0, 0.0, 0.0, vDepth);
  gStep = vec4(0.0);
}
`;

// The 2D sprite character: a camera-facing card drawn after the post pass with
// the sheet's own colours (no palette, light or outline). Things in front of it
// in the G-buffer hide it.
export const CHAR_SPRITE_VERT = /* glsl */ `
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec2 uSize;   // world size of one frame
out vec2 vUv;
out float vDepth;
void main() {
  vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 w = base + uCamR * (position.x * uSize.x) + uCamU * (position.y * uSize.y);
  vUv = uv;
  // depth of a body standing upright here (not of the tilted card), so the grass at its feet does not cut it
  vDepth = -(viewMatrix * vec4(base + vec3(0.0, position.y * uSize.y, 0.0), 1.0)).z;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

export const CHAR_SPRITE_FRAG = /* glsl */ `
uniform sampler2D uSheet;
uniform sampler2D tNorm;
uniform vec2 uCell;    // column, row of the frame shown (row 0 = top of the sheet)
uniform float uSteps;  // frames per row and per column
out vec4 outColor;
in vec2 vUv;
in float vDepth;
void main() {
  float d = texelFetch(tNorm, ivec2(gl_FragCoord.xy), 0).w;
  // hidden by what is in front, but not by the grass it stands in (about its radius)
  if (d > 0.0 && d < vDepth - 0.25) discard;
  vec4 c = texture(uSheet, (vec2(uCell.x, uSteps - 1.0 - uCell.y) + vUv) / uSteps);
  if (c.a < 0.5) discard;
  outColor = vec4(c.rgb, 1.0);   // the sheet is sRGB, like the post pass output
}
`;

// The 3d_new character in the top view: drawn after the upscale, straight onto
// the screen at full resolution with its own textures (no palette or outline),
// in two light bands like the scene. Its viewport lines it up with the low-res
// frame (sub-pixel camera shift included); things in front of it in the
// G-buffer hide it, but not the grass it stands in.
export const SCREEN_CHAR_VERT = /* glsl */ `
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vec4 v = viewMatrix * w;
  vDepth = -v.z;
  gl_Position = projectionMatrix * v;
}
`;

export const SCREEN_CHAR_FRAG = COMMON + /* glsl */ `
uniform sampler2D uTex;
uniform sampler2D tNorm;   // the low-res G-buffer (depth in w)
uniform vec2 uOffset;      // the blit's mapping from screen to low-res pixels
uniform float uScale;
uniform vec2 uMargin;
in vec3 vW; in vec3 vN; in vec2 vUv; in float vDepth;
out vec4 outColor;
void main() {
  ivec2 q = ivec2(floor((gl_FragCoord.xy - uMargin) / uScale + 1.0 + uOffset));
  float d = texelFetch(tNorm, q, 0).w;
  if (d > 0.0 && d < vDepth - 0.25) discard;
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float ndl = dot(N, uSunL);
  float lv = ndl > 0.0 ? ndl * cloudLight(vW) * shadowHard(vW + N * 0.02) : 0.0;
  vec3 c = texture(uTex, vUv).rgb;   // sRGB, like the post pass output
  outColor = vec4(lv > 0.09 ? c * 1.08 : c * vec3(0.8, 0.78, 0.88), 1.0);
}
`;

// ------------------------------------------------------------------ fullscreen
export const FS_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Flat palette colour of one G-buffer sample (before outlines and light).
// pal.props: the palettes of generated objects, by family (gen/palettes.js paletteTables)
function paletteGlsl(pal) {
  return rampRows('rampGround', pal.props.ground) + rampRows('rampTrunk', pal.props.trunk) +
    rampRows('rampCanopy', pal.props.canopy) + stoneGlsl(pal.props.stone) + waterGlsl(pal.props.water) + rampFn('rampFlowerW', pal.flower_w) +
    rampFn('rampFlowerL', pal.flower_l) + rampFn('rampSprout', pal.sprout) +
    rampFn('rampLeafdeco', pal.leafdeco) + /* glsl */ `
const vec3 SKY_TOP = ${vec3(pal.sky_top)};
const vec3 SKY_HORIZON = ${vec3(pal.sky_horizon)};
${charGlsl(pal.char)}
float isMid(float m, float k) { return abs(m - k) <= 0.5 ? 1.0 : 0.0; }
// the character: material id CHAR_MID + palette index
float isChar(float m) { return m > ${(CHAR_MID - 0.5).toFixed(1)} ? 1.0 : 0.0; }
int charIndex(float m) { return clamp(int(m - ${CHAR_MID.toFixed(1)} + 0.5), 0, CHAR_N - 1); }
// sun, top face in shade, side face in shade (a little darker); the dark
// colour is kept for the outlines, so faces turned from the sun stay readable
vec3 charColor(float lv, float mid, float up) {
  int i = charIndex(mid);
  return lv > 0.09 ? CHAR_LIT[i] : up > 0.6 ? CHAR_MIDTONE[i] : mix(CHAR_MIDTONE[i], CHAR_DARK[i], 0.3);
}

// row: the palette row of the ground, stone, trunk and canopy (G-buffer w)
vec3 baseColor(float lv, float mid, float up, float row) {
  vec3 col = rampGround(lv, isMid(mid, 1.0) > 0.5 ? row : 0.0);
  float lit = lv > 0.09 ? 1.0 : 0.0;
  int s = stoneRow(row);
  vec3 rock = mix(mix(STONE_SHADE[s], STONE_UP[s], up > 0.6 ? 1.0 : 0.0), STONE_LIT[s], lit);
  col = mix(col, rock, isMid(mid, 2.0));
  col = mix(col, rampTrunk(lv, row), isMid(mid, 3.0));
  col = mix(col, rampCanopy(lv, row), isMid(mid, 4.0));
  col = mix(col, rampFlowerW(lv), isMid(mid, 5.0));
  col = mix(col, rampFlowerL(lv), isMid(mid, 6.0));
  col = mix(col, rampSprout(lv), isMid(mid, 7.0));
  col = mix(col, rampLeafdeco(lv), isMid(mid, 8.0));
  col = mix(col, charColor(lv, mid, up), isChar(mid));
  return col;
}
`;
}

// the character's colours as GLSL arrays: [name, [lit, top in shade, shade]]
function charGlsl(palette) {
  const rows = Object.values(palette);
  const arr = (name, f) => `const vec3 ${name}[CHAR_N] = vec3[](${rows.map((r) => f(r)).join(', ')});`;
  // outline highlight: the lit colour a third of the way to white
  const hi = (hex) => `vec3(${hexToLin(hex).map((v) => (v + (1 - v) * 0.35).toFixed(6)).join(', ')})`;
  return [`const int CHAR_N = ${rows.length};`,
    arr('CHAR_LIT', (r) => vec3(r[0])), arr('CHAR_MIDTONE', (r) => vec3(r[1])),
    arr('CHAR_DARK', (r) => vec3(r[2])), arr('CHAR_HI', (r) => hi(r[0]))].join('\n');
}

// Top view: the scene is drawn with 3x3 samples per pixel, and each pixel copies
// ONE of them (no blending, colours stay flat). Usually the centre sample,
// which is exactly what a 1-sample render gives. On stone and the character, a
// brighter surface (lit, or facing up) that covers at least 3 of the 9 samples
// wins: thin lit ledges and bevels then become whole 1-pixel lines instead of
// dots and dashes.
export const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D tData;
uniform sampler2D tNorm;
uniform sampler2D tStep;
layout(location = 0) out vec4 gData;
layout(location = 1) out vec4 gNorm;
layout(location = 2) out vec4 gStep;
float rank(vec4 D) { return (D.x > 0.09 ? 2.0 : 0.0) + (D.z > 0.6 ? 1.0 : 0.0); }
bool solid(float m) { return abs(m - 2.0) <= 0.5 || m > ${(CHAR_MID - 0.5).toFixed(1)}; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 3 + 1;
  ivec2 pick = c;
  vec4 D = texelFetch(tData, c, 0);
  if (solid(D.y)) {
    float r0 = rank(D), count[4] = float[](0.0, 0.0, 0.0, 0.0);
    ivec2 first[4];
    for (int y = 1; y >= -1; y--) for (int x = -1; x <= 1; x++) {
      ivec2 s = c + ivec2(x, y);
      vec4 Ds = texelFetch(tData, s, 0);
      if (abs(Ds.y - D.y) > 0.5 || texelFetch(tNorm, s, 0).w <= 0.0) continue;
      int r = int(rank(Ds));
      if (count[r] == 0.0 || (x == 0 || y == 0)) first[r] = s;
      count[r] += 1.0;
    }
    for (int r = 3; r >= 0; r--) {
      if (float(r) <= r0) break;
      if (count[r] >= 3.0) { pick = first[r]; break; }
    }
  }
  gData = texelFetch(tData, pick, 0);
  gNorm = texelFetch(tNorm, pick, 0);
  gStep = texelFetch(tStep, pick, 0);
}
`;

// First person god rays, at a quarter of the resolution (they are soft): march
// from the eye out along each pixel's ray through the light volume.
export const RAY_FRAG = COMMON + /* glsl */ `
uniform sampler2D tNorm;
uniform vec2 uRes;
uniform vec3 uCamPos, uViewR, uViewU, uViewF;
uniform vec2 uTanHalf;
uniform float uVolTop;
uniform float uRayK;
uniform float uRayBias;
uniform int uRaySteps;
uniform float uRayScale;     // full-resolution pixels per ray pixel
out vec4 outColor;
void main() {
  vec2 f = floor(gl_FragCoord.xy) * uRayScale + 0.5 * uRayScale;
  float d = texelFetch(tNorm, clamp(ivec2(f), ivec2(0), ivec2(uRes) - 1), 0).w;
  vec2 ndc = f / uRes * 2.0 - 1.0;
  vec3 dir = normalize(uViewF + uViewR * ndc.x * uTanHalf.x + uViewU * ndc.y * uTanHalf.y);
  float dist = d <= 0.0 ? 1e4 : d / dot(dir, uViewF);
  const float SIGMA = 0.035;
  float len = min(dist, 30.0), acc = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uRaySteps) break;
    float s = (float(i) + 0.5) / float(uRaySteps) * len;
    vec3 Q = uCamPos + dir * s;
    if (Q.y > uVolTop) continue;
    float w = exp(-SIGMA * s) * exp(-SIGMA * (uVolTop - Q.y) / uSunL.y);
    acc += shadowHard(Q) * cloudLight(Q) * w;
  }
  // same contrast as the top view: only well-lit stretches glow
  outColor = vec4(uRayK * len * max(0.0, acc / float(uRaySteps) - uRayBias / 13.9), 0.0, 0.0, 1.0);
}
`;

export function postFrag(pal) {
  return COMMON + paletteGlsl(pal) + /* glsl */ `
uniform sampler2D tData;
uniform sampler2D tNorm;
uniform sampler2D tStep;
uniform sampler2D tRay;      // first person: god rays from the quarter-resolution pass
uniform vec2 uRes;
uniform vec3 uCamPos, uViewR, uViewU, uViewF;
uniform vec2 uHalf;          // orthographic: half the view size in world units
uniform int uPersp;          // 1 = first-person perspective camera
uniform vec2 uTanHalf;       // perspective: tan of half the field of view (x, y)
uniform vec2 uFog;           // perspective: fog start, end distance
uniform float uVolTop;
uniform float uRayK;
uniform int uRaySteps;
uniform int uRayDebug;
uniform float uRayBias;
uniform sampler2D tRefl;     // water: the G-buffer seen from the mirrored camera (light, material, up, row)
uniform sampler2D tReflN;    // ... and its normal + depth (0 = nothing, the sky)
uniform mat4 uReflVP;        // water: view-projection of the mirrored camera
uniform float uTime;
out vec4 outColor;

const ivec2 O4[4] = ivec2[](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));

// Water, at the point W of the surface (view ray dir): flat depth bands from
// the distance to the shore, the scene mirrored in it (rows wobble a pixel:
// ripples), short wave lines along the screen rows that grow and fade, and
// a 1px foam line along the shore.
vec3 waterColor(ivec2 p, ivec2 hi, vec3 W, vec3 dir, float lv, float shore, float row, float d) {
  int r = waterRow(row);
  float lit = lv > 0.5 ? 1.0 : 0.0;
  // one row / column: a screen pixel on the water (top view), a surface pixel (first person)
  float colW = uPersp == 1 ? uTexel : 2.0 * uHalf.x / uRes.x;
  float rowH = uPersp == 1 ? uTexel : colW / max(0.2, -uViewF.y);
  if (uPersp == 1) W.xz = (floor(W.xz / uTexel) + 0.5) * uTexel;
  vec2 Rg = normalize(uViewR.xz), Fg = normalize(uViewF.xz);
  float a = dot(W.xz, Rg), j = floor(dot(W.xz, Fg) / rowH);

  // depth bands; their edges lap slowly
  float s = shore + 0.08 * gnoise(W.xz * 1.6 + vec2(0.21, -0.17) * uTime);
  int tone = s < 0.3 ? SHALLOW : s < 0.9 ? MID : DEEP;
  vec3 col = waterTone(r, tone, lit);

  // the mirrored scene, read where this point of the water plane falls in it
  vec4 c = uReflVP * vec4(W.x, 0.0, W.z, 1.0);
  ivec2 q = ivec2(floor((c.xy / c.w * 0.5 + 0.5) * uRes));
  q.x += int(floor(0.5 + 1.1 * sin(j * 0.9 + uTime * 1.7)));
  q = clamp(q, ivec2(0), hi);
  float rd = texelFetch(tReflN, q, 0).w;
  if (rd > 0.0) {
    vec4 R = texelFetch(tRefl, q, 0);
    vec3 rc = baseColor(R.x, R.y, R.z, R.w);
    // the mirrored shapes keep a dark outline against the sky and far things
    float e = 0.0;
    for (int i = 0; i < 4; i++) {
      float qd = texelFetch(tReflN, clamp(q + O4[i], ivec2(0), hi), 0).w;
      if (qd <= 0.0 || qd - rd > 0.8 * max(1.0, rd / 6.0)) e = 1.0;
    }
    rc = mix(rc, waterTone(r, DEEP, 0.0) * 0.75, e);
    col = mix(col, rc, 0.42);
  } else if (uPersp == 1) {
    vec3 m = reflect(dir, vec3(0.0, 1.0, 0.0));
    col = mix(col, mix(SKY_HORIZON, SKY_TOP, clamp(m.y * 2.5, 0.0, 1.0)), 0.3);
  }

  // wave lines: on every third row, dashes that drift, grow, then fade
  if (tone != SHALLOW && mod(j, 3.0) < 0.5) {
    vec2 h = hash2(vec2(j, 7.0)) * 0.5 + 0.5;
    float aa = a + uTime * (0.08 + 0.1 * h.x) * (h.y > 0.5 ? 1.0 : -1.0);
    float cell = 1.3 + h.y;
    float k = floor(aa / cell);
    vec2 g = hash2(vec2(k, j)) * 0.5 + 0.5;
    float life = fract(uTime * (0.1 + 0.08 * g.x) + g.y);
    float len = (0.2 + 0.5 * g.x) * sin(life * 3.14159);
    if (g.x < 0.6 && abs(aa - (k + 0.3 + 0.4 * g.y) * cell) < 0.5 * len) col = waterTone(r, WAVE, lit);
  }

  // foam: where the shallow water laps, and the 1px line along the shore
  // (next to ground or something low that stands in the water, not in front of it)
  bool foam = shore < colW * (0.8 + 0.8 * sin(uTime * 1.3 + 7.0 * gnoise(W.xz * 2.3)));
  if (uPersp == 0) for (int i = 0; i < 4; i++) {
    ivec2 n = clamp(p + O4[i], ivec2(0), hi);
    float nd = texelFetch(tNorm, n, 0).w;
    if (abs(texelFetch(tData, n, 0).y - ${WATER_MID.toFixed(1)}) > 0.5 && nd > 0.0 && abs(nd - d) < 0.3) foam = true;
  }
  if (foam) col = waterTone(r, FOAM, lit);
  return col;
}

vec3 linToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(uRes) - 1;
  vec4 D = texelFetch(tData, p, 0);
  vec4 NN = texelFetch(tNorm, p, 0);
  float lv = D.x, mid = D.y, up = D.z;
  vec3 n = NN.xyz;
  float d = NN.w;

  // first person: an outline is a thin detail of the object, uLineWorld wide,
  // so it gets thinner with distance like the object does. Near, it stops at
  // uLineMax screen pixels (fine lines); far, once it is thinner than one
  // screen pixel, it fades out (like a real thin detail). Tested per screen
  // pixel, so lines move smoothly with the edges they draw.
  vec2 offs[4] = vec2[](vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1));
  float lineK = 1.0;
  vec4 st = texelFetch(tStep, p, 0) * 0.5 * uRes.xyxy;
  if (st != vec4(0.0)) {
    float w = max(length(st.xy), length(st.zw));     // one surface pixel, in screen pixels
    float lw = w * uLineWorld / uTexel;               // the line, in screen pixels
    st *= min(lw, uLineMax) / w;
    lineK = clamp(lw, 0.0, 1.0);
    // at least one screen pixel, so faces seen edge-on do not flicker
    vec2 a = st.xy * max(1.0, 1.0 / max(length(st.xy), 1e-4));
    vec2 b = st.zw * max(1.0, 1.0 / max(length(st.zw), 1e-4));
    offs = vec2[](a, -a, b, -b);
  }

  // flat palette bands per material
  // top view, stone and the character: a single pixel whose band (lit, facing up)
  // matches none of its 4 neighbours on the same surface takes the band most
  // of them share, so faces have no stray single-pixel dots
  if (uPersp == 0 && max(isMid(mid, 2.0), isChar(mid)) > 0.5) {
    float r = (lv > 0.09 ? 2.0 : 0.0) + (up > 0.6 ? 1.0 : 0.0);
    float cnt[4] = float[](0.0, 0.0, 0.0, 0.0);
    vec4 rep4[4];
    bool same = false;
    ivec2 o4[4] = ivec2[](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
    for (int i = 0; i < 4; i++) {
      ivec2 qp = clamp(p + o4[i], ivec2(0), hi);
      vec4 Dq = texelFetch(tData, qp, 0);
      if (abs(Dq.y - mid) > 0.5 || abs(texelFetch(tNorm, qp, 0).w - d) > 0.3) continue;
      int rq = int((Dq.x > 0.09 ? 2.0 : 0.0) + (Dq.z > 0.6 ? 1.0 : 0.0));
      if (float(rq) == r) same = true;
      cnt[rq] += 1.0; rep4[rq] = Dq;
    }
    if (!same) for (int k = 0; k < 4; k++) if (cnt[k] >= 2.0) { lv = rep4[k].x; up = rep4[k].z; break; }
  }
  vec3 col = baseColor(lv, mid, up, D.w);
  float lit = lv > 0.09 ? 1.0 : 0.0;

  // 1px outlines: depth edges + convex normal edges (4-neighbour kernel)
  float dsum = 0.0, nsum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 q = texelFetch(tNorm, clamp(ivec2(floor(vec2(p) + 0.5 + offs[i])), ivec2(0), hi), 0);
    float dd = q.w - d;
    // first person: depth steps grow with distance, so do the thresholds
    if (uPersp == 1) dd /= max(1.0, d / 6.0);
    dsum += clamp(dd, 0.0, 1.0);
    float ni = dot(n - q.xyz, vec3(1.0)) > 0.01 ? 1.0 : 0.0;
    float di = dd > -0.04 ? 1.0 : 0.0;
    nsum += (1.0 - dot(n, q.xyz)) * di * ni;
  }
  float dei = dsum > 0.22 ? 1.0 : 0.0;
  // smooth meshes (character palette row 1: the 3d_new model) only get lines at sharp creases
  float nei = nsum > (isChar(mid) * D.w > 0.5 ? 0.6 : 0.05) ? 1.0 : 0.0;
  // stones and the character get outlines
  float ch = isChar(mid);
  int ci = charIndex(mid);
  float edge = max(dei, nei) * max(isMid(mid, 2.0), ch) * lineK;
  // one dark line colour per material (not per face), so lines do not change shade along an edge
  int si = stoneRow(D.w);
  vec3 dark = mix(STONE_SHADE[si], CHAR_DARK[ci], ch) * (0.60 - 0.25 * dei);
  // the outline around the shape is always dark (so the shape reads clearly);
  // inner edges get a highlight where the face is lit
  vec3 edgeCol = mix(dark, mix(STONE_HI[si], CHAR_HI[ci], ch), lit * (1.0 - dei));
  col = mix(col, edgeCol, edge);

  vec2 ndc = (vec2(p) + 0.5) / uRes * 2.0 - 1.0;
  if (isMid(mid, ${WATER_MID.toFixed(1)}) > 0.5) {
    // the point on the water: along this pixel's ray (first person), or under it (top view)
    vec3 dir = normalize(uViewF + uViewR * ndc.x * uTanHalf.x + uViewU * ndc.y * uTanHalf.y);
    vec3 W = uPersp == 1 ? uCamPos + dir * (d / dot(dir, uViewF))
      : uCamPos + uViewR * ndc.x * uHalf.x + uViewU * ndc.y * uHalf.y + uViewF * d;
    col = waterColor(p, hi, W, uPersp == 1 ? dir : uViewF, lv, up, D.w, d);
  }

  // god rays: march through the light volume, testing the shadow map and
  // the canopy noise. Same medium as the Blender volume: density 0.035,
  // light and view paths both attenuated (EEVEE "volumetric shadows").
  const float SIGMA = 0.035;
  float acc = 0.0, len, ray;
  if (uPersp == 1) {
    // first person: from the eye out along this pixel's ray
    vec3 dir = normalize(uViewF + uViewR * ndc.x * uTanHalf.x + uViewU * ndc.y * uTanHalf.y);
    bool sky = d <= 0.0;
    float dist = sky ? 1e4 : d / dot(dir, uViewF);
    vec3 skyCol = mix(SKY_HORIZON, SKY_TOP, clamp(dir.y * 2.5, 0.0, 1.0));
    col = sky ? skyCol : mix(col, SKY_HORIZON, smoothstep(uFog.x, uFog.y, dist));
    // from the quarter-resolution ray pass
    ray = texture(tRay, (vec2(p) + 0.5) / uRes).r;
  } else {
    // top view: from the surface back up to the top of the volume
    vec3 P = uCamPos + uViewR * ndc.x * uHalf.x + uViewU * ndc.y * uHalf.y + uViewF * d;
    len = max(0.0, (uVolTop - P.y) / (-uViewF.y));
    for (int i = 0; i < 64; i++) {
      if (i >= uRaySteps) break;
      float t = (float(i) + 0.5) / float(uRaySteps) * len;
      vec3 Q = P - uViewF * t;
      float w = exp(-SIGMA * (len - t)) * exp(-SIGMA * (uVolTop - Q.y) / uSunL.y);
      acc += shadowHard(Q) * cloudLight(Q) * w;
    }
    float raw = acc / float(uRaySteps) * len;
    if (uRayDebug == 1) { outColor = vec4(vec3(raw * uRayK * 2.0), 1.0); return; }
    // fitted to the Blender volume pass: median 0.045, p90 0.15, p99 0.25
    ray = uRayK * max(0.0, raw - uRayBias);
  }
  ray = floor(ray * 24.0) / 24.0;
  col += vec3(1.0, 0.95, 0.72) * ray;

  outColor = vec4(linToSrgb(col), 1.0);
}
`;
}

// dust motes: 1px points that only show inside the light beams
export const DUST_VERT = COMMON + /* glsl */ `
uniform float uTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
out float vDepth;
void main() {
  vec3 P = position;
  P.x += uTime * 0.07 + sin(uTime * 0.31 + position.z * 1.7) * 0.25;
  P.y += sin(uTime * 0.23 + position.x * 2.3) * 0.2;
  P.z += cos(uTime * 0.27 + position.y * 1.9) * 0.25;
  P = uBoxMin + mod(P - uBoxMin, uBoxSize);
  float lit = shadowHard(P) * cloudLight(P);
  vec4 v = viewMatrix * vec4(P, 1.0);
  vDepth = -v.z;
  bool hide = lit < 0.5 || (uTexel > 0.0 && vDepth < uNearCull);
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * v;
  // as big as one surface pixel, at most a line's width (first person), or one screen pixel (top view)
  gl_PointSize = uTexel > 0.0 ? clamp(uTexel / (vDepth * uPxAngle), 1.0, uLineMax) : 1.0;
}
`;

export const DUST_FRAG = /* glsl */ `
uniform sampler2D tNorm;
in float vDepth;
out vec4 outColor;
void main() {
  if (vDepth > texelFetch(tNorm, ivec2(gl_FragCoord.xy), 0).w + 0.01) discard;
  outColor = vec4(0.30, 0.29, 0.22, 1.0);
}
`;

export const BLIT_FRAG = /* glsl */ `
uniform sampler2D tFinal;
uniform sampler2D tNorm;
uniform vec2 uOffset;   // sub-pixel camera error, in low-res pixels
uniform float uScale;
uniform vec2 uMargin;
uniform vec2 uLow;
uniform float uSoftK;   // first person: screen pixels of one surface pixel at distance 1 (0 = off)
out vec4 outColor;
void main() {
  vec2 lp = (gl_FragCoord.xy - uMargin) / uScale;
  if (any(lessThan(lp, vec2(0.0))) || any(greaterThanEqual(lp, uLow))) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  ivec2 q = ivec2(floor(lp + 1.0 + uOffset));
  outColor = texelFetch(tFinal, q, 0);
  if (uSoftK > 0.0) {
    // first person, far: once surface pixels (and the lines they carry) get
    // smaller than about two screen pixels, average them a little, like a real
    // far object or a mipmapped texture, instead of hard broken 1-pixel dashes.
    // The nearest surface around decides, so near edges stay sharp.
    ivec2 hi = textureSize(tFinal, 0) - 1;
    float dmin = 1e9;
    vec3 sum = vec3(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      ivec2 r = clamp(q + ivec2(x, y), ivec2(0), hi);
      float d = texelFetch(tNorm, r, 0).w;
      if (d > 0.0) dmin = min(dmin, d);
      sum += texelFetch(tFinal, r, 0).rgb * float((2 - abs(x)) * (2 - abs(y)));
    }
    float s = 0.5 - 0.5 * smoothstep(1.0, 2.0, uSoftK / dmin);
    outColor.rgb = mix(outColor.rgb, sum / 16.0, s);
  }
}
`;
