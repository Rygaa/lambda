// The game data, read from game/assets/ (the server reads the files, the client fetches them).

export type TerrainConfig = {
  size: number;
  seed: number;
  cell: number;
  coast: { radius: number; noiseScale: number; noiseAmount: number; beach: number };
  ponds: { noiseScale: number; threshold: number; minDistFromCenter: number };
  dirt: { noiseScale: number; threshold: number };
  mountains: {
    noiseScale: number;
    threshold: number;
    height: number;
    clearCenter: number;
    blockAbove: number;
    meshCell: number;
    snowAbove: number;
    grassBelow: number;
    rockColor: string;
    snowColor: string;
    grassColor: string;
  };
  buildings: { minDistFromCenter: number; maxDistFromCenter: number; margin: number; minSpacing: number };
  spawn: [number, number];
};

export type PropsConfig = {
  rocks: {
    spacing: number;
    fieldNoiseScale: number;
    fieldThreshold: number;
    nearMountain: number;
    minRadius: number;
    maxRadius: number;
    colors: string[];
  };
  stones: { spacing: number; probability: number; minRadius: number; maxRadius: number; colors: string[] };
};

export type MonsterConfig = {
  name: string;
  size: number;
  color: string;
  radius: number;
  hp: number;
  speed: number;
  wanderSpeed: number;
  aggroRange: number;
  leashRange: number;
  attackRange: number;
  attackDamage: number;
  attackPeriod: number;
  attackWindup: number;
  count: number;
  respawnSeconds: number;
  minSpawnDistanceFromPlayers: number;
};

export type LootConfig = {
  size: number;
  colors: string[];
  dropMin: number;
  dropMax: number;
  spread: number;
  lifetimeSeconds: number;
};

export type CharacterConfig = {
  name: string;
  parts: string[];
  animations: string;
  clips: Record<"idle" | "walk" | "attack" | "hit" | "dead", string>;
  bakeFps: number;
  radius: number;
  speed: number;
  hp: number;
  regenPerSecond: number;
  attackRange: number;
  attackArc: number;
  attackDamage: number;
  attackPeriod: number;
  attackWindup: number;
  respawnSeconds: number;
};

// A building plan, as in documentation/building (the Infer format: faces is a list).
export type BuildingShape = {
  id: string;
  type: "box" | "cylinder" | "wedge" | "pyramid" | "dome";
  size: [number, number, number];
  position: [number, number, number];
  rotationY: number;
  tilt?: number;
  faces: { face: string; texture: string | null }[];
};
export type BuildingPlan = {
  description: string;
  shapes: BuildingShape[];
  textures: { name: string; color: string; widthM: number; heightM: number; file?: string | null }[];
  pod?: unknown;
};

// The 4 buildings of the map: exactly one of each.
export const BUILDING_IDS = ["chichi-house", "buu-house", "capsule-ship", "raditz-pod"] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

export type GameConfig = {
  terrain: TerrainConfig;
  props: PropsConfig;
  monster: MonsterConfig;
  loot: LootConfig;
  character: CharacterConfig;
  buildings: Record<BuildingId, BuildingPlan>;
};

// Where each file is, relative to game/assets/.
export const CONFIG_FILES = {
  terrain: "terrain/terrain.json",
  props: "props/rocks.json",
  monster: "monsters/red-cube/monster.json",
  loot: "items/loot-cubes.json",
  character: "characters/player/character.json",
} as const;
export const buildingFile = (id: BuildingId) => `buildings/${id}/building.json`;

export async function loadConfig(read: (path: string) => Promise<unknown>): Promise<GameConfig> {
  const entries = await Promise.all(Object.entries(CONFIG_FILES).map(async ([key, path]) => [key, await read(path)] as const));
  const buildings = Object.fromEntries(await Promise.all(BUILDING_IDS.map(async (id) => [id, await read(buildingFile(id))] as const)));
  return { ...Object.fromEntries(entries), buildings } as GameConfig;
}
