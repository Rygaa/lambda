// The rules of a fight, in one place: the stats of the human (STR and STA), its damage, its HP, the chance to hit,
// and the experience that gives levels and stat points (assets/monsters/levels.json, from FlyFF data/exp.ron).
// A monster has its own numbers (assets/monsters/monsters.json): hp, damage [min, max], defense, level, xp.

// the stats of a new human; each level gives the points of levels.json and one skill point (systems/skills.js)
export const START = { level: 1, xp: 0, str: 15, sta: 15, points: 0, skillPoints: 0 };

// STA: 5 HP and half a point of defense each
export const maxHp = (s) => 100 + 10 * s.level + 5 * s.sta;
export const defenseOf = (s) => Math.floor(s.sta / 2);
// MP: 50, and 5 more each level; the skills cost it (assets/character/player/skills.json)
export const maxMp = (s) => 50 + 5 * s.level;
export const MP_REGEN = 1;   // MP a second
// STR: 2 damage each, ±10 %
export const damageOf = (s) => { const d = 2 * s.str + 2 * s.level; return [Math.round(d * 0.9), Math.round(d * 1.1)]; };

// the chance to hit: 95 %, 4 % less for each level the target is above the attacker, at least 40 %
export const hitChance = (attacker, target) => Math.min(0.95, Math.max(0.4, 0.95 - 0.04 * (target - attacker)));

// one blow: null (a miss), or the damage after defense (at least 1). random: a function () -> [0, 1)
export function blow({ level, damage: [min, max] }, target, random = Math.random) {
  if (random() >= hitChance(level, target.level)) return null;
  return Math.max(1, Math.round(min + random() * (max - min) - target.defense));
}

// experience: the human gets xp; each level it passes gives its points and a skill point, and fills its HP and MP (in
// the caller).
// need[i]: the experience from level i + 1 to i + 2; points[i]: the points of reaching level i + 1. Returns the levels gained
export function gainXp(s, xp, { need, points }) {
  let gained = 0;
  s.xp += xp;
  while (s.level - 1 < need.length && s.xp >= need[s.level - 1]) {
    s.xp -= need[s.level - 1];
    s.level++;
    s.points += points[s.level - 1] ?? 0;
    s.skillPoints = (s.skillPoints ?? 0) + 1;
    gained++;
  }
  return gained;
}
