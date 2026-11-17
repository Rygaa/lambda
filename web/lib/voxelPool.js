// The voxel workers (lib/voxelWorker.js), one per core of the computer but one: the world (systems/voxels.js) and the
// bodies (lib/voxels.js voxelClips) share them. A job goes to the worker with the fewest jobs, each worker has at
// most AHEAD at a time, and the jobs marked `first` (the bodies: they are seen at once) go before the others.
// With the cubes of the world made beforehand (useBaked: worlds/baked/<world>.bin, lib/voxelSaved.js), a job found in
// them is answered here at once, without a worker; with keepAll (?bake), every answer is kept, for that file.
import { hashJob, unpack, uvOf } from './voxelSaved.js';

const AHEAD = 2;

export function createPool(size = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))) {
  const first = [], later = [], waiting = new Map(), load = new Array(size).fill(0);
  let next = 0, baked = null, palette = null, kept = null;
  const workers = Array.from({ length: size }, (_, w) => {
    const worker = new Worker(new URL('./voxelWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      load[w]--;
      if (kept && data.kept) kept.set(data.key, data.kept);
      waiting.get(data.id)(data);
      waiting.delete(data.id);
      pump();
    };
    return worker;
  });

  function pump() {
    while (first.length || later.length) {
      const w = load.indexOf(Math.min(...load));
      if (load[w] >= AHEAD) return;
      const job = first.length ? first.shift() : later.shift();
      load[w]++;
      waiting.set(job.id, job.resolve);
      workers[w].postMessage({ ...job.message, id: job.id }, job.transfers);
    }
  }

  return {
    size,
    // a job (lib/voxelWorker.js): a promise of its answer. transfers: the buffers given to the worker
    run(message, transfers = [], isFirst = false) {
      const key = baked || kept ? hashJob(message) : undefined, found = baked?.get(key);
      if (found) {
        if (kept) kept.set(key, found);
        const textured = message.sources.some((s) => s.texture !== undefined);
        // a little later, so many answers at once do not stop the page
        return new Promise((resolve) => setTimeout(() => resolve({ key, meshes: found.map((m) => {
          if (!m) return null;
          const arrays = unpack(m, message.size);
          return textured ? { ...arrays, uv: uvOf(arrays.color, palette), color: null } : arrays;
        }) })));
      }
      return new Promise((resolve) => {
        (isFirst ? first : later).push({ id: next++, message: { ...message, key, keep: !!kept }, transfers, resolve });
        pump();
      });
    },
    // the cubes made beforehand: key -> packed meshes (lib/voxelSaved.js fromFile); colours: 0xRRGGBB -> palette index
    useBaked(file, colours) { baked = file; palette = colours; },
    // the loading is over: the file can go (its memory too)
    dropBaked() { baked = null; },
    // keep every answer from now on (for worlds/baked/<world>.bin): key -> packed meshes
    keepAll() { kept = new Map(); },
    get kept() { return kept; },
    // a message for every worker (a texture), before the jobs sent after it
    tell(message) { for (const worker of workers) worker.postMessage(message); },
  };
}
