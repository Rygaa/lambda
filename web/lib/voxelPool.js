// The voxel workers (lib/voxelWorker.js), one per core of the computer but one: the world (systems/voxels.js) and the
// bodies (lib/voxels.js voxelClips) share them. A job goes to the worker with the fewest jobs, each worker has at
// most AHEAD at a time, and the jobs marked `first` (the bodies: they are seen at once) go before the others.
const AHEAD = 2;

export function createPool(size = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))) {
  const first = [], later = [], waiting = new Map(), load = new Array(size).fill(0);
  let next = 0;
  const workers = Array.from({ length: size }, (_, w) => {
    const worker = new Worker(new URL('./voxelWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      load[w]--;
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
      return new Promise((resolve) => {
        (isFirst ? first : later).push({ id: next++, message, transfers, resolve });
        pump();
      });
    },
    // a message for every worker (a texture), before the jobs sent after it
    tell(message) { for (const worker of workers) worker.postMessage(message); },
  };
}
