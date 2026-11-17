// The rules of the skills (assets/character/player/skills.json): which skill can start now, and how hard it hits.
// systems/skills.js plays them.

// what the human holds: a sword (a weapon file item_weasw..., one or two hands) or a shield (not with a weapon held
// with both hands). outfit: slot -> file (the Wardrobe resource); slots: items.json slots
export function holds(outfit, slots, need) {
  if (need === 'sword') return /^item_weasw/.test(outfit.weapon ?? '');
  if (need === 'shield') return !!outfit.shield && !slots.weapon.find((w) => w.file === outfit.weapon)?.bothHands;
  return true;
}

// why the skill cannot start now (a short text for the screen), or null: it can
export function whyNot(skill, { levels, cooldowns }, outfit, slots, mp) {
  if (!levels[skill.id]) return 'not learned';
  if (!holds(outfit, slots, skill.needs)) return `needs a ${skill.needs}`;
  if (cooldowns[skill.id] > 0) return 'not ready';
  if (mp < skill.mp) return 'no MP';
  return null;
}

// the power of a step at a skill level: perLevel more for each level after the first
export const powerOf = (book, step, level) => step.power * (1 + book.perLevel * (level - 1));
