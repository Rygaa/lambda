// 1x1 world-unit grid cells, used to find nearby grass and footprints fast.
export const cellKey = (x, z) => (Math.floor(x) + 1024) * 4096 + (Math.floor(z) + 1024);

export function eachCell(x, z, r, fn) {
  for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++)
    for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) fn(cellKey(i, j));
}
