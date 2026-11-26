// Pure authoritative game rules. No DOM, no Firebase.

import { PHASE, ROLE, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './gameConfig.js';
import { ROOM_IDS, isAdjacent } from './map.js';

export { PHASE, ROLE };

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return s;
}


/** Unbiased index in [0,n) - rejection sampling so no id is favoured. */
function randomIndex(n) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let v;
    do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
    return v % n;
  }
  return Math.floor(Math.random() * n);
}

/**
 * Picks exactly one Hunter at random; everyone else is a Player.
 * Join order gives no advantage. Called once, by the Host, on Start.
 * @returns {Object<string,string>} uid -> role
 */
export function assignRandomRoles(playerIds) {
  const ids = Array.from(playerIds);
  const out = {};
  if (!ids.length) return out;
  const hunter = ids[randomIndex(ids.length)];
  for (const id of ids) out[id] = (id === hunter) ? ROLE.HUNTER : ROLE.PLAYER;
  return out;
}

/** Fisher-Yates using the unbiased index above. */
export function shuffled(list) {
  const a = Array.from(list);
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Any of the six rooms, uniformly. */
export function getRandomRoom() {
  return ROOM_IDS[randomIndex(ROOM_IDS.length)];
}

/** Exactly one uid, uniformly. */
export function selectRandomHunter(playerIds) {
  const ids = Array.from(playerIds);
  return ids.length ? ids[randomIndex(ids.length)] : null;
}

/**
 * Random spawn per Player. Rooms are NOT unique - several Players may share one.
 * Isolated so the spawn rule can be swapped without touching the phase machine.
 */
export function assignRandomStartingRooms(playerIds) {
  const out = {};
  for (const id of playerIds) out[id] = getRandomRoom();
  return out;
}

/** Game length is the size of the imported deck. Capped here if ever needed. */
export function getTotalRounds(questions) {
  return Array.isArray(questions) ? questions.length : 0;
}

/**
 * One shared random permutation plus a distinct random offset per participant.
 * Participant p answers master[(offset_p + round - 1) % N] in each round, so:
 *   - nobody repeats a question until their deck is exhausted,
 *   - distinct offsets => different questions in the same round,
 *     which is possible only while participants <= questions.
 * @returns {{master:string[], offsets:Object<string,number>}}
 */
export function assignQuestionDecks(participantIds, questionIds) {
  const master = shuffled(questionIds);
  const ids = Array.from(participantIds);
  const offsets = {};
  if (!master.length) return { master, offsets };

  // Distinct offsets while they last, then wrap (more participants than questions).
  const pool = shuffled(master.map((_, i) => i));
  ids.forEach((id, i) => {
    offsets[id] = i < pool.length ? pool[i] : randomIndex(master.length);
  });
  return { master, offsets };
}

/** Question id for one participant in one 1-based round. */
export function questionIdFor(assignment, uid, round) {
  const master = (assignment && assignment.master) || [];
  if (!master.length) return null;
  const offset = ((assignment.offsets || {})[uid]) || 0;
  return master[(offset + round - 1) % master.length];
}

/**
 * Winner check, run AFTER the result of a round has been resolved.
 * @returns {'hunter'|'players'|null} null = keep playing
 */
export function decideWinner({ alivePlayerCount, round, totalRounds }) {
  if (alivePlayerCount === 0) return ROLE.HUNTER;
  if (totalRounds && round >= totalRounds) return 'players';   // 0/null = until the clock ends it
  return null;
}

/**
 * Resolve one Player's move.
 * @returns {{from:string,to:string,success:boolean}}
 */
export function resolveMove(currentRoom, target, lockedRoom) {
  if (!target || target === currentRoom || !isAdjacent(currentRoom, target)) {
    return { from: currentRoom, to: currentRoom, success: false };
  }
  if (lockedRoom && target === lockedRoom) {
    return { from: currentRoom, to: currentRoom, success: false };
  }
  return { from: currentRoom, to: target, success: true };
}

/**
 * `correct` is a letter, or a list of letters when the source file allowed
 * several correct answers. Any listed answer counts as correct.
 */
export function isCorrect(answer, correct) {
  if (!answer || !correct) return false;
  const given = String(answer).trim().toUpperCase();
  const accepted = Array.isArray(correct) ? correct : [correct];
  return accepted.some(c => String(c).trim().toUpperCase() === given);
}

/** Shield for THIS turn only: successful move AND correct answer. */
export function earnsShield(movementSuccess, answeredCorrectly) {
  return movementSuccess === true && answeredCorrectly === true;
}

/**
 * Resolve the attack for one alive Player.
 * @returns {'safe'|'shielded'|'eliminated'}
 */
export function resolveAttackFor(player, hunterCorrect, hunterTarget) {
  const targets = parseTargets(hunterTarget);
  if (!hunterCorrect || !targets.length) return 'safe';
  if (!targets.includes(player.currentRoom)) return 'safe';
  return player.shield ? 'shielded' : 'eliminated';
}

/** Convenience wrapper: is the match over? See decideWinner for the winner. */
export function shouldEndGame(gameState) {
  return decideWinner({
    alivePlayerCount: gameState.alivePlayerCount,
    round: gameState.round,
    totalRounds: gameState.totalRounds
  }) !== null;
}

/**
 * Fit every question into a match length by shortening the move and quiz timers.
 * Pure. Returns the move time and a multiplier for each question's own time limit,
 * never below the floors. `fits` is false when even the floors can't make it; the
 * match clock then ends the game after the round that is playing.
 * @param {{questions:Array<{timeLimit?:number}>, minutes:number, moveSeconds:number,
 *          defaultQuizSeconds:number, overheadSeconds:number, minMove:number, minQuiz:number}} o
 */
export function fitMatchTiming(o) {
  const n = (o.questions || []).length;
  const quizOf = (q) => (Number(q.timeLimit) > 0 ? Number(q.timeLimit) : o.defaultQuizSeconds);
  const quizTotal = (o.questions || []).reduce((s, q) => s + quizOf(q), 0);
  const natural = n * (o.moveSeconds + o.overheadSeconds) + quizTotal;
  if (!o.minutes || !n) {
    return { moveSeconds: o.moveSeconds, quizScale: 1, fits: true, estimateSeconds: natural };
  }
  const budget = o.minutes * 60;
  const playable = budget - n * o.overheadSeconds;          // seconds left for timers
  const want = n * o.moveSeconds + quizTotal;
  const s = Math.min(1, Math.max(0, playable / want));
  const moveSeconds = Math.max(o.minMove, Math.round(o.moveSeconds * s));
  const quizSecs = (q) => Math.max(o.minQuiz, Math.round(quizOf(q) * s));
  const estimateSeconds = n * (moveSeconds + o.overheadSeconds)
    + (o.questions || []).reduce((t, q) => t + quizSecs(q), 0);
  return { moveSeconds, quizScale: s, fits: estimateSeconds <= budget, estimateSeconds };
}

/** One question's quiz seconds after fitting. */
export function quizSecondsFor(q, quizScale, defaultQuizSeconds, minQuiz) {
  const base = Number(q && q.timeLimit) > 0 ? Number(q.timeLimit) : defaultQuizSeconds;
  if (quizScale >= 1) return base;
  return Math.max(minQuiz, Math.round(base * quizScale));
}

/**
 * Leaderboard: most correct answers first; ties go to the smaller total answer
 * time (an unanswered question counts its full time limit). Pure.
 * @param {Object<string,{correct:number,timeMs:number,answered:number}>} stats
 * @param {Object<string,{name:string,role:string,alive:boolean}>} who
 */
export function rankLeaderboard(stats, who) {
  return Object.keys(who)
    .map(id => {
      const s = (stats || {})[id] || {};
      return {
        uid: id,
        name: who[id].name || '?',
        role: who[id].role || null,
        alive: who[id].alive !== false,
        correct: s.correct || 0,
        answered: s.answered || 0,
        timeMs: Math.round(s.timeMs || 0)
      };
    })
    .sort((a, b) => (b.correct - a.correct) || (a.timeMs - b.timeMs) || a.name.localeCompare(b.name))
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Is the match clock over? A missing deadline means no limit. */
export function matchTimeUp(endsAt, now) {
  return !!endsAt && now >= endsAt;
}

/**
 * Shared question deck: everyone gets the same question each round. The deck is
 * a random order; when it runs out it is reshuffled and goes round again (never
 * starting the new cycle with the question that just ended the old one).
 * @returns {{order:string[], pos:number, cycle:number}}
 */
export function newQuestionDeck(questionIds) {
  return { order: shuffled(questionIds), pos: 0, cycle: 1 };
}

/** Draw the next question id. Pure: returns the id and the advanced deck. */
export function drawQuestion(deck, questionIds) {
  let d = deck && Array.isArray(deck.order) && deck.order.length ? deck : newQuestionDeck(questionIds);
  if (d.pos >= d.order.length) {
    const last = d.order[d.order.length - 1];
    let order = shuffled(questionIds);
    if (order.length > 1 && order[0] === last) order = order.slice(1).concat(order[0]);
    d = { order, pos: 0, cycle: (d.cycle || 1) + 1 };
  }
  return { id: d.order[d.pos], deck: { ...d, pos: d.pos + 1 } };
}

/**
 * Hunter targets travel as one string ("roomA" or "roomA,roomC") so the existing
 * database rules (target must be a string) keep working. Pure.
 * @returns {string[]} valid, unique room ids, at most `max`
 */
export function parseTargets(value, max = 2) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const out = [];
  for (const raw of list) {
    const id = String(raw).trim();
    if (ROOM_IDS.includes(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, max);
}

/**
 * "Late game": the second half of the match by rounds or by the clock, whichever
 * comes first. The Hunter may then pick two target rooms. Pure.
 */
export function isLateGame({ round, totalRounds, startedAt, endsAt, now }) {
  if (totalRounds && round > Math.ceil(totalRounds / 2)) return true;
  if (startedAt && endsAt && now >= startedAt + (endsAt - startedAt) / 2) return true;
  return false;
}
