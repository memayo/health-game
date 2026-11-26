// PLAYER / HUNTER client. Renders Firebase state and submits private choices.
// It never decides an authoritative result and only ever reads its OWN role,
// question and submissions.

import { signIn, lastRoom } from './auth.js';
import { db, ref, get, set, update, remove, onValue, onDisconnect, serverTimestamp } from './firebase.js';
import { PHASE, ROLE, HUNTER_CHAR_ID, PHASE_LABEL } from './gameConfig.js';
import { parseTargets } from './gameState.js';
import { buildMap, ROOM_IDS, ADJACENCY } from './map.js';
import { CharacterRenderer } from './characterRenderer.js';
import { renderGameOverView } from './gameOverView.js';
import { renderLobbyHall } from './lobbyView.js';
import { startMatchClock } from './matchClock.js';
import { openTutorial, closeTutorial } from './tutorial.js';
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
// Hunter only: the last positions it received; a fallback if an older database
// rule still hides positions from the Hunter during MOVE.
let lastSeen = {};
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
  const user = await signIn();
  uid = user.uid;

  const mine = await get(path('players/' + uid));
  if (!mine.exists()) { lastRoom.clear(code); location.href = 'index.html'; return; }
  lastRoom.save(code, 'player', mine.val().displayName || '');

  // Dropping out only marks this player offline; coming back (same device) rejoins.
  onValue(ref(db, '.info/connected'), s => {
    if (s.val() !== true || leaving) return;
    onDisconnect(path('players/' + uid + '/connected')).set(false);
    update(path('players/' + uid), { connected: true }).catch(() => {});
  });

  mapApi = buildMap($('stage'));
  chars = new CharacterRenderer(mapApi);
  chars.add(HUNTER_CHAR_ID, { kind: 'hunter', name: '', roomId: null, hidden: true });
  mapApi.onRoomClick(onRoomClick);

  onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffset = s.val() || 0; });
  onValue(path('meta'), s => { if (!s.exists()) goHome(); });
  onValue(path('public/closed'), s => { if (s.val()) goHome(); });
  onValue(path('players'), s => {
    players = s.val() || {};
    // Removed by the Host (e.g. left behind at Start): nothing to rejoin.
    if (!players[uid]) { lastRoom.clear(code); goHome(); return; }
    me = players[uid] || {};
    syncCharacters(); render();
  });
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
  // Local only: the tutorial never touches Firebase or game state.
  $('tutorial-open').addEventListener('click', () => openTutorial({ code }));
  startMatchClock($('game-clock'), () => pub.gameEndsAt, serverNow);
}

/**
 * Positions subscription.
 *
 * Normal Players may always read them. The Hunter may read them only during QUIZ
 * and RESULT - the rules deny it during MOVE, so the listener is attached and
 * detached as the phase changes rather than left running.
 */
let positionsUnsub = null;

// Everyone in the match sees every Player, all the time (the Hunter included).
function wantPositions() {
  return myRole === ROLE.PLAYER || myRole === ROLE.HUNTER;
}

function syncPositionsSubscription() {
  const want = wantPositions();
  if (want && !positionsUnsub) {
    positionsUnsub = onValue(path('positions'),
      s => {
        positions = s.val() || {};
        if (isHunter()) lastSeen = { ...positions };
        syncCharacters(); render();
      },
      (err) => {
        // Older database rules still deny the Hunter during MOVE: fall back to
        // the last positions it saw (identical, since positions only change
        // when a move resolves).
        console.warn('[positions] read ended:', err && err.code, '- phase', pub.phase);
        positionsUnsub = null;
        positions = isHunter() ? { ...lastSeen } : {};
        syncCharacters();
        render();
      });
  } else if (!want && positionsUnsub) {
    positionsUnsub();
    positionsUnsub = null;
    positions = {};
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
  lastRoom.clear(code);
  try {
    await onDisconnect(path('players/' + uid + '/connected')).cancel();
    await remove(path('actions/moves/' + uid));
    await remove(path('actions/answers/' + uid));
    await remove(path('actions/hunter/' + uid));
    await remove(path('players/' + uid));   // Host clears the derived state
  } catch (e) { console.error(e); }
  location.href = 'index.html';
}

/* ---------------- characters ---------------- */

/** Every Player sprite is visible to everyone. */
function playerSpritesVisible() {
  return true;
}

function syncCharacters() {
  for (const [id, p] of Object.entries(players)) {
    const room = positions[id] || null;
    if (!chars.has(id)) {
      chars.add(id, { kind: 'player', name: p.displayName || '', roomId: room });
    } else if (isHunter()) {
      // The Hunter never plays the walk animation, so its sprites are simply kept
      // in sync with the resolved positions - including when the positions
      // snapshot arrives after the sprite was created.
      chars.setRoom(id, room);
    }
    chars.setEliminated(id, p.alive === false);
  }
  for (const id of [...chars.chars.keys()]) {
    if (!id.startsWith('__') && !players[id]) chars.remove(id);
  }
}

function isHunterSelf(id) { return isHunter() && id === uid; }

/* ---------------- render ---------------- */

let rendering = false;

function render() {
  if (!mapApi || leaving) return;
  if (rendering) return;            // secondary guard; the recursion itself is gone
  rendering = true;
  try {
    syncPositionsSubscription();    // Hunter gains/loses positions with the phase
    syncCharacters();               // visibility is a pure function of current state
    const inGame = pub.phase && pub.phase !== PHASE.LOBBY;
    const over = pub.phase === PHASE.ENDED;

    $('lobby').classList.toggle('hidden', !!inGame);
    $('bar').classList.toggle('hidden', !inGame || over);
    $('board').classList.toggle('hidden', !inGame || over);
    $('gameover').classList.toggle('hidden', !over);
    $('phase').textContent = over ? '' : (PHASE_LABEL[pub.phase] || '');
    $('round').textContent = pub.round ? 'รอบ ' + pub.round + (pub.totalRounds ? '/' + pub.totalRounds : '') : '';
    $('host-away').classList.toggle('hidden', !(inGame && !over && pub.hostOnline === false));
    $('hunter-rage').classList.toggle('hidden', !(inGame && !over && pub.hunterTargets > 1));
    renderRoleBadge(inGame && !over);

    if (inGame) closeTutorial();      // the game started: back to the real map
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
  renderLobbyHall($('player-list'), players, uid);
  $('player-count').textContent = Object.values(players).filter(p => p.connected !== false).length + ' คน';
}

/** Small badge: which side am I on (only I can see my role). */
function renderRoleBadge(show) {
  const el = $('role-badge');
  if (!show || !myRole) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.textContent = isHunter() ? '☠ HUNTER' : (isAlive() ? '⚔ ผู้เล่น' : '💀 ตกรอบ (ยังเก็บคะแนนได้)');
  el.classList.toggle('hunter', isHunter());
  el.classList.toggle('dead', !isHunter() && !isAlive());
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
    // Eliminated: no moves any more, but still answers questions for points.
    $('controls').innerHTML = '';
    $('status').textContent = 'ตกรอบ · รอตอบคำถามเก็บคะแนน';
    for (const id of ROOM_IDS) mapApi.setRoomState(id, 'blocked');
    return;
  }

  const expired = moveExpired();

  if (isHunter()) {
    const targets = parseTargets(myHunter.target, pub.hunterTargets || 1);
    for (const id of ROOM_IDS) {
      let state = 'selectable';
      const t = targets.includes(id);
      if (t && myHunter.lock === id) state = 'target-lock';
      else if (t) state = 'target';
      else if (myHunter.lock === id) state = 'lock';
      mapApi.setRoomState(id, expired ? 'blocked' : state);
    }
    renderHunterControls(expired);
    const n = pub.hunterTargets || 1;
    $('status').textContent = expired ? 'ล็อกแล้ว'
      : n > 1 ? 'เลือกห้องเป้าหมายได้ 2 ห้อง (' + targets.length + '/2)' : 'เลือกห้องเป้าหมาย';
  } else {
    const here = positions[uid] || null;
    for (const id of ROOM_IDS) {
      const reachable = !expired && (ADJACENCY[here] || []).includes(id);
      mapApi.setRoomState(id, reachable ? 'reachable' : 'blocked');
    }
    if (myMove && myMove.target) mapApi.setRoomState(myMove.target, 'chosen');
    $('controls').innerHTML = '';
    $('controls').dataset.mode = '';
    $('status').textContent = (myMove && myMove.target) ? 'รอคนอื่น…' : (expired ? 'ไม่ได้เดิน' : 'เลือกห้องข้างๆ');
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
    b.textContent = mode === 'target' ? '🎯 ห้องเป้าหมาย' : '🔒 ปิดห้อง';
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

  if (!myCard) {
    $('quiz').classList.add('hidden');
    $('status').textContent = isAlive() ? 'รอคนอื่น…' : 'ตกรอบ';
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
  $('status').textContent = submitted ? 'ส่งแล้ว รอคนอื่น…' : (expired ? 'หมดเวลา' : '');
}

async function submitAnswer() {
  if (!selectedChoice || quizExpired()) return;   // eliminated Players answer too (score only)
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
  lastRoom.clear(code);       // nothing left to rejoin
  renderGameOverView(pub.gameOver || {}, uid);
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
    let target = myHunter.target || null;
    if (hunterMode === 'target') {
      const max = pub.hunterTargets || 1;
      let list = parseTargets(target, max);
      if (list.includes(roomId)) list = list.filter(r => r !== roomId);   // tap again = undo
      else list = [...list, roomId].slice(-max);                          // keep the newest
      target = list.length ? list.join(',') : null;
    }
    const next = {
      target,
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
