// Shape builders: the code that makes the shapes of an asset type. An asset
// type (assets/<family>/<type>/<family>.json, gen/assets.js) names its builder
// and gives the builder's values for each size. A builder is one plain object:
//
//   defineBuilder({
//     name: 'sharp-rock',
//     build(params, rng, ctx, i) -> Shape,
//   })
//
// Shape (gen/shapes.js caches them):
//   parts:   [{ geometry, role, palette? }]   role = material: stone | trunk | canopy | leaves | water;
//            palette: a part that always keeps this palette of its family (the palm trunk)
//   height:  top of the object (world units)
//   radius:  circle on the ground: no grass inside, other objects keep out
//   circles: [[x, z, r]] for a shape that is not round (water): they replace the
//            radius circle for grass, blocking and free spots; radius still holds it all
//   blocker: { r, h } the part that stops movement (default { r: radius, h: height })
//   blocks:  true / false to skip the height rule of gen/collision.js
//   colliders: [[x, z, r]]: simple circles that stop a walker instead of its real shape (thin posts, a torch, crates:
//            the walker slides along a circle, lib/footprints.js bumps), turned with the object
//   turns:   false if it must not be turned around the up axis (trees: their leaves are lit in place)

const builders = new Map();

export function defineBuilder(builder) {
  builders.set(builder.name, builder);
  return builder;
}

export function getBuilder(name) {
  const builder = builders.get(name);
  if (!builder) throw new Error(`unknown builder "${name}" (known: ${[...builders.keys()].join(', ')})`);
  return builder;
}
