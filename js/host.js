// HOST = the single authoritative client. Only this file resolves phases,
// assigns roles/spawns/questions, runs timers and decides the winner.

import { signIn, handoff } from './auth.js';
import {
  db, ref, get, set, update, remove, onValue, onDisconnect, runTransaction
} from './firebase.js';
import {
  PHASE, ROLE, TIMING, HUNTER_CHAR_ID,
  MOVE_TIME_SECONDS, DEFAULT_QUIZ_TIME_SECONDS, CLOSE_ROOM_GRACE_MS
} from './gameConfig.js';
import {
  assignRandomStartingRooms, assignRandomRoles, assignQuestionDecks, questionIdFor,
  getTotalRounds, getRandomRoom, decideWinner,
  resolveMove, isCorrect, earnsShield, resolveAttackFor
} from './gameState.js';
import { buildMap } from './map.js';
import { CharacterRenderer } from './characterRenderer.js';
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
let assignment = null;     // hostPrivate/deck: {master, offsets}
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

const serverNow = () => Date.now() + serverOffset;
const isHunterId = (id) => roles[id] === ROLE.HUNTER;
const hunterUid = () => Object.keys(roles).find(isHunterId) || null;

$('bar-code').textContent = code;
$('lobby-code').textContent = code;

init().catch(err => console.error(err));

async function init() {
  if (!handoff.take(code)) { location.href = 'index.html'; return; }

  const user = await signIn();
  uid = user.uid;

  const meta = await get(path('meta'));
  if (!meta.exists() || meta.val().hostUid !== uid) { location.href = 'index.html'; return; }

  onDisconnect(ref(db, base)).remove();

  mapApi = buildMap($('stage'));
  chars = new CharacterRenderer(mapApi);
  chars.add(HUNTER_CHAR_ID, { kind: 'hunter', name: '', roomId: null, hidden: true });

  onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffset = s.val() || 0; });

  onValue(path('players'), s => { players = s.val() || {}; onPlayers(); });
  onValue(path('roles'), s => { roles = s.val() || {}; onPlayers(); });
  onValue(path('positions'), s => { positions = s.val() || {}; syncCharacters(); renderBoard(); });
  onValue(path('actions'), s => { actions = s.val() || {}; tick(); });
  onValue(path('questions'), s => {
    quizCards = s.val() || {};
    startCountdown();          // per-player deadlines may extend the phase timer
    scheduleDeadlineCheck();
    tick();
  });
  onValue(path('hostPrivate/turn'), s => { turnState = s.val() || {}; });
  onValue(path('hostPrivate/deck'), s => { assignment = s.val(); });
  onValue(path('hostPrivate/hunterRoom'), s => { hunterRoom = s.val(); });
  onValue(path('public'), s => { pub = s.val() || {}; onPublic(); });

  $('file').addEventListener('change', onFile);
  $('start').addEventListener('click', startGame);
  for (const id of ['close-bar', 'close-lobby', 'close-over']) {
    $(id).addEventListener('click', closeRoom);
  }
  // Local presentation only: it never touches Firebase or any game state.
  $('tutorial-open').addEventListener('click', openTutorial);
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
  const ul = $('player-list');
  ul.innerHTML = '';
  const names = Object.values(players).map(p => p.displayName || '?');
  if (!names.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'waiting';
    ul.appendChild(li);
    return;
  }
  for (const name of names) {
    const li = document.createElement('li');
    li.textContent = name;
    ul.appendChild(li);
  }
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
    if (!parsed.questions.length) { questionSummary = 'no valid rows'; $('hint').textContent = questionSummary; return; }
    questions = parsed.questions;
    questionById = Object.fromEntries(questions.map(q => [q.id, q]));
    await set(path('hostPrivate/questions'), questions);
    questionSummary = questions.length + ' questions'
      + (parsed.errors.length ? ' / ' + parsed.errors.length + ' skipped' : '');
    if (parsed.errors.length) console.warn('Skipped rows:', parsed.errors);
  } catch (e) {
    console.error(e);
    questionSummary = 'read failed';
  }
  refreshStart();
}

function refreshStart() {
  if (pub.phase && pub.phase !== PHASE.LOBBY) return;
  const count = Object.keys(players).length;
  const hasQuestions = questions.length > 0;
  const ready = count >= 2 && hasQuestions;
  $('start').disabled = !ready;
  if (ready) $('hint').textContent = questionSummary;
  else if (count < 2) $('hint').textContent = 'need 2 players';
  else $('hint').textContent = questionSummary || 'need questions';
}

async function startGame() {
  $('start').disabled = true;
  const ids = Object.keys(players);
  if (ids.length < 2 || !questions.length) { refreshStart(); return; }

  const roleMap = assignRandomRoles(ids);                       // one random Hunter
  const hunter = ids.find(id => roleMap[id] === ROLE.HUNTER);
  const normals = ids.filter(id => id !== hunter);
  const spawns = assignRandomStartingRooms(normals);            // random, may collide
  const deck = assignQuestionDecks(ids, questions.map(q => q.id));

  const updates = {};
  for (const id of ids) {
    updates['roles/' + id] = roleMap[id];
    updates['players/' + id + '/alive'] = true;
    updates['hostPrivate/turn/' + id] = { shield: false, movementSuccess: false };
    updates['positions/' + id] = id === hunter ? null : spawns[id];
  }
  updates['hostPrivate/deck'] = deck;
  updates['hostPrivate/hunterRoom'] = getRandomRoom();   // hidden Hunter fallback
  updates['actions'] = null;
  updates['questions'] = null;
  updates['public/round'] = 1;
  updates['public/totalRounds'] = getTotalRounds(questions);
  updates['public/gameOver'] = null;
  updates['public/question'] = null;
  updates['public/moveResults'] = null;
  updates['public/lockedRoom'] = null;
  updates['public/result'] = null;
  Object.assign(updates, movePhaseUpdates());
  await update(ref(db, base), updates);
}

function movePhaseUpdates() {
  return {
    'public/phase': PHASE.MOVE,
    'public/phaseResolved': false,
    'public/moveStartedAt': serverNow(),
    'public/moveDeadline': serverNow() + MOVE_TIME_SECONDS * 1000
  };
}

async function closeRoom() {
  if (closing) return;
  closing = true;
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
  if (pub.closed) { location.href = 'index.html'; return; }

  const inGame = pub.phase && pub.phase !== PHASE.LOBBY;
  const over = pub.phase === PHASE.ENDED;
  $('lobby').classList.toggle('hidden', !!inGame);
  $('bar').classList.toggle('hidden', !inGame || over);
  $('board').classList.toggle('hidden', !inGame || over);
  $('gameover').classList.toggle('hidden', !over);
  $('phase').textContent = over ? '' : (pub.phase || '');
  $('round').textContent = pub.totalRounds ? 'ROUND ' + (pub.round || 1) + ' / ' + pub.totalRounds : '';

  if (pub.phase === PHASE.MOVE) enterMove();
  else if (pub.phase === PHASE.QUIZ) enterQuiz();
  else if (pub.phase === PHASE.RESULT) enterResult();
  else if (over) renderGameOver();

  startCountdown();
  scheduleDeadlineCheck();
  tick();
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
  const go = pub.gameOver || {};
  $('go-title').textContent = go.winner === ROLE.HUNTER ? 'HUNTER WINS' : 'PLAYERS WIN';
  $('go-reveal').textContent = go.hunterName ? 'Hunter: ' + go.hunterName : '';
  const ul = $('go-survivors');
  ul.innerHTML = '';
  for (const name of go.survivors || []) {
    const li = document.createElement('li');
    li.textContent = name;
    ul.appendChild(li);
  }
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

function tick() {
  if (resolving || closing || !pub.phase) return;
  if (pub.phase === PHASE.MOVE && moveReady()) guard(resolveMovePhase);
  else if (pub.phase === PHASE.QUIZ && quizReady()) guard(resolveQuizPhase);
}

function moveReady() {
  const need = activeIds();
  if (!need.length) return false;
  if (pub.moveDeadline && serverNow() >= pub.moveDeadline) return true;   // timeout
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
  const need = activeIds();
  if (!need.length) return false;
  const ans = actions.answers || {};
  const now = serverNow();
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

  // Individual questions for this round.
  const round = pub.round || 1;
  const quizStartedAt = serverNow();
  // Clear only the cards of users who are no longer active; nulling the whole
  // "questions" node here would collide with the per-uid writes below (Firebase
  // rejects an update containing both a path and its descendant).
  const active = new Set(activeIds());
  for (const id of Object.keys(players)) {
    if (!active.has(id)) updates['questions/' + id] = null;
  }
  for (const id of active) {
    const q = questionById[questionIdFor(assignment, id, round)];
    if (!q) continue;
    const secs = Number(q.timeLimit) > 0 ? Number(q.timeLimit) : DEFAULT_QUIZ_TIME_SECONDS;
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

  const correctFor = (id) => {
    const q = questionById[questionIdFor(assignment, id, round)];
    const card = quizCards[id];
    const a = answers[id];
    if (!q || !a || !inTime(a, card && card.deadline)) return false;  // timeout = wrong
    return isCorrect(a.choice, q.correct);
  };

  const hunterCorrect = hunter ? correctFor(hunter) : false;

  const updates = {};
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

  const winner = decideWinner({
    alivePlayerCount: aliveNormals.length, round, totalRounds
  });

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
    updates['public/gameOver'] = {
      winner,
      hunterUid: hunter || null,
      hunterName: (fresh[hunter] || {}).displayName || '?',
      survivors: aliveNormals.map(id => fresh[id].displayName || '?')
    };
  } else {
    updates['public/round'] = round + 1;
    Object.assign(updates, movePhaseUpdates());
  }
  await update(ref(db, base), updates);
}
