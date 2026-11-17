// A small Entity-Component-System.
//
//   entity     a number
//   component  plain data, stored per type (see components.js)
//   resource   one-of-a-kind data (see resources.js)
//   event      a message that lives until the end of the frame
//   system     a function (world) => void, run in a fixed order
//
// Change tracking: added(), removed() and changed() list what happened to a
// component type during the current frame; the lists are cleared after the
// last system runs.

export function defineComponent(name, defaults = () => ({})) {
  return { name, defaults };
}

export function createWorld() {
  return {
    nextId: 1,
    entities: new Set(),
    stores: new Map(),        // component type -> Map(entity -> data)
    queries: new Map(),       // key -> { all, none, members: Set }
    resources: new Map(),
    events: new Map(),        // event name -> array
    added: new Map(),         // component type -> Set(entity)
    removed: new Map(),       // component type -> Map(entity -> data)
    changed: new Map(),       // component type -> Set(entity)
    startup: [],
    update: [],
  };
}

// ---------------------------------------------------------------- entities
export function createEntity(world) {
  const e = world.nextId++;
  world.entities.add(e);
  return e;
}

export function destroyEntity(world, e) {
  if (!world.entities.has(e)) return;
  for (const [type, store] of world.stores) if (store.has(e)) removeComponent(world, e, type);
  world.entities.delete(e);
}

export function spawn(world, ...pairs) {
  const e = createEntity(world);
  for (const [type, data] of pairs) addComponent(world, e, type, data);
  return e;
}

// ---------------------------------------------------------------- components
const storeOf = (world, type) => {
  if (!world.stores.has(type)) world.stores.set(type, new Map());
  return world.stores.get(type);
};
const setOf = (map, type) => {
  if (!map.has(type)) map.set(type, new Set());
  return map.get(type);
};

export function addComponent(world, e, type, data = {}) {
  const value = { ...type.defaults(), ...data };
  storeOf(world, type).set(e, value);
  setOf(world.added, type).add(e);
  updateQueries(world, e, type);
  return value;
}

export function removeComponent(world, e, type) {
  const store = world.stores.get(type);
  if (!store || !store.has(e)) return;
  if (!world.removed.has(type)) world.removed.set(type, new Map());
  world.removed.get(type).set(e, store.get(e));
  store.delete(e);
  world.added.get(type)?.delete(e);
  updateQueries(world, e, type);
}

export const getComponent = (world, e, type) => world.stores.get(type)?.get(e);
export const hasComponent = (world, e, type) => !!world.stores.get(type)?.has(e);

export function markChanged(world, e, type) {
  setOf(world.changed, type).add(e);
}

// ---------------------------------------------------------------- queries
const matches = (world, e, all, none) =>
  all.every((t) => hasComponent(world, e, t)) && !none.some((t) => hasComponent(world, e, t));

function updateQueries(world, e, type) {
  for (const q of world.queries.values()) {
    if (!q.all.includes(type) && !q.none.includes(type)) continue;
    if (world.entities.has(e) && matches(world, e, q.all, q.none)) q.members.add(e);
    else q.members.delete(e);
  }
}

// Entities that have every type in `all` and none of `none`, in the order
// they started to match.
export function query(world, all, none = []) {
  const key = all.map((t) => t.name).join(',') + '|' + none.map((t) => t.name).join(',');
  let q = world.queries.get(key);
  if (!q) {
    q = { all, none, members: new Set() };
    for (const e of world.entities) if (matches(world, e, all, none)) q.members.add(e);
    world.queries.set(key, q);
  }
  return [...q.members];
}

// ---------------------------------------------------------------- change lists
export const added = (world, type) => [...(world.added.get(type) || [])].filter((e) => hasComponent(world, e, type));
export const removed = (world, type) => [...(world.removed.get(type) || new Map())];   // [entity, data]
export const changed = (world, type) => [...(world.changed.get(type) || [])].filter((e) => hasComponent(world, e, type));

// ---------------------------------------------------------------- resources
export const setResource = (world, key, value) => (world.resources.set(key, value), value);
export const getResource = (world, key) => world.resources.get(key);

// ---------------------------------------------------------------- events
export function sendEvent(world, name, payload = {}) {
  if (!world.events.has(name)) world.events.set(name, []);
  world.events.get(name).push(payload);
}
export const readEvents = (world, name) => world.events.get(name) || [];

// ---------------------------------------------------------------- schedule
export function addSystem(world, system, phase = 'update') {
  world[phase].push(system);
}

function endFrame(world) {
  world.added.clear();
  world.removed.clear();
  world.changed.clear();
  world.events.clear();
}

// Startup changes and events stay visible to the first frame.
export function runStartup(world) {
  for (const s of world.startup) s(world);
}

export function runFrame(world) {
  for (const s of world.update) s(world);
  endFrame(world);
}
