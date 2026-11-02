import { useEffect, useState } from "react";
import { ASSET_KINDS, type Asset, type AssetKind } from "@lambda/asset-format/schema";
import { api, libraryUrl } from "../api.ts";

// Every asset, with its last picture in the game style.
export function LibraryPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<AssetKind | "all">("all");

  useEffect(() => {
    api.assets().then(setAssets, (reason: Error) => setError(reason.message));
  }, []);

  const shown = assets?.filter((asset) => kind === "all" || asset.kind === kind) ?? [];

  return (
    <div className="space-y-5 p-5">
      <div className="flex gap-2">
        {(["all", ...ASSET_KINDS] as const).map((item) => (
          <button
            key={item}
            onClick={() => setKind(item)}
            className={`rounded-md px-3 py-1 text-sm capitalize ${kind === item ? "bg-zinc-200 text-zinc-900" : "bg-zinc-800 text-zinc-300"}`}
          >
            {item}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {assets && shown.length === 0 && (
        <p className="text-sm text-zinc-400">
          No assets yet. <a href="#/new" className="underline">Make the first one.</a>
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {shown.map((asset) => (
          <a key={asset.id} href={`#/asset/${asset.id}`} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 hover:border-zinc-500">
            <div className="flex aspect-video items-center justify-center bg-zinc-800 text-sm text-zinc-500">
              <CardImage asset={asset} />
            </div>
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="truncate">{asset.name}</span>
              <span className={`text-xs ${asset.status === "ready" ? "text-emerald-400" : "text-amber-400"}`}>{asset.status}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// The thumbnail, then the reference, then only the name.
function CardImage({ asset }: { asset: Asset }) {
  const sources = [libraryUrl(asset, "thumbnail.png"), ...(asset.reference ? [libraryUrl(asset, asset.reference)] : [])];
  const [index, setIndex] = useState(0);
  const source = sources[index];
  if (!source) return <span>{asset.name}</span>;
  return (
    <img
      src={source}
      alt=""
      className={`pixelated h-full w-full object-cover ${index > 0 ? "opacity-40" : ""}`}
      onError={() => setIndex((value) => value + 1)}
    />
  );
}
