import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assetFolder, assetSchema, KIND_FOLDERS, type Asset } from "@lambda/asset-format/schema";
import { LIBRARY_ROOT } from "./config.ts";
import { StudioError } from "./errors.ts";

// Every asset is one folder: assets/<kind folder>/<id>/
//   asset.json, reference.png, thumbnail.png, textures/<slot>.png
//   history/  every file it replaced, with the time in front of its name

export function folderOf(asset: Pick<Asset, "kind" | "id">) {
  return join(LIBRARY_ROOT, assetFolder(asset));
}

export async function listAssets() {
  const assets: Asset[] = [];
  for (const kindFolder of Object.values(KIND_FOLDERS)) {
    const root = join(LIBRARY_ROOT, kindFolder);
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(root, entry.name, "asset.json");
      if (existsSync(file)) assets.push(await readAssetFile(file));
    }
  }
  return assets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readAsset(id: string) {
  for (const kindFolder of Object.values(KIND_FOLDERS)) {
    const file = join(LIBRARY_ROOT, kindFolder, id, "asset.json");
    if (existsSync(file)) return readAssetFile(file);
  }
  throw new StudioError(404, `No asset with the id "${id}".`);
}

async function readAssetFile(file: string) {
  const parsed = assetSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) throw new StudioError(500, `${file} is not valid: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export async function writeAsset(asset: Asset) {
  const next = assetSchema.parse({ ...asset, updatedAt: new Date().toISOString() });
  const folder = folderOf(next);
  await mkdir(join(folder, "textures"), { recursive: true });
  // history/ keeps old shape plans only. Names, notes, and status changes are not worth a copy.
  const file = join(folder, "asset.json");
  const old = existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as Partial<Asset>) : null;
  if (old && JSON.stringify(old.shapes) !== JSON.stringify(next.shapes)) await keepOldFile(next, "asset.json");
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

// Changes of one asset run one after the other. Several textures can finish at the same
// time, and each change must start from the latest asset.json.
const locks = new Map<string, Promise<unknown>>();

export function updateAsset(id: string, change: (asset: Asset) => Asset | Promise<Asset>) {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => writeAsset(await change(await readAsset(id))));
  locks.set(id, next);
  return next;
}

// Writes a file of the asset. The old file goes to history/ first, unless keepHistory is false.
export async function writeAssetFile(asset: Asset, path: string, data: Buffer, keepHistory = true) {
  const folder = folderOf(asset);
  await mkdir(join(folder, path, ".."), { recursive: true });
  if (keepHistory) await keepOldFile(asset, path);
  await writeFile(join(folder, path), data);
}

async function keepOldFile(asset: Asset, path: string) {
  const folder = folderOf(asset);
  if (!existsSync(join(folder, path))) return;
  await mkdir(join(folder, "history"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(join(folder, path), join(folder, "history", `${stamp}-${path.replaceAll("/", "-")}`));
}

export function readAssetBinary(asset: Asset, path: string) {
  return readFile(join(folderOf(asset), path));
}

// A unique id from the name: "Stone Cottage" -> "stone-cottage", then "stone-cottage-2".
export async function newAssetId(name: string) {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "asset";
  const taken = new Set((await listAssets()).map((asset) => asset.id));
  let id = base;
  for (let number = 2; taken.has(id); number++) id = `${base}-${number}`;
  return id;
}
