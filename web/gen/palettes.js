// Colour palettes, by family, from assets/palettes.json. Each material role uses
// one family; an object picks one palette per family. The shaders and
// materials are built from these tables, so a new palette is one more entry in
// the JSON file. The first palette of a family is its default.
//
//   stone:  flat tones { lit, up: top in shade, shade, hi: lit edge }; palm and wood
//           are the palm trunk and its coconuts (gen/builders/palm.js)
//   trunk, canopy: light ramps [[light value, colour], ...] (canopy is also the leaves)
//   water:  tones { deep, mid, shallow, foam, wave }, each [lit, in shade]
//   ground: light ramps of the ground paints (gen/ground.js); tile and furrow
//           are the lines drawn on pavement and fields
//   cover:  the light ramps of the flowers and sprouts in the grass
//
// A theme (recipe "theme", or ?theme=<name> in the URL) replaces palettes by
// name, so recipes keep their palette names.

let PALETTES = null;   // family -> name -> colours, with the theme swapped in
let THEMES = {};

// json: assets/palettes.json; theme: a theme name, or null
export function setPalettes(json, theme = null) {
  THEMES = json.themes;
  if (theme && !THEMES[theme]) throw new Error(`unknown theme "${theme}" (known: ${Object.keys(THEMES).join(', ')})`);
  PALETTES = {};
  for (const [family, set] of Object.entries(json.families))
    PALETTES[family] = Object.fromEntries(Object.entries(set).map(([name, v]) => [name, THEMES[theme]?.[family]?.[name] ?? v]));
}

// material role -> palette family
export const FAMILY = { stone: 'stone', trunk: 'trunk', canopy: 'canopy', leaves: 'canopy', water: 'water' };

export const paletteNames = (family) => Object.keys(PALETTES[family]);

// { family: name } -> { family: row } (row = index in the family, as the shaders see it)
export function paletteRows(names) {
  const rows = {};
  for (const [family, name] of Object.entries(names)) {
    if (!PALETTES[family]) throw new Error(`unknown palette family "${family}" (known: ${Object.keys(PALETTES).join(', ')})`);
    const row = paletteNames(family).indexOf(name);
    if (row < 0) throw new Error(`unknown ${family} palette "${name}" (known: ${paletteNames(family).join(', ')})`);
    rows[family] = row;
  }
  return rows;
}

// family -> [colours of each row], for the shaders
export function paletteTables() {
  return Object.fromEntries(Object.entries(PALETTES).map(([family, set]) => [family, Object.values(set)]));
}
