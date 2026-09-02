// PLAYER / HUNTER client. Renders Firebase state and submits private choices.
// It never decides an authoritative result and only ever reads its OWN role,
// question and submissions.

import { signIn, handoff } from './auth.js';
import { db, ref, get, set, update, remove, onValue, onDisconnect, serverTimestamp } from './firebase.js';
import { PHASE, ROLE, HUNTER_CHAR_ID } from './gameConfig.js';
import { buildMap, ROOM_IDS, ADJACENCY } from './map.js';
import { CharacterRenderer } from './characterRenderer.js';
import { playResultSequence } from './effects.js';

const $ = (id) => document.getElementById(id);
const LETTERS = ['A', 'B', 'C', 'D'];

const code = new URLSearchParams(location.search).get('room');
if (!code) location.href = 'index.html';

const base = 'rooms/' + code;
const path = (p) => ref(db, base + '/' + p);

let uid = null;
let me = {};
let myRole = null;
let players = {};
let positions = {};      // Players always; the Hunter only during QUIZ/RESULT
let pub = {};
let myCard = null;       // my own question for this round
let mapApi = null;
let chars = null;
let hunterMode = 'target';
let myMove = null;
let myHunter = { target: null, lock: null };
let myAnswer = null;
let selectedChoice = null;
let lastRenderedRound = null;
let lastSequence = null;
let serverOffset = 0;
let leaving = false;

const serverNow = () => Date.now() + serverOffset;
const isHunter = () => myRole === ROLE.HUNTER;
const isAlive = () => me.alive !== false;

$('bar-code').textContent = code;
$('lobby-code').textContent = code;

init().catch(e => console.error(e));

async function init() {
  if (!handoff.take(code)) { location.href = 'index.html'; return; }

  const user = await signIn();
  uid = user.uid;

  const mine = await get(path('players/' + uid));
  if (!mine.exists()) { location.href = 'index.html'; return; }

  await update(path('players/' + uid), { connected: true });
  onDisconnect(path('players/' + uid)).remove();

  mapApi = buildMap($('stage'));
  chars = new CharacterRenderer(mapApi);
  chars.add(HUNTER_CHAR_ID, { kind: 'hunter', name: '', roomId: null, hidden: true });
  mapApi.onRoomClick(onRoomClick);

  onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffset = s.val() || 0; });
  onValue(path('meta'), s => { if (!s.exists()) goHome(); });
  onValue(path('public/closed'), s => { if (s.val()) goHome(); });
  onValue(path('players'), s => { players = s.val() || {}; me = players[uid] || {}; syncCharacters(); render(); });
  onValue(path('roles/' + uid), s => {
    myRole = s.val();
    syncPositionsSubscription();
    syncCharacters(); render();
  });
  onValue(path('public'), s => { pub = s.val() || {}; render(); });
  onValue(path('questions/' + uid), s => { myCard = s.val(); render(); });
  onValue(path('actions/moves/' + uid), s => { myMove = s.val(); render(); });
  onValue(path('actions/hunter/' + uid), s => { myHunter = s.val() || { target: null, lock: null }; render(); });
  onValue(path('actions/answers/' + uid), s => { myAnswer = s.val(); render(); });

  for (const id of ['leave-bar', 'leave-lobby', 'leave-over']) {
    $(id).addEventListener('click', leaveRoom);
  }
  $('q-submit').addEventListener('click', submitAnswer);
}

/**
 * Positions subscription.
 *
 * Normal Players may always read them. The Hunter may read them only during QUIZ
 * and RESULT - the rules deny it during MOVE, so the listener is attached and
 * detached as the phase changes rather than left running.
 */
let positionsUnsub = null;

function hunterMaySeePositions() {
  return pub.phase === PHASE.QUIZ || pub.phase === PHASE.RESULT;
}

function wantPositions() {
  if (myRole === ROLE.PLAYER) return true;
  if (myRole === ROLE.HUNTER) return hunterMaySeePositions();
  return false;
}

function syncPositionsSubscription() {
  const want = wantPositions();
  if (want && !positionsUnsub) {
    positionsUnsub = onValue(path('positions'),
      s => { positions = s.val() || {}; syncCharacters(); render(); },
      () => {                       // read revoked (Hunter entering MOVE)
        positionsUnsub = null;
        positions = {};
        syncCharacters();
      });
  } else if (!want && positionsUnsub) {
    positionsUnsub();
    positionsUnsub = null;
    positions = {};                 // the Hunter keeps nothing between rounds
    syncCharacters();
  }
}

function goHome() {
  if (leaving) return;
  leaving = true;
  stopCountdown();
  location.href = 'index.html';
}

async function leaveRoom() {
  if (leaving) return;
  leaving = true;
  stopCountdown();
  if (positionsUnsub) { positionsUnsub(); positionsUnsub = null; }
  try {
    await remove(path('actions/moves/' + uid));
    await remove(path('actions/answers/' + uid));
    await remove(path('actions/hunter/' + uid));
    await remove(path('players/' + uid));   // Host clears the derived state
  } catch (e) { console.error(e); }
  location.href = 'index.html';
}

/* ---------------- characters ---------------- */

/** Player sprites are hidden from the Hunter during MOVE, shown in QUIZ/RESULT. */
function playerSpritesVisible() {
  return !isHunter() || hunterMaySeePositions();
}

function syncCharacters() {
  if (!playerSpritesVisible()) {
    for (const id of [...chars.chars.keys()]) if (id !== HUNTER_CHAR_ID) chars.remove(id);
    return;
  }
  for (const [id, p] of Object.entries(players)) {
    const room = positions[id] || null;
    if (!chars.has(id)) chars.add(id, { kind: 'player', name: p.displayName || '', roomId: room });
    chars.setEliminated(id, p.alive === false);
  }
  for (const id of [...chars.chars.keys()]) {
    if (id !== HUNTER_CHAR_ID && !players[id]) chars.remove(id);
  }
}

/* ---------------- render ---------------- */

let rendering = false;

function render() {
  if (!mapApi || leaving) return;
  if (rendering) return;            // secondary guard; the recursion itself is gone
  rendering = true;
  try {
    syncPositionsSubscription();    // Hunter gains/loses positions with the phase
    const inGame = pub.phase && pub.phase !== PHASE.LOBBY;
    const over = pub.phase === PHASE.ENDED;

    $('lobby').classList.toggle('hidden', !!inGame);
    $('bar').classList.toggle('hidden', !inGame || over);
    $('board').classList.toggle('hidden', !inGame || over);
    $('gameover').classList.toggle('hidden', !over);
    $('phase').textContent = over ? '' : (pub.phase || '');
    $('round').textContent = pub.totalRounds ? 'ROUND ' + (pub.round || 1) + ' / ' + pub.totalRounds : '';

    if (!inGame) renderLobby();
    else if (over) renderGameOver();
    else if (pub.phase === PHASE.MOVE) renderMove();
    else if (pub.phase === PHASE.QUIZ) renderQuiz();
    else if (pub.phase === PHASE.RESULT) renderResult();

    // Exactly one countdown call site, after the phase has been drawn.
    ensureCountdown(inGame && !over ? countdownSpec() : null);
  } finally {
    rendering = false;
  }
}

function renderLobby() {
  $('quiz').classList.add('hidden');
  $('controls').innerHTML = '';
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

const moveExpired = () => !!(pub.moveDeadline && serverNow() >= pub.moveDeadline);
const quizExpired = () => !!(myCard && myCard.deadline && serverNow() >= myCard.deadline);

function renderMove() {
  $('quiz').classList.add('hidden');
  mapApi.resetCamera();
  lastRenderedRound = null;
  chars.setHidden(HUNTER_CHAR_ID, true);

  if (playerSpritesVisible()) {
    for (const [id] of Object.entries(players)) {
      if (chars.has(id)) chars.setRoom(id, positions[id] || null);
    }
  }
  mapApi.clearRoomStates();

  if (!isAlive()) {
    $('controls').innerHTML = '';
    $('status').textContent = 'out';
    return;
  }

  const expired = moveExpired();

  if (isHunter()) {
    for (const id of ROOM_IDS) {
      let state = 'selectable';
      if (myHunter.target === id && myHunter.lock === id) state = 'target-lock';
      else if (myHunter.target === id) state = 'target';
      else if (myHunter.lock === id) state = 'lock';
      mapApi.setRoomState(id, expired ? 'blocked' : state);
    }
    renderHunterControls(expired);
    $('status').textContent = expired ? 'locked in' : '';
  } else {
    const here = positions[uid] || null;
    for (const id of ROOM_IDS) {
      const reachable = !expired && (ADJACENCY[here] || []).includes(id);
      mapApi.setRoomState(id, reachable ? 'reachable' : 'blocked');
    }
    if (myMove && myMove.target) mapApi.setRoomState(myMove.target, 'chosen');
    $('controls').innerHTML = '';
    $('controls').dataset.mode = '';
    $('status').textContent = (myMove && myMove.target) ? 'wait' : (expired ? 'no move' : '');
  }
}

function renderHunterControls(expired) {
  const el = $('controls');
  const key = hunterMode + ':' + (expired ? 'off' : 'on');
  if (el.dataset.mode === key && el.childElementCount) return;
  el.dataset.mode = key;
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'mode';
  for (const mode of ['target', 'lock']) {
    const b = document.createElement('button');
    b.className = 'btn' + (hunterMode === mode ? ' active' : '');
    b.textContent = mode === 'target' ? 'Target' : 'Lock';
    b.disabled = expired;
    b.addEventListener('click', () => { hunterMode = mode; el.dataset.mode = ''; render(); });
    wrap.appendChild(b);
  }
  el.appendChild(wrap);
}

function renderQuiz() {
  mapApi.clearRoomStates();
  if (pub.lockedRoom) mapApi.setRoomState(pub.lockedRoom, 'locked-reveal');
  $('controls').innerHTML = '';
  $('controls').dataset.mode = '';

  if (lastRenderedRound !== pub.round) {
    lastRenderedRound = pub.round;
    if (!isHunter()) {
      const results = pub.moveResults || {};
      for (const [id, r] of Object.entries(results)) {
        if (!chars.has(id)) continue;
        if (r.success) chars.moveCharacter(id, r.to);
        else chars.stayIdle(id);
      }
    }
  }

  if (!isAlive() || !myCard) {
    $('quiz').classList.add('hidden');
    $('status').textContent = isAlive() ? 'wait' : 'out';
    return;
  }

  $('quiz').classList.remove('hidden');
  const qKey = pub.round + ':' + myCard.id;
  if ($('quiz').dataset.qid !== qKey) {
    $('quiz').dataset.qid = qKey;
    selectedChoice = null;
    $('q-text').textContent = myCard.text;
    const box = $('q-choices');
    box.innerHTML = '';
    (myCard.choices || []).forEach((text, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.dataset.letter = LETTERS[i];
      b.textContent = LETTERS[i] + '. ' + text;
      b.addEventListener('click', () => {
        if ((myAnswer && myAnswer.choice) || quizExpired()) return;
        selectedChoice = LETTERS[i];
        render();
      });
      box.appendChild(b);
    });
  }

  const submitted = !!(myAnswer && myAnswer.choice);
  const expired = quizExpired();
  const shown = submitted ? myAnswer.choice : selectedChoice;
  [...$('q-choices').children].forEach(c => {
    c.classList.toggle('selected', c.dataset.letter === shown);
    c.disabled = submitted || expired;
  });
  $('q-submit').disabled = submitted || expired || !selectedChoice;
  $('status').textContent = submitted ? 'wait' : (expired ? 'no answer' : '');
}

async function submitAnswer() {
  if (!selectedChoice || !isAlive() || quizExpired()) return;
  $('q-submit').disabled = true;
  await set(path('actions/answers/' + uid), { choice: selectedChoice, at: serverTimestamp() });
}

async function renderResult() {
  $('quiz').classList.add('hidden');
  $('controls').innerHTML = '';
  $('status').textContent = '';
  mapApi.clearRoomStates();
  const result = pub.result;
  if (!result || lastSequence === result.sequenceId) return;
  lastSequence = result.sequenceId;
  await playResultSequence(mapApi, chars, result);
}

function renderGameOver() {
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

/* ---------------- countdown (display only) ---------------- */

/**
 * Countdown lifecycle.
 *
 * One timer at a time, identified by `key`. Re-rendering with the same key is a
 * no-op, so render() can be called freely without restarting or re-expiring it.
 * A tick only writes the timer element - it never calls render().
 */
const countdown = { key: null, timer: null, expired: false };

function stopCountdown() {
  if (countdown.timer) clearInterval(countdown.timer);
  countdown.timer = null;
  countdown.key = null;
  countdown.expired = false;
}

/** Timer identity for the current phase; null means "no countdown here". */
function countdownSpec() {
  if (pub.phase === PHASE.MOVE && pub.moveDeadline) {
    return {
      key: 'move:' + pub.round + ':' + pub.moveDeadline,
      deadline: pub.moveDeadline
    };
  }
  if (pub.phase === PHASE.QUIZ && myCard && myCard.deadline) {
    return {
      key: 'quiz:' + pub.round + ':' + myCard.id + ':' + myCard.deadline,
      deadline: myCard.deadline
    };
  }
  return null;
}

function ensureCountdown(spec) {
  if (!spec) {
    if (countdown.key !== null) stopCountdown();
    $('timer').textContent = '';
    return;
  }
  if (countdown.key === spec.key) return;   // already running or already expired

  stopCountdown();
  countdown.key = spec.key;                 // set BEFORE painting: a re-entrant
                                            // render() then matches and returns
  const paint = () => {
    const left = Math.max(0, Math.ceil((spec.deadline - serverNow()) / 1000));
    $('timer').textContent = String(left);  // the ONLY thing a tick touches
    if (left > 0 || countdown.expired) return;
    countdown.expired = true;               // one-shot per key
    if (countdown.timer) { clearInterval(countdown.timer); countdown.timer = null; }
    onCountdownExpired();
  };

  paint();
  if (!countdown.expired) countdown.timer = setInterval(paint, 250);
}

/**
 * Fired once per timer key. No Firebase write happens here: the Host already
 * treats a missing or late submission as "no move" / "wrong answer", so a
 * timeout only needs to lock this client's inputs.
 */
function onCountdownExpired() {
  render();
}

/* ---------------- input ---------------- */

async function onRoomClick(roomId) {
  if (pub.phase !== PHASE.MOVE || !isAlive() || moveExpired()) return;

  if (isHunter()) {
    const next = {
      target: hunterMode === 'target' ? roomId : (myHunter.target || null),
      lock: hunterMode === 'lock' ? roomId : (myHunter.lock || null),
      at: serverTimestamp()
    };
    myHunter = next;
    await set(path('actions/hunter/' + uid), next);
    return;
  }

  const here = positions[uid] || null;
  if (!(ADJACENCY[here] || []).includes(roomId)) return;
  await set(path('actions/moves/' + uid), { target: roomId, at: serverTimestamp() });
}
