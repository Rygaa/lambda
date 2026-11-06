// Colour palettes of generated objects, by family. Each material role uses
// one family; an object picks one palette per family (recipe: "palette").
// A new palette is one more entry here: the shaders and materials are built
// from these tables. The first palette of a family is its default; `null`
// takes the colours exported from Blender (assets.json "palette").
//
//   stone:  flat tones { lit, up: top in shade, shade, hi: lit edge }
//   trunk, canopy: light ramps [[light value, colour], ...] (canopy is also the leaves)
//   water:  tones { deep, mid, shallow, foam, wave }, each [lit, in shade]
//   ground: light ramps of the ground paints (gen/ground.js); tile and furrow
//           are the lines drawn on pavement and fields

export const PALETTES = {
  stone: {
    grey: null,
    sand: { lit: '#e3c99a', up: '#9a7f62', shade: '#7d6553', hi: '#fff1d2' },
    moss: { lit: '#b7c28e', up: '#5f7a62', shade: '#4a6355', hi: '#eef5cf' },
    dark: { lit: '#9b98a6', up: '#4b4a5e', shade: '#3a3a4f', hi: '#d8d6e2' },
    cliff: { lit: '#b48c68', up: '#a07d60', shade: '#6a4e46', hi: '#e2c49c' },
    // buildings (gen/kinds/house.js) and palm trunks (gen/kinds/palm.js)
    pink: { lit: '#f6c8b0', up: '#d29a9c', shade: '#bc828c', hi: '#fff2e0' },
    roof: { lit: '#e0684c', up: '#a0485a', shade: '#86405a', hi: '#ffb48e' },
    white: { lit: '#f0e8d0', up: '#b4b8cc', shade: '#9ca2bc', hi: '#fffaea' },
    glass: { lit: '#6f8fc0', up: '#3d4c78', shade: '#323e68', hi: '#b4d0ee' },
    wood: { lit: '#ab7c58', up: '#6c5058', shade: '#5a4250', hi: '#e0b48a' },
    palm: { lit: '#c6a47c', up: '#7e6a6a', shade: '#685660', hi: '#efd6a8' },
    tile: { lit: '#c47a4a', up: '#7e4c48', shade: '#683e46', hi: '#f0ae78' },
    cream: { lit: '#f2dab0', up: '#bca08e', shade: '#a28688', hi: '#fff4dc' },
  },
  trunk: {
    brown: null,
    birch: [[0.0, '#8d8a86'], [0.1, '#e4ddd0']],
    dark: [[0.0, '#4e4038'], [0.1, '#7a6250']],
  },
  canopy: {
    green: null,
    autumn: [[0.0, '#7a3b2e'], [0.28, '#9a4a2f'], [0.4, '#bd6332'], [0.5, '#d9843a'], [0.6, '#e9a748'], [0.7, '#f3c862'], [0.8, '#fbe58c']],
    pine: [[0.0, '#1f4a3f'], [0.28, '#275645'], [0.4, '#2f644a'], [0.5, '#3d7651'], [0.6, '#4f8a59'], [0.7, '#68a163'], [0.8, '#86b86f']],
  },
  water: {
    clear: { deep: ['#2d6a93', '#25527a'], mid: ['#3b88a8', '#2e6a8c'], shallow: ['#5db3b6', '#44888f'], foam: ['#e2f6e6', '#a6cfc6'], wave: ['#9bdcd4', '#6aa8ad'] },
    swamp: { deep: ['#2c5444', '#22433a'], mid: ['#3c6b4d', '#2e5541'], shallow: ['#5f8b56', '#486e47'], foam: ['#d3e2a2', '#9fb682'], wave: ['#8db570', '#69905c'] },
    glacier: { deep: ['#3a78b8', '#2f5f99'], mid: ['#559fd2', '#447fb0'], shallow: ['#8ed2e2', '#6aa9c2'], foam: ['#f4fcff', '#c3dcea'], wave: ['#c6eef6', '#97c6dc'] },
  },
  ground: {
    grass: null,
    sand: [[0.0, '#b4987e'], [0.3, '#ceb08c'], [0.52, '#e2c8a0'], [0.76, '#f2deb6']],
    dirt: [[0.0, '#76605e'], [0.3, '#907060'], [0.52, '#a8866a'], [0.76, '#bc9a78']],
    pavement: [[0.0, '#868ea0'], [0.3, '#a0a8b6'], [0.52, '#b8bec8'], [0.76, '#d0d4da']],
    tile: [[0.0, '#6c7486'], [0.3, '#828a9a'], [0.52, '#959caa'], [0.76, '#a8aebb']],
    field: [[0.0, '#6e5038'], [0.3, '#866246'], [0.52, '#9a7452'], [0.76, '#ac855e']],
    furrow: [[0.0, '#563e2c'], [0.3, '#6a4c36'], [0.52, '#7a5a40'], [0.76, '#8a684a']],
  },
};

// World colour themes (recipe "theme", or ?theme=<name> in the URL). `base`
// replaces the Blender colours (assets.json "palette") and the sky; the other
// keys replace palettes above by name, so recipes keep their palette names.
export const THEMES = {
  // Dragon Ball Z backgrounds: yellow-green grass, tan mesas with red-brown
  // walls and purple shade, a strong blue sky and a deep blue sea
  dbz: {
    base: {
      grass: [[0.0, '#3b8660'], [0.3, '#56a05a'], [0.52, '#86c058'], [0.76, '#bcd96c']],
      rock_lit: '#e0c08c', rock_up: '#a8826a', rock_shade: '#8a6066', rock_hi: '#fbe8c0',
      trunk: [[0.0, '#6a4a3e'], [0.1, '#a8744e']],
      canopy: [[0.0, '#1f5a4e'], [0.28, '#2a6e50'], [0.4, '#3b8652'], [0.5, '#52a052'], [0.6, '#72b856'], [0.7, '#9ccf5e'], [0.8, '#c8e478']],
      sprout: [[0.0, '#94a85a'], [0.5, '#e6f2a0']],
      leafdeco: [[0.0, '#2a7056'], [0.5, '#9ad468']],
      sky_top: '#5aa8e6', sky_horizon: '#c6e6ee',
    },
    stone: {
      sand: { lit: '#ecc890', up: '#b48a66', shade: '#8a6266', hi: '#fff0c8' },
      moss: { lit: '#b8c86a', up: '#6e8a5a', shade: '#6a6470', hi: '#eef4b8' },
      dark: { lit: '#a89cb0', up: '#5e5470', shade: '#463e5a', hi: '#dcd4e4' },
      cliff: { lit: '#e2b47c', up: '#b8865e', shade: '#9a5e4e', hi: '#f8dcaa' },
    },
    water: {
      clear: { deep: ['#2a64b0', '#21508f'], mid: ['#3a8cc8', '#2e70a6'], shallow: ['#5cc0d8', '#479cb4'], foam: ['#f4fbff', '#bcd8e8'], wave: ['#a8e4f0', '#7cbcd4'] },
    },
  },
  // Planet Namek: a green sky; the grass, every tree and the sea are blue;
  // pale mesas with lavender walls
  namek: {
    base: {
      grass: [[0.0, '#355e8e'], [0.3, '#4274a8'], [0.52, '#5690c4'], [0.76, '#80b4dc']],
      rock_lit: '#d8d0b0', rock_up: '#8e8aa2', rock_shade: '#6e6a8a', rock_hi: '#f4eed8',
      trunk: [[0.0, '#3e4a48'], [0.1, '#6e7c6a']],
      canopy: [[0.0, '#1c2e5a'], [0.28, '#22386a'], [0.4, '#2a467c'], [0.5, '#34588e'], [0.6, '#4670a6'], [0.7, '#5e8cbc'], [0.8, '#84aed0']],
      sprout: [[0.0, '#5a82a8'], [0.5, '#cce4f4']],
      leafdeco: [[0.0, '#2a4c7a'], [0.5, '#86b8e0']],
      sky_top: '#5cc048', sky_horizon: '#d4ec9a',
    },
    stone: {
      sand: { lit: '#e4dcb8', up: '#aaa48c', shade: '#7e7890', hi: '#fbf6e0' },
      moss: { lit: '#a4bcd8', up: '#5e7096', shade: '#5e6680', hi: '#e0ecf8' },
      dark: { lit: '#8c96b0', up: '#4e5878', shade: '#3c4462', hi: '#d0d8e8' },
      cliff: { lit: '#ddd4b2', up: '#a49ab4', shade: '#8a7ea0', hi: '#f6f0d8' },
    },
    canopy: {
      pine: [[0.0, '#1a2a50'], [0.28, '#203462'], [0.4, '#283f72'], [0.5, '#304e84'], [0.6, '#3e6298'], [0.7, '#527cb0'], [0.8, '#709cc8']],
      autumn: [[0.0, '#22305e'], [0.28, '#2a3c70'], [0.4, '#344c84'], [0.5, '#406098'], [0.6, '#5076ac'], [0.7, '#6890c0'], [0.8, '#8cb0d4']],
    },
    water: {
      clear: { deep: ['#24508e', '#1d4278'], mid: ['#2f66a8', '#27568e'], shallow: ['#4a86c0', '#3c70a4'], foam: ['#eef6ff', '#b8cce4'], wave: ['#9cc4ec', '#7aa4d0'] },
      swamp: { deep: ['#1e3c70', '#18325e'], mid: ['#284e88', '#204072'], shallow: ['#3e6aa4', '#32588a'], foam: ['#dce8f8', '#a8bcd8'], wave: ['#86aedc', '#6a90c0'] },
    },
  },
};

// the Blender colours and the sky, with a theme (THEMES name, or null) on top
export function themeBase(blender, sky, theme) {
  return { ...blender, ...sky, ...THEMES[theme]?.base };
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

// the full tables, with the Blender colours (themeBase) filled in and the
// palettes of the theme swapped in (for the shaders)
export function paletteTables(blender, theme = null) {
  const fill = { stone: { lit: blender.rock_lit, up: blender.rock_up, shade: blender.rock_shade, hi: blender.rock_hi },
    trunk: blender.trunk, canopy: blender.canopy, ground: blender.grass };
  const out = {};
  for (const [family, set] of Object.entries(PALETTES))
    out[family] = Object.entries(set).map(([name, v]) => THEMES[theme]?.[family]?.[name] ?? v ?? fill[family]);
  return out;
}
