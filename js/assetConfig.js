// Replaceable asset hooks.
// Every animation names its own spritesheet, row and frame count, so idle and walk
// can live in separate files. Drop a `sheet` on an animation to make it real;
// leave every sheet null and the animator falls back to pixel placeholders.

import { SPRITE } from './gameConfig.js';

/* ---------------- Player ---------------- */

// Both sheets: 128x160, a 4 x 5 grid of 32x32 cells.
// The 16x32 character art is centred in each cell, feet on the cell's bottom edge.
const PLAYER_IDLE_SHEET = 'assets/characters/16x32 Idle-Sheet.png';
const PLAYER_WALK_SHEET = 'assets/characters/16x32 Walk-Sheet.png';

// Row order is identical in both sheets. Row 3 is unused for now.
const PLAYER_ROWS = { down: 0, right: 1, left: 2, up: 4 };
const PLAYER_FRAMES = 4;

function playerAnimations() {
  const out = {};
  for (const [dir, row] of Object.entries(PLAYER_ROWS)) {
    out['idle_' + dir] = { sheet: PLAYER_IDLE_SHEET, row, frames: PLAYER_FRAMES };
    out['walk_' + dir] = { sheet: PLAYER_WALK_SHEET, row, frames: PLAYER_FRAMES };
  }
  return out;
}

/* ---------------- Hunter (still placeholder) ---------------- */

const PLACEHOLDER_ANIMATIONS = {
  idle_down:  { sheet: null, row: 0, frames: 1 },
  idle_up:    { sheet: null, row: 1, frames: 1 },
  idle_left:  { sheet: null, row: 2, frames: 1 },
  idle_right: { sheet: null, row: 3, frames: 1 },
  walk_down:  { sheet: null, row: 4, frames: 4 },
  walk_up:    { sheet: null, row: 5, frames: 4 },
  walk_left:  { sheet: null, row: 6, frames: 4 },
  walk_right: { sheet: null, row: 7, frames: 4 }
};

export const CHARACTER_ASSETS = {
  player: {
    frameWidth: 32,          // cell pitch, not the 16px character width
    frameHeight: 32,
    fps: SPRITE.fps,
    scale: SPRITE.scale,
    animations: playerAnimations()
  },
  hunter: {
    frameWidth: 16,
    frameHeight: 24,
    fps: SPRITE.fps,
    scale: SPRITE.scale,
    animations: PLACEHOLDER_ANIMATIONS
  }
};

// Effect hooks: pixelfx effect ids (js/vendor/pixelfx/fx/<id>.js) plus options.
// Recolor with `palette` (dark -> bright). One-shots end on their own; loops get `hold` ms.
export const EFFECT_ASSETS = {
  // Violet smoke bursting out of the sewer grate.
  hunterEmerge: { fx: 'spawn/poof', opts: {
    palette: ['#0f0a18', '#1c1230', '#2c1a4a', '#432468', '#6b3a9a', '#9a6ad0'],
    stars: ['#7ee787', '#c684ff', '#ecc8ff'], light: 0.7 } },
  // Three burning claw marks across the room.
  hunterAttack: { fx: 'melee/claw-swipe', opts: { light: 0.9 } },
  // Gold bubble round a shielded Player.
  shield:       { fx: 'holy/divine-shield', opts: { hold: 1400, radius: 20 } },
  // The eliminated Player's soul rises and fades.
  playerElimination: { fx: 'spawn/soul-rise', opts: { height: 34, dimBody: false } }
};
