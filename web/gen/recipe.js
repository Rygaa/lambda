// World recipes (worlds/*.json) -> a world: borders, clearings, cliffs, then
// every recipe line scattered over the ground. See documentation/worlds.md for the fields.
import { createWorldBuilder, finish, discsOf } from './world.js';
import { paletteNames } from './palettes.js';
import { SIZES } from './assets.js';
import { buildCliffs, levelUnder, CLIFF_FIELDS } from './terrain.js';
import { SIDES, BORDER_KINDS, fromSide, wavyLine } from './borders.js';
import { createGround, paint, groundAt, pathShape, rectShape, circleShape, PAINTS, GROUND_FIELDS } from './ground.js';

// objects per 100 m² for each amount word
export const AMOUNTS = { none: 0, few: 0.3, some: 1, many: 2.5, lots: 6 };
const CLEARINGS = { none: 0, few: 2, some: 3, many: 4, lots: 4 };   // the shaders take at most 4

const WORLD_FIELDS = ['name', 'seed', 'size', 'theme', 'start', 'clouds', 'rays', 'borders', 'islands', 'clearings', 'cliffs', 'ground', 'props'];
// recipe "clouds": how much of the ground their shadows cover -> the CloudLayer edges (lo, hi)
export const CLOUDS = { none: [9, 10], few: [0.14, 0.2], some: [-0.05, 0.02] };
const LINE_FIELDS = ['asset', 'params', 'amount', 'count', 'palette', 'spacing', 'gap', 'near', 'avoid', 'on', 'at'];
const ISLAND_FIELDS = ['at', 'radius', 'bar', 'barWidth'];

// the asset types ('family/type') a recipe uses: they are loaded before it is built (gen/assets.js)
export function assetsOf(recipe) {
  const names = (recipe.props ?? []).map((line, i) => assetOf(line, `props[${i}]`).asset);
  if (Object.values(recipe.borders ?? {}).some((v) => (typeof v === 'string' ? v : v?.kind) === 'ocean')) names.push('water/ocean');
  return names;
}

// recipe line "asset": "family/type/size" -> { asset: 'family/type', size }
function assetOf(line, where) {
  if (typeof line.asset !== 'string') bad(where, 'no "asset": "family/type/size", for example "rock/sharp/small"');
  const parts = line.asset.split('/');
  if (parts.length !== 3 || !SIZES.includes(parts[2])) bad(where, `asset "${line.asset}": give family/type/size, with a size of ${SIZES.join(', ')}`);
  return { asset: `${parts[0]}/${parts[1]}`, size: parts[2] };
}

// recipe: the parsed JSON
export function buildRecipe(cache, recipe) {
  check(recipe, WORLD_FIELDS, 'world');
  const half = (recipe.size ?? 40) / 2;
  const b = createWorldBuilder(cache, recipe.seed ?? 1, half);
  const borders = planBorders(b, recipe.borders ?? {}, islandsOf(recipe.islands ?? []));
  const inBorder = (x, z, pad) => borders.some((bd) => bd.inside(x, z, pad));

  // clearings: open ground where light falls through the canopy; the player starts in the first
  const c = recipe.clearings ?? {};
  check(c, ['amount', 'count', 'radius', 'light'], 'clearings');
  const nClear = Math.min(4, c.count ?? CLEARINGS[c.amount ?? 'some'] ?? bad('clearings', `amount "${c.amount}"`));
  for (let tries = 0; b.glades.length < nClear && tries < 400; tries++) {
    const r = b.range(...(c.radius ?? [3, 3.6]));
    const x = b.range(-half * 0.7, half * 0.7), z = b.range(-half * 0.7, half * 0.7);
    if (b.glades.some((g) => Math.hypot(g.x - x, g.z - z) < g.r + r + 2) || inBorder(x, z, r + 2)) continue;
    b.glades.push({ x, z, r, k: b.range(...(c.light ?? [0.16, 0.2])) });
  }
  const g0 = b.glades[0];
  b.start = g0 ? [g0.x, 0.6, g0.z] : [0, 0.6, 0];
  if (recipe.start) b.start = [recipe.start[0], 0.6, recipe.start[1]];
  b.rays = recipe.rays ?? 1;     // strength of the god rays (0 = none)
  b.clouds = CLOUDS[recipe.clouds ?? 'some'] ?? bad('world', `clouds "${recipe.clouds}" (use ${Object.keys(CLOUDS).join(', ')})`);

  // cliffs: plateaus in levels, with stairs, and the mountain borders
  // (gen/terrain.js); the start stays on the ground
  if (recipe.cliffs || borders.some((bd) => bd.kind === 'mountains')) {
    const cl = recipe.cliffs ?? { count: 0 };
    check(cl, CLIFF_FIELDS, 'cliffs');
    for (const key of ['palette', 'stairs'])
      if (cl[key] !== undefined && !paletteNames('stone').includes(cl[key])) bad('cliffs', `${key}: stone palette "${cl[key]}" (known: ${paletteNames('stone').join(', ')})`);
    b.terrain = buildCliffs(b, cl, borders);
  }
  // the ocean borders: one water shape each, before anything else takes the room
  for (const bd of borders) if (bd.set) b.add(bd.set, 0, ...bd.set.shapes[0].origin, 0);
  if (recipe.ground) b.ground = buildGround(b, recipe.ground, borders);

  // big things first; lines placed "near" something come after the others
  const lines = (recipe.props ?? []).map((line, i) => prepare(b, line, i));
  lines.sort((p, q) => (!!p.line.near - !!q.line.near) || q.size - p.size);
  for (const l of lines) place(b, l);
  return finish(b);
}

// recipe "borders": { side: "mountains" | "ocean" | { kind, width } } -> [{ side, kind, inside(x, z, pad) }]
// inside: is (x, z) in the border, or less than pad from it? islands: cut out of every ocean
function planBorders(b, spec, islands) {
  if (typeof spec !== 'object' || Array.isArray(spec)) bad('borders', 'give { side: kind }, for example { "west": "mountains" }');
  check(spec, SIDES, 'borders');
  return Object.entries(spec).map(([side, value]) => {
    const { kind, width } = typeof value === 'string' ? { kind: value } : value;
    if (typeof value !== 'string') check(value, ['kind', 'width'], `borders.${side}`);
    if (!BORDER_KINDS.includes(kind)) bad('borders', `${side}: "${kind}" (use ${BORDER_KINDS.join(', ')})`);
    if (width !== undefined && kind !== 'ocean') bad('borders', `${side}: only the ocean takes a "width"`);
    if (kind === 'ocean') {
      const set = b.set('water/ocean', 'medium', { side, half: b.half, islands, ...(width !== undefined && { width }) });
      const shore = set.shapes[0].shore;
      return { side, kind, set, inside: (x, z, pad = 0) => shore(x, z) > -pad };
    }
    // mountains: in from the side as far as a wavy line, 6 to 10 units
    const line = wavyLine({ seed: Math.floor(b.rand() * 2 ** 31) }, [6, 10], [0.8, 1.6]);
    return { side, kind, line, inside(x, z, pad = 0) {
      const [e, along] = fromSide(side, b.half, x, z);
      return e < line(along) + pad;
    } };
  });
}

// recipe "islands": [{ at: [x, z], radius, bar: [x, z], barWidth }] -> the
// ocean's islands; bar: a sand bar from the island out to that point
function islandsOf(list) {
  return list.map((s, i) => {
    check(s, ISLAND_FIELDS, `islands[${i}]`);
    if (!Array.isArray(s.at)) bad(`islands[${i}]`, 'no "at": [x, z]');
    return { at: s.at, radius: s.radius ?? 6, bar: s.bar ?? null, barWidth: s.barWidth ?? 2.4 };
  });
}

// recipe "ground": paints laid on the grass in order (gen/ground.js)
//   { paint, beach: w }: along the ocean shores, w units in
//   { paint, path: [[x, z], ...], width }, { paint, rect: [x0, z0, x1, z1] }, { paint, circle: [x, z, r] }
function buildGround(b, lines, borders) {
  const g = createGround(b.half);
  lines.forEach((l, i) => {
    const where = `ground[${i}]`;
    check(l, GROUND_FIELDS, where);
    if (!PAINTS.includes(l.paint)) bad(where, `paint "${l.paint}" (use ${PAINTS.join(', ')})`);
    if (l.beach !== undefined) {
      for (const bd of borders) if (bd.set) {
        const shore = bd.set.shapes[0].shore;
        paint(g, l.paint, (x, z) => l.beach + shore(x, z));
      }
      return;
    }
    const s = l.path ? pathShape(l.path, l.width ?? 2) : l.rect ? rectShape(l.rect) : l.circle ? circleShape(l.circle)
      : bad(where, 'give "beach", "path", "rect" or "circle"');
    paint(g, l.paint, s.sd, s.box);
  });
  return g;
}

function prepare(b, line, i) {
  const where = `props[${i}] (${line.asset})`;
  check(line, LINE_FIELDS, where);
  const { asset, size } = assetOf(line, where);
  if (line.on !== undefined && line.on !== 'grass' && !PAINTS.includes(line.on)) bad(where, `on "${line.on}" (use grass, ${PAINTS.join(', ')})`);
  let set;
  try { set = b.set(asset, size, line.params); } catch (err) { bad(where, err.message); }
  const area = (2 * b.half) ** 2 / 100;
  const count = line.at ? line.at.length
    : line.count ?? Math.round(area * (AMOUNTS[line.amount ?? 'some'] ?? bad(where, `amount "${line.amount}" (use ${Object.keys(AMOUNTS).join(', ')})`)));
  return { line, where, set, count, palettes: palettesOf(set, line.palette, where), size: Math.max(...set.shapes.map((s) => s.radius)) };
}

// recipe "palette": a name, or a list of names (one is picked per object),
// of the asset type's palettes (gen/assets.js); none: its default
function palettesOf(set, value, where) {
  if (value === undefined) return null;
  const names = [value].flat();
  for (const name of names)
    if (!set.palettes[name]) bad(where, `palette "${name}" (${set.asset} has ${Object.keys(set.palettes).join(', ')})`);
  return names;
}

function place(b, { line, set, count, palettes }) {
  const paletteFor = () => (palettes ? b.pick(palettes) : set.palette);
  const variant = () => Math.floor(b.rand() * set.shapes.length);
  if (line.at) {
    for (const [x, z, rot = b.range(0, Math.PI * 2)] of line.at) b.add(set, variant(), x, z, rot, paletteFor());
    return;
  }
  // spacing: keep this far from the other spaced objects of the same type (e.g. tree crowns)
  const spaced = line.spacing ? b.props.filter((p) => p.asset === set.asset && p.spaced) : [];
  // near "cliffs": at the foot of a wall; "cliff-tops": on top, just behind its edge;
  // near a family ("water", "rock", "plant"): around the objects of that family
  const edges = b.terrain?.edges ?? [];
  const cliffs = { cliffs: 1, 'cliff-tops': -1 }[line.near];
  const near = !line.near || cliffs ? null : b.props.filter((p) => p.family === line.near);
  const spacing = line.spacing ?? 0, gap = line.gap ?? 0.3;
  for (let made = 0, tries = 0; made < count && tries < count * 60; tries++) {
    const v = variant();
    const shape = set.shapes[v];
    let x, z;
    if (cliffs) {
      if (!edges.length) return;
      // out from the wall (cliffs) or back from its edge (cliff-tops), a little to the side
      const e = b.pick(edges), d = cliffs * (shape.radius + b.range(0.35, 1.2)), side = b.range(-0.25, 0.25);
      x = e.x + e.nx * d + e.nz * side;
      z = e.z + e.nz * d - e.nx * side;
    } else if (near) {
      if (!near.length) return;
      // around a round object; along the shore of water (one of its circles)
      const t = b.pick(near), a = b.range(0, Math.PI * 2);
      const c = t.discs.length > 1 ? b.pick(t.discs) : t;
      const d = t.discs.length > 1 ? c.r + b.range(0.1, 0.9) : t.radius + b.range(1.2, 2.8);
      x = c.x + Math.cos(a) * d;
      z = c.z + Math.sin(a) * d;
    } else {
      x = b.range(-b.half, b.half);
      z = b.range(-b.half, b.half);
    }
    if (Math.abs(x) > b.half || Math.abs(z) > b.half) continue;
    // water (a shape of circles) is turned first, then each of its circles is tested
    const rot = shape.circles ? b.range(0, Math.PI * 2) : null;
    const discs = shape.circles ? discsOf(shape, { x, z, rot }) : [{ x, z, r: shape.radius }];
    if (line.avoid === 'clearings' && b.glades.some((g) => discs.some((c) => Math.hypot(g.x - c.x, g.z - c.z) < g.r * 0.95 + (shape.circles ? c.r : 0)))) continue;
    if (spacing && spaced.some((p) => Math.hypot(p.x - x, p.z - z) < spacing)) continue;
    // on: only on this ground (grass or a paint), all around it
    if (line.on && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => groundAt(b.ground, x + dx * shape.radius, z + dz * shape.radius, 0.4) !== line.on)) continue;
    // on flat ground only (not over a cliff edge or on stairs); water only on the lowest level
    if (b.terrain) {
      const levels = discs.map((c) => levelUnder(b.terrain, c.x, c.z, c.r + 0.3));
      if (levels.some((l) => l < 0 || l !== levels[0])) continue;
      if (levels[0] > 0 && shape.parts.some((part) => part.role === 'water')) continue;
    }
    if (!discs.every((c) => b.free(c.x, c.z, c.r + gap))) continue;
    const p = b.add(set, v, x, z, rot ?? b.range(0, Math.PI * 2), paletteFor());
    if (spacing) { p.spaced = true; spaced.push(p); }
    made++;
  }
}

function check(obj, fields, where) {
  for (const k of Object.keys(obj)) if (!fields.includes(k)) bad(where, `unknown field "${k}" (known: ${fields.join(', ')})`);
}

function bad(where, msg) {
  throw new Error(`world recipe, ${where}: ${msg}`);
}
