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
