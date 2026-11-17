// The worker that makes the cubes of a body (lib/shell.js shellOf) away from the page, so the game does not wait for
// them (lib/voxelBody.js). A job: { id, parts, frame, size, all }. Out: { id, shell } (its arrays given back, not copied).
// The textures stay here by id (sent once: { texture: { id, width, height, data } })
import { shellOf } from './shell.js';

const textures = new Map();

self.onmessage = ({ data }) => {
  if (data.texture) { textures.set(data.texture.id, data.texture); return; }
  const { id, parts, frame, size, all } = data;
  const shell = shellOf(parts.map((p) => ({ cut: p.cut, tex: textures.get(p.tex), texId: p.tex })), frame, size, all);
  self.postMessage({ id, shell }, [shell.part.buffer, shell.tri.buffer, shell.bary.buffer, shell.local.buffer, shell.rgb.buffer]);
};
