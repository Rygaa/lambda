import { assetFolder, type Asset, type AssetKind } from "@lambda/asset-format/schema";

export type InferModel = { id: string; reasoningEfforts: string[] };
export type InferChoice = { model: string; reasoningEffort: string; note: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? `The server answered ${response.status}.`);
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  models: () => call<{ models: InferModel[] }>("/api/models").then((body) => body.models),
  assets: () => call<{ assets: Asset[] }>("/api/assets").then((body) => body.assets),
  asset: (id: string) => call<{ asset: Asset }>(`/api/assets/${id}`).then((body) => body.asset),

  create(name: string, kind: AssetKind, prompt: string, reference: File | null) {
    const form = new FormData();
    form.set("name", name);
    form.set("kind", kind);
    form.set("prompt", prompt);
    if (reference) form.set("reference", reference);
    return call<{ asset: Asset }>("/api/assets", { method: "POST", body: form }).then((body) => body.asset);
  },

  setReference(id: string, reference: File) {
    const form = new FormData();
    form.set("reference", reference);
    return call<{ asset: Asset }>(`/api/assets/${id}/reference`, { method: "PUT", body: form }).then((body) => body.asset);
  },

  update: (
    id: string,
    patch: { name?: string; prompt?: string; status?: Asset["status"]; slot?: { name: string; description?: string; color?: string } },
  ) =>
    call<{ asset: Asset }>(`/api/assets/${id}`, json("PATCH", patch)).then((body) => body.asset),

  makeShapes: (id: string, choice: InferChoice) =>
    call<{ asset: Asset }>(`/api/assets/${id}/shapes`, json("POST", choice)).then((body) => body.asset),

  editShapes: (id: string, choice: InferChoice) =>
    call<{ asset: Asset }>(`/api/assets/${id}/shapes/edit`, json("POST", choice)).then((body) => body.asset),

  checkShapes(id: string, choice: InferChoice, renders: { game: Blob; top: Blob }) {
    const form = new FormData();
    form.set("model", choice.model);
    form.set("reasoningEffort", choice.reasoningEffort);
    form.set("note", choice.note);
    form.set("game", renders.game, "game.png");
    form.set("top", renders.top, "top.png");
    return call<{ asset: Asset }>(`/api/assets/${id}/shapes/check`, { method: "POST", body: form }).then((body) => body.asset);
  },

  makeTexture: (id: string, slot: string, choice: InferChoice) =>
    call<{ asset: Asset }>(`/api/assets/${id}/textures/${slot}`, json("POST", choice)).then((body) => body.asset),

  saveThumbnail: (id: string, png: Blob) =>
    call<{ asset: Asset }>(`/api/assets/${id}/thumbnail`, { method: "PUT", body: png }).then((body) => body.asset),
};

export function libraryUrl(asset: Asset, file: string) {
  return `/library/${assetFolder(asset)}/${file}?v=${encodeURIComponent(asset.updatedAt)}`;
}
