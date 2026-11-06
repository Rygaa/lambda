// Asset types: one JSON file per type, assets/<family>/<type>/<family>.json
// (documentation/assets.md). A world loads the types it uses before it is made.
//
//   {
//     "about":    what it is, and what its values mean
//     "builder":  the code that makes its shapes (gen/builders/, defineBuilder)
//     "variants": how many different shapes of each size a world makes
//     "palettes": its colours: a list of palette names of its one colour family
//                 (assets/palettes.json), or { name: { family: palette } } when
//                 it has more than one family (a tree: trunk and canopy).
//                 The first one is the default.
//     "sizes":    { small | medium | large: the builder's values }
//   }
//
// One object in the world is named family/type/size/palette/variant, for
// example rock/sharp/small/grey/2.

export const SIZES = ['small', 'medium', 'large'];
const FIELDS = ['about', 'builder', 'variants', 'palettes', 'sizes'];
const types = new Map();   // 'family/type' -> { name, family, type, builder, variants, palettes, sizes }

// names: 'family/type' of every type to load; root: the URL of assets/
export async function loadTypes(names, root) {
  await Promise.all([...new Set(names)].filter((n) => !types.has(n)).map(async (name) => {
    const [family, type, ...rest] = name.split('/');
    if (!family || !type || rest.length) throw new Error(`asset "${name}": give family/type, for example rock/sharp`);
    const file = `${family}/${type}/${family}.json`;
    const res = await fetch(root + file + '?v=' + Date.now());
    if (!res.ok) throw new Error(`asset "${name}": no file assets/${file}`);
    let json;
    try { json = await res.json(); } catch (err) { throw new Error(`assets/${file} is not valid JSON: ${err.message}`); }
    for (const k of Object.keys(json)) if (!FIELDS.includes(k)) throw new Error(`assets/${file}: unknown field "${k}" (known: ${FIELDS.join(', ')})`);
    for (const s of Object.keys(json.sizes ?? {})) if (!SIZES.includes(s)) throw new Error(`assets/${file}: unknown size "${s}" (use ${SIZES.join(', ')})`);
    if (!json.builder || !json.sizes || !json.palettes) throw new Error(`assets/${file}: give "builder", "palettes" and "sizes"`);
    types.set(name, { ...json, name, family, type, variants: json.variants ?? 1 });
  }));
}

export function getType(name) {
  const type = types.get(name);
  if (!type) throw new Error(`asset type "${name}" is not loaded`);
  return type;
}

// the values of one size of a type, changed by `overrides` (recipe "params")
export function paramsOf(type, size, overrides = {}) {
  const base = type.sizes[size];
  if (!base) throw new Error(`${type.name} has no size "${size}" (it has ${Object.keys(type.sizes).join(', ')})`);
  for (const key of Object.keys(overrides))
    if (!(key in base)) throw new Error(`${type.name} has no value "${key}" (known: ${Object.keys(base).join(', ')})`);
  return { ...base, ...overrides };
}

// the palettes of a type: name -> { family: palette }; families: the colour
// families its shapes use (a list of names needs exactly one)
export function paletteChoices(type, families) {
  if (!Array.isArray(type.palettes)) return type.palettes;
  if (families.length !== 1) throw new Error(`${type.name}: its shapes use ${families.join(', ')}, so give "palettes" as { name: { family: palette } }`);
  return Object.fromEntries(type.palettes.map((name) => [name, { [families[0]]: name }]));
}
