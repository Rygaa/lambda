// Event names. Events live until the end of the frame they are sent in.

export const FootprintChanged = 'FootprintChanged';
// { x, z, r }

// a blow of the human, on the hit frame of its attack clip (systems/player.js -> systems/combat.js):
// where it stands and faces, how far and how wide it hits (character.json attackRange, attackArc)
export const Swing = 'Swing';
// { x, z, rot, range, arc }

// a blow of a monster at the human, on the hit frame of its attack clip (systems/monsters.js -> systems/combat.js)
export const MonsterBlow = 'MonsterBlow';
// { monster: entity }

// a blow that landed or missed, for the damage numbers (systems/combat.js -> systems/hud.js)
export const Damage = 'Damage';
// { x, y, z, amount (null: a miss), human: true when the human is hit }
