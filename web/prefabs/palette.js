// Every flat-coloured solid (the character and the slimes) shares one palette:
// material id CHAR_MID + index in SOLID_COLORS, role char_<colour>.
import { CHAR_PALETTE } from './character.js';
import { SLIME_PALETTE } from './slime.js';

export const SOLID_PALETTE = { ...CHAR_PALETTE, ...SLIME_PALETTE };
export const SOLID_COLORS = Object.keys(SOLID_PALETTE);
