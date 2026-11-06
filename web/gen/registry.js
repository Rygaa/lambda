// Kinds of generated objects. A kind is one plain object:
//
//   defineKind({
//     name: 'rock',
//     presets: { pebble: { ...params }, stone: { ...params } },   // the first one is the default
//     variants: 6,                       // different shapes made per world (or a function of params)
//     palettes: { stone: 'grey' },       // colour family per material role -> default palette
//     build(params, rng, ctx, i) -> Shape,
//   })
//
// Shape (gen/shapes.js caches them):
//   parts:   [{ geometry, role }]   role = material: stone | trunk | canopy | leaves | water
//   height:  top of the object (world units)
//   radius:  circle on the ground: no grass inside, other objects keep out
//   circles: [[x, z, r]] for a shape that is not round (water): they replace the
//            radius circle for grass, blocking and free spots; radius still holds it all
//   blocker: { r, h } the part that stops movement (default { r: radius, h: height })
//   blocks:  true / false to skip the height rule of gen/collision.js
//   turns:   false if it must not be turned around the up axis (trees: their leaves are lit in place)
//
// A recipe line (worlds/*.json) picks a kind and a preset and may change any
// preset value: params = { ...preset, ...line.params }.

const kinds = new Map();

export function defineKind(kind) {
  kinds.set(kind.name, kind);
  return kind;
}

export function getKind(name) {
  const kind = kinds.get(name);
  if (!kind) throw new Error(`unknown kind "${name}" (known: ${[...kinds.keys()].join(', ')})`);
  return kind;
}

export const kindNames = () => [...kinds.keys()];

// the preset values of a kind, changed by `overrides`
export function paramsOf(kind, preset, overrides = {}) {
  const name = preset ?? Object.keys(kind.presets)[0];
  const base = kind.presets[name];
  if (!base) throw new Error(`kind "${kind.name}" has no preset "${name}" (known: ${Object.keys(kind.presets).join(', ')})`);
  for (const key of Object.keys(overrides))
    if (!(key in base)) throw new Error(`kind "${kind.name}" has no value "${key}" (known: ${Object.keys(base).join(', ')})`);
  return { preset: name, params: { ...base, ...overrides } };
}
