import {
  ALL_FACES,
  MAX_SHAPES,
  SHAPE_ROLES,
  SHAPE_TYPES,
  shapeSchema,
  textureSlotSchema,
  type Asset,
  type Shape,
  type TextureSlot,
} from "@lambda/asset-format/schema";
import { z } from "zod";
import { uploadPng } from "./bucket.ts";
import { StudioError } from "./errors.ts";
import { generateJson, type InferChoice } from "./infer.ts";
import { readAssetBinary, updateAsset } from "./library.ts";

// The JSON that Infer must return. Infer needs every property in "required"
// and additionalProperties: false on every object, so faces are a list here.
const planJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["description", "layout", "shapes", "textures"],
  properties: {
    description: { type: "string", description: "One sentence about the object." },
    layout: {
      type: "string",
      description:
        "Before the shapes: every part of the object, where it is (back, front, left, right), its x and z range in meters, and its walls, roof, and details.",
    },
    shapes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "size", "position", "rotationY", "tilt", "role", "faces"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: [...SHAPE_TYPES] },
          size: { type: "array", items: { type: "number" }, description: "[width x, height y, depth z] in meters" },
          position: { type: "array", items: { type: "number" }, description: "[x, y, z] of the bottom center" },
          rotationY: { type: "number", description: "Degrees around the y axis" },
          tilt: { type: "number", description: "Degrees around the x axis, after rotationY" },
          role: { anyOf: [{ type: "string", enum: [...SHAPE_ROLES] }, { type: "null" }] },
          faces: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["face", "texture"],
              properties: {
                face: { type: "string", enum: [...ALL_FACES] },
                texture: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
    textures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "color", "widthM", "heightM"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          color: { type: "string", description: "#rrggbb" },
          widthM: { type: "number" },
          heightM: { type: "number" },
        },
      },
    },
  },
};

// A check answer is a whole plan, after a list of what was wrong.
const checkJsonSchema = {
  ...planJsonSchema,
  required: ["differences", ...planJsonSchema.required],
  properties: {
    differences: {
      type: "string",
      description:
        "Before the plan: every difference between the renders of the current model and the reference, part by part: missing or extra parts, wrong place, wrong size, wrong direction, wrong color.",
    },
    ...planJsonSchema.properties,
  },
};

const planSchema = z.object({
  description: z.string(),
  layout: z.string(),
  shapes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(SHAPE_TYPES),
      size: z.array(z.number()),
      position: z.array(z.number()),
      rotationY: z.number(),
      tilt: z.number(),
      role: z.enum(SHAPE_ROLES).nullable(),
      faces: z.array(z.object({ face: z.enum(ALL_FACES), texture: z.string().nullable() })),
    }),
  ),
  textures: z.array(textureSlotSchema.pick({ name: true, description: true, color: true, widthM: true, heightM: true })),
});

function intro(asset: Asset) {
  const kindHint =
    asset.kind === "building"
      ? "It is a building."
      : "It is a prop, such as a tree, a rock, a fence, or a barrel. Use only the shapes it needs, often 2 to 6.";
  return [
    `A low-poly 3D model of "${asset.name}" for a top-down 3D pixel art game.`,
    ...(asset.prompt ? [`What the artist wants: ${asset.prompt}`] : []),
    kindHint,
  ];
}

// How to read the reference and how to build. The same rules for a new plan and for a check.
const SHAPE_RULES = [
  "Read the reference:",
  "- List every part of the object and where it is. A part that is only partly seen, such as a roof behind another part, is still a whole part: build it whole.",
  "- If you know this object from a game, a film, or a show, build its whole form as you know it, in the simple form a top-down game gives it: its main block, its best-known parts, and few repeated parts.",
  "- The reference is often seen from the front at eye level. In the game the camera looks down from above, so the layout from above matters most. Work out from the image which parts stand in front of others and which stand behind.",
  "- Keep the proportions of the reference: the width of each part compared with the others, how high the walls are compared with the roofs, and where each door and window is.",
  "- All parts join into one object, with no gaps between them.",
  "- In the layout, give each part its x range and z range, and check with the numbers that parts side by side do not cut into each other. Only walls that join and small things on a surface touch.",
  "",
  "Build it from simple shapes:",
  "- Each building stands on a low stone base: a box 0.16 m high and about 0.07 m wider than its walls on every side.",
  "- The walls are boxes on top of the base. A round part is a dome, often on a low cylinder ring.",
  "- The ridge of a roof runs along the long side of the walls under it: rotationY 0 when the walls are wider along x, 90 when they are deeper along z.",
  "- Roofs are wedges that start at the top of the walls and hang over them by about 0.25 m on every side. A thin wooden ridge board runs along the top of a roof. Make a roof as steep as in the reference.",
  "- A wing or a second part has its own walls and its own roof. Turn that roof with rotationY 90 when its gable faces the front. A wing reaches a little into the part it joins, so its roof runs into the other roof. Never join parts with extra small boxes.",
  "- Small things seen in the reference, such as a mailbox, are simple boxes too.",
  "- Chimneys and pipes start inside the roof or dome, so they look stuck into it.",
  "- A door is a thin box, about 0.06 m deep, standing out of its wall. Give it role \"door\". Put a low step box in front of it.",
  "- Each window is a small thin box on its wall. Its glass and frame are painted in its texture.",
  "- Never build bricks, planks, roof tiles, stones, or trims as shapes. They are painted in textures.",
  "- A texture repeats over its faces, so a slot is one material only, such as walls, roof, wood, stone, or plaster. Never put a sign, an emblem, a band, or any other one-time mark in a material slot.",
  "- Each sign or emblem is its own small thin shape, about 0.04 m deep, pushed a little into the surface it sits on. Give it its own slot, like a door or a window.",
  "- A shape on a dome must stand out of it, or part of it is hidden inside. For a dome with center (cx, cz), radius r (half its width), and height h, at a height y above the dome base and a side offset dx = x - cx, the front of the dome is at z = cz + sqrt(r*r*(1 - (y/h)^2) - dx*dx). The dome is widest low down, so use the bottom of the shape for y, and put the front face of the shape about 0.03 m in front of that z. A shape on the side of a dome is turned with rotationY to face out from its spot.",
  "- The slot of a door, a window, or a sign has widthM and heightM equal to the size of its front face, so it shows once.",
  "",
  "Rules:",
  "- Units are meters. y is up. The ground is y = 0. The front of the model faces +z, toward the camera.",
  `- Shape types: ${SHAPE_TYPES.join(", ")}. At most ${MAX_SHAPES} shapes.`,
  "- position is the center of the bottom of the shape. size is [width x, height y, depth z]. rotationY is in degrees; a positive rotationY turns the front of the shape toward +x.",
  "- tilt is in degrees and leans the shape around x after rotationY, around the center of its bottom. Negative tilt leans its top back so its front faces up, for a shape that lies on a curved or sloped surface. A cylinder with tilt 90 lies on its side with its top facing the front, and grows from its position toward the front by its size y: a round disc, used for the round top of an arched door. Put it at the back of the arch box, at the height of the top of the arch box, with size y equal to the depth of the arch box. Most shapes have tilt 0.",
  "- box faces: front (+z), back (-z), left (-x), right (+x), top, bottom.",
  "- wedge is a gable roof: a triangle prism with the ridge along x, at the top, over the middle of the depth. Its faces: front (the slope toward +z), back (the slope toward -z), left and right (the triangle ends), bottom. With rotationY 90, its left end faces the front.",
  "- pyramid faces: front, back, left, right, bottom.",
  "- cylinder faces: side, top, bottom. size x and z are its width and depth.",
  "- dome faces: side, bottom. size y is its height; size x and z are the width and depth of its base.",
  "- role is \"door\" for a door and null for every other shape.",
  "- List every face of every shape. Give each face a texture slot name, or null when nobody sees it (bottoms, faces hidden inside other shapes).",
  "- Reuse one slot for faces of the same material, such as all the walls, all the roofs, or all the wood.",
  "- Colors are the colors of each material in plain white daylight. The reference may have colored light, such as a sunset or night; never copy that light. A white wall stays white.",
  "- For each slot: name (lowercase-with-dashes), description (what to paint), color (its color in the sun, as #rrggbb), widthM and heightM (the size in meters of the area it covers; the texture repeats after this size).",
  "- Sizes are game sizes, not real-life sizes: walls about 1.2 to 1.4 m high, a door about 0.6 x 0.85 m, a small house about 3.6 x 2.4 m.",
];

function noteLine(note: string) {
  return note.trim() ? `\nNote from the artist: ${note.trim()}` : "";
}

function buildPrompt(asset: Asset, note: string) {
  return [
    ...intro(asset),
    "Plan this model.",
    ...(asset.reference && asset.prompt
      ? [
          "The image is the reference. The artist text comes first: build the parts, their places, and their sizes that the text describes. When the text and the image differ, follow the text. Use the image for colors and for what the text does not say.",
        ]
      : asset.reference
        ? ["The image is the reference. Copy its parts, where each part sits, their sizes, and their colors."]
        : []),
    "",
    "First write the layout, then the shapes.",
    "",
    ...SHAPE_RULES,
    noteLine(note),
  ].join("\n");
}

function buildCheckPrompt(asset: Asset, plan: string, note: string) {
  const first = asset.reference ? "The first image is the reference." : "There is no reference image; the artist text above is the reference.";
  return [
    ...intro(asset),
    "",
    "Below is the current plan of the model. Check it and fix it.",
    first,
    "The next image is the current model seen from the game camera: from the front, looking down about 33 degrees.",
    "The last image is the current model seen from straight above: +x is to the right, +z (the front) is at the bottom. The ground grid has 1 m cells; its two dark lines are x = 0 and z = 0.",
    "The renders show only shapes and flat colors, with black edges. Textures are not made yet, so do not judge details that a texture will paint.",
    "",
    "First write the differences: compare the renders with the reference part by part. Look for missing or extra parts, parts in the wrong place, the wrong size, the wrong direction (such as a roof ridge or a gable that faces the wrong way), and wrong colors.",
    "Then return the whole fixed plan: every shape and every slot, not only the changed ones. Keep the parts that are right as they are. If nothing is wrong, return the same plan.",
    "",
    ...SHAPE_RULES,
    "",
    "Current plan:",
    plan,
    noteLine(note),
  ].join("\n");
}

function buildEditPrompt(asset: Asset, plan: string, note: string) {
  return [
    ...intro(asset),
    ...(asset.reference ? ["The image is the reference of the model."] : []),
    "",
    "Below is the current plan of the model. Change it as the artist asks in the change request at the end.",
    "Change only what the request asks, and what must move with it so parts still join (for example, a roof follows its walls). Keep every other shape and slot exactly as it is, with the same ids, sizes, positions, and colors.",
    "Return the whole plan: every shape and every slot, not only the changed ones.",
    "",
    ...SHAPE_RULES,
    "",
    "Current plan:",
    plan,
    "",
    `Change request from the artist: ${note.trim()}`,
  ].join("\n");
}

// The current shapes and slots in the form Infer returns, so a check or an edit can send them back.
function currentPlan(asset: Asset) {
  return JSON.stringify({
    description: asset.description,
    shapes: asset.shapes.map((shape) => ({
      ...shape,
      faces: Object.entries(shape.faces).map(([face, texture]) => ({ face, texture })),
    })),
    textures: asset.textures.map(({ name, description, color, widthM, heightM }) => ({ name, description, color, widthM, heightM })),
  });
}

// Turns the Infer answer into shapes and slots, and checks them.
function readPlan(output: unknown, oldSlots: TextureSlot[]) {
  const parsed = planSchema.safeParse(output);
  if (!parsed.success) throw new StudioError(502, `Infer gave a shape plan in the wrong form: ${parsed.error.issues[0]?.message}`);
  const plan = parsed.data;
  const now = new Date().toISOString();

  const shapes: Shape[] = plan.shapes.slice(0, MAX_SHAPES).map((shape) => {
    const candidate = {
      id: shape.id,
      type: shape.type,
      size: shape.size.slice(0, 3),
      position: shape.position.slice(0, 3),
      rotationY: shape.rotationY,
      tilt: shape.tilt,
      role: shape.role,
      faces: Object.fromEntries(shape.faces.map((face) => [face.face, face.texture])),
    };
    const checked = shapeSchema.safeParse(candidate);
    if (!checked.success) {
      throw new StudioError(502, `Infer gave a wrong shape "${shape.id}": ${checked.error.issues[0]?.message}`);
    }
    return checked.data;
  });

  // A slot with the same name keeps its texture file. A redo of the shapes does not lose textures.
  const textures: TextureSlot[] = plan.textures.map((slot) => {
    const old = oldSlots.find((item) => item.name === slot.name);
    return { ...slot, file: old?.file ?? null, prompt: old?.prompt ?? null, updatedAt: old?.updatedAt ?? now };
  });
  const names = new Set(textures.map((slot) => slot.name));
  for (const shape of shapes) {
    for (const slot of Object.values(shape.faces)) {
      if (slot && !names.has(slot)) throw new StudioError(502, `Infer used a texture "${slot}" that it did not list.`);
    }
  }
  return { description: plan.description, shapes, textures };
}

// Infer sees the reference only through Bucket, so it is uploaded once.
async function withReference(asset: Asset) {
  if (!asset.reference || asset.referenceBucketFileId) return asset;
  const fileId = await uploadPng(`${asset.id}-reference.png`, await readAssetBinary(asset, asset.reference));
  return updateAsset(asset.id, (latest) => ({ ...latest, referenceBucketFileId: fileId }));
}

export async function makeShapes(asset: Asset, note: string, choice: InferChoice) {
  if (asset.kind === "ground") throw new StudioError(400, "A ground tile has no shapes.");
  const next = await withReference(asset);
  const images = next.referenceBucketFileId ? [next.referenceBucketFileId] : [];
  const output = await generateJson(buildPrompt(next, note), planJsonSchema, images, choice);
  return updateAsset(next.id, (latest) => ({ ...latest, ...readPlan(output, latest.textures) }));
}

// Infer gets the current plan and changes only what the note asks.
export async function editShapes(asset: Asset, note: string, choice: InferChoice) {
  if (asset.shapes.length === 0) throw new StudioError(409, "Make the shapes before you edit them.");
  if (!note.trim()) throw new StudioError(400, "Write in the note what Infer must change.");
  const next = await withReference(asset);
  const images = next.referenceBucketFileId ? [next.referenceBucketFileId] : [];
  const output = await generateJson(buildEditPrompt(next, currentPlan(next), note), planJsonSchema, images, choice);
  return updateAsset(next.id, (latest) => ({ ...latest, ...readPlan(output, latest.textures) }));
}

// One check round: Infer compares renders of the current shapes with the reference and fixes the plan.
export async function checkShapes(asset: Asset, renders: { game: Buffer; top: Buffer }, note: string, choice: InferChoice) {
  if (asset.shapes.length === 0) throw new StudioError(409, "Make the shapes before a check.");
  const next = await withReference(asset);
  const [game, top] = await Promise.all([
    uploadPng(`${next.id}-check-game.png`, renders.game),
    uploadPng(`${next.id}-check-top.png`, renders.top),
  ]);
  const images = [...(next.referenceBucketFileId ? [next.referenceBucketFileId] : []), game, top];
  const output = await generateJson(buildCheckPrompt(next, currentPlan(next), note), checkJsonSchema, images, choice);
  const differences = (output as { differences?: unknown } | null)?.differences;
  if (typeof differences === "string") console.log(`Check of ${next.id}:\n${differences}`);
  return updateAsset(next.id, (latest) => ({ ...latest, ...readPlan(output, latest.textures) }));
}
