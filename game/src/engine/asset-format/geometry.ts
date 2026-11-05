import * as THREE from "three";
import type { FaceName, Shape } from "./schema.ts";

type Point = [number, number, number];
type UvPoint = [number, number];

// UVs are in meters, so one texture keeps the same texel size on every face.
// The material divides them by the size of its texture slot.
class FaceBuilder {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly groups: { face: FaceName; start: number; count: number }[] = [];

  // Points go counter-clockwise when seen from outside.
  polygon(face: FaceName, points: Point[], uvs: UvPoint[]) {
    const start = this.positions.length / 3;
    for (let index = 1; index < points.length - 1; index++) {
      for (const corner of [0, index, index + 1]) {
        this.positions.push(...points[corner]!);
        this.uvs.push(...uvs[corner]!);
      }
    }
    const count = this.positions.length / 3 - start;
    const last = this.groups.at(-1);
    if (last && last.face === face) last.count += count;
    else this.groups.push({ face, start, count });
  }

  // A rectangle from bottom-left a, bottom-right b, top-right c, top-left d.
  quad(face: FaceName, a: Point, b: Point, c: Point, d: Point, width: number, height: number) {
    this.polygon(face, [a, b, c, d], [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ]);
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    return { geometry, groups: this.groups };
  }
}

function box(builder: FaceBuilder, [w, h, d]: Shape["size"]) {
  const x = w / 2;
  const z = d / 2;
  builder.quad("front", [-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z], w, h);
  builder.quad("back", [x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z], w, h);
  builder.quad("right", [x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z], d, h);
  builder.quad("left", [-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z], d, h);
  builder.quad("top", [-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z], w, d);
  builder.quad("bottom", [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], w, d);
}

// A gable roof: the ridge runs along x at the top, over z = 0.
function wedge(builder: FaceBuilder, [w, h, d]: Shape["size"]) {
  const x = w / 2;
  const z = d / 2;
  const slope = Math.hypot(h, z);
  builder.quad("front", [-x, 0, z], [x, 0, z], [x, h, 0], [-x, h, 0], w, slope);
  builder.quad("back", [x, 0, -z], [-x, 0, -z], [-x, h, 0], [x, h, 0], w, slope);
  builder.polygon("left", [[-x, 0, -z], [-x, 0, z], [-x, h, 0]], [[0, 0], [d, 0], [z, h]]);
  builder.polygon("right", [[x, 0, z], [x, 0, -z], [x, h, 0]], [[0, 0], [d, 0], [z, h]]);
  builder.quad("bottom", [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], w, d);
}

function pyramid(builder: FaceBuilder, [w, h, d]: Shape["size"]) {
  const x = w / 2;
  const z = d / 2;
  const top: Point = [0, h, 0];
  const slopeFront = Math.hypot(h, z);
  const slopeSide = Math.hypot(h, x);
  builder.polygon("front", [[-x, 0, z], [x, 0, z], top], [[0, 0], [w, 0], [x, slopeFront]]);
  builder.polygon("back", [[x, 0, -z], [-x, 0, -z], top], [[0, 0], [w, 0], [x, slopeFront]]);
  builder.polygon("right", [[x, 0, z], [x, 0, -z], top], [[0, 0], [d, 0], [z, slopeSide]]);
  builder.polygon("left", [[-x, 0, -z], [-x, 0, z], top], [[0, 0], [d, 0], [z, slopeSide]]);
  builder.quad("bottom", [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], w, d);
}

// 8 flat sides, so it reads as low-poly. Width and depth may differ.
const CYLINDER_SIDES = 8;

function cylinder(builder: FaceBuilder, [w, h, d]: Shape["size"]) {
  const ring: [number, number][] = [];
  for (let index = 0; index < CYLINDER_SIDES; index++) {
    const angle = (index / CYLINDER_SIDES) * Math.PI * 2 + Math.PI / CYLINDER_SIDES;
    ring.push([(Math.sin(angle) * w) / 2, (Math.cos(angle) * d) / 2]);
  }
  let u = 0;
  for (let index = 0; index < CYLINDER_SIDES; index++) {
    const [ax, az] = ring[index]!;
    const [bx, bz] = ring[(index + 1) % CYLINDER_SIDES]!;
    const length = Math.hypot(bx - ax, bz - az);
    builder.polygon(
      "side",
      [[ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az]],
      [[u, 0], [u + length, 0], [u + length, h], [u, h]],
    );
    u += length;
  }
  // The ring goes counter-clockwise when seen from above.
  const flat = (x: number, z: number): UvPoint => [x + w / 2, d / 2 - z];
  builder.polygon("top", ring.map(([x, z]): Point => [x, h, z]), ring.map(([x, z]) => flat(x, z)));
  builder.polygon("bottom", ring.map(([x, z]): Point => [x, 0, z]).reverse(), ring.map(([x, z]) => flat(x, z)).reverse());
}

// A half-sphere: 14 sides and 5 bands up to the top point, like the dome of pixel-scene.
const DOME_SIDES = 14;
const DOME_BANDS = 5;

function dome(builder: FaceBuilder, [w, h, d]: Shape["size"]) {
  const point = (side: number, band: number): Point => {
    const angle = (side / DOME_SIDES) * Math.PI * 2 + Math.PI / DOME_SIDES;
    const up = (band / DOME_BANDS) * (Math.PI / 2);
    return [(Math.sin(angle) * Math.cos(up) * w) / 2, Math.sin(up) * h, (Math.cos(angle) * Math.cos(up) * d) / 2];
  };
  // UVs in meters: around the base, and up along the curve.
  const around = (Math.PI * (w + d)) / 2;
  const curve = (Math.PI / 2) * ((w + d) / 4 + h) / 2;
  const uv = (side: number, band: number): UvPoint => [(side / DOME_SIDES) * around, (band / DOME_BANDS) * curve];

  for (let band = 0; band < DOME_BANDS; band++) {
    for (let side = 0; side < DOME_SIDES; side++) {
      const next = side + 1;
      if (band === DOME_BANDS - 1) {
        builder.polygon("side", [point(side, band), point(next, band), point(side, band + 1)], [
          uv(side, band),
          uv(next, band),
          uv(side + 0.5, band + 1),
        ]);
      } else {
        builder.polygon(
          "side",
          [point(side, band), point(next, band), point(next, band + 1), point(side, band + 1)],
          [uv(side, band), uv(next, band), uv(next, band + 1), uv(side, band + 1)],
        );
      }
    }
  }
  const ring = Array.from({ length: DOME_SIDES }, (_, side) => point(side, 0));
  builder.polygon("bottom", [...ring].reverse(), ring.map(([x, , z]): UvPoint => [x + w / 2, d / 2 - z]).reverse());
}

const BUILDERS = { box, wedge, pyramid, cylinder, dome } as const;

export function buildShapeGeometry(shape: Shape) {
  const builder = new FaceBuilder();
  BUILDERS[shape.type](builder, shape.size);
  return builder.build();
}
