import { z } from "zod";

// The asset.json file of one asset. The studio writes it. The map maker and the game read it.
// This file has no three.js code, so the studio server can use it too.

export const ASSET_KINDS = ["building", "prop", "ground"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

// The folder of each kind inside assets/.
export const KIND_FOLDERS: Record<AssetKind, string> = {
  building: "buildings",
  prop: "props",
  ground: "ground",
};

export const SHAPE_TYPES = ["box", "cylinder", "wedge", "pyramid", "dome"] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

// The faces of each shape. The front always faces +z, toward the camera.
// wedge: a gable roof with the ridge along x. front and back are the 2 slopes, left and right the triangle ends.
// dome: a half-sphere. Width and depth may differ.
export const SHAPE_FACES = {
  box: ["front", "back", "left", "right", "top", "bottom"],
  cylinder: ["side", "top", "bottom"],
  wedge: ["front", "back", "left", "right", "bottom"],
  pyramid: ["front", "back", "left", "right", "bottom"],
  dome: ["side", "bottom"],
} as const satisfies Record<ShapeType, readonly string[]>;

export const ALL_FACES = ["front", "back", "left", "right", "top", "bottom", "side"] as const;
export type FaceName = (typeof ALL_FACES)[number];

export const MAX_SHAPES = 30;

// What a shape does in the game. A door opens.
export const SHAPE_ROLES = ["door"] as const;
// Ground tiles cover this many meters on each side and must tile with no seams.
export const GROUND_TILE_METERS = 2;

const slotName = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase words with dashes.");
const meters = z.number().positive().max(64);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const shapeSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(SHAPE_TYPES),
    // [width x, height y, depth z] in meters.
    size: z.tuple([meters, meters, meters]),
    // The center of the bottom of the shape.
    position: vec3,
    rotationY: z.number(),
    // Degrees around x, after rotationY. Positive leans the top toward the front (+z);
    // negative leans it back, so its front faces up, as on the slope of a dome.
    tilt: z.number().default(0),
    role: z.enum(SHAPE_ROLES).nullable().default(null),
    // Face name -> texture slot name. null means nobody sees the face.
    faces: z.partialRecord(z.enum(ALL_FACES), slotName.nullable()),
  })
  .superRefine((shape, context) => {
    const allowed: readonly string[] = SHAPE_FACES[shape.type];
    for (const face of Object.keys(shape.faces)) {
      if (!allowed.includes(face)) {
        context.addIssue({ code: "custom", message: `A ${shape.type} has no "${face}" face.` });
      }
    }
  });
export type Shape = z.infer<typeof shapeSchema>;

export const textureSlotSchema = z.object({
  name: slotName,
  // What to paint on this surface.
  description: z.string(),
  // The main color, used before the texture exists.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  // The real size this texture covers. It repeats after this size.
  widthM: meters,
  heightM: meters,
  // textures/<name>.png, or null before Infer makes it.
  file: z.string().nullable(),
  // The full prompt of the last Infer call, kept so a texture can be traced.
  prompt: z.string().nullable(),
  updatedAt: z.string(),
});
export type TextureSlot = z.infer<typeof textureSlotSchema>;

export const assetSchema = z
  .object({
    id: slotName,
    name: z.string().min(1),
    kind: z.enum(ASSET_KINDS),
    // Only "ready" assets go into maps.
    status: z.enum(["draft", "ready"]),
    description: z.string(),
    // What the artist asked for. It may be empty when there is a reference image.
    prompt: z.string(),
    // reference.png, or null when the asset comes from the prompt only.
    reference: z.string().nullable(),
    // The Bucket copy of the reference. Infer reads images only from Bucket.
    referenceBucketFileId: z.string().nullable(),
    shapes: z.array(shapeSchema).max(MAX_SHAPES),
    textures: z.array(textureSlotSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((asset, context) => {
    if (!asset.reference && !asset.prompt.trim()) {
      context.addIssue({ code: "custom", message: "An asset needs a prompt, a reference image, or both." });
    }
    const names = new Set(asset.textures.map((slot) => slot.name));
    for (const shape of asset.shapes) {
      for (const slot of Object.values(shape.faces)) {
        if (slot && !names.has(slot)) {
          context.addIssue({ code: "custom", message: `Shape "${shape.id}" uses a missing texture "${slot}".` });
        }
      }
    }
  });
export type Asset = z.infer<typeof assetSchema>;

// The folder of an asset, relative to assets/.
export function assetFolder(asset: Pick<Asset, "kind" | "id">) {
  return `${KIND_FOLDERS[asset.kind]}/${asset.id}`;
}

// Texels per meter: the game pixels per meter of the renderer (480 / 11), so 1 texel is about 1 game pixel.
export const TEXELS_PER_METER = 480 / 11;

// Pixel size of a texture, kept between 4 and 512.
export function texturePixels(slot: Pick<TextureSlot, "widthM" | "heightM">) {
  const clamp = (value: number) => Math.min(512, Math.max(4, Math.round(value * TEXELS_PER_METER)));
  return { width: clamp(slot.widthM), height: clamp(slot.heightM) };
}

// The space an asset takes on the ground, in meters, around its origin.
export function assetFootprint(asset: Pick<Asset, "shapes" | "kind">) {
  if (asset.kind === "ground" || asset.shapes.length === 0) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const shape of asset.shapes) {
    const angle = (shape.rotationY * Math.PI) / 180;
    const [width, , depth] = shape.size;
    for (const [x, z] of [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ] as const) {
      const worldX = shape.position[0] + x * Math.cos(angle) + z * Math.sin(angle);
      const worldZ = shape.position[2] - x * Math.sin(angle) + z * Math.cos(angle);
      minX = Math.min(minX, worldX);
      maxX = Math.max(maxX, worldX);
      minZ = Math.min(minZ, worldZ);
      maxZ = Math.max(maxZ, worldZ);
    }
  }
  return { minX, maxX, minZ, maxZ };
}
