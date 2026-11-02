import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ASSET_KINDS, type AssetKind } from "@lambda/asset-format/schema";
import { api } from "../api.ts";

// Step 1: a name, a kind, and a prompt, a reference image, or both.
export function NewAssetPage() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("building");
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const asset = await api.create(name, kind, prompt, file);
      window.location.hash = `#/asset/${asset.id}`;
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-md space-y-4 p-5">
      <h1 className="text-lg font-semibold">New asset</h1>
      <label className="block space-y-1 text-sm">
        <span>Name</span>
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Stone cottage" />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Kind</span>
        <select className="field capitalize" value={kind} onChange={(event) => setKind(event.target.value as AssetKind)}>
          {ASSET_KINDS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>Prompt</span>
        <textarea
          className="field"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="A small stone cottage with a red tile roof, a wooden door, and two windows"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Reference image</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" className="field" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      {preview && <img src={preview} alt="" className="max-h-64 rounded-md" />}
      <p className="text-xs text-zinc-500">Give a prompt, a reference image, or both.</p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="button-primary" disabled={busy || !name.trim() || (!file && !prompt.trim())}>
        {busy ? "Saving…" : "Create"}
      </button>
    </form>
  );
}
