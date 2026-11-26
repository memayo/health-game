// Central place for every tunable value. No magic numbers elsewhere.

export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  MOVE: 'move',
  QUIZ: 'quiz',
  RESULT: 'result',
  ENDED: 'ended'
});

export const ROLE = Object.freeze({
  PLAYER: 'player',
  HUNTER: 'hunter'
});

export const TIMING = Object.freeze({
  moveDuration: 700,        // walk tween between two rooms
  cameraDuration: 800,      // host camera zoom/focus
  blackoutDuration: 900,    // blackout transition between turns
  hunterEmergeDuration: 600,
  hunterEmergeWait: 1000,   // REQUIRED: exactly 1s between emerge and attack
  attackDuration: 700,
  shieldDuration: 700,
  eliminateDuration: 550,   // stylized Player elimination splat
  resultDelay: 1600,        // hold after the sequence before next turn
  wrongMessageDuration: 2000
});

// Phase timers. Authoritative deadlines are derived from these by the Host.
export const MOVE_TIME_SECONDS = 12;
// Used when a question carries no usable "Time Limit (sec)".
export const DEFAULT_QUIZ_TIME_SECONDS = 20;
// Grace period between "room closed" being published and the data being deleted,
// so connected clients can react before the room disappears.
export const CLOSE_ROOM_GRACE_MS = 500;

export const SPRITE = Object.freeze({
  fps: 8,
  scale: 2
});

// Room code
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Render id for the Hunter sprite. The Hunter is drawn as an anonymous character
// so no client can map the emerging Hunter back to a specific user.
export const HUNTER_CHAR_ID = '__hunter__';

// Character slot spacing inside a room (px, world units)
export const SLOT_SPACING = 20;

// ---- Match length (Host picks one in the lobby; 0 = no limit) ----
export const MATCH_MINUTE_CHOICES = [0, 3, 5, 10, 15, 20, 30];
// Seconds to answer each question; 0 = each question's own Time Limit from the sheet.
export const ANSWER_SECOND_CHOICES = [0, 10, 15, 20, 30];
export const DEFAULT_MATCH_MINUTES = 10;
// Fixed cost of a round that timers can't shrink: result sequence, blackout, network.
export const ROUND_OVERHEAD_SECONDS = 8;
// Floors when timers are shortened to fit the match length.
export const MIN_MOVE_SECONDS = 5;
export const MIN_QUIZ_SECONDS = 7;

// Thai labels for phases and statuses shown in the HUD.
export const PHASE_LABEL = Object.freeze({
  move: 'เดิน',
  quiz: 'ตอบคำถาม',
  result: 'ผลลัพธ์',
  ended: ''
});
