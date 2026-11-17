// The blows of a fight (the rules are in lib/combat.js):
//   a Swing of the human (systems/player.js, systems/skills.js) hits every monster in front of it, within its range
//   and arc (or all around it, or only its target), with its power (times the damage, more when it is transformed:
//   systems/transform.js) and its stun. A hit monster
//   gets angry; at 0 HP it dies (a Kill event: systems/drops.js) and the human gets its experience (levels, points and
//   a skill point, full HP and MP on a level);
//   a MonsterBlow (systems/monsters.js) hits the human. At 0 HP the human dies for DEAD seconds (systems/player.js).
// Each blow sends a Damage event for the numbers on screen (systems/hud.js).
// With other players (systems/net.js): only the host changes the HP of the monsters. A guest shows its numbers at once
// and sends each blow to the host ('hit'); the host strikes the monster (it gets angry at that player) and, when it
// dies, tells that player ('kill'), who gets its experience and its potions. A monster of the host hits another player
// by a 'blow' message: that player's page sends the MonsterBlow, with its own defense.
import { query, getComponent, getResource, readEvents, sendEvent } from '../ecs/world.js';
import { Monster, Player, Health, Stats, Mana, Form } from '../components.js';
import { Bestiary, Skillbook, Net, runsMonsters } from '../resources.js';
import { Swing, MonsterBlow, Damage, Kill } from '../events.js';
import { blow, damageOf, defenseOf, gainXp, maxHp, maxMp } from '../lib/combat.js';

const DEAD = 3;      // seconds before the human stands up again
const SHOWN = 6;     // seconds the HP bar of a hit monster stays

export function combatSystem(world) {
  const swings = readEvents(world, Swing), blows = readEvents(world, MonsterBlow);
  const human = query(world, [Player, Health, Stats])[0];
  if ((!swings.length && !blows.length) || human === undefined) return;
  const p = getComponent(world, human, Player), life = getComponent(world, human, Health), s = getComponent(world, human, Stats);
  const clipTime = (clips, state, fps) => (clips[state].length - 1) / fps;
  const net = getResource(world, Net), host = runsMonsters(net);

  // transformed (systems/transform.js), it hits harder
  const boost = getComponent(world, human, Form)?.phase === 'on' ? getResource(world, Skillbook).transform.power : 1;
  for (const { x, z, rot, range, arc, power = 1, target = null, around = false, stun = 0 } of swings) {
    const [min, max] = damageOf(s), damage = [Math.round(min * power * boost), Math.round(max * power * boost)];
    for (const e of query(world, [Monster, Health])) {
      const m = getComponent(world, e, Monster), health = getComponent(world, e, Health);
      if (m.mode === 'dead' || (target !== null && e !== target)) continue;
      // in front of the human: within range (to the edge of the monster) and within the arc (a target or a blow all
      // around: only the range)
      const dx = m.x - x, dz = m.z - z, d = Math.hypot(dx, dz);
      if (d > range + m.radius) continue;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - rot), Math.cos(Math.atan2(dx, dz) - rot)));
      if (target === null && !around && d > m.radius && off > (arc * Math.PI) / 360) continue;
      const amount = blow({ level: s.level, damage }, m.type);
      sendEvent(world, Damage, { x: m.x, y: m.y + m.foot + m.height, z: m.z, amount, human: false });
      if (!host) {
        // a guest: the host strikes it; its bar goes down here at once
        m.shown = SHOWN;
        net.outbox.push({ t: 'hit', to: net.host, m: m.net, amount, stun });
        if (amount !== null) health.hp = Math.max(0, health.hp - amount);
        continue;
      }
      if (strike(world, e, amount, stun, null)) killed(world, e);
    }
  }

  for (const { monster } of blows) {
    const m = getComponent(world, monster, Monster);
    if (host && m?.target != null) { net.outbox.push({ t: 'blow', to: m.target, m: m.net }); continue; }   // another player
    if (!m || p.dead > 0) continue;
    const amount = blow(m.type, { level: s.level, defense: defenseOf(s) });
    sendEvent(world, Damage, { x: p.x, y: p.y + 1.1, z: p.z, amount, human: true });
    if (amount === null) continue;
    life.hp = Math.max(0, life.hp - amount);
    if (life.hp <= 0) p.dead = DEAD;
    else if (!p.attack.hit) p.hurt = clipTime(p.clips, 'hit', p.fps);
  }
}

// a blow on a monster (amount null: a miss) by `by` (null: the human of this page, else the number of another player):
// a calm monster gets angry at it; true when the blow kills it
export function strike(world, e, amount, stun, by) {
  const m = getComponent(world, e, Monster), health = getComponent(world, e, Health);
  if (!m || m.mode === 'dead') return false;
  m.shown = SHOWN;
  if (m.mode === 'calm') { m.mode = 'angry'; m.goal = null; m.target = by; }
  if (amount === null) return false;
  if (stun) m.stun = stun;
  health.hp = Math.max(0, health.hp - amount);
  if (health.hp > 0) {
    if (m.swing === null) m.hurt = (m.clips.hit.length - 1) / m.fps;
    return false;
  }
  m.mode = 'dead'; m.swing = null; m.shown = 0; m.stun = 0;
  return true;
}

// the human of this page killed the monster e: a Kill event (its potions, systems/drops.js; the quests) and its
// experience
export function killed(world, e) {
  const human = query(world, [Player, Stats])[0], m = getComponent(world, e, Monster);
  if (human === undefined || !m) return;
  sendEvent(world, Kill, { monster: e, x: m.x, z: m.z, y: m.y });
  if (gainXp(getComponent(world, human, Stats), m.type.xp, getResource(world, Bestiary).levels)) leveled(world, human);
}

// the human passed a level (lib/combat.js gainXp): its HP and MP grow and fill, and a text says its level
export function leveled(world, human) {
  const p = getComponent(world, human, Player), s = getComponent(world, human, Stats), life = getComponent(world, human, Health);
  const mana = getComponent(world, human, Mana);
  life.max = maxHp(s);
  life.hp = life.max;
  if (mana) { mana.max = maxMp(s); mana.mp = mana.max; }
  sendEvent(world, Damage, { x: p.x, y: (p.y ?? 0) + 1.3, z: p.z, text: `Level ${s.level}`, human: true });
}
