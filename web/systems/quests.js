// The quests (assets/quests/quests.json, the Quests resource). A person of npcs.json gives a quest; when the human talks
// to it (systems/npcs.js sets Quests.talk), the talk window shows what it says now:
//   the quest not started: the lines of its first step (talk), and a button that starts it;
//   a talk step: its lines, and a button that goes to the next step;
//   a kill step: while not done, its waiting lines; once done, the talk goes on with the next step;
//   a goal step: its waiting lines.
// A kill step counts the monsters of its id the human kills (the Kill event of systems/combat.js). While a quest runs,
// its title and its step are shown at the top left. The state is not saved: a reload starts again.
import { getComponent, getResource, readEvents } from '../ecs/world.js';
import { Monster } from '../components.js';
import { Input, Npcs, Quests } from '../resources.js';
import { Kill } from '../events.js';

let ui = null;

export function setupQuestSystem() {
  const talk = document.createElement('div');
  talk.id = 'talk';
  talk.hidden = true;
  talk.innerHTML = '<header><b></b><button data-close>×</button></header><div class="lines"></div><footer><button data-next></button></footer>';
  const tracker = document.createElement('div');
  tracker.id = 'quest';
  tracker.hidden = true;
  document.body.append(talk, tracker);
  ui = { talk, tracker, drawn: -1, next: null };
  talk.querySelector('[data-close]').addEventListener('click', () => { talk.hidden = true; });
  talk.querySelector('[data-next]').addEventListener('click', () => { ui.next?.(); });
}

export function questSystem(world) {
  const q = getResource(world, Quests), input = getResource(world, Input);
  // the monsters killed: they count for each kill step that runs
  for (const { monster } of readEvents(world, Kill)) {
    const id = getComponent(world, monster, Monster)?.type.id;
    for (const [name, s] of Object.entries(q.state)) {
      const step = q.quests[name].steps[s.step];
      if (step?.kill && step.kill.id === id && s.count < step.kill.count) { s.count++; q.version++; }
    }
  }
  if (q.talk) { open(world, q, q.talk); q.talk = null; }
  if (!ui.talk.hidden && input.pressed.some(({ key }) => key === 'Escape')) ui.talk.hidden = true;
  if (ui.drawn !== q.version) { ui.drawn = q.version; drawTracker(q, getResource(world, Npcs).people); }
}

// the talk with the person `npc`: what it says for the first of its quests that is not over
function open(world, q, npc) {
  const name = getResource(world, Npcs).people[npc].name;
  const quest = Object.keys(q.quests).find((id) => q.quests[id].npc === npc && (q.state[id]?.step ?? 0) < q.quests[id].steps.length);
  if (!quest) return show(name, ['Thank you for your help!'], 'Bye', null);
  const { steps } = q.quests[quest], s = q.state[quest];
  const go = (step) => { q.state[quest] = { step, count: 0 }; q.version++; };
  if (!s) return show(name, steps[0].talk, steps[0].button, () => go(1));
  const step = steps[s.step];
  if (step.talk) return show(name, step.talk, step.button, () => go(s.step + 1));
  if (step.kill && s.count >= step.kill.count) {
    go(s.step + 1);
    return open(world, q, npc);
  }
  return show(name, step.waiting, 'OK', null);
}

// shows the lines of `name`; the button closes the window after `then`
function show(name, lines, button, then) {
  ui.talk.querySelector('b').textContent = name;
  ui.talk.querySelector('.lines').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  ui.talk.querySelector('[data-next]').textContent = button;
  ui.next = () => { ui.talk.hidden = true; then?.(); };
  ui.talk.hidden = false;
}

function drawTracker(q, people) {
  const rows = Object.entries(q.state).map(([id, s]) => {
    const quest = q.quests[id], step = quest.steps[s.step];
    if (!step) return null;
    const text = step.kill ? (s.count >= step.kill.count ? `Go back to ${people[quest.npc].name}` : (step.kill.count > 1 ? `${step.goal}: ${s.count} / ${step.kill.count}` : step.goal))
      : step.goal ?? `Talk to ${people[quest.npc].name}`;
    return `<b>${quest.title}</b><span>${text}</span>`;
  }).filter(Boolean);
  ui.tracker.innerHTML = rows.join('');
  ui.tracker.hidden = !rows.length;
}
