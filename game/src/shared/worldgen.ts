// The map, made from a seed with noise. The server and every client run this same code with the same seed and
// the same assets, so they get the same map: only the seed goes over the network.
//
// - An island in the sea (radial falloff + noise on the coast), with beaches of sand and a few ponds.
// - Mountains: ridged noise, kept away from the center. They block the way.
// - Dirt patches (noise) on the grass.
// - Rocks (big, they block) in rock fields and at the foot of the mountains, and small stones everywhere.
// - The 4 buildings, exactly one of each, each on flat ground with nothing on it.
import type { BuildingId, BuildingPlan, BuildingShape, GameConfig } from "./config.ts";
import { BUILDING_IDS } from "./config.ts";
import { createNoise2D, createRandom, fbm, hashSeed, ridged, smoothstep, type Random } from "./noise.ts";

export const ROW_GRASS = 0;
export const ROW_SAND = 1;
export const ROW_DIRT = 2;
export const ROW_WATER = 255;

export type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
export type PlacedBuilding = { id: BuildingId; x: number; z: number; footprint: Box };
export type Rock = { x: number; z: number; radius: number; height: number; seed: number; color: string };

// Points inside a shape, in the building frame (turn, then tilt, as in asset-format/build.ts: Euler "YXZ").
export function shapePoints(shape: BuildingShape, step: number, visit: (x: number, y: number, z: number) => void) {
  const [w, h, d] = shape.size;
  const hw = w / 2;
  const hd = d / 2;
  const a = (shape.rotationY * Math.PI) / 180;
  const t = ((shape.tilt ?? 0) * Math.PI) / 180;
  const inside = (x: number, y: number, z: number) => {
    const k = y / h;
    switch (shape.type) {
      case "dome": return (x / hw) ** 2 + k * k + (z / hd) ** 2 <= 1;
      case "cylinder": return (x / hw) ** 2 + (z / hd) ** 2 <= 1;
      case "wedge": return Math.abs(z) / hd <= 1 - k;
      case "pyramid": return Math.abs(x) / hw <= 1 - k && Math.abs(z) / hd <= 1 - k;
      default: return true;
    }
  };
  const nx = Math.max(2, Math.ceil(w / step));
  const ny = Math.max(2, Math.ceil(h / step));
  const nz = Math.max(2, Math.ceil(d / step));
  for (let iy = 0; iy <= ny; iy++) {
    const y = (iy / ny) * h;
    for (let iz = 0; iz <= nz; iz++) {
      const z = -hd + (iz / nz) * d;
      for (let ix = 0; ix <= nx; ix++) {
        const x = -hw + (ix / nx) * w;
        if (!inside(x, y, z)) continue;
        const y1 = y * Math.cos(t) - z * Math.sin(t);
        const z1 = y * Math.sin(t) + z * Math.cos(t);
        visit(shape.position[0] + x * Math.cos(a) + z1 * Math.sin(a), shape.position[1] + y1, shape.position[2] - x * Math.sin(a) + z1 * Math.cos(a));
      }
    }
  }
}

// The space a building takes on the ground, around its origin (every part above the ground).
export function planFootprint(plan: BuildingPlan): Box {
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const shape of plan.shapes) {
    shapePoints(shape, 0.2, (x, y, z) => {
      if (y < 0) return;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minZ = Math.min(box.minZ, z);
      box.maxZ = Math.max(box.maxZ, z);
    });
  }
  return box;
}

export class GameMap {
  readonly size: number;
  readonly half: number;
  readonly cell: number;
  // cells per side of the fine grids (rows, blocked)
  readonly n: number;
  // the ground row of each cell (ROW_*)
  readonly rows: Uint8Array;
  // 1 where nothing can walk (sea, ponds, mountains, buildings, rocks)
  readonly blocked: Uint8Array;
  // mountain height every meter, (size + 1)²
  readonly heights: Float32Array;
  // the island value every meter: < 0 is sea
  private readonly land: Float32Array;
  readonly buildings: PlacedBuilding[] = [];
  readonly rocks: Rock[] = [];
  readonly stones: Rock[] = [];
  readonly spawn: { x: number; z: number };

  constructor(readonly seed: number, readonly config: GameConfig) {
    const t = config.terrain;
    this.size = t.size;
    this.half = t.size / 2;
    this.cell = t.cell;
    this.n = Math.round(t.size / t.cell);
    this.rows = new Uint8Array(this.n * this.n);
    this.blocked = new Uint8Array(this.n * this.n);
    const m = t.size + 1;
    this.heights = new Float32Array(m * m);
    this.land = new Float32Array(m * m);
    this.spawn = { x: t.spawn[0], z: t.spawn[1] };

    const coastNoise = createNoise2D(hashSeed(seed, "coast"));
    const pondNoise = createNoise2D(hashSeed(seed, "ponds"));
    const mountainNoise = createNoise2D(hashSeed(seed, "mountains"));
    const dirtNoise = createNoise2D(hashSeed(seed, "dirt"));
    const mt = t.mountains;

    // 1. Island value and mountain height, every meter.
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const x = i - this.half;
        const z = j - this.half;
        const dist = Math.hypot(x - this.spawn.x, z - this.spawn.z);
        let v = t.coast.radius - Math.hypot(x, z) / this.half + fbm(coastNoise, x * t.coast.noiseScale, z * t.coast.noiseScale, 4) * t.coast.noiseAmount;
        if (dist > t.ponds.minDistFromCenter) {
          const pond = fbm(pondNoise, x * t.ponds.noiseScale, z * t.ponds.noiseScale, 3) * 0.5 + 0.5;
          // ponds: the island value drops below 0 where the pond noise is high
          v = Math.min(v, (t.ponds.threshold - pond) * 2.2);
        }
        this.land[j * m + i] = v;
        const r = ridged(mountainNoise, x * mt.noiseScale, z * mt.noiseScale, 4);
        const base = (r - mt.threshold) / (1 - mt.threshold);
        let h = base > 0 ? Math.pow(base, 1.25) * mt.height : 0;
        h *= smoothstep(mt.clearCenter, mt.clearCenter + 24, dist) * smoothstep(0.0, 0.07, v);
        this.heights[j * m + i] = h < 0.05 ? 0 : h;
      }
    }

    // 2. The buildings, then the rocks and stones, all from the seed.
    const random = createRandom(hashSeed(seed, "placement"));
    this.placeBuildings(random);
    this.placeRocks(createRandom(hashSeed(seed, "rocks")), createNoise2D(hashSeed(seed, "rockfield")));

    // 3. Fine grids: ground rows and what blocks the way.
    const beach = t.coast.beach / this.half;
    for (let cj = 0; cj < this.n; cj++) {
      for (let ci = 0; ci < this.n; ci++) {
        const x = -this.half + (ci + 0.5) * this.cell;
        const z = -this.half + (cj + 0.5) * this.cell;
        const k = cj * this.n + ci;
        const v = this.landAt(x, z);
        const h = this.heightAt(x, z);
        let row = ROW_GRASS;
        if (v < 0) row = ROW_WATER;
        else if (v < beach) row = ROW_SAND;
        else if (h > 0.01 || fbm(dirtNoise, x * t.dirt.noiseScale, z * t.dirt.noiseScale, 3) > t.dirt.threshold) row = ROW_DIRT;
        this.rows[k] = row;
        if (row === ROW_WATER || h > mt.blockAbove) this.blocked[k] = 1;
        // the edge of the map: 2 m of blocked cells
        if (Math.abs(x) > this.half - 2 || Math.abs(z) > this.half - 2) this.blocked[k] = 1;
      }
    }
    for (const b of this.buildings) this.blockBuilding(b, config.buildings[b.id]);
    for (const rock of this.rocks) this.blockCircle(rock.x, rock.z, rock.radius * 0.8);
  }

  private sample(grid: Float32Array, x: number, z: number) {
    const m = this.size + 1;
    const fx = Math.min(this.size - 1e-6, Math.max(0, x + this.half));
    const fz = Math.min(this.size - 1e-6, Math.max(0, z + this.half));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const w = fz - j;
    const a = grid[j * m + i]!;
    const b = grid[j * m + i + 1]!;
    const c = grid[(j + 1) * m + i]!;
    const d = grid[(j + 1) * m + i + 1]!;
    return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
  }

  heightAt(x: number, z: number) {
    if (Math.abs(x) > this.half || Math.abs(z) > this.half) return 0;
    return this.sample(this.heights, x, z);
  }

  landAt(x: number, z: number) {
    if (Math.abs(x) > this.half || Math.abs(z) > this.half) return -1;
    return this.sample(this.land, x, z);
  }

  private cellIndex(x: number, z: number) {
    const ci = Math.floor((x + this.half) / this.cell);
    const cj = Math.floor((z + this.half) / this.cell);
    if (ci < 0 || cj < 0 || ci >= this.n || cj >= this.n) return -1;
    return cj * this.n + ci;
  }

  isBlocked(x: number, z: number) {
    const k = this.cellIndex(x, z);
    return k < 0 || this.blocked[k] === 1;
  }

  // A circle of this radius can stand here.
  isFree(x: number, z: number, radius: number) {
    if (this.isBlocked(x, z)) return false;
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      if (this.isBlocked(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)) return false;
    }
    return true;
  }

  rowAt(x: number, z: number) {
    const k = this.cellIndex(x, z);
    return k < 0 ? ROW_WATER : this.rows[k]!;
  }

  // A random free spot on land, for monsters.
  randomFreePoint(random: Random, radius: number, accept: (x: number, z: number) => boolean = () => true) {
    for (let tries = 0; tries < 500; tries++) {
      const x = (random() * 2 - 1) * (this.half - 4);
      const z = (random() * 2 - 1) * (this.half - 4);
      if (this.isFree(x, z, radius) && accept(x, z)) return { x, z };
    }
    return { ...this.spawn };
  }

  // Flat, dry, empty ground over the whole box (every meter).
  private isFlatGround(box: Box) {
    const beach = this.config.terrain.coast.beach / this.half;
    for (let z = box.minZ; z <= box.maxZ + 1e-6; z += 1) {
      for (let x = box.minX; x <= box.maxX + 1e-6; x += 1) {
        if (this.heightAt(x, z) > 0 || this.landAt(x, z) < beach * 1.5) return false;
      }
    }
    return true;
  }

  private placeBuildings(random: Random) {
    const b = this.config.terrain.buildings;
    const start = random() * Math.PI * 2;
    BUILDING_IDS.forEach((id, index) => {
      const plan = this.config.buildings[id];
      const local = planFootprint(plan);
      const cx = (local.minX + local.maxX) / 2;
      const cz = (local.minZ + local.maxZ) / 2;
      for (let tries = 0; tries < 4000; tries++) {
        // each building in its own quarter of the island at first, anywhere after many tries
        const spread = tries < 1500 ? Math.PI / 4 : Math.PI;
        const angle = start + (index * Math.PI) / 2 + (random() * 2 - 1) * spread;
        const dist = b.minDistFromCenter + random() * (b.maxDistFromCenter - b.minDistFromCenter);
        const px = Math.round((this.spawn.x + Math.cos(angle) * dist) * 4) / 4;
        const pz = Math.round((this.spawn.z + Math.sin(angle) * dist) * 4) / 4;
        const x = px - cx;
        const z = pz - cz;
        const footprint = { minX: local.minX + x, maxX: local.maxX + x, minZ: local.minZ + z, maxZ: local.maxZ + z };
        const zone = grow(footprint, b.margin);
        if (!this.isFlatGround(zone)) continue;
        if (this.buildings.some((other) => Math.hypot(other.x - px, other.z - pz) < b.minSpacing || overlaps(grow(other.footprint, b.margin), zone))) continue;
        this.buildings.push({ id, x, z, footprint });
        return;
      }
      throw new Error(`No flat ground for ${id} with seed ${this.seed}`);
    });
  }

  // Where nothing else may stand: the buildings with their margin, and the spawn.
  private isReserved(x: number, z: number, radius: number) {
    const margin = this.config.terrain.buildings.margin;
    if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 7 + radius) return true;
    return this.buildings.some((b) => x + radius > b.footprint.minX - margin && x - radius < b.footprint.maxX + margin && z + radius > b.footprint.minZ - margin && z - radius < b.footprint.maxZ + margin);
  }

  private placeRocks(random: Random, field: ReturnType<typeof createNoise2D>) {
    const { rocks, stones } = this.config.props;
    const beach = this.config.terrain.coast.beach / this.half;
    const nearMountain = (x: number, z: number) => {
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        if (this.heightAt(x + Math.cos(angle) * rocks.nearMountain, z + Math.sin(angle) * rocks.nearMountain) > 0.5) return true;
      }
      return false;
    };
    for (let gz = -this.half; gz < this.half; gz += rocks.spacing) {
      for (let gx = -this.half; gx < this.half; gx += rocks.spacing) {
        const x = gx + random() * rocks.spacing;
        const z = gz + random() * rocks.spacing;
        const radius = rocks.minRadius + Math.pow(random(), 1.6) * (rocks.maxRadius - rocks.minRadius);
        const roll = random();
        const f = fbm(field, x * rocks.fieldNoiseScale, z * rocks.fieldNoiseScale, 3);
        const want = f > rocks.fieldThreshold ? roll < 0.75 : nearMountain(x, z) ? roll < 0.45 : roll < 0.04;
        if (!want) continue;
        if (this.landAt(x, z) < beach || this.heightAt(x, z) > 0.2 || this.isReserved(x, z, radius)) continue;
        if (this.rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius + radius + 0.6)) continue;
        this.rocks.push({ x, z, radius, height: radius * (0.55 + random() * 0.45), seed: Math.floor(random() * 1e9), color: rocks.colors[Math.floor(random() * rocks.colors.length)]! });
      }
    }
    for (let gz = -this.half; gz < this.half; gz += stones.spacing) {
      for (let gx = -this.half; gx < this.half; gx += stones.spacing) {
        const x = gx + random() * stones.spacing;
        const z = gz + random() * stones.spacing;
        const radius = stones.minRadius + random() * (stones.maxRadius - stones.minRadius);
        if (random() > stones.probability) continue;
        if (this.landAt(x, z) < 0.002 || this.heightAt(x, z) > 0 || this.isReserved(x, z, radius)) continue;
        this.stones.push({ x, z, radius, height: radius * (0.5 + random() * 0.4), seed: Math.floor(random() * 1e9), color: stones.colors[Math.floor(random() * stones.colors.length)]! });
      }
    }
  }

  private blockCircle(cx: number, cz: number, radius: number) {
    for (let z = cz - radius; z <= cz + radius; z += this.cell / 2) {
      for (let x = cx - radius; x <= cx + radius; x += this.cell / 2) {
        if (Math.hypot(x - cx, z - cz) > radius) continue;
        const k = this.cellIndex(x, z);
        if (k >= 0) this.blocked[k] = 1;
      }
    }
  }

  // Every part of a building lower than a character blocks the ground under it.
  private blockBuilding(b: PlacedBuilding, plan: BuildingPlan) {
    for (const shape of plan.shapes) {
      shapePoints(shape, 0.12, (x, y, z) => {
        if (y < -0.05 || y > 1.7) return;
        const k = this.cellIndex(x + b.x, z + b.z);
        if (k >= 0) this.blocked[k] = 1;
      });
    }
  }
}

function grow(box: Box, by: number): Box {
  return { minX: box.minX - by, maxX: box.maxX + by, minZ: box.minZ - by, maxZ: box.maxZ + by };
}
function overlaps(a: Box, b: Box) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
