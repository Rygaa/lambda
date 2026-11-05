// The render system: it reads the components of the client world and keeps a three.js object for each
// networked entity (the objects live in the system, not in components). Characters play their baked clips,
// monsters hop, squash, lunge and flash, items spin on the ground. Names and life bars are HTML labels.
import * as THREE from "three";
import type { PixelRenderer } from "../engine/renderer/index.ts";
import { CAMERA_FORWARD, PIXELS_PER_METER } from "../engine/renderer/index.ts";
import type { Entity } from "../shared/components.ts";
import type { System } from "../shared/ecs.ts";
import { createCharacter, type CharacterLibrary } from "./character.ts";
import type { ClientContext } from "./net.ts";

type View = {
  object: THREE.Object3D;
  update: (ctx: ClientContext, e: Entity) => void;
  label?: HTMLElement;
};

export function createRenderSystem(renderer: PixelRenderer, library: CharacterLibrary, labels: HTMLElement): System<ClientContext> {
  const views = new Map<Entity, View>();
  const itemMaterials = new Map<string, THREE.Material>();
  const cube = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const forward = new THREE.Vector3(...CAMERA_FORWARD).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const makeLabel = (cls: string) => {
    const el = document.createElement("div");
    el.className = cls;
    labels.appendChild(el);
    return el;
  };

  const create = (ctx: ClientContext, e: Entity): View => {
    const { c, config } = ctx;
    const kind = c.net.get(e)!.kind;
    if (kind === "player") {
      const ch = createCharacter(library);
      const label = makeLabel(e === ctx.localId ? "label me" : "label");
      return {
        object: ch.group,
        label,
        update: (ctx, e) => {
          const anim = c.anim.get(e)!;
          let state = anim.state;
          let time = anim.time;
          // my player: walk or stand from my predicted movement, at once
          const v = c.velocity.get(e);
          if (v && (state === "idle" || state === "walk")) {
            const moving = Math.hypot(v.x, v.z) > 0.1;
            state = moving ? "walk" : "idle";
            time = ctx.now;
          }
          if (state === "walk") time = ctx.now;
          // the attack clip is played to fit the attack period
          const speed = state === "attack" ? library.clips.attack.duration / config.character.attackPeriod : 1;
          ch.setPose(state, time, speed);
          const h = c.health.get(e);
          label.innerHTML = `<span>${escapeHtml(c.player.get(e)?.name ?? "")}</span>` + (h ? `<i style="--hp:${(100 * h.hp) / (h.max || 1)}%"></i>` : "");
        },
      };
    }
    if (kind === "monster") {
      const m = config.monster;
      const material = renderer.materials.solid({ color: m.color });
      const body = new THREE.Mesh(cube, material);
      body.scale.setScalar(m.size);
      const group = new THREE.Group();
      group.add(body);
      const color = new THREE.Color(m.color);
      const white = new THREE.Color("#ffffff");
      const label = makeLabel("label monster");
      const phase = (e * 0.37) % 1;
      return {
        object: group,
        label,
        update: (ctx, e) => {
          const anim = c.anim.get(e)!;
          const t = anim.time;
          let sx = 1, sy = 1, y = 0, lunge = 0;
          let flash = 0;
          if (anim.state === "walk") {
            // hops
            const p = (ctx.now * 2.2 + phase) % 1;
            y = Math.sin(p * Math.PI) * 0.22;
            sy = 1 + Math.sin(p * Math.PI) * 0.12;
            sx = 1 / Math.sqrt(sy);
          } else if (anim.state === "idle") {
            sy = 1 + Math.sin((ctx.now + phase * 3) * 3) * 0.04;
            sx = 1 / Math.sqrt(sy);
          } else if (anim.state === "attack") {
            // crouch during the windup, then jump at the target
            const w = m.attackWindup;
            if (t < w) {
              sy = 1 - 0.3 * (t / w);
              sx = 1 + 0.18 * (t / w);
            } else {
              const k = Math.min(1, (t - w) / 0.3);
              lunge = Math.sin(k * Math.PI) * 0.55;
              y = Math.sin(k * Math.PI) * 0.3;
              sy = 1 + Math.sin(k * Math.PI) * 0.15;
            }
          } else if (anim.state === "hit") {
            flash = t < 0.15 ? 1 : 0;
            sy = 0.85;
            sx = 1.1;
          } else if (anim.state === "dead") {
            flash = t < 0.12 ? 1 : 0;
            const k = Math.min(1, t / 0.6);
            sy = Math.max(0.02, 1 - k);
            sx = 1 + k * 0.4;
          }
          body.scale.set(m.size * sx, m.size * sy, m.size * sx);
          body.position.set(0, y, lunge);
          material.uniforms.uColor!.value.copy(flash ? white : color);
          const h = c.health.get(e);
          const show = h && h.hp < h.max && anim.state !== "dead";
          label.style.display = show ? "" : "none";
          if (show) label.innerHTML = `<i style="--hp:${(100 * h!.hp) / (h!.max || 1)}%"></i>`;
        },
      };
    }
    if (kind === "pet") {
      // the pet cube: smaller, light blue, it hops after its player
      const p = config.pet;
      const body = new THREE.Mesh(cube, renderer.materials.solid({ color: p.color }));
      body.scale.setScalar(p.size);
      const group = new THREE.Group();
      group.add(body);
      const phase = (e * 0.29) % 1;
      return {
        object: group,
        update: (ctx, e) => {
          const anim = c.anim.get(e)!;
          let y = 0, sy = 1;
          if (anim.state === "walk") {
            const k = (ctx.now * 3.2 + phase) % 1;
            y = Math.sin(k * Math.PI) * 0.18;
            sy = 1 + Math.sin(k * Math.PI) * 0.15;
          } else sy = 1 + Math.sin((ctx.now + phase * 3) * 4) * 0.05;
          const sx = 1 / Math.sqrt(sy);
          body.scale.set(p.size * sx, p.size * sy, p.size * sx);
          body.position.y = y;
        },
      };
    }
    // item: a small cube of color that turns and bobs a little
    const color = config.loot.items.find((i) => i.id === c.item.get(e)?.type)?.color ?? "#ffffff";
    let material = itemMaterials.get(color);
    if (!material) {
      material = renderer.materials.solid({ color });
      itemMaterials.set(color, material);
    }
    const s = config.loot.size;
    const mesh = new THREE.Mesh(cube, material);
    mesh.scale.setScalar(s);
    const group = new THREE.Group();
    group.add(mesh);
    const phase = (e * 0.61) % 1;
    return {
      object: group,
      update: (ctx, e) => {
        const t = c.anim.get(e)?.time ?? 0;
        // dropped: a small jump out of the monster, then a slow bob
        const drop = Math.max(0, 1 - t / 0.45);
        mesh.position.y = Math.sin(drop * Math.PI) * 0.5 + 0.04 + Math.sin((ctx.now + phase * 6) * 2.5) * 0.03;
        mesh.rotation.y = ctx.now * 1.2 + phase * 6;
      },
    };
  };

  const project = new THREE.Vector3();
  return (world, ctx) => {
    const { c } = ctx;
    for (const e of world.query(c.net, c.transform)) {
      let view = views.get(e);
      if (!view) {
        view = create(ctx, e);
        renderer.castShadows(view.object);
        renderer.scene.add(view.object);
        views.set(e, view);
      }
      const t = c.transform.get(e)!;
      view.object.position.set(t.x, 0, t.z);
      view.object.rotation.y = t.rot;
      view.update(ctx, e);
    }
    for (const [e, view] of views) {
      if (world.exists(e)) continue;
      renderer.scene.remove(view.object);
      view.label?.remove();
      views.delete(e);
    }
    // labels: placed over each entity, in CSS pixels of the view
    const target = renderer.getTarget();
    const scale = (renderer as any).pixelScale as number;
    const container = renderer.canvas.parentElement!;
    const w = container.clientWidth, h = container.clientHeight;
    for (const [e, view] of views) {
      if (!view.label) continue;
      const t = c.transform.get(e)!;
      const height = c.player.has(e) ? 1.95 : 1.15;
      project.set(t.x, height, t.z).sub(target);
      const px = w / 2 + project.dot(right) * PIXELS_PER_METER * scale;
      const py = h / 2 - project.dot(up) * PIXELS_PER_METER * scale;
      view.label.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px) translate(-50%, -100%)`;
    }
  };
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
