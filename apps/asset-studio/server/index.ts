import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { relative } from "node:path";
import type { Server } from "node:http";
import { Hono } from "hono";
import sharp from "sharp";
import { z } from "zod";
import { ASSET_KINDS, GROUND_TILE_METERS, type Asset } from "@lambda/asset-format/schema";
import { ConfigError, LIBRARY_ROOT, SERVER_PORT } from "./config.ts";
import { StudioError } from "./errors.ts";
import { listModels } from "./infer.ts";
import { listAssets, newAssetId, readAsset, updateAsset, writeAsset, writeAssetFile } from "./library.ts";
import { checkShapes, editShapes, makeShapes } from "./shapes.ts";
import { makeTexture } from "./textures.ts";

const app = new Hono();

const choiceSchema = z.object({
  model: z.string().min(1),
  reasoningEffort: z.string().min(1),
  note: z.string().max(2000).default(""),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  prompt: z.string().trim().max(4000).optional(),
  status: z.enum(["draft", "ready"]).optional(),
  slot: z
    .object({
      name: z.string(),
      description: z.string().optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    .optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new StudioError(400, result.error.issues[0]?.message ?? "The request is not valid.");
  return result.data;
}

app.onError((error, context) => {
  if (error instanceof StudioError) return context.json({ message: error.message }, error.status);
  if (error instanceof ConfigError) return context.json({ message: error.message }, 500);
  if (error instanceof z.ZodError) return context.json({ message: error.issues[0]?.message ?? "Invalid data." }, 500);
  console.error(error);
  return context.json({ message: "The studio server failed. Read its terminal." }, 500);
});

app.get("/api/models", async (context) => context.json({ models: await listModels() }));

app.get("/api/assets", async (context) => context.json({ assets: await listAssets() }));

app.get("/api/assets/:id", async (context) => context.json({ asset: await readAsset(context.req.param("id")) }));

// A reference upload becomes a PNG of at most 1024 pixels.
async function toReferencePng(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return null;
  return sharp(Buffer.from(await file.arrayBuffer()))
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer()
    .catch(() => {
      throw new StudioError(400, "The reference must be a PNG, JPEG, or WebP image.");
    });
}

// A new asset starts as a draft with a prompt, a reference image, or both.
// A ground tile gets its one texture slot right away; it has no shapes.
app.post("/api/assets", async (context) => {
  const form = await context.req.formData();
  const name = parse(z.string().trim().min(1, "Give the asset a name."), form.get("name"));
  const kind = parse(z.enum(ASSET_KINDS), form.get("kind"));
  const prompt = parse(z.string().trim().max(4000), form.get("prompt") ?? "");
  const reference = await toReferencePng(form.get("reference"));
  if (!reference && !prompt) throw new StudioError(400, "Write a prompt, add a reference image, or both.");

  // With no image, the slot stays gray until Infer paints it.
  let mainColor = "#808080";
  if (reference) {
    const { dominant } = await sharp(reference).stats();
    mainColor = `#${[dominant.r, dominant.g, dominant.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  const now = new Date().toISOString();
  const asset: Asset = {
    id: await newAssetId(name),
    name,
    kind,
    status: "draft",
    description: "",
    prompt,
    reference: reference ? "reference.png" : null,
    referenceBucketFileId: null,
    shapes: [],
    textures:
      kind === "ground"
        ? [
            {
              name: "ground",
              description: `${name}, seen from straight above.`,
              color: mainColor,
              widthM: GROUND_TILE_METERS,
              heightM: GROUND_TILE_METERS,
              file: null,
              prompt: null,
              updatedAt: now,
            },
          ]
        : [],
    createdAt: now,
    updatedAt: now,
  };
  if (reference) await writeAssetFile(asset, "reference.png", reference);
  return context.json({ asset: await writeAsset(asset) });
});

// Adds or changes the reference image. The old Bucket copy is no longer the right image.
app.put("/api/assets/:id/reference", async (context) => {
  const reference = await toReferencePng((await context.req.formData()).get("reference"));
  if (!reference) throw new StudioError(400, "Add a reference image.");
  const asset = await readAsset(context.req.param("id"));
  await writeAssetFile(asset, "reference.png", reference);
  return context.json({
    asset: await updateAsset(asset.id, (latest) => ({ ...latest, reference: "reference.png", referenceBucketFileId: null })),
  });
});

app.patch("/api/assets/:id", async (context) => {
  const patch = parse(patchSchema, await context.req.json());
  const asset = await updateAsset(context.req.param("id"), (latest) => {
    if (patch.status === "ready" && latest.kind !== "ground" && latest.shapes.length === 0) {
      throw new StudioError(409, "Make the shapes before you mark the asset ready.");
    }
    if (patch.status === "ready" && latest.textures.some((slot) => !slot.file)) {
      throw new StudioError(409, "Make every texture before you mark the asset ready.");
    }
    if (patch.slot && !latest.textures.some((slot) => slot.name === patch.slot?.name)) {
      throw new StudioError(404, `No texture "${patch.slot.name}" in this asset.`);
    }
    return {
      ...latest,
      name: patch.name ?? latest.name,
      prompt: patch.prompt ?? latest.prompt,
      status: patch.status ?? latest.status,
      textures: latest.textures.map((slot) =>
        slot.name === patch.slot?.name
          ? { ...slot, description: patch.slot.description ?? slot.description, color: patch.slot.color ?? slot.color }
          : slot,
      ),
    };
  });
  return context.json({ asset });
});

app.post("/api/assets/:id/shapes", async (context) => {
  const { note, ...choice } = parse(choiceSchema, await context.req.json());
  const asset = await readAsset(context.req.param("id"));
  return context.json({ asset: await makeShapes(asset, note, choice) });
});

// Infer changes the current plan as the note asks.
app.post("/api/assets/:id/shapes/edit", async (context) => {
  const { note, ...choice } = parse(choiceSchema, await context.req.json());
  const asset = await readAsset(context.req.param("id"));
  return context.json({ asset: await editShapes(asset, note, choice) });
});

// One check round. The page renders the current shapes and sends the 2 pictures.
app.post("/api/assets/:id/shapes/check", async (context) => {
  const form = await context.req.formData();
  const { note, ...choice } = parse(choiceSchema, {
    model: form.get("model"),
    reasoningEffort: form.get("reasoningEffort"),
    note: form.get("note") ?? "",
  });
  const toPng = async (file: FormDataEntryValue | null) => {
    if (!(file instanceof File) || file.size === 0) throw new StudioError(400, "Send both renders of the shapes.");
    return sharp(Buffer.from(await file.arrayBuffer())).png().toBuffer();
  };
  const renders = { game: await toPng(form.get("game")), top: await toPng(form.get("top")) };
  const asset = await readAsset(context.req.param("id"));
  return context.json({ asset: await checkShapes(asset, renders, note, choice) });
});

app.post("/api/assets/:id/textures/:slot", async (context) => {
  const { note, ...choice } = parse(choiceSchema, await context.req.json());
  const asset = await readAsset(context.req.param("id"));
  return context.json({ asset: await makeTexture(asset, context.req.param("slot"), note, choice) });
});

// The page renders the asset in the game style and sends the picture for the library.
app.put("/api/assets/:id/thumbnail", async (context) => {
  const asset = await readAsset(context.req.param("id"));
  const png = await sharp(Buffer.from(await context.req.arrayBuffer())).png().toBuffer();
  await writeAssetFile(asset, "thumbnail.png", png, false);
  return context.json({ asset: await updateAsset(asset.id, (latest) => latest) });
});

// The assets/ folder, read by the 3D view with the same paths as the map maker.
app.use(
  "/library/*",
  serveStatic({
    root: relative(process.cwd(), LIBRARY_ROOT),
    rewriteRequestPath: (path) => path.replace(/^\/library/, ""),
    onFound: (_path, context) => context.header("Cache-Control", "no-store"),
  }),
);

const server = serve({ fetch: app.fetch, port: SERVER_PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`Asset studio server on http://127.0.0.1:${info.port}`);
}) as Server;
// An Infer image can take several minutes, plus the wait for a free slot.
server.requestTimeout = 0;
