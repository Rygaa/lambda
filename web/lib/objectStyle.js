// The FlyFF decor objects in the style of our world (systems/objects.js): their painted textures (about 1800 colours,
// with light painted in) become textures of our palette rows (assets/palettes.json), so the world pass gives them our
// tones, our light bands and our 1 px outline (render/shaders.js DECOR_FRAG). A texel takes the row with the nearest
// of its tones, so a texel painted in shadow still finds its colour, and the light comes from the game. The rows: the
// stone ones (4 tones: lit, top in shade, side in shade, lit edge) and the green leaf ones (canopy green and pine, the
// 7 greens of their light ramp; not autumn, which would take the wood), so plants stay green. Then each texel takes
// the row most of its neighbours have, twice, so the painted specks go and flat areas stay.
// In the texture (and in the voxel palette, for the cubes: lib/voxels.js) the red byte is the row, the green byte 255
// for a leaf row, the blue byte 255 where the FlyFF texture is transparent: there it is cut out (the leaves of a plant
// painted on a flat card keep their shape).
import * as THREE from 'three';
import { paletteTables, paletteNames } from '../gen/palettes.js';

const made = new WeakMap();   // texture -> its texture of rows

// the texture of rows of a FlyFF texture (a canvas: lib/bake.js solidTexture), made once
export function styleTexture(texture) {
  if (!made.has(texture)) made.set(texture, rowTexture(texture.image, texture.userData.alpha));
  return made.get(texture);
}

const LEAF = 64;                         // code of a leaf row: LEAF + its row
const LEAF_ROWS = ['green', 'pine'];     // the canopy rows a texel can take

// [r, g, b, code] of each tone of each row a texel can take
let tones = null;
function allTones() {
  if (tones) return tones;
  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const { stone, canopy } = paletteTables(), names = paletteNames('canopy');
  tones = stone.flatMap((row, i) => ['lit', 'up', 'shade', 'hi'].filter((k) => row[k]).map((k) => [...rgb(row[k]), i]));
  for (const name of LEAF_ROWS) {
    const i = names.indexOf(name);
    if (i >= 0) for (const [, hex] of canopy[i]) tones.push([...rgb(hex), LEAF + i]);
  }
  return tones;
}

// the nearest row code of an sRGB colour ("redmean": a cheap distance close to what the eye sees)
function rowOf(r, g, b) {
  let best = 0, bestD = Infinity;
  for (const [tr, tg, tb, row] of allTones()) {
    const m = (r + tr) / 2, dr = r - tr, dg = g - tg, db = b - tb;
    const d = (2 + m / 256) * dr * dr + 4 * dg * dg + (2 + (255 - m) / 256) * db * db;
    if (d < bestD) { bestD = d; best = row; }
  }
  return best;
}

// alpha: the alpha byte of each texel of the FlyFF texture (lib/bake.js), or none: all opaque
function rowTexture(image, alpha) {
  const { width, height } = image, cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(image, 0, 0);
  const data = cx.getImageData(0, 0, width, height).data, cache = new Map();
  let rows = new Uint8Array(width * height);
  for (let i = 0; i < rows.length; i++) {
    const rgb = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    let row = cache.get(rgb);
    if (row === undefined) cache.set(rgb, (row = rowOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])));
    rows[i] = row;
  }
  for (let pass = 0; pass < 2; pass++) rows = majority(rows, width, height);
  return codeTexture(rows, width, height, alpha);
}

// each texel takes the row most of the 3 x 3 texels around it have (the texture repeats)
function majority(rows, w, h) {
  const out = new Uint8Array(rows.length), count = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    count.clear();
    let best = 0, bestN = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = rows[((y + dy + h) % h) * w + ((x + dx + w) % w)], n = (count.get(v) ?? 0) + 1;
      count.set(v, n);
      if (n > bestN) { bestN = n; best = v; }
    }
    out[y * w + x] = best;
  }
  return out;
}

// a canvas texture: the red byte is the row, the green byte 255 for a leaf row, the blue byte 255 where it is cut out
// (a canvas, so the voxel workers can read it: lib/voxels.js)
function codeTexture(rows, w, h, alpha) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const img = new ImageData(w, h);
  for (let i = 0; i < rows.length; i++) {
    const leaf = rows[i] >= LEAF;
    img.data[i * 4] = leaf ? rows[i] - LEAF : rows[i];
    img.data[i * 4 + 1] = leaf ? 255 : 0;
    img.data[i * 4 + 2] = alpha && alpha[i] < 128 ? 255 : 0;
    img.data[i * 4 + 3] = 255;
  }
  cv.getContext('2d').putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(cv);
  texture.flipY = false;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
