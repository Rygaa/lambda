import { fileURLToPath } from "node:url";

export const SERVER_PORT = 9310;

// The asset library at the root of projet-lambda.
export const LIBRARY_ROOT = fileURLToPath(new URL("../../../assets", import.meta.url));

export class ConfigError extends Error {}

// Read only when Infer or Bucket is called, so the library still opens with no keys.
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is missing in apps/asset-studio/.env.dev.`);
  return value;
}

export function inferConfig() {
  return { url: required("INFER_API_URL").replace(/\/$/, ""), apiKey: required("INFER_API_KEY") };
}

export function bucketConfig() {
  return {
    baseUrl: required("BUCKET_BASE_URL"),
    apiKey: required("BUCKET_API_KEY"),
    folderId: required("BUCKET_UPLOAD_FOLDER_ID"),
  };
}
