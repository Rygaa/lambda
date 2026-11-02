import { bucketConfig } from "./config.ts";
import { StudioError } from "./errors.ts";

// Asks Bucket for a one-time link, then uploads the PNG to the configured folder.
// Infer reads images for text requests only from Bucket.
export async function uploadPng(name: string, png: Buffer) {
  const config = bucketConfig();
  const linkResponse = await fetch(new URL(`/api/folders/${config.folderId}/upload-links`, config.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
    body: JSON.stringify({ folderId: config.folderId, expiresIn: 300 }),
  });
  const link = (await linkResponse.json().catch(() => ({}))) as { url?: string };
  if (!linkResponse.ok || !link.url) throw new StudioError(502, `Bucket error ${linkResponse.status}.`);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), name);
  const response = await fetch(new URL(link.url, config.baseUrl), { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as { file?: { id: string } };
  if (!response.ok || !body.file) throw new StudioError(502, `Bucket error ${response.status}.`);
  return body.file.id;
}
