import { useEffect, useState } from "react";
import { AssetPage } from "./pages/AssetPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { NewAssetPage } from "./pages/NewAssetPage.tsx";

// Pages live in the hash: #/, #/new, #/asset/<id>.
function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

export function App() {
  const path = useHash();
  const assetId = /^\/asset\/([^/]+)$/.exec(path)?.[1];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-6 border-b border-zinc-800 px-5 py-3">
        <a href="#/" className="font-semibold">
          Asset Studio
        </a>
        <nav className="flex gap-4 text-sm text-zinc-400">
          <a href="#/" className="hover:text-white">
            Library
          </a>
          <a href="#/new" className="hover:text-white">
            New asset
          </a>
        </nav>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {assetId ? <AssetPage key={assetId} id={assetId} /> : path === "/new" ? <NewAssetPage /> : <LibraryPage />}
      </main>
    </div>
  );
}
