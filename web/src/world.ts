/** The walkable road: canvas 2D over code-drawn art in /art. Chain state is pushed in through setState. */
import { sfx, setNight } from './sfx.ts';

export interface WorldMerchant { name: string; town_name: string; gold: number; news: { day: number; town: number; cls: string }[] }
export interface Courier { day: number; town: number; cls: string }
export interface WorldState { merchants: WorldMerchant[]; couriers: Courier[]; day: number; dayFrac: number; canEnd: boolean; selected: number }
interface Rect { 0: number; 1: number; 2: number; 3: number }
interface Layout { w: number; h: number; merchants: { x: number; y: number; talk: { x: number; y: number } }[]; boards: { x: number; y: number }[]; road: [number, number][]; solids: Rect[] }

const VW = 480, VH = 270, SPEED = 72, TALK_R = 30;
const VOICE = [520, 300, 420];
const IDLE_LINES = [
  ['Fresh grain, fair prices!', 'Seed loans for honest farmers.', 'Millford pays its debts. Mostly.'],
  ['State your business at the gate.', 'Every coin is counted twice here.', 'Tolls are due at sundown.'],
  ['Ships in, ships out.', 'Salt and silver from the coast!', 'A sailor always has a story.'],
];

export function createWorld(canvas: HTMLCanvasElement, onTalk: (m: number) => void) {
  const ctx = canvas.getContext('2d')!;
  canvas.width = VW; canvas.height = VH;
  ctx.imageSmoothingEnabled = false;
  const img = (n: string) => Object.assign(new Image(), { src: `/art/${n}` });
  const art = { world: img('world.png'), canopy: img('canopy.png'), player: img('player.png'), folk: img('townsfolk.png'), courier: img('courier.png') };
  let L: Layout | null = null;
  const layer = document.createElement('div');
  layer.className = 'wlabels';
  canvas.parentElement!.appendChild(layer);
  layer.innerHTML = '<span class="wname"></span><span class="wname"></span><span class="wname"></span><div class="wsay"></div><div class="wprompt"></div>';
  const names = Array.from(layer.querySelectorAll<HTMLElement>('.wname'));
  const say = layer.querySelector<HTMLElement>('.wsay')!;
  const prompt = layer.querySelector<HTMLElement>('.wprompt')!;
  const pin = (el: HTMLElement, x: number, y: number) => { el.style.left = `${(x / VW) * 100}%`; el.style.top = `${(y / VH) * 100}%`; };
  fetch('/art/world.json').then((r) => r.json()).then((j) => { L = j; });

  let state: WorldState = { merchants: [], couriers: [], day: 1, dayFrac: 0, canEnd: false, selected: 0 };
  const p = { x: 240, y: 204, face: 0, step: 0, stepT: 0, moving: false };
  let target: { x: number; y: number; talk: number } | null = null;
  const keys = new Set<string>();
  let near = -1;
  let camX = 0, camY = 0;
  let last = performance.now();
  let chatter = { m: -1, text: '', shown: 0, until: 0, next: performance.now() + 2500 };
  let seenCouriers = new Set<string>();
  let active = true;

  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const DIRS: Record<string, [number, number, number]> = {
    ArrowDown: [0, 1, 0], s: [0, 1, 0], S: [0, 1, 0], ArrowLeft: [-1, 0, 1], a: [-1, 0, 1], A: [-1, 0, 1],
    ArrowRight: [1, 0, 2], d: [1, 0, 2], D: [1, 0, 2], ArrowUp: [0, -1, 3], w: [0, -1, 3], W: [0, -1, 3],
  };
  window.addEventListener('keydown', (e) => {
    if (!active || typing()) return;
    if (DIRS[e.key]) { keys.add(e.key); target = null; e.preventDefault(); }
    if ((e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.key === ' ') && near >= 0) { e.preventDefault(); talk(near); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    if (!L) return;
    const r = canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left) / r.width * VW + camX, wy = (e.clientY - r.top) / r.height * VH + camY;
    const hit = L.merchants.findIndex((m) => Math.abs(wx - m.x) < 26 && wy > m.y - 40 && wy < m.talk.y + 8);
    target = hit >= 0 ? { x: L.merchants[hit].talk.x, y: L.merchants[hit].talk.y, talk: hit } : { x: wx, y: wy, talk: -1 };
  });

  function talk(m: number) {
    keys.clear(); target = null;
    sfx.talkOpen();
    onTalk(m);
  }

  function blocked(x: number, y: number): boolean {
    if (!L || x < 6 || x > L.w - 6 || y < 70 || y > L.h - 2) return true;
    const bx = x - 5, by = y - 5, bw = 10, bh = 5;
    return L.solids.some((s) => bx < s[0] + s[2] && bx + bw > s[0] && by < s[1] + s[3] && by + bh > s[1]);
  }

  function update(dt: number) {
    if (!L) return;
    let dx = 0, dy = 0;
    for (const k of keys) { const d = DIRS[k]; if (d) { dx += d[0]; dy += d[1]; p.face = d[2]; } }
    if (target) {
      const tx = target.x - p.x, ty = target.y - p.y, dist = Math.hypot(tx, ty);
      if (dist < 3) {
        const t = target.talk; target = null;
        if (t >= 0) { p.face = 3; talk(t); }
      } else {
        dx = tx / dist; dy = ty / dist;
        p.face = Math.abs(tx) > Math.abs(ty) ? (tx < 0 ? 1 : 2) : (ty < 0 ? 3 : 0);
      }
    }
    const len = Math.hypot(dx, dy);
    p.moving = len > 0;
    if (p.moving) {
      const sx = dx / len * SPEED * dt, sy = dy / len * SPEED * dt;
      let moved = false;
      if (!blocked(p.x + sx, p.y)) { p.x += sx; moved = true; }
      else if (sx && !sy) {
        // corner slide: step around an edge that blocks a sideways walk by up to 6px
        for (const off of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
          if (!blocked(p.x + sx, p.y + off)) { p.y += Math.sign(off) * Math.min(Math.abs(off), SPEED * dt); moved = true; break; }
        }
      }
      if (!blocked(p.x, p.y + sy)) { p.y += sy; moved = true; }
      else if (sy && !sx) {
        for (const off of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
          if (!blocked(p.x + off, p.y + sy)) { p.x += Math.sign(off) * Math.min(Math.abs(off), SPEED * dt); moved = true; break; }
        }
      }
      if (!moved && target) target = null;
      p.stepT += dt;
      if (p.stepT > 0.14) { p.stepT = 0; p.step = (p.step + 1) % 4; if (p.step % 2) sfx.step(); }
    } else p.step = 0;
    near = L.merchants.findIndex((m) => Math.hypot(p.x - m.talk.x, p.y - m.talk.y) < TALK_R);
    camX = Math.max(0, Math.min(L.w - VW, p.x - VW / 2));
    camY = Math.max(0, Math.min(L.h - VH, p.y - VH / 2 - 20));
    const now = performance.now();
    if (now > chatter.next && state.merchants.length) {
      const visible = L.merchants.map((m, i) => i).filter((i) => Math.abs(L!.merchants[i].x - p.x) < VW / 2);
      if (visible.length) {
        const i = visible[Math.floor(Math.random() * visible.length)];
        const m = state.merchants[i];
        const heard = m?.news[m.news.length - 1];
        const line = heard && Math.random() < 0.6
          ? `Heard the news? ${heard.cls} in ${state.merchants[heard.town]?.town_name ?? 'town'}, day ${heard.day}.`
          : IDLE_LINES[i][Math.floor(Math.random() * 3)];
        chatter = { m: i, text: line, shown: 0, until: now + 4200, next: now + 7000 + Math.random() * 5000 };
      } else chatter.next = now + 2000;
    }
    if (chatter.m >= 0 && chatter.shown < chatter.text.length) {
      chatter.shown = Math.min(chatter.text.length, chatter.shown + dt * 32);
      if (Math.floor(chatter.shown) % 3 === 0 && near === chatter.m) sfx.blip(VOICE[chatter.m]);
    }
  }

  function roadAt(x: number): number {
    const r = L!.road; const i = Math.min(r.length - 2, Math.max(0, Math.floor(x / 24)));
    const t = (x - r[i][0]) / 24; return r[i][1] + (r[i + 1][1] - r[i][1]) * t;
  }

  /** Riders carry each landed con away from its town at one town per chain day, the contract's news_arrives rule. */
  function riders() {
    const out: { x: number; y: number; dir: number; cls: string; key: string }[] = [];
    if (!L) return out;
    const xs = L.merchants.map((m) => m.x);
    const t = state.day + state.dayFrac;
    for (const c of state.couriers) {
      const prog = t - c.day;
      for (const dir of [-1, 1]) {
        const far = dir < 0 ? c.town : xs.length - 1 - c.town;
        if (far <= 0 || prog < 0 || prog >= far) continue;
        const pos = c.town + dir * prog;
        const i = Math.floor(pos), f = pos - i;
        const x = xs[Math.min(i, xs.length - 1)] + (xs[Math.min(i + 1, xs.length - 1)] - xs[Math.min(i, xs.length - 1)]) * f;
        out.push({ x, y: roadAt(x) + 4, dir, cls: c.cls, key: `${c.day}:${c.town}:${dir}` });
      }
    }
    return out;
  }

  function draw() {
    ctx.clearRect(0, 0, VW, VH);
    if (!L || !art.world.complete) { ctx.fillStyle = '#121624'; ctx.fillRect(0, 0, VW, VH); return; }
    const cx = Math.round(camX), cy = Math.round(camY);
    ctx.drawImage(art.world, cx, cy, VW, VH, 0, 0, VW, VH);
    const now = performance.now();
    const sprites: { y: number; draw: () => void }[] = [];
    L.merchants.forEach((m, i) => {
      // merchant stands behind the counter: only the part above the counter top is drawn
      const bob = Math.floor(now / 600 + i) % 2;
      sprites.push({ y: m.y - 30, draw: () => ctx.drawImage(art.folk, bob * 16, i * 24, 16, 15, m.x - 8 - cx, m.y - 18 - cy, 16, 15) });
      const n = state.merchants[i]?.news.length ?? 0;
      const b = L!.boards[i];
      for (let k = 0; k < Math.min(n, 4); k++) {
        ctx.fillStyle = k % 2 ? '#f6ecd6' : '#e8d8b0';
        ctx.fillRect(b.x - 8 + k * 4 - cx, b.y - 17 - (k % 2) - cy, 4, 6);
        ctx.fillStyle = '#c84038'; ctx.fillRect(b.x - 7 + k * 4 - cx, b.y - 16 - (k % 2) - cy, 2, 1);
      }
    });
    for (const r of riders()) {
      if (!seenCouriers.has(r.key)) { seenCouriers.add(r.key); if (Math.abs(r.x - p.x) < VW) sfx.courier(); }
      const f = Math.floor(now / 180) % 2;
      sprites.push({ y: r.y, draw: () => {
        ctx.save();
        if (r.dir < 0) { ctx.translate(Math.round(r.x - cx), 0); ctx.scale(-1, 1); ctx.drawImage(art.courier, f * 24, 0, 24, 20, -12, r.y - 18 - cy, 24, 20); }
        else ctx.drawImage(art.courier, f * 24, 0, 24, 20, Math.round(r.x - 12 - cx), r.y - 18 - cy, 24, 20);
        ctx.restore();
      } });
    }
    sprites.push({ y: p.y, draw: () => ctx.drawImage(art.player, p.step * 16, p.face * 24, 16, 24, Math.round(p.x - 8 - cx), Math.round(p.y - 23 - cy), 16, 24) });
    sprites.sort((a, b) => a.y - b.y).forEach((s) => s.draw());
    ctx.drawImage(art.canopy, cx, cy, VW, VH, 0, 0, VW, VH);

    // day and night from the chain clock: the day's last fifth is dusk, a day that can end is night
    const night = state.canEnd ? 1 : Math.max(0, (state.dayFrac - 0.8) / 0.2);
    setNight(night > 0.5);
    if (night > 0) {
      ctx.fillStyle = `rgba(18, 26, 70, ${0.5 * night})`; ctx.fillRect(0, 0, VW, VH);
      ctx.globalCompositeOperation = 'lighter';
      for (const m of L.merchants) {
        const g = ctx.createRadialGradient(m.x - cx, m.y - 20 - cy, 2, m.x - cx, m.y - 20 - cy, 46);
        g.addColorStop(0, `rgba(255, 190, 110, ${0.35 * night})`); g.addColorStop(1, 'rgba(255, 190, 110, 0)');
        ctx.fillStyle = g; ctx.fillRect(m.x - 50 - cx, m.y - 70 - cy, 100, 100);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    L.merchants.forEach((m, i) => {
      const el = names[i]; const nm = state.merchants[i]?.name;
      el.hidden = !nm || Math.abs(m.x - cx - VW / 2) > VW / 2 + 40;
      if (nm) { el.textContent = nm; el.classList.toggle('sel', i === state.selected); pin(el, m.x - cx, m.y - 46 - cy); }
    });
    if (chatter.m >= 0 && now < chatter.until) {
      const m = L.merchants[chatter.m];
      say.hidden = false; say.textContent = chatter.text.slice(0, Math.floor(chatter.shown));
      pin(say, m.x - cx, m.y - 52 - cy);
    } else say.hidden = true;
    if (near >= 0 && state.merchants[near]) {
      prompt.hidden = false;
      prompt.innerHTML = `<kbd>E</kbd> Talk to ${state.merchants[near].name}`;
      pin(prompt, p.x - cx, p.y - 34 - cy);
    } else prompt.hidden = true;
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (active) { update(dt); draw(); canvas.dataset.px = String(Math.round(p.x)); canvas.dataset.py = String(Math.round(p.y)); canvas.dataset.near = String(near); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setState(s: WorldState) { state = s; },
    /** Put the player on a merchant's doorstep, e.g. after fast travel or leaving a stall. */
    standAt(m: number) { if (L) { p.x = L.merchants[m].talk.x; p.y = L.merchants[m].talk.y + 6; p.face = 0; } else { p.x = [240, 720, 1200][m] ?? 240; } },
    setActive(a: boolean) { active = a; keys.clear(); last = performance.now(); },
    move(dir: 'up' | 'down' | 'left' | 'right' | null) {
      for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) keys.delete(k);
      if (dir) keys.add({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir]);
    },
    act() { if (near >= 0) talk(near); },
  };
}
