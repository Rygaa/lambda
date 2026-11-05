// The static scene made from the map: the ground (rows + water), the mountains, rocks and stones, and the grass
// that grows near the camera. Everything uses the game materials, so it has the renderer's look.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildGroundPatch } from "../engine/asset-format/build.ts";
import { CAMERA_FORWARD, PIXELS_PER_METER, type PixelRenderer } from "../engine/renderer/index.ts";
import type { GroundRow } from "../engine/renderer/palette.ts";
import { createRandom } from "../shared/noise.ts";
import { GameMap, ROW_DIRT, ROW_GRASS, ROW_SAND, type Rock } from "../shared/worldgen.ts";

export function buildGround(renderer: PixelRenderer, map: GameMap) {
  const rowMap = new THREE.DataTexture(map.rows, map.n, map.n, THREE.RedFormat, THREE.UnsignedByteType);
  rowMap.minFilter = rowMap.magFilter = THREE.NearestFilter;
  rowMap.generateMipmaps = false;
  rowMap.flipY = false;
  rowMap.needsUpdate = true;
  const material = renderer.materials.ground({ row: "grass", rowMap, rowMapRect: [-map.half, -map.half, map.size, map.size] });
  // the sea goes on past the map
  return buildGroundPatch(material, map.size * 4);
}

// The mountains: one low-poly height field, flat faces, rock with snow on the tops. Triangles that lie flat on
// the ground (every corner under 0.3 m) are left out, so the mountains rise straight from the ground.
export function buildMountains(renderer: PixelRenderer, map: GameMap) {
  const mt = map.config.terrain.mountains;
  const step = mt.meshCell;
  const count = Math.round(map.size / step);
  const buckets: Record<"rock" | "snow", number[]> = { rock: [], snow: [] };
  const tri = (a: number[], b: number[], d: number[]) => {
    if (Math.max(a[1]!, b[1]!, d[1]!) < 0.3) return;
    const avg = (a[1]! + b[1]! + d[1]!) / 3;
    buckets[avg > mt.snowAbove ? "snow" : "rock"].push(...a, ...b, ...d);
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
  const group = new THREE.Group();
  const colors = { rock: mt.rockColor, snow: mt.snowColor };
  for (const kind of ["rock", "snow"] as const) {
    if (!buckets[kind].length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(buckets[kind], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((buckets[kind].length / 3) * 2), 2));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, renderer.materials.solid({ color: colors[kind] })));
  }
  return renderer.castShadows(group);
}

// A rock: an icosahedron pushed in and out from its seed, flattened, a little sunk in the ground.
function rockGeometry(rock: Rock, detail: number) {
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

export function buildRocks(renderer: PixelRenderer, map: GameMap) {
  const group = new THREE.Group();
  const byColor = new Map<string, THREE.BufferGeometry[]>();
  for (const [list, detail] of [[map.rocks, 1], [map.stones, 0]] as const) {
    for (const rock of list) {
      if (!byColor.has(rock.color)) byColor.set(rock.color, []);
      byColor.get(rock.color)!.push(rockGeometry(rock, detail));
    }
  }
  for (const [color, geometries] of byColor) {
    group.add(new THREE.Mesh(mergeGeometries(geometries), renderer.materials.solid({ color })));
  }
  return renderer.castShadows(group);
}

// Grass tufts and flowers, as in the scene tool, but only where the camera looks: patches of CHUNK meters
// over the ground the view shows (plus a margin), made when they come into view and dropped after.
const CHUNK = 4;
export function createGroundCoverManager(renderer: PixelRenderer, map: GameMap) {
  const chunks = new Map<string, THREE.Object3D>();
  const rows: Record<number, GroundRow> = { [ROW_GRASS]: "grass", [ROW_SAND]: "sand", [ROW_DIRT]: "dirt" };
  const groundAt = (x: number, z: number): GroundRow | null => {
    if (map.isBlocked(x, z) || map.heightAt(x, z) > 0.02) return null;
    return rows[map.rowAt(x, z)] ?? null;
  };
  const pitch = Math.asin(-CAMERA_FORWARD[1]);
  return (cx: number, cz: number) => {
    // the ground the view shows: half its width, and half its depth along z (the camera looks down `pitch`)
    const container = renderer.canvas.parentElement!;
    const scale = (renderer as any).pixelScale as number;
    const halfW = container.clientWidth / 2 / scale / PIXELS_PER_METER + 1.5;
    const halfD = container.clientHeight / 2 / scale / PIXELS_PER_METER / Math.sin(pitch) + 1.5;
    const want = new Set<string>();
    for (let j = Math.floor((cz - halfD) / CHUNK); j <= Math.floor((cz + halfD) / CHUNK); j++) {
      for (let i = Math.floor((cx - halfW) / CHUNK); i <= Math.floor((cx + halfW) / CHUNK); i++) {
        if (Math.abs(i * CHUNK) > map.half + CHUNK || Math.abs(j * CHUNK) > map.half + CHUNK) continue;
        const key = `${i},${j}`;
        want.add(key);
        if (chunks.has(key)) continue;
        const cover = renderer.createGroundCover({ minX: i * CHUNK, maxX: (i + 1) * CHUNK, minZ: j * CHUNK, maxZ: (j + 1) * CHUNK, groundAt, seed: (i * 7919 + j * 104729) >>> 0 });
        renderer.scene.add(cover);
        chunks.set(key, cover);
      }
    }
    for (const [key, cover] of chunks) {
      if (want.has(key)) continue;
      renderer.scene.remove(cover);
      cover.traverse((o: any) => o.geometry?.dispose?.());
      chunks.delete(key);
    }
  };
}
