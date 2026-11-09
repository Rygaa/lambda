// The fight on screen, in HTML over the canvas (#hud in index.html):
//   over each monster that was hit lately or is angry: its name, its level, and an HP bar;
//   the damage numbers (Damage events, systems/combat.js): they jump up and fade, "miss" for a miss;
//   at the bottom left: the level, HP and experience of the human, its STR and STA, and a + button for each one
//   while it has points to spend (lib/combat.js: STR gives damage, STA gives HP and defense).
// A point on the ground is placed on the screen like the fine pass draws it (render/shaders.js FINE_VERT).
import * as THREE from 'three';
import { query, getComponent, getResource, setResource, readEvents } from '../ecs/world.js';
import { Monster, Player, Health, Stats } from '../components.js';
import { Gpu, Settings, ActiveView, Time, Bestiary, Hud } from '../resources.js';
import { Damage } from '../events.js';
import { maxHp } from '../lib/combat.js';

const RISE = 0.7, LIFE = 1.1;   // a damage number goes this high (world units) in this many seconds

export function setupHudSystem(world) {
  const el = document.getElementById('hud');
  el.innerHTML = `<div class="me" hidden><b class="lv"></b><div class="bar hp"><i></i><span></span></div>
    <div class="bar xp"><i></i><span></span></div><div class="stat"><span>STR</span><b data-k="str"></b><button data-k="str">+</button></div>
    <div class="stat"><span>STA</span><b data-k="sta"></b><button data-k="sta">+</button></div><small class="pts"></small></div>`;
  const hud = { el, me: el.querySelector('.me'), bars: new Map(), floats: [], spend: [] };
  for (const button of el.querySelectorAll('button')) button.addEventListener('click', (e) => { hud.spend.push(button.dataset.k); e.currentTarget.blur(); });
  setResource(world, Hud, hud);
}

export function hudSystem(world) {
  const hud = getResource(world, Hud), gpu = getResource(world, Gpu), dt = getResource(world, Time).dt;
  if (!gpu.fine) return;
  const canvas = getResource(world, Settings).canvas, camera = getResource(world, ActiveView).camera, u = gpu.fine.uniforms;
  const v = new THREE.Vector3();
  // a world point -> CSS pixels on the page
  const place = (el, x, y, z) => {
    v.set(x, y, z).project(camera);
    const sx = ((v.x * 0.5 + 0.5) * u.uLowSize.value.x - 1 - u.uOffset.value.x) * u.uScale.value + u.uMargin.value.x;
    const sy = ((v.y * 0.5 + 0.5) * u.uLowSize.value.y - 1 - u.uOffset.value.y) * u.uScale.value + u.uMargin.value.y;
    el.style.transform = `translate(${(sx / u.uScreen.value.x) * canvas.clientWidth}px, ${(1 - sy / u.uScreen.value.y) * canvas.clientHeight}px)`;
  };

  // the bars over the monsters
  const seen = new Set();
  for (const e of query(world, [Monster, Health])) {
    const m = getComponent(world, e, Monster), h = getComponent(world, e, Health);
    if (m.mode === 'dead' || (m.mode !== 'angry' && m.shown <= 0)) continue;
    seen.add(e);
    let bar = hud.bars.get(e);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'mbar';
      bar.innerHTML = '<span></span><div class="bar"><i></i></div>';
      bar.querySelector('span').textContent = `${m.type.name} · ${m.type.level}`;
      hud.el.append(bar);
      hud.bars.set(e, bar);
    }
    bar.querySelector('i').style.width = `${(100 * h.hp) / h.max}%`;
    place(bar, m.x, m.y + m.foot + m.height + 0.15, m.z);
  }
  for (const [e, bar] of hud.bars) if (!seen.has(e)) { bar.remove(); hud.bars.delete(e); }

  // the damage numbers
  for (const { x, y, z, amount, text, human } of readEvents(world, Damage)) {
    const el = document.createElement('div');
    el.className = 'float' + (text ? ' level' : amount === null ? ' miss' : human ? ' hurt' : '');
    el.textContent = text ?? (amount === null ? 'miss' : amount);
    hud.el.append(el);
    hud.floats.push({ el, x: x + (Math.random() - 0.5) * 0.3, y, z, t: 0 });
  }
  hud.floats = hud.floats.filter((f) => {
    f.t += dt;
    if (f.t >= LIFE) { f.el.remove(); return false; }
    place(f.el, f.x, f.y + RISE * Math.sqrt(f.t / LIFE), f.z);
    f.el.style.opacity = Math.min(1, 2 * (1 - f.t / LIFE));
    return true;
  });

  // the human: spend points, then show its numbers
  const human = query(world, [Player, Health, Stats])[0];
  hud.me.hidden = human === undefined;
  if (human === undefined) return;
  const s = getComponent(world, human, Stats), h = getComponent(world, human, Health);
  for (const k of hud.spend.splice(0)) {
    if (s.points <= 0) break;
    s.points--;
    s[k]++;
    const max = maxHp(s);
    h.hp += max - h.max;
    h.max = max;
  }
  const { need } = getResource(world, Bestiary).levels, next = need[s.level - 1];
  const me = hud.me;
  me.querySelector('.lv').textContent = `Lv ${s.level}`;
  me.querySelector('.hp i').style.width = `${(100 * h.hp) / h.max}%`;
  me.querySelector('.hp span').textContent = `${Math.ceil(h.hp)} / ${h.max}`;
  me.querySelector('.xp i').style.width = next ? `${(100 * s.xp) / next}%` : '100%';
  me.querySelector('.xp span').textContent = next ? `${s.xp} / ${next} xp` : 'max level';
  me.querySelector('b[data-k="str"]').textContent = s.str;
  me.querySelector('b[data-k="sta"]').textContent = s.sta;
  me.querySelector('.pts').textContent = s.points ? `${s.points} points` : '';
  me.classList.toggle('spend', s.points > 0);
}
