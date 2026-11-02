import sharp from "sharp";
import { texturePixels, type Asset, type TextureSlot } from "@lambda/asset-format/schema";
import { StudioError } from "./errors.ts";
import { generateImage, type InferChoice } from "./infer.ts";
import { readAssetBinary, updateAsset, writeAssetFile } from "./library.ts";

// Every texture is cut down to this many colors, with no dithering.
const MAX_COLORS = 16;
// Infer takes a reference PNG of 2 MiB or less.
const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;

function buildPrompt(asset: Asset, slot: TextureSlot, note: string) {
  const pixels = texturePixels(slot);
  const lines = [
    `Paint one flat texture for a top-down 3D pixel art game.`,
    `It covers ${slot.widthM} x ${slot.heightM} meters of the "${slot.name}" surface of "${asset.name}".`,
    `What to paint: ${slot.description}`,
    `Main color: ${slot.color}.`,
  ];
  if (asset.prompt) lines.push(`What the artist wants for the whole ${asset.kind}: ${asset.prompt}`);
  if (asset.reference) {
    lines.push(
      "The reference image shows the object. Copy the material of this surface from it, but in plain white daylight: never copy the sunset, night, or colored light of the image.",
    );
  }
  lines.push(
    "",
    "Rules:",
    "- A straight-on flat view of the surface that fills the whole image, edge to edge. No perspective, no background, no border, no frame, no text.",
    `- The image will be stretched to a ${slot.widthM}:${slot.heightM} area, so place details for that shape.`,
    "- Simple pixel art: big flat color areas, clear shapes, few colors.",
    "- Most of the image is the main color. Joints, lines, and marks are one or two steps lighter or darker in the same hue. No black lines.",
    "- A material (walls, roof, wood, stone, plaster) repeats, so its opposite edges must meet with no seams, and it has no signs or one-time marks. One object (a door, a window, a sign) is painted once and fills the image.",
    "- No painted light, no shadows, no outlines, no gradients. The game adds light and outlines.",
    `- The final texture is only ${pixels.width} x ${pixels.height} pixels, so only big details survive.`,
  );
  if (asset.kind === "ground") lines.push("- It is a ground tile seen from above. It must tile with no seams on all four sides.");
  if (note.trim()) lines.push("", `Note from the artist: ${note.trim()}`);
  return lines.join("\n");
}

// A PNG of 2 MiB or less for Infer, made smaller until it fits.
export async function referenceForInfer(png: Buffer) {
  for (const size of [1024, 768, 512]) {
    const resized = await sharp(png).resize(size, size, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    if (resized.length <= MAX_REFERENCE_BYTES) return resized;
  }
  throw new StudioError(400, "The reference image is too large, even at 512 pixels.");
}

// The big Infer image becomes a small pixel texture: about 44 texels per meter (1 per game pixel), at most 16 colors.
// Infer sometimes paints a transparent background; those pixels take the main color of the slot.
async function toPixelTexture(image: Buffer, slot: TextureSlot) {
  const { width, height } = texturePixels(slot);
  return sharp(image)
    .flatten({ background: slot.color })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .png({ palette: true, colours: MAX_COLORS, dither: 0 })
    .toBuffer();
}

export async function makeTexture(asset: Asset, slotName: string, note: string, choice: InferChoice) {
  const slot = asset.textures.find((item) => item.name === slotName);
  if (!slot) throw new StudioError(404, `No texture "${slotName}" in this asset.`);

  const prompt = buildPrompt(asset, slot, note);
  const reference = asset.reference ? await referenceForInfer(await readAssetBinary(asset, asset.reference)) : null;
  const texture = await toPixelTexture(await generateImage(prompt, reference, choice), slot);

  const file = `textures/${slot.name}.png`;
  await writeAssetFile(asset, file, texture);
  const now = new Date().toISOString();
  return updateAsset(asset.id, (latest) => ({
    ...latest,
    textures: latest.textures.map((item) => (item.name === slot.name ? { ...item, file, prompt, updatedAt: now } : item)),
  }));
}
