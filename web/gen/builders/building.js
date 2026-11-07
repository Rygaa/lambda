// Buildings (assets/building): a plan of simple shapes, as in
// documentation/building/README.md. The type file lists them, and each face
// names its colour, a palette of the stone family, so themes work on buildings.
// There is one variant: the plan is the shape, nothing is random.
//   shapes: [{ id, type, size: [x, y, z], position, rotationY, tilt, faces }]
//   type:     box | wedge | pyramid | cylinder | dome
//   position: the centre of the bottom of the shape
//   faces:    { face: palette }, "all" for the faces it does not name
import * as THREE from 'three';
import { defineBuilder } from '../registry.js';
import { partsOf, clean } from '../solids.js';
import { paletteNames } from '../palettes.js';

const CYLINDER_SIDES = 8;       // flat sides, so it reads as low-poly
const DOME_SIDES = 14, DOME_BANDS = 5;
const LOW = 1.2;                // what starts lower than this stands on the ground, the rest (a roof) hangs over it
const STEP = 0.6, DISC = 0.45;  // the ground it covers: circles on a grid

// every shape type: [w, h, d] -> [[face, [x, y, z], ...]]: polygons, counter-clockwise from outside
const SHAPES = {
  box([w, h, d]) {
    const x = w / 2, z = d / 2;
    return [
      ['front', [-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]],
      ['back', [x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]],
      ['right', [x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z]],
      ['left', [-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z]],
      ['top', [-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z]],
      ['bottom', [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]],
    ];
  },
  // a gable roof: the ridge runs along x, over z = 0
  wedge([w, h, d]) {
    const x = w / 2, z = d / 2;
    return [
      ['front', [-x, 0, z], [x, 0, z], [x, h, 0], [-x, h, 0]],
      ['back', [x, 0, -z], [-x, 0, -z], [-x, h, 0], [x, h, 0]],
      ['left', [-x, 0, -z], [-x, 0, z], [-x, h, 0]],
      ['right', [x, 0, z], [x, 0, -z], [x, h, 0]],
      ['bottom', [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]],
    ];
  },
  pyramid([w, h, d]) {
    const x = w / 2, z = d / 2, top = [0, h, 0];
    return [
      ['front', [-x, 0, z], [x, 0, z], top],
      ['back', [x, 0, -z], [-x, 0, -z], top],
      ['right', [x, 0, z], [x, 0, -z], top],
      ['left', [-x, 0, -z], [-x, 0, z], top],
      ['bottom', [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]],
    ];
  },
  cylinder([w, h, d]) {
    const ring = Array.from({ length: CYLINDER_SIDES }, (_, i) => {
      const a = ((i + 0.5) / CYLINDER_SIDES) * Math.PI * 2;
      return [(Math.sin(a) * w) / 2, (Math.cos(a) * d) / 2];
    });
    return [
      ...ring.map(([ax, az], i) => {
        const [bx, bz] = ring[(i + 1) % CYLINDER_SIDES];
        return ['side', [ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az]];
      }),
      ['top', ...ring.map(([x, z]) => [x, h, z])],
      ['bottom', ...ring.map(([x, z]) => [x, 0, z]).reverse()],
    ];
  },
  // a half-sphere; width and depth may differ
  dome([w, h, d]) {
    const point = (side, band) => {
      const a = ((side + 0.5) / DOME_SIDES) * Math.PI * 2, up = (band / DOME_BANDS) * (Math.PI / 2);
      return [(Math.sin(a) * Math.cos(up) * w) / 2, Math.sin(up) * h, (Math.cos(a) * Math.cos(up) * d) / 2];
    };
    const out = [];
    for (let band = 0; band < DOME_BANDS; band++)
      for (let side = 0; side < DOME_SIDES; side++)
        out.push(band === DOME_BANDS - 1
          ? ['side', point(side, band), point(side + 1, band), point(side + 0.5, band + 1)]
          : ['side', point(side, band), point(side + 1, band), point(side + 1, band + 1), point(side, band + 1)]);
    out.push(['bottom', ...Array.from({ length: DOME_SIDES }, (_, side) => point(side, 0)).reverse()]);
    return out;
  },
};

// turn first, then tilt in the turned frame
function matrixOf(s) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(s.tilt ?? 0), THREE.MathUtils.degToRad(s.rotationY ?? 0), 0, 'YXZ'));
  return m.setPosition(...s.position);
}

// the triangles of one shape, in the building: { palette: [[a, b, c], ...] }
function trianglesOf(s) {
  const make = SHAPES[s.type];
  if (!make) throw new Error(`building shape "${s.id}": unknown type "${s.type}" (known: ${Object.keys(SHAPES).join(', ')})`);
  const m = matrixOf(s), out = {};
  for (const [face, ...points] of make(s.size)) {
    const palette = s.faces[face] ?? s.faces.all;
    if (!palette) throw new Error(`building shape "${s.id}": no palette for its "${face}" face`);
    if (!paletteNames('stone').includes(palette)) throw new Error(`building shape "${s.id}": unknown stone palette "${palette}" (known: ${paletteNames('stone').join(', ')})`);
    const at = points.map((p) => new THREE.Vector3(...p).applyMatrix4(m).toArray());
    for (let i = 1; i < at.length - 1; i++) (out[palette] ??= []).push([at[0], at[i], at[i + 1]]);
  }
  return out;
}

function geometryOf(tris) {
  return clean(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3)));
}

// is (x, z) under the triangle (a, b, c), seen from above?
function under(x, z, [a, b, c]) {
  const side = (p, q) => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
  const s = [side(a, b), side(b, c), side(c, a)];
  return s.every((v) => v >= 0) || s.every((v) => v <= 0);
}

// the ground it stands on, as circles [[x, z, r]] on a grid
function groundOf(tris) {
  const low = tris.filter((t) => t.some((p) => p[1] < LOW));
  const xs = low.flat().map((p) => p[0]), zs = low.flat().map((p) => p[2]);
  const out = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs) + STEP; x += STEP)
    for (let z = Math.min(...zs); z <= Math.max(...zs) + STEP; z += STEP)
      if (low.some((t) => under(x, z, t))) out.push([x, z, DISC]);
  return out;
}

defineBuilder({
  name: 'building',
  build(p) {
    const pieces = {}, all = [];
    for (const s of p.shapes)
      for (const [palette, tris] of Object.entries(trianglesOf(s))) {
        (pieces[palette] ??= []).push(geometryOf(tris));
        all.push(...tris);
      }
    const circles = groundOf(all);
    return {
      parts: partsOf(pieces),
      height: Math.max(...all.flat().map((v) => v[1])),
      radius: Math.max(...circles.map(([x, z, r]) => Math.hypot(x, z) + r)),
      circles,
      blocks: true,
      turns: false,      // its front faces the camera, as the plans are drawn
    };
  },
});
