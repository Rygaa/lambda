// The shapes of the terrain made from the map: the triangles of the low-poly mountains and the rock shapes.
// Used by the mesh terrain (terrain.ts) and the voxel terrain (terrainChunk.ts, also in a worker: no DOM here).
import * as THREE from "three";
import { createRandom } from "../shared/noise.ts";
import type { GameMap, Rock } from "../shared/worldgen.ts";

// The triangles of the low-poly mountains: 9 numbers each (3 corners), and 1 where a triangle is snow.
// Triangles that lie flat on the ground (every corner under 0.3 m) are left out, so the mountains rise straight
// from the ground.
export function mountainTriangles(map: GameMap) {
  const mt = map.config.terrain.mountains;
  const step = mt.meshCell;
  const count = Math.round(map.size / step);
  const points: number[] = [];
  const snow: number[] = [];
  const tri = (a: number[], b: number[], d: number[]) => {
    if (Math.max(a[1]!, b[1]!, d[1]!) < 0.3) return;
    const avg = (a[1]! + b[1]! + d[1]!) / 3;
    points.push(...a, ...b, ...d);
    snow.push(avg > mt.snowAbove ? 1 : 0);
  };
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      // each corner moved a little (from its grid place, always the same), so the grid does not show
      const p = (ii: number, jj: number) => {
        const r = createRandom((ii * 73856093) ^ (jj * 19349663));
        const x = -map.half + ii * step + (r() - 0.5) * step * 0.6;
        const z = -map.half + jj * step + (r() - 0.5) * step * 0.6;
        const y = map.heightAt(x, z);
        return [x, y < 0.05 ? -0.05 : y, z];
      };
      const a = p(i, j), b = p(i + 1, j), cc = p(i + 1, j + 1), d = p(i, j + 1);
      // counter-clockwise seen from above (+y): a, d, c and a, c, b
      if ((i + j) % 2 === 0) {
        tri(a, d, cc);
        tri(a, cc, b);
      } else {
        tri(a, d, b);
        tri(b, d, cc);
      }
    }
  }
  return { points: new Float32Array(points), snow: new Uint8Array(snow) };
}

// A rock: an icosahedron pushed in and out from its seed, flattened, a little sunk in the ground.
export function rockGeometry(rock: Rock, detail: number) {
  const random = createRandom(rock.seed);
  const base = new THREE.IcosahedronGeometry(1, detail);
  const pos = base.getAttribute("position");
  const moved = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!moved.has(key)) moved.set(key, 0.75 + random() * 0.45);
    const k = moved.get(key)!;
    pos.setXYZ(i, pos.getX(i) * k, Math.max(-0.3, pos.getY(i) * k), pos.getZ(i) * k);
  }
  const g = base.index ? base.toNonIndexed() : base;
  g.scale(rock.radius, rock.height, rock.radius);
  g.rotateY(random() * Math.PI * 2);
  g.translate(rock.x, rock.height * 0.15, rock.z);
  g.deleteAttribute("normal");
  g.computeVertexNormals();
  return g;
}

