// The transformation of the human (skills.json transform, the Form component), like Super Saiyan in Dragon Ball. It
// opens at level `level`: its gold form is made then (lib/form.js goldForm), and again after each new outfit or look.
// Its key (G) starts it when it has the MP: the human plays its power-up clip (character.json powerup) without moving
// while the gold aura grows (systems/aura.js), in its gold form from the start: its hair (lib/superHair.js) shakes,
// lifts a little and flickers gold; when its arms open (burst: seconds of the clip) comes the burst: a white flash, a
// ring of cubes, and its hair stands up in gold spikes (hairOf); the clip plays on to its end, then it can move. Transformed, it hits harder (systems/combat.js), walks and runs
// faster (systems/player.js) and loses MP each second; the key again, no MP left, or death ends it, and its cooldown
// starts. Its slot in the skill bar shows the level it needs, its MP, or its cooldown.
import { query, getComponent, getResource, sendEvent } from '../ecs/world.js';
import { Player, Form, Stats, Mana, Skills } from '../components.js';
import { Input, Time, Wardrobe, Skillbook, Gpu } from '../resources.js';
import { Damage } from '../events.js';
import { goldForm, wear } from '../lib/form.js';

const AURA = { charge: [0.25, 1], burst: [1.5, 1.5], on: [0.8, 0.8] };   // the aura at the start and the end of each phase

let ui = null;        // its slot in the skill bar, and the flash over the screen

export function setupTransformSystem(world) {
  const T = getResource(world, Skillbook).transform, bar = document.getElementById('skillbar');
  if (!T || !bar) return;
  const slot = document.createElement('div');
  slot.className = 'sk form';
  slot.innerHTML = `<b>${T.key.toUpperCase()}</b><span>${T.name}</span><small></small><i></i>`;
  bar.insertBefore(slot, bar.querySelector('.pot'));
  const flash = document.createElement('div');
  flash.id = 'flash';
  document.body.append(flash);
  ui = { slot, flash, said: 0 };
}

export function transformSystem(world) {
  const e = query(world, [Player, Form, Stats, Mana])[0];
  if (e === undefined || !ui) return;
  const T = getResource(world, Skillbook).transform, w = getResource(world, Wardrobe), dt = getResource(world, Time).dt;
  const input = getResource(world, Input), gpu = getResource(world, Gpu);
  const p = getComponent(world, e, Player), f = getComponent(world, e, Form), s = getComponent(world, e, Stats), mana = getComponent(world, e, Mana);
  const sk = getComponent(world, e, Skills);
  const say = (text, kind = 'note') => {
    if (performance.now() - ui.said < 600) return;
    ui.said = performance.now();
    sendEvent(world, Damage, { x: p.x, y: (p.y ?? 0) + 1.3, z: p.z, text, human: true, kind });
  };
  const open = s.level >= T.level;

  // the gold form: made when it opens, made again for a new outfit or look
  if (open && w.dressed && f.normal !== w.dressed && !f.busy) {
    if (f.gold) f.gold.forget();
    const normal = w.dressed;
    f.normal = normal; f.gold = null; f.busy = true;
    goldForm(world, normal).then((g) => { if (f.normal === normal) f.gold = g; else if (g) g.forget(); f.busy = false; },
      (err) => { console.error(err); f.busy = false; });
  }
  if (open && !f.told) { f.told = true; say(`${T.name} open: ${T.key.toUpperCase()}`, 'level'); }

  f.cooldown = Math.max(0, f.cooldown - dt);
  f.flash = Math.max(0, f.flash - dt * 2);
  const end = () => { f.phase = null; f.act = null; f.cooldown = T.cooldown; f.aura = 0; };
  if (p.dead > 0 && f.phase) end();

  if (input.pressed.some(({ key }) => key.toLowerCase() === T.key) && p.dead <= 0) {
    if (f.phase === 'on') end();
    else if (!f.phase) {
      const why = !open ? `level ${T.level}` : f.cooldown > 0 ? 'not ready' : mana.mp < T.mp ? 'no MP' : sk?.active || p.jump.air || p.jump.crouch ? '' : null;
      if (why) say(why);
      else if (why === null) { mana.mp -= T.mp; f.phase = 'charge'; f.t = 0; f.act = { clip: 'powerup', t: 0 }; }
    }
  }

  // the power-up clip plays to its end (it melts into idle), the burst comes on its way (T.burst)
  if (f.act) {
    f.act.t += dt * T.rate;
    if (f.act.t >= (p.clips.powerup.length - 1) / p.fps) f.act = null;
  }
  if (f.phase === 'charge') {
    f.t = f.act.t;
    if (f.t >= T.burst) { f.phase = 'burst'; f.t = 0; f.flash = 1; }
  } else if (f.phase === 'burst') {
    f.t += dt;
    if (f.t >= T.flicker) { f.phase = 'on'; f.t = 0; }
  } else if (f.phase === 'on') {
    f.t += dt;
    mana.mp -= T.drain * dt;
    if (mana.mp <= 0) { mana.mp = 0; end(); }
  }
  if (f.phase) {
    const [a, b] = AURA[f.phase], k = f.phase === 'charge' ? f.t / T.burst : f.phase === 'burst' ? f.t / T.flicker : 0;
    f.aura = a + (b - a) * Math.min(1, k);
  }

  // the form it shows: gold from the start of the power-up, its hair as far as it has turned
  f.clock = (f.clock ?? 0) + dt;
  if (f.gold) f.gold.bend(hairOf(f, T));
  const want = f.gold && f.phase ? f.gold : w.dressed;
  if (want && p.meshes !== want.meshes) { wear(p, want); gpu.shadowsDirty = true; }

  drawUi(T, f, open, mana);
}

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// how far the hair of the gold form has turned (lib/superHair.js pose): while the power-up charges it shakes, lifts a
// little and flickers gold; at the burst it stands up gold in a blink (a little too far, then back); then it stays
function hairOf(f, T) {
  const time = f.clock;
  if (f.phase === 'charge') {
    const k = f.t / T.burst, flick = k > 0.35 ? (Math.sin(time * 37) > 0.55 ? 0.9 : 0.15) * sm(0.35, 0.95, k) : 0;
    return { lift: 0.2 * sm(0.3, 1, k), shake: sm(0.3, 0.95, k), gold: flick, time };
  }
  if (f.phase === 'burst') {
    const t = f.t, back = Math.sin(Math.min(1, Math.max(0, (t - 0.12) / 0.4)) * Math.PI);
    return { lift: 0.2 + 0.8 * sm(0, 0.16, t) + 0.07 * back, shake: 1 - sm(0.05, 0.4, t), gold: sm(0, 0.12, t), time };
  }
  return f.phase === 'on' ? { lift: 1, shake: 0, gold: 1, time } : { lift: 0, shake: 0, gold: 0, time };
}

function drawUi(T, f, open, mana) {
  const { slot, flash } = ui;
  slot.classList.toggle('off', !f.phase && (!open || f.cooldown > 0 || mana.mp < T.mp));
  slot.classList.toggle('on', !!f.phase);
  slot.querySelector('small').textContent = !open ? `level ${T.level}` : f.phase ? 'transformed' : f.cooldown > 0 ? `${Math.ceil(f.cooldown)} s` : `${T.mp} MP`;
  slot.querySelector('i').style.height = `${(100 * f.cooldown) / T.cooldown}%`;
  flash.style.opacity = f.flash.toFixed(3);
}
