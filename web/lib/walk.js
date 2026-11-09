// What stops a walker on the ground: the human (systems/player.js) and the monsters (systems/monsters.js).
// Trees and water stop it by a circle (gen/collision.js, the BlockGrid), and so does a step higher than terrain STEP
// (a cliff wall); stairs are a slope, so it goes up and down them. Rocks and buildings stop it by their real shape
// (lib/tops.js): it stands on their top, and a part more than LEDGE higher than its feet stops it.
import { isBlocked } from './footprints.js';
import { topAt } from './tops.js';
import { heightAt, STEP } from '../gen/terrain.js';

export const LEDGE = 0.12;   // it steps up onto a top at most this much higher than its feet: a slope steeper than
                             // about 30° stops it (the human must jump onto a rock)

// the ground under a point: the terrain, or the top of a rock or a building
export const groundAt = (terrain, tops, x, z) => Math.max(heightAt(terrain, x, z), topAt(tops, x, z));

// can a walker of radius r go from (x0, z0) to (x, z) with its feet at y? no tree or water within r, no top of a rock
// or a building more than LEDGE above its feet, and no cliff wall up or down. A point of its circle that is already
// over a rock (it landed against the rock) stops only a step towards that point, so it can walk along the rock or
// away from it
export function free(grid, tops, terrain, x0, z0, x, z, y, r) {
  const high = (px, pz) => topAt(tops, px, pz) > y + LEDGE;
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    if (isBlocked(grid, x + ox, z + oz)) return false;
    if (high(x + ox, z + oz) && (!high(x0 + ox, z0 + oz) || (x - x0) * ox + (z - z0) * oz > 0)) return false;
  }
  return Math.abs(heightAt(terrain, x, z) - heightAt(terrain, x0, z0)) <= STEP;
}
