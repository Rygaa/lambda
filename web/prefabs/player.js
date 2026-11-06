// First-person view: sky colours for the post pass and the camera settings.
// (The character itself is in prefabs/character.js.)
export const PLAYER_PALETTE = {
  sky_top: '#9fd0dd',        // first-person sky
  sky_horizon: '#d4ecd0',    // and the haze it fades into
};

export const FPS = { fov: 70, eye: 0.75, near: 0.05, far: 120, fog: [24, 48], look: 0.0025, dragLook: 0.006, nearCull: 1.3,
  rayScale: 4,        // god rays are computed at 1/4 resolution (they are soft)
  raySteps: 24,
  lineWorld: 0.015,   // outline width on the objects (metres): far lines thin out like the object
  lines: 1.5 };       // but near they are never thicker than this, in CSS pixels (admin menu: Lines)

// Third-person view: a perspective camera behind the character's back.
//   distance: from the point it looks at (wheel: min..max); lookAt: height of that point;
//   pitch: how far the mouse tilts it (negative = looks down); follow: how fast it
//   catches up with the character; nearCull: grass this close to the camera is hidden
export const THIRD = { distance: 3.2, min: 1.6, max: 6, lookAt: 0.75, pitch: [-1.1, 0.25], startPitch: -0.35,
  follow: 10, nearCull: 0.5 };

// admin menu choices for the first-person view: [setting, label, [[name, value], ...]]
export const FPS_OPTIONS = [
  ['fpsLines', 'Lines', [['Thin', 1], ['Normal', 1.5], ['Bold', 2.5]]],
  ['fpsFog', 'Fog', [['Near', [16, 34]], ['Mid', [24, 48]], ['Far', [36, 72]], ['Off', [500, 600]]]],
];
