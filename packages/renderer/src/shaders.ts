// GLSL of the pixel-art pipeline, ported from pixel-scene (web/render/shaders.js), top view only:
//   scene pass  -> G-buffer at 3×3 samples per pixel (light, material, normal, depth, albedo)
//   resolve     -> one sample per pixel, so thin lit ledges stay whole lines
//   post pass   -> flat color bands, 1px outlines, water, raymarched god rays
//   dust        -> 1px motes that show only in the light beams
import { DECOR_RAMPS, GROUND_RAMPS, GROUND_ROWS, WATER, type Ramp } from "./palette.ts";

// Material ids in the G-buffer.
export const MID = { ground: 1, solid: 2, flowerWhite: 5, flowerLilac: 6, sprout: 7, leaf: 8, water: 9 } as const;

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const vec3 = (hex: string) =>
  `vec3(${[0, 2, 4].map((i) => srgbToLinear(parseInt(hex.slice(1 + i, 3 + i), 16) / 255).toFixed(6)).join(", ")})`;

function rampFn(name: string, stops: Ramp) {
  let body = `vec3 ${name}(float v) {\n  vec3 c = ${vec3(stops[0]![1])};\n`;
  for (const [position, hex] of stops.slice(1)) body += `  if (v >= ${position.toFixed(4)}) c = ${vec3(hex)};\n`;
  return `${body}  return c;\n}\n`;
}

const GROUND_GLSL =
  GROUND_ROWS.map((row, index) => rampFn(`rampGround${index}`, GROUND_RAMPS[row])).join("") +
  `vec3 rampGround(float v, float row) {\n  int i = int(row + 0.5);\n` +
  GROUND_ROWS.map((_, index) => `  if (i == ${index}) return rampGround${index}(v);\n`).slice(1).join("") +
  `  return rampGround0(v);\n}\n`;

// ------------------------------------------------------------------ shared
const COMMON = /* glsl */ `
uniform vec3 uSunL;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform vec2 uCloudOffset;
uniform float uCloudScale;
uniform float uCloudLo;
uniform float uCloudHi;

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
// Cloud shadow: noise on the ground plane, projected along the sun.
float cloudLight(vec3 P) {
  vec2 G = P.xz - uSunL.xz * (P.y / uSunL.y);
  float v = fbm((G + uCloudOffset) * uCloudScale);
  return 1.0 - smoothstep(uCloudLo, uCloudHi, v);
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
layout(location = 0) out vec4 gData;   // light value, material id, world up, ground row
layout(location = 1) out vec4 gNorm;   // view normal (0 = none), linear depth (0 = nothing)
layout(location = 2) out vec4 gAlb;    // albedo (linear), 1 when it is used
`;

// ------------------------------------------------------------------ meshes
export const MESH_VERT = /* glsl */ `
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

// Asset parts: N.L × cloud × hard shadow; the post pass turns it into flat bands.
export const SOLID_FRAG = COMMON + GBUF_OUT + /* glsl */ `
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uUseMap;
uniform vec2 uRepeat;
in vec3 vW; in vec3 vN; in vec2 vUv; in float vDepth;
void main() {
  vec3 N = normalize(vN);
  float ndl = dot(N, uSunL);
  float lv = 0.0;
  // hard shadow: a soft one, cut into lit / shade, makes jagged edges on faces
  if (ndl > 0.0) lv = ndl * cloudLight(vW) * shadowHard(vW + N * 0.02);
  vec3 albedo = uUseMap > 0.5 ? texture(uMap, vUv * uRepeat).rgb : uColor;
  gData = vec4(lv, ${MID.solid.toFixed(1)}, N.y, 0.0);
  gNorm = vec4(normalize(mat3(viewMatrix) * N), vDepth);
  gAlb = vec4(albedo, 1.0);
}
`;

// The ground: a ramp row (grass, sand, dirt, road), or a ground texture, lit by soft shadows.
export const GROUND_FRAG = COMMON + GBUF_OUT + /* glsl */ `
uniform float uRow;
uniform sampler2D uMap;
uniform float uUseMap;
uniform float uTile;   // meters per texture repeat
in vec3 vW; in vec3 vN; in vec2 vUv; in float vDepth;
void main() {
  vec3 albedo = uUseMap > 0.5 ? texture(uMap, vec2(vW.x, -vW.z) / uTile).rgb : vec3(0.0);
  gData = vec4(cloudLight(vW) * shadowSoft(vW), ${MID.ground.toFixed(1)}, 1.0, uRow);
  gNorm = vec4(0.0, 0.0, 0.0, vDepth);
  gAlb = vec4(albedo, uUseMap);
}
`;

export const WATER_FRAG = COMMON + GBUF_OUT + /* glsl */ `
in vec3 vW; in vec3 vN; in vec2 vUv; in float vDepth;
void main() {
  gData = vec4(cloudLight(vW) * shadowSoft(vW), ${MID.water.toFixed(1)}, 1.0, 0.0);
  gNorm = vec4(0.0, 0.0, 0.0, vDepth);
  gAlb = vec4(0.0);
}
`;

// ------------------------------------------------------------------ sprites
// Grass and flowers: camera-facing quads lit once, at their base point
// (the article's LIGHT_VERTEX trick), so they blend into the ground.
export const SPRITE_VERT = COMMON + /* glsl */ `
in vec3 iPos;      // where the quad stands
in vec4 iParam;    // atlas cell, material id, ground row, unused
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec2 uSize;
out vec2 vUv;
flat out float vLv;
flat out float vMid;
flat out float vCell;
flat out float vRow;
out float vDepth;
void main() {
  vec3 base = (modelMatrix * vec4(iPos, 1.0)).xyz;
  vec3 w = base + uCamR * (position.x * uSize.x) + uCamU * (position.y * uSize.y);
  vLv = cloudLight(base) * shadowSoft(base);
  vMid = iParam.y;
  vCell = iParam.x;
  vRow = iParam.z;
  vUv = uv;
  vec4 v = viewMatrix * vec4(w, 1.0);
  vDepth = -v.z;
  gl_Position = projectionMatrix * v;
}
`;

export const SPRITE_FRAG = GBUF_OUT + /* glsl */ `
uniform sampler2D uAtlas;
uniform float uCells;
in vec2 vUv;
flat in float vLv;
flat in float vMid;
flat in float vCell;
flat in float vRow;
in float vDepth;
void main() {
  if (texture(uAtlas, vec2((vUv.x + vCell) / uCells, vUv.y)).a < 0.5) discard;
  gData = vec4(vLv, vMid, 1.0, vRow);
  gNorm = vec4(0.0, 0.0, 0.0, vDepth);
  gAlb = vec4(0.0);
}
`;

// ------------------------------------------------------------------ fullscreen
export const FS_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// 3×3 samples per pixel -> one of them (no blending, colors stay flat). Usually the
// centre one. On solids, a brighter surface (lit, or facing up) that covers at least
// 3 of the 9 samples wins, so thin lit ledges become whole 1-pixel lines.
export const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D tData;
uniform sampler2D tNorm;
uniform sampler2D tAlb;
layout(location = 0) out vec4 gData;
layout(location = 1) out vec4 gNorm;
layout(location = 2) out vec4 gAlb;
float rank(vec4 D) { return (D.x > 0.09 ? 2.0 : 0.0) + (D.z > 0.6 ? 1.0 : 0.0); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 3 + 1;
  ivec2 pick = c;
  vec4 D = texelFetch(tData, c, 0);
  if (abs(D.y - ${MID.solid.toFixed(1)}) <= 0.5) {
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
  gAlb = texelFetch(tAlb, pick, 0);
}
`;

export const POST_FRAG =
  COMMON +
  GROUND_GLSL +
  rampFn("rampFlowerWhite", DECOR_RAMPS.flowerWhite) +
  rampFn("rampFlowerLilac", DECOR_RAMPS.flowerLilac) +
  rampFn("rampSprout", DECOR_RAMPS.sprout) +
  rampFn("rampLeaf", DECOR_RAMPS.leaf) +
  /* glsl */ `
uniform sampler2D tData;
uniform sampler2D tNorm;
uniform sampler2D tAlb;
uniform vec2 uRes;
uniform vec3 uCamPos, uViewR, uViewU, uViewF;
uniform vec2 uHalf;          // half the view size in meters
uniform float uVolTop;
uniform float uRayK;
uniform float uRayBias;
uniform int uRaySteps;
out vec4 outColor;

float isMid(float m, float k) { return abs(m - k) <= 0.5 ? 1.0 : 0.0; }

vec3 linToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 srgbToLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

// The tones of one albedo, like the hand-picked solid palettes of pixel-scene:
// lit = the albedo; shade = darker and bluer; up = top face in shade; hi = lit edge.
vec3 toneShade(vec3 albedo) { return srgbToLin(linToSrgb(albedo) * 0.62 + vec3(0.03, 0.02, 0.16)); }
vec3 toneUp(vec3 albedo) { return srgbToLin(mix(linToSrgb(toneShade(albedo)), linToSrgb(albedo), 0.3)); }
vec3 toneHi(vec3 albedo) { return srgbToLin(mix(linToSrgb(albedo), vec3(1.0, 0.98, 0.92), 0.45)); }

vec3 solidColor(float lv, float up, vec3 albedo) {
  return lv > 0.09 ? albedo : up > 0.6 ? toneUp(albedo) : toneShade(albedo);
}

// A textured ground: the same 4 light steps as the ground ramps.
vec3 groundTexColor(float lv, vec3 albedo) {
  float k = lv >= 0.76 ? 1.0 : lv >= 0.52 ? 0.8 : lv >= 0.3 ? 0.45 : 0.0;
  return srgbToLin(mix(linToSrgb(toneShade(albedo)), linToSrgb(albedo), k));
}

vec3 baseColor(float lv, float mid, float up, float row, vec4 alb) {
  vec3 col = alb.a > 0.5 ? groundTexColor(lv, alb.rgb) : rampGround(lv, row);
  col = mix(col, solidColor(lv, up, alb.rgb), isMid(mid, ${MID.solid.toFixed(1)}));
  col = mix(col, rampFlowerWhite(lv), isMid(mid, ${MID.flowerWhite.toFixed(1)}));
  col = mix(col, rampFlowerLilac(lv), isMid(mid, ${MID.flowerLilac.toFixed(1)}));
  col = mix(col, rampSprout(lv), isMid(mid, ${MID.sprout.toFixed(1)}));
  col = mix(col, rampLeaf(lv), isMid(mid, ${MID.leaf.toFixed(1)}));
  return col;
}

const ivec2 O4[4] = ivec2[](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(uRes) - 1;
  vec4 D = texelFetch(tData, p, 0);
  vec4 NN = texelFetch(tNorm, p, 0);
  vec4 A = texelFetch(tAlb, p, 0);
  float lv = D.x, mid = D.y, up = D.z;
  vec3 n = NN.xyz;
  float d = NN.w;

  // solids: a single pixel whose band (lit, facing up) matches none of its 4 neighbours
  // on the same surface takes the band most of them share, so faces have no stray dots
  if (isMid(mid, ${MID.solid.toFixed(1)}) > 0.5) {
    float r = (lv > 0.09 ? 2.0 : 0.0) + (up > 0.6 ? 1.0 : 0.0);
    float cnt[4] = float[](0.0, 0.0, 0.0, 0.0);
    vec4 rep4[4];
    bool same = false;
    for (int i = 0; i < 4; i++) {
      ivec2 qp = clamp(p + O4[i], ivec2(0), hi);
      vec4 Dq = texelFetch(tData, qp, 0);
      if (abs(Dq.y - mid) > 0.5 || abs(texelFetch(tNorm, qp, 0).w - d) > 0.3) continue;
      int rq = int((Dq.x > 0.09 ? 2.0 : 0.0) + (Dq.z > 0.6 ? 1.0 : 0.0));
      if (float(rq) == r) same = true;
      cnt[rq] += 1.0; rep4[rq] = Dq;
    }
    if (!same) for (int k = 0; k < 4; k++) if (cnt[k] >= 2.0) { lv = rep4[k].x; up = rep4[k].z; break; }
  }
  vec3 col = baseColor(lv, mid, up, D.w, A);
  float lit = lv > 0.09 ? 1.0 : 0.0;

  // 1px outlines on solids: depth edges + convex normal edges (4-neighbour kernel)
  float dsum = 0.0, nsum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 q = texelFetch(tNorm, clamp(p + O4[i], ivec2(0), hi), 0);
    float dd = q.w - d;
    dsum += clamp(dd, 0.0, 1.0);
    float ni = dot(n - q.xyz, vec3(1.0)) > 0.01 ? 1.0 : 0.0;
    float di = dd > -0.04 ? 1.0 : 0.0;
    nsum += (1.0 - dot(n, q.xyz)) * di * ni;
  }
  float dei = dsum > 0.22 ? 1.0 : 0.0;
  float nei = nsum > 0.05 ? 1.0 : 0.0;
  float edge = max(dei, nei) * isMid(mid, ${MID.solid.toFixed(1)});
  // the outline around the shape is always dark; inner edges get a highlight where the face is lit
  vec3 dark = toneShade(A.rgb) * (0.60 - 0.25 * dei);
  vec3 edgeCol = mix(dark, toneHi(A.rgb), lit * (1.0 - dei));
  col = mix(col, edgeCol, edge);

  // water: flat tone, and a 1px foam line where it meets something at its own level
  if (isMid(mid, ${MID.water.toFixed(1)}) > 0.5) {
    col = lv > 0.5 ? ${vec3(WATER.mid[0])} : ${vec3(WATER.mid[1])};
    for (int i = 0; i < 4; i++) {
      ivec2 q = clamp(p + O4[i], ivec2(0), hi);
      float nd = texelFetch(tNorm, q, 0).w;
      if (abs(texelFetch(tData, q, 0).y - ${MID.water.toFixed(1)}) > 0.5 && nd > 0.0 && abs(nd - d) < 0.6) {
        col = lv > 0.5 ? ${vec3(WATER.foam[0])} : ${vec3(WATER.foam[1])};
      }
    }
  }
  if (d <= 0.0) col = ${vec3(WATER.deep[1])};

  // god rays: from the surface back up to the top of the light volume, testing the
  // shadow map and the clouds. Density 0.035, light and view paths both attenuated.
  const float SIGMA = 0.035;
  vec2 ndc = (vec2(p) + 0.5) / uRes * 2.0 - 1.0;
  vec3 P = uCamPos + uViewR * ndc.x * uHalf.x + uViewU * ndc.y * uHalf.y + uViewF * d;
  float len = d > 0.0 ? max(0.0, (uVolTop - P.y) / (-uViewF.y)) : 0.0;
  float acc = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uRaySteps) break;
    float t = (float(i) + 0.5) / float(uRaySteps) * len;
    vec3 Q = P - uViewF * t;
    float w = exp(-SIGMA * (len - t)) * exp(-SIGMA * (uVolTop - Q.y) / uSunL.y);
    acc += shadowHard(Q) * cloudLight(Q) * w;
  }
  float ray = uRayK * max(0.0, acc / float(uRaySteps) * len - uRayBias);
  ray = floor(ray * 24.0) / 24.0;
  col += vec3(1.0, 0.95, 0.72) * ray;

  outColor = vec4(linToSrgb(col), 1.0);
}
`;

// Dust motes: 1px points that show only inside the light beams.
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
  gl_Position = lit < 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * v;
  gl_PointSize = 1.0;
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
