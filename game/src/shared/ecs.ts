// A small strict ECS, used the same way by the server and the client.
// - An entity is only a number.
// - A component is plain data (no methods, no three.js objects), kept in one store per component type.
// - All the logic is in systems: functions that run in a fixed order on the world.

export type Entity = number;

export class Store<T> {
  readonly data = new Map<Entity, T>();
  constructor(readonly name: string) {}
  get(entity: Entity) {
    return this.data.get(entity);
  }
  has(entity: Entity) {
    return this.data.has(entity);
  }
  set(entity: Entity, value: T) {
    this.data.set(entity, value);
    return value;
  }
  delete(entity: Entity) {
    this.data.delete(entity);
  }
  entities() {
    return this.data.keys();
  }
  get size() {
    return this.data.size;
  }
}

export type System<C> = (world: World, context: C) => void;

export class World {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores: Store<unknown>[] = [];
  // Entities destroyed since the last call to takeDestroyed (the server sends them to the clients).
  private destroyed: Entity[] = [];

  store<T>(name: string): Store<T> {
    const store = new Store<T>(name);
    this.stores.push(store as Store<unknown>);
    return store;
  }

  // id: the client creates its copies of server entities with the server id.
  create(id?: Entity): Entity {
    const entity = id ?? this.nextId++;
    if (id !== undefined && id >= this.nextId) this.nextId = id + 1;
    this.alive.add(entity);
    return entity;
  }

  exists(entity: Entity) {
    return this.alive.has(entity);
  }

  destroy(entity: Entity) {
    if (!this.alive.delete(entity)) return;
    for (const store of this.stores) store.delete(entity);
    this.destroyed.push(entity);
  }

  takeDestroyed() {
    const list = this.destroyed;
    this.destroyed = [];
    return list;
  }

  // Entities that have every one of these components. Iterates the smallest store.
  *query(...stores: Store<unknown>[]): Generator<Entity> {
    let smallest = stores[0]!;
    for (const store of stores) if (store.size < smallest.size) smallest = store;
    for (const entity of [...smallest.entities()]) {
      if (stores.every((store) => store.has(entity))) yield entity;
    }
  }

  get count() {
    return this.alive.size;
  }
}
