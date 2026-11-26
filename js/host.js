// HOST = the single authoritative client. Only this file resolves phases,
// assigns roles/spawns/questions, runs timers and decides the winner.

import { signIn, lastRoom } from './auth.js';
import {
  db, ref, get, set, update, remove, onValue, onDisconnect, runTransaction
} from './firebase.js';
import {
  PHASE, ROLE, TIMING, HUNTER_CHAR_ID,
  MOVE_TIME_SECONDS, DEFAULT_QUIZ_TIME_SECONDS, CLOSE_ROOM_GRACE_MS,
  MATCH_MINUTE_CHOICES, DEFAULT_MATCH_MINUTES, ROUND_OVERHEAD_SECONDS,
  MIN_MOVE_SECONDS, MIN_QUIZ_SECONDS, PHASE_LABEL
} from './gameConfig.js';
import {
  assignRandomStartingRooms, assignRandomRoles, newQuestionDeck, drawQuestion,
  getTotalRounds, getRandomRoom, decideWinner,
  resolveMove, isCorrect, earnsShield, resolveAttackFor,
  fitMatchTiming, quizSecondsFor, rankLeaderboard, matchTimeUp
} from './gameState.js';
import { buildMap } from './map.js';
import { CharacterRenderer } from './characterRenderer.js';
import { renderGameOverView } from './gameOverView.js';
import { renderLobbyHall } from './lobbyView.js';
import { startMatchClock } from './matchClock.js';
import { parseWorkbook } from './questions.js';
import { blackoutTransition, playResultSequence } from './effects.js';
import { openTutorial } from './tutorial.js';

const $ = (id) => document.getElementById(id);
const code = new URLSearchParams(location.search).get('room');

if (!code) location.href = 'index.html';
const base = 'rooms/' + code;
const path = (p) => ref(db, base + '/' + p);

let uid = null;
let questions = [];        // full imported list, with answer keys (host only)
let questionById = {};
let players = {};
let roles = {};
let positions = {};        // uid -> roomId (host + normal players may read)
let turnState = {};        // hostPrivate/turn: shield + movementSuccess per uid
let deck = null;           // hostPrivate/deck: shared {order, pos, cycle}
let currentQid = null;     // hostPrivate/currentQuestion: this round's question for everyone
let hunterRoom = null;     // hidden fallback room for the Hunter
let pub = {};
let actions = {};
let quizCards = {};        // uid -> {id, deadline}
let mapApi = null;
let chars = null;
let resolving = false;
let lastSequence = null;
let lastRenderedRound = null;
let questionSummary = '';
let serverOffset = 0;
let deadlineTimer = null;
let tickTimer = null;
let closing = false;
let settings = { minutes: DEFAULT_MATCH_MINUTES };   // hostPrivate/settings
let timing = null;         // hostPrivate/timing: {moveSeconds, quizScale}
let stats = {};            // hostPrivate/stats: uid -> {correct, answered, timeMs}

const serverNow = () => Date.now() + serverOffset;
const isHunterId = (id) => roles[id] === ROLE.HUNTER;
const hunterUid = () => Object.keys(roles).find(isHunterId) || null;

$('bar-code').textContent = code;
$('lobby-code').textContent = code;

init().catch(err => console.error(err));

async function init() {
  const user = await signIn();
  uid = user.uid;

  const meta = await get(path('meta'));
  if (!meta.exists() || meta.val().hostUid !== uid) {
    lastRoom.clear(code);
    location.href = 'index.html';
    return;
  }
  lastRoom.save(code, 'host');

  // A dropped Host no longer deletes the room: it is flagged offline and the
  // game waits for it. Only "Close Room" deletes the room.
  onValue(ref(db, '.info/connected'), s => {
    if (s.val() !== true || closing) return;
    onDisconnect(path('public/hostOnline')).set(false);
    set(path('public/hostOnline'), true).catch(() => {});
  });

  // Resume: questions, settings, timing and stats live in hostPrivate.
  const [qSnap, setSnap, timSnap, pubSnap] = await Promise.all([
    get(path('hostPrivate/questions')), get(path('hostPrivate/settings')),
    get(path('hostPrivate/timing')), get(path('public'))
  ]);
  if (Array.isArray(qSnap.val()) && qSnap.val().length) {
    questions = qSnap.val();
    questionById = Object.fromEntries(questions.map(q => [q.id, q]));
    questionSummary = questions.length + ' ข้อ';
  }
  if (setSnap.val()) settings = { ...settings, ...setSnap.val() };
  timing = timSnap.val();
  // A Host that dropped mid-resolution may have left the phase claimed: release it.
  if (pubSnap.val() && pubSnap.val().phaseResolved) await set(path('public/phaseResolved'), false);

  mapApi = buildMap($('stage'));
  chars = new CharacterRenderer(mapApi);
  chars.add(HUNTER_CHAR_ID, { kind: 'hunter', name: '', roomId: null, hidden: true });

  onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffset = s.val() || 0; });

  onValue(path('players'), s => { players = s.val() || {}; onPlayers(); });
  onValue(path('roles'), s => { roles = s.val() || {}; onPlayers(); });
  onValue(path('positions'), s => { positions = s.val() || {}; syncCharacters(); renderBoard(); });
  onValue(path('actions'), s => { actions = s.val() || {}; renderAnsweredCount(); tick(); });
  onValue(path('questions'), s => {
    quizCards = s.val() || {};
    startCountdown();          // per-player deadlines may extend the phase timer
    scheduleDeadlineCheck();
    tick();
  });
  onValue(path('hostPrivate/turn'), s => { turnState = s.val() || {}; });
  onValue(path('hostPrivate/deck'), s => { deck = s.val(); });
  onValue(path('hostPrivate/currentQuestion'), s => { currentQid = s.val(); renderHostQuestion(); });
  onValue(path('hostPrivate/hunterRoom'), s => { hunterRoom = s.val(); });
  onValue(path('hostPrivate/timing'), s => { timing = s.val(); });
  onValue(path('hostPrivate/stats'), s => { stats = s.val() || {}; });
  onValue(path('public'), s => { pub = s.val() || {}; onPublic(); });

  $('file').addEventListener('change', onFile);
  $('start').addEventListener('click', startGame);
  for (const id of ['close-bar', 'close-lobby', 'close-over']) {
    $(id).addEventListener('click', closeRoom);
  }
  // Local presentation only: it never touches Firebase or any game state.
  $('tutorial-open').addEventListener('click', openTutorial);
  renderTimeChoices();
  startMatchClock($('game-clock'), () => pub.gameEndsAt, serverNow);
}

/* ---------------- match length ---------------- */

function renderTimeChoices() {
  const box = $('time-choices');
  box.innerHTML = '';
  for (const m of MATCH_MINUTE_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (settings.minutes === m ? ' active' : '');
    b.textContent = m ? m + ' นาที' : 'ไม่จำกัด';
    b.addEventListener('click', async () => {
      settings = { ...settings, minutes: m };
      renderTimeChoices();
      refreshStart();
      await set(path('hostPrivate/settings'), settings).catch(e => console.error(e));
    });
    box.appendChild(b);
  }
}

function currentFit() {
  return fitMatchTiming({
    questions, minutes: settings.minutes, moveSeconds: MOVE_TIME_SECONDS,
    defaultQuizSeconds: DEFAULT_QUIZ_TIME_SECONDS, overheadSeconds: ROUND_OVERHEAD_SECONDS,
    minMove: MIN_MOVE_SECONDS, minQuiz: MIN_QUIZ_SECONDS
  });
}

function timingSummary() {
  if (settings.minutes) {
    return 'เล่นไปเรื่อยๆ ' + settings.minutes + ' นาที คำถามสุ่มทีละข้อ ครบแล้วสุ่มวนซ้ำ';
  }
  if (!questions.length) return 'เล่นจนครบทุกข้อ';
  const mins = Math.ceil(currentFit().estimateSeconds / 60);
  return 'เล่นจนครบ ' + questions.length + ' ข้อ (ประมาณ ' + mins + ' นาที)';
}

/* ---------------- lobby ---------------- */

function onPlayers() {
  renderLobbyList();
  syncCharacters();
  refreshStart();
  cleanupDeparted();
  tick();
}

// Names only. No roles are shown, and none exist before Start.
function renderLobbyList() {
  renderLobbyHall($('player-list'), players);
  const n = Object.values(players).filter(p => p.connected !== false).length;
  $('player-count').textContent = n + ' คน';
}

/** A user who pressed Leave (or vanished) leaves derived state behind. */
async function cleanupDeparted() {
  if (closing) return;
  const stale = new Set([
    ...Object.keys(roles), ...Object.keys(positions), ...Object.keys(quizCards)
  ].filter(id => !players[id]));
  if (!stale.size) return;
  const updates = {};
  for (const id of stale) {
    updates['roles/' + id] = null;
    updates['positions/' + id] = null;
    updates['questions/' + id] = null;
    updates['actions/moves/' + id] = null;
    updates['actions/answers/' + id] = null;
    updates['actions/hunter/' + id] = null;
    updates['hostPrivate/turn/' + id] = null;
  }
  await update(ref(db, base), updates).catch(e => console.error(e));
}

async function onFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const parsed = await parseWorkbook(buf);
    if (!parsed.questions.length) { questionSummary = 'ไม่พบคำถามที่ใช้ได้'; $('hint').textContent = questionSummary; return; }
    questions = parsed.questions;
    questionById = Object.fromEntries(questions.map(q => [q.id, q]));
    await set(path('hostPrivate/questions'), questions);
    questionSummary = questions.length + ' ข้อ'
      + (parsed.errors.length ? ' (ข้าม ' + parsed.errors.length + ' แถว)' : '');
    if (parsed.errors.length) console.warn('Skipped rows:', parsed.errors);
  } catch (e) {
    console.error(e);
    questionSummary = 'อ่านไฟล์ไม่สำเร็จ';
  }
  refreshStart();
}

function refreshStart() {
  if (pub.phase && pub.phase !== PHASE.LOBBY) return;
  const count = Object.values(players).filter(p => p.connected !== false).length;
  const hasQuestions = questions.length > 0;
  const ready = count >= 2 && hasQuestions;
  $('start').disabled = !ready;
  $('q-summary').textContent = questionSummary || 'ยังไม่มีคำถาม';
  $('q-summary').classList.toggle('ok', hasQuestions);
  $('time-summary').textContent = timingSummary();
  if (ready) $('hint').textContent = 'พร้อมออกผจญภัย!';
  else if (count < 2) $('hint').textContent = 'ต้องมีผู้เล่นอย่างน้อย 2 คน';
  else $('hint').textContent = 'อัปโหลดไฟล์คำถาม (.xlsx) ก่อน';
}

async function startGame() {
  $('start').disabled = true;
  // Players who dropped out of the lobby are left behind.
  const ids = Object.keys(players).filter(id => players[id].connected !== false);
  if (ids.length < 2 || !questions.length) { refreshStart(); return; }
  // Same question for everyone, normal timers. With a match length the game runs
  // until the clock ends it and the deck cycles; without one it is one pass.
  timing = { moveSeconds: MOVE_TIME_SECONDS, quizScale: 1 };

  const roleMap = assignRandomRoles(ids);                       // one random Hunter
  const hunter = ids.find(id => roleMap[id] === ROLE.HUNTER);
  const normals = ids.filter(id => id !== hunter);
  const spawns = assignRandomStartingRooms(normals);            // random, may collide

  const updates = {};
  for (const id of Object.keys(players)) {
    if (!ids.includes(id)) updates['players/' + id] = null;
  }
  updates['hostPrivate/timing'] = timing;
  updates['hostPrivate/settings'] = settings;
  updates['hostPrivate/stats'] = null;
  updates['public/gameEndsAt'] = settings.minutes ? serverNow() + settings.minutes * 60000 : null;
  updates['public/matchMinutes'] = settings.minutes || 0;
  for (const id of ids) {
    updates['roles/' + id] = roleMap[id];
    updates['players/' + id + '/alive'] = true;
    updates['hostPrivate/turn/' + id] = { shield: false, movementSuccess: false };
    updates['positions/' + id] = id === hunter ? null : spawns[id];
  }
  updates['hostPrivate/deck'] = newQuestionDeck(questions.map(q => q.id));
  updates['hostPrivate/currentQuestion'] = null;
  updates['hostPrivate/hunterRoom'] = getRandomRoom();   // hidden Hunter fallback
  updates['actions'] = null;
  updates['questions'] = null;
  updates['public/round'] = 1;
  updates['public/totalRounds'] = settings.minutes ? 0 : getTotalRounds(questions);
  updates['public/gameOver'] = null;
  updates['public/question'] = null;
  updates['public/moveResults'] = null;
  updates['public/lockedRoom'] = null;
  updates['public/result'] = null;
  Object.assign(updates, movePhaseUpdates());
  await update(ref(db, base), updates);
}

function movePhaseUpdates() {
  const secs = (timing && timing.moveSeconds) || MOVE_TIME_SECONDS;
  return {
    'public/phase': PHASE.MOVE,
    'public/phaseResolved': false,
    'public/moveStartedAt': serverNow(),
    'public/moveDeadline': serverNow() + secs * 1000
  };
}

async function closeRoom() {
  if (closing) return;
  closing = true;
  lastRoom.clear(code);
  clearTimers();
  try {
    await set(path('public/closed'), true);
    await new Promise(r => setTimeout(r, CLOSE_ROOM_GRACE_MS));
    await remove(ref(db, base));
  } catch (e) {
    console.error(e);
  }
  location.href = 'index.html';
}

/* ---------------- rendering ---------------- */

function syncCharacters() {
  for (const [id, p] of Object.entries(players)) {
    if (isHunterId(id)) continue;                 // Hunter is never a map character
    if (!chars.has(id)) {
      chars.add(id, { kind: 'player', name: p.displayName || '', roomId: positions[id] || null });
    }
    chars.setEliminated(id, p.alive === false);
  }
  for (const id of [...chars.chars.keys()]) {
    if (id !== HUNTER_CHAR_ID && (!players[id] || isHunterId(id))) chars.remove(id);
  }
}

/** Spawns stay hidden from the Host until the first movement has resolved. */
function positionsRevealed() {
  return !(pub.round === 1 && pub.phase === PHASE.MOVE);
}

function renderBoard() {
  if (!mapApi) return;
  const reveal = positionsRevealed();
  for (const id of Object.keys(players)) {
    if (!chars.has(id)) continue;
    chars.setHidden(id, !reveal);
    if (reveal && pub.phase === PHASE.MOVE) chars.setRoom(id, positions[id] || null);
  }
  chars.layoutAll();   // occupancy offsets change when sprites appear/disappear
}

function onPublic() {
  if (pub.closed) { lastRoom.clear(code); location.href = 'index.html'; return; }

  const inGame = pub.phase && pub.phase !== PHASE.LOBBY;
  const over = pub.phase === PHASE.ENDED;
  $('lobby').classList.toggle('hidden', !!inGame);
  $('bar').classList.toggle('hidden', !inGame || over);
  $('board').classList.toggle('hidden', !inGame || over);
  $('gameover').classList.toggle('hidden', !over);
  $('phase').textContent = over ? '' : (PHASE_LABEL[pub.phase] || '');
  $('round').textContent = pub.round ? 'รอบ ' + pub.round + (pub.totalRounds ? '/' + pub.totalRounds : '') : '';
  if (!inGame) refreshStart();

  renderHostQuestion();
  if (pub.phase === PHASE.MOVE) enterMove();
  else if (pub.phase === PHASE.QUIZ) enterQuiz();
  else if (pub.phase === PHASE.RESULT) enterResult();
  else if (over) renderGameOver();

  startCountdown();
  scheduleDeadlineCheck();
  tick();
}

/* ---------------- question on the Host screen ---------------- */

const LETTERS = ['A', 'B', 'C', 'D'];

/** The round's question, big, for the room to read. Correct answer only in RESULT. */
function renderHostQuestion() {
  const box = $('host-quiz');
  if (!box) return;
  const show = (pub.phase === PHASE.QUIZ || pub.phase === PHASE.RESULT) && currentQid && questionById[currentQid];
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const q = questionById[currentQid];
  const reveal = pub.phase === PHASE.RESULT;
  if (box.dataset.qid !== currentQid + ':' + pub.round) {
    box.dataset.qid = currentQid + ':' + pub.round;
    $('hq-text').textContent = q.text;
    const ol = $('hq-choices');
    ol.innerHTML = '';
    (q.choices || []).forEach((text, i) => {
      const li = document.createElement('li');
      li.dataset.letter = LETTERS[i];
      const tag = document.createElement('span');
      tag.className = 'hq-letter';
      tag.textContent = LETTERS[i];
      const t = document.createElement('span');
      t.textContent = text;
      li.append(tag, t);
      ol.appendChild(li);
    });
  }
  const correct = Array.isArray(q.correct) ? q.correct : [q.correct];
  for (const li of $('hq-choices').children) {
    li.classList.toggle('correct', reveal && correct.map(String).includes(li.dataset.letter));
  }
  box.classList.toggle('revealed', reveal);
  renderAnsweredCount();
}

function renderAnsweredCount() {
  const el = $('hq-count');
  if (!el) return;
  const need = activeIds();
  const ans = actions.answers || {};
  const n = need.filter(id => ans[id] && ans[id].choice).length;
  el.textContent = pub.phase === PHASE.RESULT ? 'เฉลย' : 'ตอบแล้ว ' + n + '/' + need.length;
}

function enterMove() {
  // No Host blackout any more: the map is visible, the choices are not.
  mapApi.clearRoomStates();
  mapApi.resetCamera();
  chars.setHidden(HUNTER_CHAR_ID, true);
  renderBoard();
  lastRenderedRound = null;
}

function enterQuiz() {
  mapApi.clearRoomStates();
  if (pub.lockedRoom) mapApi.setRoomState(pub.lockedRoom, 'locked-reveal');
  chars.setHidden(HUNTER_CHAR_ID, true);
  renderBoard();
  if (lastRenderedRound === pub.round) return;
  lastRenderedRound = pub.round;
  const results = pub.moveResults || {};
  for (const [id, r] of Object.entries(results)) {
    if (!chars.has(id)) continue;
    if (r.success) chars.moveCharacter(id, r.to);
    else chars.stayIdle(id);
  }
}

async function enterResult() {
  const result = pub.result;
  if (!result || lastSequence === result.sequenceId) return;
  lastSequence = result.sequenceId;
  await playResultSequence(mapApi, chars, result);
  await endRound();
}

function renderGameOver() {
  clearTimers();
  lastRoom.clear(code);
  renderGameOverView(pub.gameOver || {});
}

/* ---------------- countdown display ---------------- */

function clearTimers() {
  if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  countdownKey = null;
}

// Keyed like the client so a re-render never churns or stacks timers.
// A tick only writes the timer element; it never re-enters the render path.
let countdownKey = null;

function startCountdown() {
  const dl = currentDeadline();
  const key = dl ? (pub.phase + ':' + pub.round + ':' + dl) : null;
  if (key === countdownKey) return;
  countdownKey = key;

  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (!dl) { $('timer').textContent = ''; return; }

  // Recompute per tick: the quiz deadline is the max across per-player cards,
  // which can still be arriving when the phase starts.
  const paint = () => {
    const d = currentDeadline();
    $('timer').textContent = d ? String(Math.max(0, Math.ceil((d - serverNow()) / 1000))) : '';
  };
  paint();
  tickTimer = setInterval(paint, 250);
}

/** Latest deadline the Host is waiting on for the current phase. */
function currentDeadline() {
  if (pub.phase === PHASE.MOVE) return pub.moveDeadline || null;
  if (pub.phase === PHASE.QUIZ) {
    const ds = Object.values(quizCards).map(c => c.deadline).filter(Boolean);
    return ds.length ? Math.max(...ds) : null;
  }
  return null;
}

/** Wake the Host at the deadline; the deadline itself is the source of truth. */
function scheduleDeadlineCheck() {
  if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
  const dl = currentDeadline();
  if (!dl) return;
  deadlineTimer = setTimeout(() => { deadlineTimer = null; tick(); },
    Math.max(50, dl - serverNow() + 120));
}

/* ---------------- authoritative resolution ---------------- */

/** Everyone still in the room with a role and alive. */
function activeIds() {
  return Object.keys(players).filter(id =>
    roles[id] && (isHunterId(id) || players[id].alive !== false));
}

/** Active and online: the only ones a phase waits for before its deadline. */
const waitingFor = () => activeIds().filter(id => players[id].connected !== false);

function tick() {
  if (resolving || closing || !pub.phase) return;
  if (pub.phase === PHASE.MOVE && moveReady()) guard(resolveMovePhase);
  else if (pub.phase === PHASE.QUIZ && quizReady()) guard(resolveQuizPhase);
}

function moveReady() {
  if (!activeIds().length) return false;
  if (pub.moveDeadline && serverNow() >= pub.moveDeadline) return true;   // timeout
  const need = waitingFor();
  if (!need.length) return false;
  const moves = actions.moves || {};
  const hunter = hunterUid();
  for (const id of need) {
    if (id === hunter) {
      const a = (actions.hunter || {})[id];
      if (!a || !a.target) return false;          // lock stays optional
    } else if (!moves[id] || !moves[id].target) {
      return false;
    }
  }
  return true;
}

function quizReady() {
  const all = activeIds();
  if (!all.length) return false;
  const ans = actions.answers || {};
  const now = serverNow();
  // Offline participants are not waited for: no answer counts as wrong.
  const need = waitingFor();
  if (!need.length) return all.every(id => { const c = quizCards[id]; return !c || (c.deadline && now >= c.deadline); });
  return need.every(id => {
    if (ans[id] && ans[id].choice) return true;
    const card = quizCards[id];
    return card && card.deadline && now >= card.deadline;   // individual timeout
  });
}

async function guard(fn) {
  resolving = true;
  try {
    const res = await runTransaction(path('public/phaseResolved'), cur => (cur ? undefined : true));
    if (res.committed) await fn();
  } catch (e) {
    console.error(e);
  } finally {
    resolving = false;
  }
}

/** An action only counts if it was written before the deadline. */
function inTime(action, deadline) {
  if (!action) return false;
  if (!deadline) return true;
  return typeof action.at === 'number' ? action.at <= deadline : true;
}

async function resolveMovePhase() {
  const hunter = hunterUid();
  const deadline = pub.moveDeadline || null;
  const hunterAct = inTime((actions.hunter || {})[hunter], deadline)
    ? (actions.hunter || {})[hunter] : null;

  // Timeout rules: no lock is ever carried over; the target falls back to the
  // Hunter's last/hidden room.
  const locked = (hunterAct && hunterAct.lock) || null;
  const target = (hunterAct && hunterAct.target) || hunterRoom || getRandomRoom();

  const moves = actions.moves || {};
  const updates = {};
  const moveResults = {};

  for (const id of Object.keys(players)) {
    if (isHunterId(id) || players[id].alive === false) continue;
    const act = inTime(moves[id], deadline) ? moves[id] : null;
    const r = resolveMove(positions[id] || null, act && act.target, locked);
    moveResults[id] = r;
    updates['positions/' + id] = r.to;
    updates['hostPrivate/turn/' + id + '/movementSuccess'] = r.success;
  }

  // One question for everyone this round, drawn from the shared cycling deck.
  const quizStartedAt = serverNow();
  const allIds = questions.map(q => q.id);
  const drawn = drawQuestion(deck, allIds);
  const q = questionById[drawn.id];
  updates['hostPrivate/deck'] = drawn.deck;
  updates['hostPrivate/currentQuestion'] = drawn.id;
  const secs = quizSecondsFor(q, (timing && timing.quizScale) || 1,
    DEFAULT_QUIZ_TIME_SECONDS, MIN_QUIZ_SECONDS);
  // Clear only the cards of users who are no longer active; nulling the whole
  // "questions" node here would collide with the per-uid writes below (Firebase
  // rejects an update containing both a path and its descendant).
  const active = new Set(activeIds());
  for (const id of Object.keys(players)) {
    if (!active.has(id)) updates['questions/' + id] = null;
  }
  for (const id of active) {
    if (!q) continue;
    updates['questions/' + id] = {
      id: q.id, text: q.text, choices: q.choices,
      timeLimit: secs, deadline: quizStartedAt + secs * 1000
    };
  }

  updates['hostPrivate/hunterTarget'] = target;
  updates['hostPrivate/hunterRoom'] = target;          // becomes next round's fallback
  updates['public/moveResults'] = moveResults;
  updates['public/lockedRoom'] = locked;               // revealed only now
  updates['public/quizStartedAt'] = quizStartedAt;
  updates['public/phase'] = PHASE.QUIZ;
  updates['public/phaseResolved'] = false;
  await update(ref(db, base), updates);
}

async function resolveQuizPhase() {
  const round = pub.round || 1;
  const answers = actions.answers || {};
  const hunter = hunterUid();
  const targetSnap = await get(path('hostPrivate/hunterTarget'));
  const hunterTarget = targetSnap.val() || null;
  const qid = (await get(path('hostPrivate/currentQuestion'))).val();
  const q = questionById[qid];

  const correctFor = (id) => {
    const card = quizCards[id];
    const a = answers[id];
    if (!q || !a || !inTime(a, card && card.deadline)) return false;  // timeout = wrong
    return isCorrect(a.choice, q.correct);
  };

  const hunterCorrect = hunter ? correctFor(hunter) : false;

  const updates = {};

  // Leaderboard stats for everyone who had a question this round.
  const startedAt = pub.quizStartedAt || 0;
  for (const id of Object.keys(quizCards)) {
    if (!players[id] || !roles[id]) continue;
    const card = quizCards[id];
    const limitMs = (card.timeLimit || DEFAULT_QUIZ_TIME_SECONDS) * 1000;
    const a = answers[id];
    const ok = !!(a && inTime(a, card.deadline));
    const took = ok && typeof a.at === 'number' && startedAt
      ? Math.min(limitMs, Math.max(0, a.at - startedAt)) : limitMs;
    const prev = stats[id] || { correct: 0, answered: 0, timeMs: 0 };
    updates['hostPrivate/stats/' + id] = {
      correct: prev.correct + (correctFor(id) ? 1 : 0),
      answered: prev.answered + (ok ? 1 : 0),
      timeMs: prev.timeMs + took
    };
  }
  const outcomes = {};
  const resolved = {};

  for (const id of Object.keys(players)) {
    if (isHunterId(id) || players[id].alive === false) continue;
    const moved = (turnState[id] || {}).movementSuccess === true;
    const shield = earnsShield(moved, correctFor(id));      // rule unchanged
    updates['hostPrivate/turn/' + id + '/shield'] = shield;
    resolved[id] = { currentRoom: positions[id] || null, shield };
  }

  for (const [id, p] of Object.entries(resolved)) {
    const outcome = resolveAttackFor(p, hunterCorrect, hunterTarget);
    outcomes[id] = outcome;
    if (outcome === 'eliminated') updates['players/' + id + '/alive'] = false;
  }

  updates['public/result'] = {
    sequenceId: round + ':' + Date.now(),
    hunterCorrect,
    hunterTarget,
    outcomes
  };
  updates['public/phase'] = PHASE.RESULT;
  updates['public/phaseResolved'] = false;
  await update(ref(db, base), updates);
}

async function endRound() {
  await blackoutTransition(TIMING.blackoutDuration);
  chars.setHidden(HUNTER_CHAR_ID, true);

  const fresh = (await get(path('players'))).val() || {};
  const round = pub.round || 1;
  const totalRounds = pub.totalRounds || 0;
  const aliveNormals = Object.keys(fresh)
    .filter(id => !isHunterId(id) && fresh[id].alive !== false);

  let winner = decideWinner({
    alivePlayerCount: aliveNormals.length, round, totalRounds
  });
  let reason = winner ? 'rounds' : null;
  // Match clock: when time is up the game ends after this round.
  if (!winner && matchTimeUp(pub.gameEndsAt, serverNow())) {
    winner = aliveNormals.length ? 'players' : ROLE.HUNTER;
    reason = 'time';
  }

  const updates = {};
  for (const id of Object.keys(fresh)) {
    updates['hostPrivate/turn/' + id] = { shield: false, movementSuccess: false };
  }
  updates['actions'] = null;                 // no stale submissions survive a round
  updates['public/moveResults'] = null;
  updates['public/lockedRoom'] = null;
  updates['public/result'] = null;
  updates['public/phaseResolved'] = false;

  if (winner) {
    const hunter = hunterUid();
    updates['questions'] = null;
    updates['public/phase'] = PHASE.ENDED;
    const finalStats = (await get(path('hostPrivate/stats'))).val() || {};
    const who = {};
    for (const id of Object.keys(fresh)) {
      if (!roles[id]) continue;
      who[id] = { name: fresh[id].displayName || '?', role: roles[id], alive: fresh[id].alive !== false };
    }
    updates['public/gameOver'] = {
      winner,
      reason,
      hunterUid: hunter || null,
      hunterName: (fresh[hunter] || {}).displayName || '?',
      survivors: aliveNormals.map(id => fresh[id].displayName || '?'),
      leaderboard: rankLeaderboard(finalStats, who)
    };
  } else {
    updates['public/round'] = round + 1;
    Object.assign(updates, movePhaseUpdates());
  }
  await update(ref(db, base), updates);
}
