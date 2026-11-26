// HOST-ONLY tutorial presentation.
//
// Completely isolated from the live game: no Firebase, no game CharacterRenderer,
// no real phases, questions, timers or actions. It builds its own DOM, its own
// simplified 6-room map and its own sprite instances, and every timer it creates
// is tracked so a page change or close cancels all of them.
//
// The only shared code it reuses is SpriteAnimator + CHARACTER_ASSETS, which are
// pure DOM/asset helpers that hold no game state.

import { SpriteAnimator } from './spriteAnimator.js';
import { CHARACTER_ASSETS } from './assetConfig.js';

/* ---------------- local config ---------------- */

const TUT = Object.freeze({
  cursorGlide: 700,     // fake cursor travel
  clickHold: 220,
  walk: 900,            // demo walk between rooms
  beat: 600,            // generic pause between steps
  hold: 1400,           // pause on the final state
  loopGap: 900,         // pause before replaying
  emergeWait: 1000      // mirrors the real 1s emerge -> attack beat
});

// Simplified copy of the real map. Deliberately local so the tutorial can never
// disturb the real map module.
const ROOMS = [
  { id: 'A', col: 0, row: 0 }, { id: 'B', col: 1, row: 0 }, { id: 'C', col: 2, row: 0 },
  { id: 'D', col: 0, row: 1 }, { id: 'E', col: 1, row: 1 }, { id: 'F', col: 2, row: 1 }
];
const ADJ = {
  A: ['B', 'D'], B: ['A', 'C', 'E'], C: ['B', 'F'],
  D: ['A', 'E'], E: ['B', 'D', 'F'], F: ['C', 'E']
};

const PAGES = ['SURVIVE', 'MOVE', 'HUNT', 'SHIELD', 'LOCK'];

/* ---------------- lifecycle state ---------------- */

let root = null;
let stageEl = null;
let page = 0;
let paused = false;
let generation = 0;               // bumped on every teardown; stale steps abort
let open = false;

const timeouts = new Set();
const sprites = [];               // SpriteAnimator instances to destroy
let onKey = null;

/** Tracked setTimeout. Every tutorial delay goes through here. */
function later(fn, ms) {
  const id = setTimeout(() => { timeouts.delete(id); fn(); }, ms);
  timeouts.add(id);
  return id;
}

/** Cancel every tutorial timer and destroy every tutorial sprite animator. */
function stopEverything() {
  generation++;
  for (const id of timeouts) clearTimeout(id);
  timeouts.clear();
  while (sprites.length) {
    const s = sprites.pop();
    try { s.destroy(); } catch { /* already gone */ }
  }
}

/**
 * Run a timeline of [delayFromPrevious, fn] steps, then loop.
 * Steps belonging to an old generation are dropped, so switching pages or
 * closing can never let an old demo keep painting.
 */
function runTimeline(steps, restart) {
  const mine = generation;
  let t = 0;
  for (const [dt, fn] of steps) {
    t += dt;
    later(() => { if (generation === mine && !paused) fn(); }, t);
  }
  later(() => { if (generation === mine && !paused) restart(); }, t + TUT.loopGap);
}

/* ---------------- tiny DOM helpers ---------------- */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ---------------- demo map ---------------- */

function buildDemoMap(host) {
  const map = el('div', 'tut-map');
  const rooms = {};
  for (const r of ROOMS) {
    const room = el('div', 'tut-room');
    room.dataset.room = r.id;
    room.style.gridColumn = String(r.col + 1);
    room.style.gridRow = String(r.row + 1);
    room.appendChild(el('span', 'tut-room-label', r.id));
    room.appendChild(el('span', 'tut-pipe'));
    rooms[r.id] = room;
    map.appendChild(room);
  }
  const layer = el('div', 'tut-layer');
  map.appendChild(layer);
  host.appendChild(map);

  const api = {
    map, rooms, layer,
    state(id, s) { if (rooms[id]) rooms[id].dataset.state = s || ''; },
    clear() { for (const r of ROOMS) api.state(r.id, ''); },
    /** Room centre in map coordinates. */
    center(id) {
      const r = rooms[id];
      return r ? { x: r.offsetLeft + r.offsetWidth / 2, y: r.offsetTop + r.offsetHeight / 2 }
        : { x: 0, y: 0 };
    },
    pipe(id) {
      const r = rooms[id], p = r && r.querySelector('.tut-pipe');
      if (!p) return api.center(id);
      return { x: r.offsetLeft + p.offsetLeft + p.offsetWidth / 2,
               y: r.offsetTop + p.offsetTop + p.offsetHeight / 2 };
    },
    /** Where a character stands (feet at the anchor). */
    anchor(id, slot = 0) {
      const c = api.center(id);
      return { x: c.x + slot * 26, y: c.y + 14 };
    },
    flash(id, cls) {
      const c = api.center(id);
      const fx = el('div', 'tut-fx ' + cls);
      fx.style.transform = `translate(${c.x}px,${c.y}px) translate(-50%,-50%)`;
      layer.appendChild(fx);
      later(() => fx.remove(), 900);
    },
    banner(text, cls) {
      const b = el('div', 'tut-banner ' + (cls || ''), text);
      map.appendChild(b);
      later(() => b.remove(), TUT.hold);
      return b;
    }
  };
  return api;
}

/* ---------------- demo characters (own instances) ---------------- */

function makeChar(mapApi, kind, name) {
  const wrap = el('div', 'tut-char tut-char-' + kind);
  const sprite = el('div', 'sprite');
  wrap.appendChild(sprite);
  if (name) wrap.appendChild(el('div', 'tut-name', name));
  mapApi.layer.appendChild(wrap);

  // Own SpriteAnimator instance - never registered with the game's renderer.
  const anim = new SpriteAnimator(sprite, CHARACTER_ASSETS[kind] || CHARACTER_ASSETS.player);
  sprites.push(anim);

  const c = { wrap, anim, room: null, facing: 'down' };
  c.place = (roomId, slot = 0) => {
    c.room = roomId;
    const p = mapApi.anchor(roomId, slot);
    wrap.style.transition = 'none';
    wrap.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;
    anim.play('idle_' + c.facing);
  };
  c.show = (on) => { wrap.style.opacity = on ? '1' : '0'; };
  c.walk = (roomId, ms = TUT.walk, slot = 0) => {
    const from = mapApi.anchor(c.room || roomId, 0);
    const to = mapApi.anchor(roomId, slot);
    const dx = to.x - from.x, dy = to.y - from.y;
    c.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    c.room = roomId;
    anim.play('walk_' + c.facing);
    wrap.style.transition = `transform ${ms}ms linear`;
    wrap.style.transform = `translate(${to.x}px,${to.y}px) translate(-50%,-100%)`;
    later(() => anim.play('idle_' + c.facing), ms);
  };
  c.shield = () => {
    const ring = el('div', 'tut-shield');
    wrap.appendChild(ring);
    later(() => ring.remove(), 900);
  };
  c.hit = () => {
    wrap.classList.add('tut-hit');
    later(() => wrap.classList.remove('tut-hit'), 600);
  };
  return c;
}

/* ---------------- fake cursor ---------------- */

function makeCursor(mapApi) {
  const cur = el('div', 'tut-cursor');
  cur.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
    '<path d="M4 2 L20 12 L13 13.5 L16.5 21 L13.5 22.5 L10 15 L4 19 Z" ' +
    'fill="#fff" stroke="#0b0d12" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  mapApi.map.appendChild(cur);
  cur.style.transform = 'translate(-40px,-40px)';

  return {
    to(roomId, ms = TUT.cursorGlide) {
      const c = mapApi.center(roomId);
      cur.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1)`;
      cur.style.transform = `translate(${c.x}px,${c.y}px)`;
    },
    at(x, y, ms = TUT.cursorGlide) {
      cur.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1)`;
      cur.style.transform = `translate(${x}px,${y}px)`;
    },
    click() {
      cur.classList.add('clicking');
      const ring = el('div', 'tut-click-ring');
      cur.appendChild(ring);
      later(() => { cur.classList.remove('clicking'); ring.remove(); }, TUT.clickHold + 200);
    },
    hide() { cur.style.opacity = '0'; },
    show() { cur.style.opacity = '1'; }
  };
}

/* ---------------- pages ---------------- */

function pageSurvive(host, setCaption) {
  setCaption('เอาตัวรอดให้ครบทุกข้อ ถ้าผู้เล่นยังรอดอยู่ตอนจบ ฝั่งผู้เล่นชนะ');
  const wrap = el('div', 'tut-survive');
  const track = el('div', 'tut-rounds');
  const pills = [];
  for (let i = 1; i <= 6; i++) {
    const p = el('div', 'tut-pill', i === 6 ? 'FINAL' : String(i));
    pills.push(p); track.appendChild(p);
  }
  const outcome = el('div', 'tut-outcome', '');
  wrap.append(track, outcome);
  host.appendChild(wrap);

  let playersWin = true;
  const start = () => {
    pills.forEach(p => { p.dataset.on = ''; p.dataset.dead = ''; });
    outcome.textContent = '';
    outcome.dataset.kind = '';

    const steps = [];
    const upto = playersWin ? 6 : 3;
    for (let i = 0; i < upto; i++) {
      steps.push([TUT.beat, () => { pills[i].dataset.on = '1'; }]);
    }
    if (playersWin) {
      steps.push([TUT.beat, () => {
        outcome.textContent = 'PLAYERS WIN';
        outcome.dataset.kind = 'players';
      }]);
    } else {
      steps.push([TUT.beat, () => {
        for (let i = upto; i < 6; i++) pills[i].dataset.dead = '1';
        outcome.textContent = 'HUNTER WINS';
        outcome.dataset.kind = 'hunter';
      }]);
    }
    steps.push([TUT.hold, () => {}]);
    runTimeline(steps, () => { playersWin = !playersWin; start(); });
  };
  start();
}

function pageMove(host, setCaption) {
  setCaption('แต่ละรอบเดินได้ 1 ห้องที่อยู่ติดกัน (ซ้าย ขวา บน ล่าง)');
  const map = buildDemoMap(host);
  const cur = makeCursor(map);
  const player = makeChar(map, 'player', 'คุณ');

  const start = () => {
    map.clear();
    cur.show();
    player.place('A');
    cur.at(-40, -40, 0);

    runTimeline([
      [TUT.beat, () => {
        for (const r of ROOMS) map.state(r.id, ADJ.A.includes(r.id) ? 'reachable' : 'blocked');
      }],
      [TUT.beat, () => cur.to('B')],
      [TUT.cursorGlide, () => { cur.click(); map.state('B', 'chosen'); }],
      [TUT.beat, () => { map.clear(); player.walk('B'); }],
      [TUT.walk + TUT.hold, () => {}],

      // Brief secondary case: no click before the timer ends.
      [TUT.beat, () => {
        map.clear(); cur.hide(); player.place('A');
        for (const r of ROOMS) map.state(r.id, ADJ.A.includes(r.id) ? 'reachable' : 'blocked');
        map.banner('ไม่ได้เลือกห้อง', 'warn');
      }],
      [TUT.hold, () => { map.clear(); map.banner('อยู่ห้อง A ต่อ', 'warn'); }],
      [TUT.hold, () => {}]
    ], start);
  };
  start();
}

function pageHunt(host, setCaption) {
  setCaption('Hunter มุดท่อไปโผล่ได้ทุกห้อง เลือกห้องเป้าหมายได้ 1 ห้อง');
  const map = buildDemoMap(host);
  const cur = makeCursor(map);
  const hunter = makeChar(map, 'hunter', '');
  const victim = makeChar(map, 'player', '');

  const start = () => {
    map.clear();
    cur.show();
    hunter.show(false);
    victim.place('F');
    hunter.place('F');
    hunter.show(false);
    cur.at(-40, -40, 0);

    runTimeline([
      [TUT.beat, () => { for (const r of ROOMS) map.state(r.id, 'selectable'); }],
      [TUT.beat, () => cur.to('A')],
      [TUT.cursorGlide, () => cur.to('F')],           // glide across distant rooms
      [TUT.cursorGlide, () => { cur.click(); map.clear(); map.state('F', 'target'); }],
      [TUT.beat, () => { cur.hide(); map.banner('เป้าหมาย: F', 'target'); }],
      [TUT.hold, () => { map.flash('F', 'tut-fx-pipe'); }],
      [TUT.beat, () => map.banner('ตอบถูก', 'good')],
      [TUT.hold, () => { map.state('F', 'focus'); hunter.show(true); map.flash('F', 'tut-fx-emerge'); }],
      [TUT.emergeWait, () => { map.flash('F', 'tut-fx-attack'); victim.hit(); }],
      [TUT.hold, () => { victim.show(false); }],
      [TUT.beat, () => { map.clear(); hunter.show(false); map.banner('Hunter ตอบผิด = ไม่ได้โจมตี', 'warn'); }],
      [TUT.hold, () => {}]
    ], start);
  };
  start();
}

function pageShield(host, setCaption) {
  setCaption('เดินสำเร็จ + ตอบถูก = ได้โล่ กันการโจมตีได้ 1 รอบ');
  const formula = el('div', 'tut-formula');
  formula.append(el('span', 'tut-term', 'เดินสำเร็จ'), el('span', 'tut-op', '+'),
    el('span', 'tut-term', 'ตอบถูก'), el('span', 'tut-op', '='),
    el('span', 'tut-term tut-term-key', 'ได้โล่'));
  host.appendChild(formula);

  const map = buildDemoMap(host);
  const cur = makeCursor(map);
  const player = makeChar(map, 'player', 'คุณ');
  const hunter = makeChar(map, 'hunter', '');

  const terms = formula.querySelectorAll('.tut-term');

  const start = () => {
    map.clear();
    cur.show();
    terms.forEach(t => { t.dataset.on = ''; });
    player.show(true);
    player.place('A');
    hunter.place('B');
    hunter.show(false);
    cur.at(-40, -40, 0);

    runTimeline([
      [TUT.beat, () => { map.state('B', 'reachable'); map.state('D', 'reachable'); cur.to('B'); }],
      [TUT.cursorGlide, () => { cur.click(); map.clear(); player.walk('B'); }],
      [TUT.walk, () => { terms[0].dataset.on = '1'; cur.hide(); }],
      [TUT.beat, () => map.banner('ตอบถูก', 'good')],
      [TUT.beat, () => { terms[1].dataset.on = '1'; }],
      [TUT.beat, () => { terms[2].dataset.on = '1'; player.shield(); }],
      [TUT.beat, () => { map.state('B', 'target'); map.banner('เป้าหมาย: B', 'target'); }],
      [TUT.hold, () => { map.state('B', 'focus'); hunter.show(true); map.flash('B', 'tut-fx-emerge'); }],
      [TUT.emergeWait, () => { map.flash('B', 'tut-fx-attack'); player.shield(); }],
      [TUT.beat, () => map.banner('โล่กันไว้ได้!', 'good')],
      [TUT.hold, () => {}]
    ], start);
  };
  start();
}

function pageLock(host, setCaption) {
  setCaption('Hunter ปิดห้องได้ 1 ห้องต่อรอบ ใครเดินเข้าห้องนั้นจะเดินไม่สำเร็จ');
  const map = buildDemoMap(host);
  const cur = makeCursor(map);
  const player = makeChar(map, 'player', 'คุณ');

  const start = () => {
    map.clear();
    cur.show();
    player.place('A');
    cur.at(-40, -40, 0);

    runTimeline([
      [TUT.beat, () => { map.state('B', 'reachable'); map.state('D', 'reachable'); cur.to('B'); }],
      [TUT.cursorGlide, () => { cur.click(); map.state('B', 'chosen'); }],
      [TUT.beat, () => { cur.hide(); map.banner('Hunter ปิดห้อง B', 'bad'); }],
      [TUT.beat, () => { map.clear(); map.state('B', 'lock'); }],
      [TUT.hold, () => { player.place('A'); map.banner('เดินไม่สำเร็จ', 'bad'); }],
      [TUT.hold, () => map.banner('ตอบถูก', 'good')],
      [TUT.hold, () => map.banner('ไม่ได้โล่', 'bad')],
      [TUT.hold, () => {
        map.clear();
        map.state('E', 'target'); map.state('B', 'lock');
        map.banner('เป้าหมาย = เดาใจ · ปิดห้อง = ดักทาง', '');
      }],
      [TUT.hold, () => {}]
    ], start);
  };
  start();
}

const BUILDERS = [pageSurvive, pageMove, pageHunt, pageShield, pageLock];

/* ---------------- shell ---------------- */

function build() {
  root = el('div', 'tut hidden');
  root.id = 'tutorial';

  const box = el('div', 'tut-box');
  const title = el('h1', 'tut-title');
  title.id = 'tut-title';
  const stage = el('div', 'tut-stage');
  stage.id = 'tut-stage';
  const caption = el('p', 'tut-caption');
  caption.id = 'tut-caption';

  const nav = el('div', 'tut-nav');
  const prev = el('button', 'btn tut-arrow', '‹');
  const counter = el('span', 'tut-count');
  const next = el('button', 'btn tut-arrow', '›');
  const pause = el('button', 'btn tut-mini', 'หยุด');
  const close = el('button', 'btn tut-mini', 'ปิด');
  nav.append(prev, counter, next, pause, close);

  box.append(title, stage, caption, nav);
  root.appendChild(box);
  document.body.appendChild(root);

  stageEl = stage;

  prev.addEventListener('click', () => goto(page - 1));
  next.addEventListener('click', () => goto(page + 1));
  close.addEventListener('click', closeTutorial);
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'เล่น' : 'หยุด';
    if (paused) stopEverything(); else show();     // resume restarts this page
  });

  root._parts = { title, caption, counter, pause };
}

function show() {
  const { title, caption, counter } = root._parts;
  stopEverything();                 // never leave a previous demo running
  stageEl.innerHTML = '';
  title.textContent = PAGES[page];
  counter.textContent = (page + 1) + ' / ' + PAGES.length;
  caption.textContent = '';
  BUILDERS[page](stageEl, (t) => { caption.textContent = t; });
}

function goto(n) {
  if (!open) return;
  page = (n + PAGES.length) % PAGES.length;
  if (paused) {                      // navigating while paused resumes playback
    paused = false;
    root._parts.pause.textContent = 'หยุด';
  }
  show();
}

export function openTutorial() {
  if (!root) build();
  open = true;
  paused = false;
  page = 0;
  root._parts.pause.textContent = 'หยุด';
  root.classList.remove('hidden');
  show();

  onKey = (e) => {
    if (e.key === 'ArrowRight') goto(page + 1);
    else if (e.key === 'ArrowLeft') goto(page - 1);
    else if (e.key === 'Escape') closeTutorial();
  };
  document.addEventListener('keydown', onKey);
}

export function closeTutorial() {
  if (!root) return;
  open = false;
  stopEverything();                  // cancel every timer and sprite animator
  stageEl.innerHTML = '';
  root.classList.add('hidden');
  if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
}
