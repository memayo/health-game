// "How to play" for Host and Players.
//
// Isolated from the live game: no Firebase, no real phases, questions, timers or
// actions. Each page builds its OWN demo map (the real dungeon map, characters and
// pixel effects, so it looks exactly like the game) and everything it creates is
// tracked and torn down on page change or close.

import { buildMap } from './map.js';
import { CharacterRenderer } from './characterRenderer.js';
import { playResultSequence, wait } from './effects.js';
import { SpriteAnimator } from './spriteAnimator.js';
import { LiveSprite } from './pixelStage.js';
import { CHARACTER_ASSETS } from './assetConfig.js';
import { HUNTER_CHAR_ID } from './gameConfig.js';

/* ---------------- config ---------------- */

const TUT = Object.freeze({
  cursorGlide: 650,
  beat: 700,
  read: 1600,     // time to read a banner
  loopGap: 1800   // pause before a page replays
});

/* ---------------- lifecycle ---------------- */

let root = null;
let stageEl = null;
let page = 0;
let paused = false;
let generation = 0;
let open = false;
const timeouts = new Set();
const disposables = [];          // anything with destroy()
let onKey = null;

function later(fn, ms) {
  const id = setTimeout(() => { timeouts.delete(id); fn(); }, ms);
  timeouts.add(id);
  return id;
}

function stopEverything() {
  generation++;
  for (const id of timeouts) clearTimeout(id);
  timeouts.clear();
  while (disposables.length) {
    const d = disposables.pop();
    try { d.destroy(); } catch { /* already gone */ }
  }
}

/** Steps of [delayFromPrevious, fn]; fn may return a promise (awaited). Then replays. */
function runSteps(steps) {
  const mine = generation;
  (async () => {
    for (const [dt, fn] of steps) {
      await new Promise(r => later(r, dt));
      if (generation !== mine || paused) return;
      await fn();
      if (generation !== mine || paused) return;
    }
    later(() => { if (generation === mine && !paused) show(); }, TUT.loopGap);
  })().catch(e => console.error(e));
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ---------------- demo building blocks ---------------- */

/** The real dungeon map + characters, in a box inside the tutorial. */
function demoMap(host) {
  const box = el('div', 'tut-board');
  const st = el('div', 'tut-stage-map');
  box.appendChild(st);
  host.appendChild(box);
  const map = buildMap(st);
  const chars = new CharacterRenderer(map);
  disposables.push({ destroy: () => { chars.destroy(); map.destroy(); } });
  chars.add(HUNTER_CHAR_ID, { kind: 'hunter', roomId: null, hidden: true });

  const api = {
    map, chars,
    room: (L) => 'room' + L,
    state(L, s) { map.setRoomState('room' + L, s); },
    clear() { map.clearRoomStates(); },
    add(id, name, L) { chars.add(id, { kind: 'player', name, roomId: 'room' + L }); },
    banner(text, cls = '', ms = TUT.read) {
      const b = el('div', 'tut-banner ' + cls, text);
      map.stage.appendChild(b);
      later(() => b.remove(), ms);
    },
    cursor: makeCursor(map)
  };
  return api;
}

function makeCursor(map) {
  const cur = el('div', 'tut-cursor');
  cur.innerHTML =
    '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">' +
    '<path d="M4 2 L20 12 L13 13.5 L16.5 21 L13.5 22.5 L10 15 L4 19 Z" ' +
    'fill="#fff" stroke="#120f17" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  map.stage.appendChild(cur);
  cur.style.opacity = '0';
  return {
    to(L, ms = TUT.cursorGlide) {
      const c = map.roomCenter('room' + L);
      cur.style.opacity = '1';
      cur.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1),opacity 200ms`;
      cur.style.transform = `translate(${c.x}px,${c.y}px)`;
    },
    click() {
      cur.classList.add('clicking');
      const ring = el('div', 'tut-click-ring');
      cur.appendChild(ring);
      later(() => { cur.classList.remove('clicking'); ring.remove(); }, 450);
    },
    hide() { cur.style.opacity = '0'; }
  };
}

/** A standing hero sprite (no map). */
function hero(name, cls = '') {
  const w = el('div', 'tut-hero ' + cls);
  const s = el('div', 'sprite');
  w.appendChild(s);
  w.appendChild(el('span', 'tut-hero-name', name));
  const anim = new SpriteAnimator(s, CHARACTER_ASSETS.player);
  anim.setScale(3);
  disposables.push(anim);
  return w;
}

function skull(name) {
  const w = el('div', 'tut-hero tut-hero-hunter');
  const live = new LiveSprite('critters/flying-skull', { box: [28, 46], opts: { seed: 3, light: 0.9 }, scale: 2 });
  disposables.push(live);
  w.appendChild(live.el);
  w.appendChild(el('span', 'tut-hero-name', name));
  return w;
}

/** The page's short explanation: a few lines with an icon each. */
function points(host, lines) {
  const ul = el('ul', 'tut-points');
  for (const [icon, text] of lines) {
    const li = el('li');
    li.append(el('span', 'tut-icon', icon), el('span', '', text));
    ul.appendChild(li);
  }
  host.appendChild(ul);
  return ul;
}

/* ---------------- pages ---------------- */

const PAGES = [
  { title: 'ใครเป็นใคร', build: pageRoles },
  { title: 'เดิน', build: pageMove },
  { title: 'Hunter', build: pageHunter },
  { title: 'ตอบคำถาม', build: pageQuiz },
  { title: 'โล่ & โจมตี', build: pageAttack },
  { title: 'จบเกม', build: pageEnd }
];

function pageRoles(host, say) {
  const row = el('div', 'tut-cast');
  const a = hero('มิ้นท์'), b = hero('บอส'), c = hero('พลอย');
  const sk = skull('???');
  sk.style.display = 'none';
  row.append(a, b, c, sk);
  host.appendChild(row);
  points(host, [
    ['🎲', 'เริ่มเกม ระบบสุ่มให้ 1 คนเป็น Hunter ที่เหลือเป็นผู้กล้า'],
    ['🤫', 'ไม่มีใครรู้ว่าใครเป็น Hunter (ดูฝั่งตัวเองได้มุมบนจอ)'],
    ['⚔', 'ผู้กล้าชนะ ถ้ายังมีคนรอดตอนจบเกม · ☠ Hunter ชนะ ถ้าผู้กล้าตกรอบหมด']
  ]);
  say('ทุกคนเข้ามาเป็นผู้กล้า…');
  runSteps([
    [TUT.read, () => { say('…แต่หนึ่งในนั้นคือ Hunter!'); c.classList.add('tut-shake'); }],
    [900, () => { c.style.display = 'none'; sk.style.display = ''; sk.classList.add('tut-pop'); }],
    [TUT.read, () => say('ผู้กล้าต้องเอาตัวรอด · Hunter ต้องล่าให้หมด')],
    [TUT.read, () => {}]
  ]);
}

function pageMove(host, say) {
  const d = demoMap(host);
  points(host, [
    ['🟩', 'กดห้องสีเขียว = ห้องที่อยู่ติดกัน (ซ้าย ขวา บน ล่าง) ได้ 1 ห้อง'],
    ['⏳', 'เลือกให้ทันเวลา ไม่เลือก = อยู่ห้องเดิม'],
    ['👣', 'หมดเวลาแล้วทุกคนเดินพร้อมกัน']
  ]);
  d.add('me', 'คุณ', 'A');
  say('คุณอยู่ห้อง A ห้องที่ไปได้จะเป็นสีเขียว');
  runSteps([
    [TUT.beat, () => { d.state('B', 'reachable'); d.state('D', 'reachable'); for (const L of 'CEF') d.state(L, 'blocked'); }],
    [TUT.read, () => { say('กดห้อง B'); d.cursor.to('B'); }],
    [TUT.cursorGlide + 100, () => { d.cursor.click(); d.clear(); d.state('B', 'chosen'); }],
    [TUT.beat, () => { d.cursor.hide(); say('หมดเวลา → ทุกคนเดิน'); }],
    [TUT.beat, () => { d.clear(); return d.chars.moveCharacter('me', d.room('B')); }],
    [300, () => d.banner('มาถึงห้อง B แล้ว', 'good')],
    [TUT.read, () => {}]
  ]);
}

function pageHunter(host, say) {
  const d = demoMap(host);
  points(host, [
    ['🎯', 'ห้องเป้าหมาย: Hunter จะโผล่ไปโจมตีห้องนี้ (เลือกได้ทุกห้อง)'],
    ['🔒', 'ปิดห้อง: ใครเดินเข้าห้องนี้จะเดินไม่สำเร็จ (ห้องแดงเห็นตอนตอบคำถาม)'],
    ['🙈', 'ตอนเดิน Hunter มองไม่เห็นผู้กล้า ต้องเดาใจเอา']
  ]);
  d.add('p1', 'คุณ', 'B');
  say('ฝั่ง Hunter: เลือกห้องเป้าหมาย กับห้องที่จะปิด');
  runSteps([
    [TUT.beat, () => { for (const L of 'ABCDEF') d.state(L, 'selectable'); d.cursor.to('C'); }],
    [TUT.cursorGlide + 100, () => { d.cursor.click(); d.state('C', 'target'); say('🎯 เป้าหมาย: ห้อง C'); }],
    [TUT.read, () => d.cursor.to('E')],
    [TUT.cursorGlide + 100, () => { d.cursor.click(); d.state('E', 'lock'); say('🔒 ปิดห้อง E'); }],
    [TUT.read, () => { d.cursor.hide(); d.clear(); say('ผู้กล้าไม่รู้ว่าห้อง E ถูกปิด… แล้วเลือกเดินไป E'); d.state('E', 'chosen'); }],
    [TUT.read, () => { d.clear(); d.state('E', 'locked-reveal'); d.chars.stayIdle('p1'); d.banner('ห้อง E ถูกปิด! เดินไม่สำเร็จ อยู่ที่ B', 'bad'); say('เดินไม่สำเร็จ = รอบนี้ไม่ได้โล่ (ดูหน้าถัดไป)'); }],
    [TUT.read + 400, () => {}]
  ]);
}

function pageQuiz(host, say) {
  const card = el('section', 'quiz tut-quiz');
  const q = el('p', 'q-text', 'ควรล้างมืออย่างน้อยกี่วินาที');
  const box = el('div', 'choices');
  const btns = ['5 วินาที', '10 วินาที', '20 วินาที', '60 วินาที'].map((t, i) => {
    const b = el('button', 'btn', 'ABCD'[i] + '. ' + t);
    b.tabIndex = -1;
    box.appendChild(b);
    return b;
  });
  const sub = el('button', 'btn btn-primary', 'ส่งคำตอบ');
  sub.id = 'tut-submit';
  sub.tabIndex = -1;
  sub.disabled = true;
  card.append(q, box, sub);
  host.appendChild(card);
  const who = el('div', 'tut-answered');
  const people = ['มิ้นท์', 'บอส', 'พลอย'].map(n => { const s = el('span', 'tut-chip', n); who.appendChild(s); return s; });
  host.appendChild(who);
  points(host, [
    ['📜', 'ทุกคน (รวม Hunter) ได้คำถามข้อเดียวกัน และขึ้นบนจอ Host ด้วย'],
    ['✅', 'ตอบถูก = ได้คะแนน · ตอบเร็ว = ได้เปรียบเมื่อคะแนนเท่ากัน'],
    ['⏳', 'ไม่ตอบทันเวลา = นับว่าตอบผิด']
  ]);
  say('เลือกคำตอบ แล้วกด "ส่งคำตอบ"');
  runSteps([
    [TUT.read, () => { btns[2].classList.add('selected'); sub.disabled = false; }],
    [TUT.beat, () => { sub.classList.add('tut-press'); }],
    [300, () => { sub.disabled = true; for (const b of btns) b.disabled = true; people[0].classList.add('done'); people[0].textContent = 'มิ้นท์ ✓ 3.2 วิ'; say('ส่งแล้ว รอคนอื่น…'); }],
    [900, () => { people[1].classList.add('done'); people[1].textContent = 'บอส ✓ 5.8 วิ'; }],
    [900, () => { people[2].classList.add('done'); people[2].textContent = 'พลอย ✓ 9.1 วิ'; say('ทุกคนตอบครบ → ไปดูผลกัน'); }],
    [TUT.read, () => {}]
  ]);
}

function pageAttack(host, say) {
  const formula = el('div', 'tut-formula');
  formula.append(el('span', 'tut-term', 'เดินสำเร็จ'), el('span', 'tut-op', '+'),
    el('span', 'tut-term', 'ตอบถูก'), el('span', 'tut-op', '='), el('span', 'tut-term tut-term-key', '🛡 ได้โล่'));
  host.appendChild(formula);
  const d = demoMap(host);
  points(host, [
    ['🛡', 'เดินสำเร็จ + ตอบถูก = ได้โล่ กันการโจมตีได้ในรอบนั้น'],
    ['☠', 'Hunter ตอบถูก → โผล่จากท่อในห้องเป้าหมาย: มีโล่ = รอด, ไม่มีโล่ = ตกรอบ'],
    ['🍀', 'Hunter ตอบผิด = รอบนั้นไม่มีการโจมตีเลย']
  ]);
  d.add('a', 'มิ้นท์ 🛡', 'E');
  d.add('b', 'บอส', 'E');
  say('มิ้นท์เดินสำเร็จ+ตอบถูก ได้โล่ · บอสตอบผิด ไม่มีโล่');
  const terms = formula.querySelectorAll('.tut-term');
  runSteps([
    [TUT.beat, () => terms[0].dataset.on = '1'],
    [500, () => terms[1].dataset.on = '1'],
    [500, () => terms[2].dataset.on = '1'],
    [TUT.read, () => say('Hunter ตอบถูก และเลือกห้อง E…')],
    [TUT.beat, async () => {
      await playResultSequence(d.map, d.chars, {
        hunterCorrect: true, hunterTarget: d.room('E'),
        outcomes: { a: 'shielded', b: 'eliminated' }
      });
    }],
    [200, () => { d.banner('มิ้นท์รอดเพราะโล่ · บอสตกรอบ', '', TUT.read + 600); say('ถ้า Hunter ตอบผิด จะไม่มีการโจมตีเลย'); }],
    [TUT.read + 600, () => {}]
  ]);
}

function pageEnd(host, say) {
  const ol = el('ol', 'go-board tut-board-lb');
  const rows = [
    [1, 'มิ้นท์', '5 ข้อ', '21.4 วิ', 'lb-gold'],
    [2, 'พลอย ☠', '5 ข้อ', '30.2 วิ', 'lb-silver'],
    [3, 'บอส', '3 ข้อ', '18.0 วิ', 'lb-bronze lb-out']
  ];
  const lis = rows.map(([r, n, s, t, cls]) => {
    const li = el('li', 'lb-row ' + cls);
    li.append(el('span', 'lb-rank', String(r)), el('span', 'lb-name', n), el('span', 'lb-score', s), el('span', 'lb-time', t));
    li.style.visibility = 'hidden';
    ol.appendChild(li);
    return li;
  });
  host.appendChild(ol);
  points(host, [
    ['🏁', 'เกมจบเมื่อ: หมดเวลา · คำถามหมด · หรือผู้กล้าตกรอบหมด'],
    ['🏆', 'ตารางคะแนน: ตอบถูกมากสุดได้ที่ 1 ถ้าเท่ากัน ใครใช้เวลาตอบรวมน้อยกว่าชนะ'],
    ['🔄', 'หลุดกลางเกม? เปิดเว็บใหม่ แล้วกด "กลับเข้าห้อง"']
  ]);
  say('จบเกมแล้วดูตารางคะแนนกัน');
  runSteps([
    [TUT.beat, () => { lis[0].style.visibility = ''; }],
    [400, () => { lis[1].style.visibility = ''; }],
    [400, () => { lis[2].style.visibility = ''; }],
    [TUT.beat, () => { lis[0].classList.add('tut-glow'); lis[1].classList.add('tut-glow'); say('มิ้นท์กับพลอยถูก 5 ข้อเท่ากัน → มิ้นท์ตอบเร็วกว่า ได้ที่ 1'); }],
    [TUT.read + 1200, () => {}]
  ]);
}

/* ---------------- shell ---------------- */

function build() {
  root = el('div', 'tut hidden');
  root.id = 'tutorial';

  const box = el('div', 'tut-box');
  const head = el('div', 'tut-head');
  const step = el('span', 'tut-step');
  const title = el('h1', 'tut-title');
  head.append(step, title);
  const stage = el('div', 'tut-stage');
  const caption = el('p', 'tut-caption');

  const nav = el('div', 'tut-nav');
  const prev = el('button', 'btn tut-arrow', '‹ ก่อนหน้า');
  const dots = el('div', 'tut-dots');
  const next = el('button', 'btn btn-primary tut-arrow', 'ถัดไป ›');
  const close = el('button', 'btn btn-ghost tut-mini', 'ปิด ✕');
  nav.append(prev, dots, next);

  box.append(close, head, caption, stage, nav);
  root.appendChild(box);
  document.body.appendChild(root);
  stageEl = stage;

  PAGES.forEach((p, i) => {
    const dbtn = el('button', 'tut-dot');
    dbtn.title = p.title;
    dbtn.addEventListener('click', () => goto(i));
    dots.appendChild(dbtn);
  });

  prev.addEventListener('click', () => goto(page - 1));
  next.addEventListener('click', () => (page === PAGES.length - 1 ? closeTutorial() : goto(page + 1)));
  close.addEventListener('click', closeTutorial);
  root.addEventListener('click', (e) => { if (e.target === root) closeTutorial(); });

  root._parts = { title, step, caption, dots, next, prev };
}

function show() {
  const { title, step, caption, dots, next, prev } = root._parts;
  stopEverything();
  stageEl.innerHTML = '';
  title.textContent = PAGES[page].title;
  step.textContent = (page + 1) + '/' + PAGES.length;
  caption.textContent = '';
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i === page));
  next.textContent = page === PAGES.length - 1 ? 'เข้าใจแล้ว ✓' : 'ถัดไป ›';
  prev.disabled = page === 0;
  PAGES[page].build(stageEl, (t) => { caption.textContent = t; });
}

function goto(n) {
  if (!open) return;
  page = Math.max(0, Math.min(PAGES.length - 1, n));
  paused = false;
  show();
}

export function openTutorial() {
  if (!root) build();
  open = true;
  paused = false;
  page = 0;
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
  if (!root || !open) return;
  open = false;
  stopEverything();
  stageEl.innerHTML = '';
  root.classList.add('hidden');
  if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
}

export { wait };
