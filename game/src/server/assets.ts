// Reads game/assets/ from the disk (server and tools).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../shared/config.ts";

export function assetsDir(root: string) {
  return path.join(root, "assets");
}

export function loadConfigFromDisk(root: string) {
  return loadConfig(async (file) => JSON.parse(await readFile(path.join(assetsDir(root), file), "utf8")));
}
