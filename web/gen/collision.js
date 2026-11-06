// Who stops whom. One rule for every generated object, so a new kind gets it
// for free; a kind can still decide for itself with `blocks` on its shape.

export const PLAYER_HEIGHT = 1.65 * 0.62;         // the player of pixel-scene: about 1 unit tall
export const STEP_OVER = 0.25;                    // lower than this share of the player: walk over it

// shape: { height, blocks? } -> does it stop a walker?
export function blocks(shape) {
  if (shape.blocks !== undefined) return shape.blocks;
  return shape.height >= STEP_OVER * PLAYER_HEIGHT;
}
