import { useCallback, useEffect, useState } from "react";
import { texturePixels, type Asset, type TextureSlot } from "@lambda/asset-format/schema";
import type { PixelRenderer } from "@lambda/renderer";
import { api, libraryUrl } from "../api.ts";
import { captureShapes } from "../capture.ts";
import { AssetView } from "../components/AssetView.tsx";
import { ModelPicker, useInferChoice, type Choice } from "../components/ModelPicker.tsx";

const CHECK_ROUNDS = 2;

// Steps 2 to 4 of an asset: shapes, textures, then ready.
export function AssetPage({ id }: { id: string }) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [rotation, setRotation] = useState(0);
  const [pixelScale, setPixelScale] = useState(3);
  const [renderer, setRenderer] = useState<PixelRenderer | null>(null);
  const [shapeNote, setShapeNote] = useState("");
  const [shapeStep, setShapeStep] = useState("");
  const [textureNote, setTextureNote] = useState("");
  const infer = useInferChoice();

  useEffect(() => {
    api.asset(id).then(setAsset, (reason: Error) => setError(reason.message));
  }, [id]);

  // Several jobs can end in any order. The newest asset.json wins.
  const keepNewest = useCallback((next: Asset) => {
    setAsset((current) => (current && current.updatedAt > next.updatedAt ? current : next));
  }, []);

  async function run(job: string, action: () => Promise<Asset>) {
    setRunning((current) => new Set(current).add(job));
    setError("");
    try {
      keepNewest(await action());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(job);
        return next;
      });
    }
  }

  if (!asset) return <p className="p-5 text-sm text-red-400">{error}</p>;
  const choice: Choice | null = infer.choice;
  const missing = asset.textures.filter((slot) => !slot.file);
  const canBeReady = missing.length === 0 && (asset.kind === "ground" || asset.shapes.length > 0);

  // The plan, then CHECK_ROUNDS rounds where Infer sees renders of its shapes and fixes them.
  // Each round saves the plan, so a closed page keeps the last one.
  const makeShapes = () =>
    run("shapes", async () => {
      const step = { ...choice!, note: shapeNote };
      setShapeStep("Plan");
      let next = await api.makeShapes(asset.id, step);
      for (let round = 1; round <= CHECK_ROUNDS; round++) {
        keepNewest(next);
        setShapeStep(`Check ${round}/${CHECK_ROUNDS}`);
        next = await api.checkShapes(asset.id, step, await captureShapes(next));
      }
      return next;
    }).finally(() => setShapeStep(""));

  const editShapes = () =>
    run("shapes", () => {
      setShapeStep("Edit");
      return api.editShapes(asset.id, { ...choice!, note: shapeNote });
    }).finally(() => setShapeStep(""));

  const makeTexture = (slot: TextureSlot) =>
    run(`texture:${slot.name}`, () => api.makeTexture(asset.id, slot.name, { ...choice!, note: textureNote }));

  async function setReady(ready: boolean) {
    await run("status", async () => {
      if (ready && renderer) await api.saveThumbnail(asset!.id, await renderer.capture());
      return api.update(asset!.id, { status: ready ? "ready" : "draft" });
    });
  }

  return (
    <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
      <section className="flex min-h-[360px] flex-1 flex-col border-zinc-800 lg:border-r">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2 text-sm">
          <span className="font-semibold">{asset.name}</span>
          <span className={asset.status === "ready" ? "text-emerald-400" : "text-amber-400"}>{asset.status}</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="button" onClick={() => setRotation((value) => value - 90)}>
              ⟲ 90°
            </button>
            <button className="button" onClick={() => setRotation((value) => value + 90)}>
              ⟳ 90°
            </button>
            <select className="field w-auto" value={pixelScale} onChange={(event) => setPixelScale(Number(event.target.value))}>
              {[2, 3, 4].map((scale) => (
                <option key={scale} value={scale}>
                  Pixel ×{scale}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-0">
            <AssetView asset={asset} rotation={rotation} pixelScale={pixelScale} onRenderer={setRenderer} />
          </div>
        </div>
      </section>

      <aside className="w-full space-y-6 p-5 lg:w-[440px] lg:overflow-y-auto">
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <Step title="1. Prompt and reference">
          <PromptField
            prompt={asset.prompt}
            onSave={(prompt) => run("prompt", () => api.update(asset.id, { prompt }))}
          />
          {asset.reference ? (
            <img src={libraryUrl(asset, asset.reference)} alt="" className="max-h-48 rounded-md" />
          ) : (
            <p className="text-sm text-zinc-500">No reference image.</p>
          )}
          <label className="button inline-block cursor-pointer">
            {running.has("reference") ? "Saving…" : asset.reference ? "Change image" : "Add image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) run("reference", () => api.setReference(asset.id, file));
              }}
            />
          </label>
          {asset.description && <p className="text-sm text-zinc-400">{asset.description}</p>}
        </Step>

        <ModelPicker {...infer} />

        {asset.kind !== "ground" && (
          <Step title="2. Shapes">
            <p className="text-sm text-zinc-400">
              {asset.shapes.length ? `${asset.shapes.length} shapes, ${asset.textures.length} texture slots.` : "No shapes yet."}
            </p>
            <textarea
              className="field"
              rows={2}
              placeholder="Note for Infer (optional), such as: the roof is taller"
              value={shapeNote}
              onChange={(event) => setShapeNote(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                className="button-primary"
                disabled={!choice || running.has("shapes")}
                onClick={makeShapes}
              >
                {running.has("shapes") ? `Infer: ${shapeStep}…` : asset.shapes.length ? "Redo shapes" : "Make shapes"}
              </button>
              {asset.shapes.length > 0 && (
                <button
                  className="button"
                  disabled={!choice || running.has("shapes") || !shapeNote.trim()}
                  onClick={editShapes}
                >
                  Edit with note
                </button>
              )}
            </div>
            {asset.shapes.length > 0 && (
              <p className="text-xs text-zinc-500">Edit with note: Infer gets the current shapes and changes only what the note asks. No checks.</p>
            )}
          </Step>
        )}

        <Step title={asset.kind === "ground" ? "2. Texture" : "3. Textures"}>
          {asset.textures.length === 0 && <p className="text-sm text-zinc-400">Make the shapes first.</p>}
          {asset.textures.length > 0 && (
            <>
              <textarea
                className="field"
                rows={2}
                placeholder="Note for Infer for every texture (optional)"
                value={textureNote}
                onChange={(event) => setTextureNote(event.target.value)}
              />
              <button className="button" disabled={!choice || missing.length === 0} onClick={() => missing.forEach(makeTexture)}>
                Make all missing ({missing.length})
              </button>
            </>
          )}
          {asset.textures.map((slot) => (
            <SlotCard
              key={slot.name}
              asset={asset}
              slot={slot}
              busy={running.has(`texture:${slot.name}`)}
              canRun={!!choice}
              onMake={() => makeTexture(slot)}
              onChange={(change) => run(`slot:${slot.name}`, () => api.update(asset.id, { slot: { name: slot.name, ...change } }))}
            />
          ))}
        </Step>

        <Step title={asset.kind === "ground" ? "3. Save" : "4. Save"}>
          <p className="text-sm text-zinc-400">Only ready assets go into maps. Marking it ready also saves the picture for the library.</p>
          {asset.status === "draft" ? (
            <button className="button-primary" disabled={!canBeReady || running.has("status")} onClick={() => setReady(true)}>
              Mark ready
            </button>
          ) : (
            <button className="button" disabled={running.has("status")} onClick={() => setReady(false)}>
              Back to draft
            </button>
          )}
        </Step>
      </aside>
    </div>
  );
}

// Saved when the field loses focus.
function PromptField({ prompt, onSave }: { prompt: string; onSave: (prompt: string) => void }) {
  const [value, setValue] = useState(prompt);
  useEffect(() => setValue(prompt), [prompt]);
  return (
    <textarea
      className="field"
      rows={3}
      placeholder="Prompt (optional when there is a reference image)"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => value.trim() !== prompt && onSave(value.trim())}
    />
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">{title}</h2>
      {children}
    </div>
  );
}

type SlotCardProps = {
  asset: Asset;
  slot: TextureSlot;
  busy: boolean;
  canRun: boolean;
  onMake: () => void;
  onChange: (change: { description?: string; color?: string }) => void;
};

function SlotCard({ asset, slot, busy, canRun, onMake, onChange }: SlotCardProps) {
  const [description, setDescription] = useState(slot.description);
  const [color, setColor] = useState(slot.color);
  useEffect(() => setDescription(slot.description), [slot.description]);
  useEffect(() => setColor(slot.color), [slot.color]);
  const pixels = texturePixels(slot);

  return (
    <div className="flex gap-3 rounded-md border border-zinc-800 p-3">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-zinc-800" style={{ backgroundColor: slot.file ? undefined : slot.color }}>
        {slot.file && <img src={libraryUrl(asset, slot.file)} alt="" className="pixelated max-h-20 max-w-20" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{slot.name}</span>
          <span className="text-xs text-zinc-500">
            {slot.widthM}×{slot.heightM} m · {pixels.width}×{pixels.height} px
          </span>
          <input
            type="color"
            className="ml-auto h-5 w-6 cursor-pointer bg-transparent"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            onBlur={() => color !== slot.color && onChange({ color })}
          />
        </div>
        <textarea
          className="field text-xs"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => description !== slot.description && onChange({ description })}
        />
        <button className="button" disabled={!canRun || busy} onClick={onMake}>
          {busy ? "Infer is painting…" : slot.file ? "Redo" : "Make"}
        </button>
      </div>
    </div>
  );
}
