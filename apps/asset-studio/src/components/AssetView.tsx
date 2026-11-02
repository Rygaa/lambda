import { useEffect, useRef } from "react";
import * as THREE from "three";
import { assetFootprint, buildAssetObject, buildGroundPatch, groundMaterial, loadAssetTextures, type Asset } from "@lambda/asset-format";
import { PixelRenderer } from "@lambda/renderer";

type Props = {
  asset: Asset;
  // Degrees. The camera never turns, so the model turns to show its other sides.
  rotation: number;
  pixelScale: number;
  onRenderer?: (renderer: PixelRenderer | null) => void;
};

const PATCH = 24;

// The asset in the game style, on a patch of grass with flowers.
export function AssetView({ asset, rotation, pixelScale, onRenderer }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixelRenderer | null>(null);
  const holderRef = useRef(new THREE.Group());

  useEffect(() => {
    const renderer = new PixelRenderer(containerRef.current!, { shadowRadius: 14 });
    renderer.scene.add(holderRef.current);
    rendererRef.current = renderer;
    onRenderer?.(renderer);
    return () => {
      onRenderer?.(null);
      renderer.scene.remove(holderRef.current);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [onRenderer]);

  useEffect(() => rendererRef.current?.setPixelScale(pixelScale), [pixelScale]);

  useEffect(() => {
    holderRef.current.rotation.y = THREE.MathUtils.degToRad(rotation);
  }, [rotation]);

  // Rebuilds the model each time the asset changes on disk.
  useEffect(() => {
    let cancelled = false;
    loadAssetTextures(asset, "/library").then((textures) => {
      const renderer = rendererRef.current;
      if (cancelled || !renderer) return;
      const holder = holderRef.current;
      holder.clear();
      const half = PATCH / 2;
      if (asset.kind === "ground") {
        holder.add(buildGroundPatch(groundMaterial(asset, textures, "grass", renderer.materials), PATCH));
        renderer.setTarget({ x: 0, y: 0, z: 0 });
        return;
      }
      const model = renderer.castShadows(buildAssetObject(asset, textures, renderer.materials));
      // No grass grows under the model.
      const box = assetFootprint(asset);
      const under = (x: number, z: number) => x > box.minX - 0.1 && x < box.maxX + 0.1 && z > box.minZ - 0.1 && z < box.maxZ + 0.1;
      holder.add(
        buildGroundPatch(renderer.materials.ground({ row: "grass" }), PATCH),
        renderer.createGroundCover({ minX: -half, maxX: half, minZ: -half, maxZ: half, groundAt: (x, z) => (under(x, z) ? null : "grass") }),
        model,
      );
      const bounds = new THREE.Box3().setFromObject(model);
      renderer.setTarget({ x: 0, y: bounds.isEmpty() ? 0 : bounds.getCenter(new THREE.Vector3()).y, z: 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  return <div ref={containerRef} className="h-full w-full" />;
}
