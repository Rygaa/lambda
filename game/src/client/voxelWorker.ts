// A voxel worker: it makes terrain chunks off the main thread, so walking into the mountains does not stall the
// frames. Messages: {setup} once, then {ci, cj, id}; it answers {id, data} (data null when the chunk is empty).
import { createChunkBuilder, type ChunkSetup } from "./terrainChunk.ts";

let builder: ReturnType<typeof createChunkBuilder> | null = null;
const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as { setup: ChunkSetup } | { ci: number; cj: number; id: number };
  if ("setup" in message) {
    builder = createChunkBuilder(message.setup);
    return;
  }
  const t0 = performance.now();
  const data = builder!.build(message.ci, message.cj);
  const ms = performance.now() - t0;
  scope.postMessage({ id: message.id, data, ms }, data ? [data.positions.buffer, data.normals.buffer, data.rgb.buffer, data.index.buffer] : []);
};
