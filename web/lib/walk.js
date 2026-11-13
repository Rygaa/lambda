// What stops a walker on the ground: the human (systems/player.js) and the monsters (systems/monsters.js).
// Trees and water stop it by a circle (gen/collision.js, the BlockGrid), and so does a step higher than terrain STEP
// (a cliff wall), and so does the water of a FlyFF map (gen/map.js); stairs are a slope, so it goes up and down them. Rocks and buildings stop it by their real shape
// (lib/tops.js): it stands on their top, and a part more than LEDGE higher than its feet stops it.
import { bumps } from './footprints.js';
import { topAt } from './tops.js';
import { heightAt, wetAt, STEP } from '../gen/terrain.js';
import { depthAt } from './craters.js';

const WALL_GAP = 0.3;        // a walker keeps this far (past its radius) from the foot of a wall: walls lean out at
                             // their foot (gen/terrain.js FOOT), and it would sink into one
// is a wall of the terrain (higher than `base` + STEP) less than r + WALL_GAP from (x, z)? (not on a FlyFF map: its
// ground is hills, not walls)
function byWall(terrain, x, z, r, base) {
  if (!terrain || terrain.kind === 'map') return false;
  const d = r + WALL_GAP;
  for (let a = 0; a < 8; a++)
    if (heightAt(terrain, x + Math.cos(a * Math.PI / 4) * d, z + Math.sin(a * Math.PI / 4) * d) > base + STEP) return true;
  return false;
}

export const LEDGE = 0.12;   // it steps up onto a top at most this much higher than its feet: a slope steeper than
                             // about 30° stops it (the human must jump onto a rock)

// the ground under a point: the terrain (down in a hole: the Craters resource, lib/craters.js), or the top of a rock or
// a building
export const groundAt = (terrain, tops, x, z, craters = null) => Math.max(heightAt(terrain, x, z) - depthAt(craters, x, z), topAt(tops, x, z));

// can a walker of radius r go from (x0, z0) to (x, z) with its feet at y? no tree or water within r, no top of a rock
// or a building more than LEDGE above its feet, and no cliff wall up or down. A point of its circle that is already
// over a rock (it landed against the rock) stops only a step towards that point, so it can walk along the rock or
// away from it
export function free(grid, tops, terrain, x0, z0, x, z, y, r) {
  const high = (px, pz) => topAt(tops, px, pz) > y + LEDGE;
  // trees, water, the simple colliders of objects (lib/parts.js): the whole circle of the walker against them
  if (bumps(grid, x0, z0, x, z, r)) return false;
  // the real shapes (lib/tops.js) and the water of a map: points of its circle, a little closer than 45° apart
  const k = r * Math.SQRT1_2;
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [k, k], [k, -k], [-k, k], [-k, -k]]) {
    // the water of a map stops it, unless something stands out of it there (a bridge)
    if ((wetAt(terrain, x + ox, z + oz) && !(topAt(tops, x + ox, z + oz) > 0))) return false;
    if (high(x + ox, z + oz) && (!high(x0 + ox, z0 + oz) || (x - x0) * ox + (z - z0) * oz > 0)) return false;
  }
  const base = heightAt(terrain, x0, z0);
  if (byWall(terrain, x, z, r, base) && !byWall(terrain, x0, z0, r, base)) return false;
  return Math.abs(heightAt(terrain, x, z) - base) <= STEP;
}
