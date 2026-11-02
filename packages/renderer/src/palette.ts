// Colors from pixel-scene (web/gen/palettes.js, the "dbz" theme). A ramp is
// [[light value, color], ...]: a surface takes the last color whose light value it reaches.

export type Ramp = [number, string][];

// Ground rows, in this order in the shaders.
export const GROUND_ROWS = ["grass", "sand", "dirt", "road"] as const;
export type GroundRow = (typeof GROUND_ROWS)[number];

export const GROUND_RAMPS: Record<GroundRow, Ramp> = {
  grass: [[0.0, "#3b8660"], [0.3, "#56a05a"], [0.52, "#86c058"], [0.76, "#bcd96c"]],
  sand: [[0.0, "#b4987e"], [0.3, "#ceb08c"], [0.52, "#e2c8a0"], [0.76, "#f2deb6"]],
  dirt: [[0.0, "#76605e"], [0.3, "#907060"], [0.52, "#a8866a"], [0.76, "#bc9a78"]],
  road: [[0.0, "#868ea0"], [0.3, "#a0a8b6"], [0.52, "#b8bec8"], [0.76, "#d0d4da"]],
};

export const DECOR_RAMPS = {
  flowerWhite: [[0.0, "#9e9ad9"], [0.5, "#f4ecf2"]] as Ramp,
  flowerLilac: [[0.0, "#7f7ccb"], [0.5, "#c4b6ee"]] as Ramp,
  sprout: [[0.0, "#94a85a"], [0.5, "#e6f2a0"]] as Ramp,
  leaf: [[0.0, "#2a7056"], [0.5, "#9ad468"]] as Ramp,
};

// Water tones: [in the sun, in shade].
export const WATER = {
  deep: ["#2a64b0", "#21508f"],
  mid: ["#3a8cc8", "#2e70a6"],
  foam: ["#f4fbff", "#bcd8e8"],
} as const;
