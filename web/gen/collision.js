// Who stops whom. One rule for every generated object, so a new kind gets it
// for free; a kind can still decide for itself with `blocks` on its shape.
import { RIG_SCALE } from '../prefabs/character.js';

export const PLAYER_HEIGHT = 1.65 * RIG_SCALE;   // the rig is about 1.65 units tall
export const STEP_OVER = 0.25;                    // lower than this share of the player: walk over it

// shape: { height, blocks? } -> does it stop the player (and the slimes)?
export function blocks(shape) {
  if (shape.blocks !== undefined) return shape.blocks;
  return shape.height >= STEP_OVER * PLAYER_HEIGHT;
}
