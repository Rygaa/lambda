// The numbers of the style, taken from pixel-scene (web/assets/assets.json).
// documentation/style/rules.md explains each one.

// One game pixel is this many screen pixels. 1920×1080 shows 480×270 game pixels.
export const PIXEL_SCALE = 4;

// Game pixels per meter, and texels per meter in every texture. So 1 texel is about 1 game pixel.
export const PIXELS_PER_METER = 480 / 11;

// The camera looks along this direction and never turns: down about 33°, toward -z.
export const CAMERA_FORWARD = [0, -0.54464, -0.83867] as const;
export const CAMERA_PITCH_DEGREES = (Math.asin(-CAMERA_FORWARD[1]) * 180) / Math.PI;

// Toward the sun: from the left, a little behind the scene.
export const SUN_DIRECTION = [-0.73592, 0.57358, -0.35977] as const;

// The color of a face with no texture yet.
export const FALLBACK_COLOR = "#a0a0a0";
