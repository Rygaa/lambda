// Event names. Events live until the end of the frame they are sent in.

export const FootprintChanged = 'FootprintChanged';
// { x, z, r }

// a blow of the human, on the hit frame of its attack clip (systems/player.js -> systems/combat.js):
// where it stands and faces, how far and how wide it hits (character.json attackRange, attackArc); the skills send
// it too (systems/skills.js): power (times the damage), target (only this monster, wherever it is within range),
// around (every monster within range), stun (seconds the monster hit cannot move or hit)
export const Swing = 'Swing';
// { x, z, rot, range, arc, power = 1, target = null, around = false, stun = 0 }

// a monster died (systems/combat.js -> systems/drops.js): where, and the entity
export const Kill = 'Kill';
// { monster, x, z, y }

// a blow of a monster at the human, on the hit frame of its attack clip (systems/monsters.js -> systems/combat.js)
export const MonsterBlow = 'MonsterBlow';
// { monster: entity }

// a blow that landed or missed, for the damage numbers (systems/combat.js -> systems/hud.js)
export const Damage = 'Damage';
// { x, y, z, amount (null: a miss), human: true when the human is hit } or { x, y, z, text, human, kind }
//   (a text: a new level, a potion picked or drunk, a skill that cannot start; kind: its colour class)
