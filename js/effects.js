// Pixel-art VFX (pixelfx) + screen transitions. Contains no game-rule decisions.
// Every effect is fire-and-forget on the map's pixel layer; the awaited waits keep
// the original TIMING so the Host's pacing is unchanged.

import { TIMING, HUNTER_CHAR_ID } from './gameConfig.js';
import { EFFECT_ASSETS, CHARACTER_ASSETS } from './assetConfig.js';
import { parseTargets } from './gameState.js';

// A second skull for late-game double attacks; added on demand.
const HUNTER2_ID = '__hunter2__';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** Start a pixel effect (never throws). Returns the effect's own end promise. */
function fx(mapApi, cfg, pos, extra = {}) {
  if (!mapApi || !mapApi.pixels || !cfg || !pos) return Promise.resolve();
  return mapApi.pixels.play(cfg.fx, pos, { ...(cfg.opts || {}), ...extra }).catch(() => {});
}

export function playHunterEmerge(mapApi, roomId) {
  // Smoke boils out of the grate and rolls down onto the floor.
  const g = mapApi.pipeAnchor(roomId), f = mapApi.pipeFloorAnchor(roomId);
  fx(mapApi, EFFECT_ASSETS.hunterEmerge, { x: (g.x + f.x) / 2, y: g.y + (f.y - g.y) * 0.55 });
  return wait(TIMING.hunterEmergeDuration);
}

export function playHunterAttack(mapApi, roomId) {
  const c = mapApi.characterAnchor(roomId, 0, 1);
  const k = mapApi.pixelScale();
  // The claw marks land ~30 art px right of the effect's origin: centre them on the room.
  fx(mapApi, EFFECT_ASSETS.hunterAttack, { x: c.x - 30 * k, y: c.y });
  return wait(TIMING.attackDuration);
}

/** Shield bubble round a surviving Player (feet position, world px). */
export function playShieldEffect(mapApi, feet) {
  fx(mapApi, EFFECT_ASSETS.shield, feet);
  return wait(TIMING.shieldDuration);
}

/**
 * The Player sprite as a pixelfx actor (mask + its own colours), so the soul that
 * rises is a pale copy of the actual character. Built once from idle_down frame 0.
 */
let actorPromise = null;
function playerActor() {
  if (actorPromise) return actorPromise;
  const cfg = CHARACTER_ASSETS.player;
  const anim = cfg.animations.idle_down;
  actorPromise = new Promise(resolve => {
    if (!anim || !anim.sheet) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const fw = cfg.frameWidth, fh = cfg.frameHeight;
        const cv = document.createElement('canvas');
        cv.width = fw; cv.height = fh;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, anim.row * fh, fw, fh, 0, 0, fw, fh);
        const d = ctx.getImageData(0, 0, fw, fh).data;
        let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          if (d[(y * fw + x) * 4 + 3] > 127) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
        if (x1 < 0) return resolve(null);
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const data = new Uint8Array(w * h), pixels = new Uint32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = ((y + y0) * fw + (x + x0)) * 4;
          if (d[i + 3] > 127) {
            data[y * w + x] = 1;
            pixels[y * w + x] = (255 << 24 | d[i + 2] << 16 | d[i + 1] << 8 | d[i]) >>> 0;
          }
        }
        // feet at (0,0): the art's bottom row sits on the cell's bottom edge
        const ax = (x0 - fw / 2) | 0, ay = -(fh - y0);
        resolve({ mask: { w, h, data }, pixels, x: ax, y: ay, w, h, k: 1,
          head: [0, ay], chest: [0, ay + Math.round(h * 0.35)] });
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = String(anim.sheet).replace(/ /g, '%20');
  });
  return actorPromise;
}

/**
 * Player elimination: the soul lifts out of the body and drifts away.
 * Presentation only - called only for an actually eliminated Player.
 * @param {{x:number,y:number}} feet world coordinates
 */
export function playPlayerElimination(mapApi, feet) {
  playerActor().then(actor => {
    fx(mapApi, EFFECT_ASSETS.playerElimination, feet, actor ? { actor } : {});
  });
  return wait(TIMING.eliminateDuration);
}

/** Drop every visibility hold this sequence took. */
function releaseHolds(chars, result) {
  for (const [uid, outcome] of Object.entries(result.outcomes || {})) {
    if (outcome === 'eliminated') chars.holdVisible(uid, false);
  }
}

export function playEliminate(characterEl) {
  if (!characterEl) return Promise.resolve();
  characterEl.classList.add('hit');
  return wait(TIMING.attackDuration).then(() => characterEl.classList.remove('hit'));
}

/** Persistent darkness (Host during MOVE). */
export function setBlackout(on) {
  document.body.classList.toggle('blackout', !!on);
}

/** Short blackout transition between turns. */
export async function blackoutTransition(ms = TIMING.blackoutDuration) {
  setBlackout(true);
  await wait(ms);
  setBlackout(false);
}

/** Large dramatic message overlay. */
export async function bigMessage(text, ms = TIMING.wrongMessageDuration) {
  const el = document.createElement('div');
  el.className = 'big-message';
  el.textContent = text;
  document.body.appendChild(el);
  await wait(ms);
  el.remove();
}

export { wait };

/**
 * Presentation-only result sequence. All decisions were already made by the Host;
 * this function just plays what `result` says.
 * result = {hunterCorrect, hunterTarget, outcomes:{uid:'safe'|'shielded'|'eliminated'}}
 * The Hunter is drawn as an anonymous sprite - the result carries no Hunter uid.
 */
export async function playResultSequence(mapApi, chars, result) {
  // The Host marks victims dead before RESULT starts, so pin them on screen for
  // the whole sequence; they are released after their own elimination effect.
  for (const [uid, outcome] of Object.entries(result.outcomes || {})) {
    if (outcome === 'eliminated') chars.holdVisible(uid, true);
  }
  const targets = parseTargets(result.hunterTarget);
  // One target: zoom in on it. Two (late game): keep the whole map in view.
  if (targets.length === 1) mapApi.focusRoom(targets[0]);
  else mapApi.resetCamera();
  await wait(TIMING.cameraDuration);

  if (!result.hunterCorrect) {
    await bigMessage('HUNTER ตอบผิด! รอดไปอีกรอบ');
    mapApi.resetCamera();
    releaseHolds(chars, result);
    return;
  }

  // 1. Hunter emerges from the pipe of each target room.
  const skulls = [HUNTER_CHAR_ID, HUNTER2_ID];
  if (targets.length > 1 && !chars.has(HUNTER2_ID) && chars.has(HUNTER_CHAR_ID)) {
    chars.add(HUNTER2_ID, { kind: 'hunter', roomId: null, hidden: true });
  }
  targets.forEach((room, i) => {
    if (!chars.has(skulls[i])) return;
    chars.setHidden(skulls[i], false);
    chars.placeAtPipe(skulls[i], room);
  });
  await Promise.all(targets.map(room => playHunterEmerge(mapApi, room)));

  // 2. Exactly one second.
  await wait(TIMING.hunterEmergeWait);

  // 3. Attack.
  await Promise.all(targets.map(room => playHunterAttack(mapApi, room)));

  // 4. Per-player outcome.
  const jobs = [];
  for (const [uid, outcome] of Object.entries(result.outcomes || {})) {
    const el = chars.getEl(uid);
    if (outcome === 'shielded') jobs.push(playShieldEffect(mapApi, chars.feetOf(uid)));
    if (outcome === 'eliminated') {
      const pos = chars.feetOf(uid);
      jobs.push(
        Promise.all([playEliminate(el), playPlayerElimination(mapApi, pos)])
          .then(() => {
            chars.holdVisible(uid, false);
            chars.setEliminated(uid, true);
          })
      );
    }
  }
  await Promise.all(jobs);
  await wait(TIMING.resultDelay);
  mapApi.resetCamera();
  if (chars.has(HUNTER2_ID)) chars.setHidden(HUNTER2_ID, true);
}
