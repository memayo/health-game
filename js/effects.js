// Placeholder VFX + screen transitions. Contains no game-rule decisions.

import { TIMING, HUNTER_CHAR_ID } from './gameConfig.js';
import { EFFECT_ASSETS } from './assetConfig.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function spawnAt(mapApi, pos, className, ms) {
  const el = document.createElement('div');
  el.className = 'fx ' + className;
  el.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px) translate(-50%,-50%)';
  mapApi.effectLayer.appendChild(el);
  return wait(ms).then(() => el.remove());
}

export function playHunterEmerge(mapApi, roomId) {
  return spawnAt(mapApi, mapApi.pipeAnchor(roomId),
    EFFECT_ASSETS.hunterEmerge.className, TIMING.hunterEmergeDuration);
}

export function playHunterAttack(mapApi, roomId) {
  return spawnAt(mapApi, mapApi.roomCenter(roomId),
    EFFECT_ASSETS.hunterAttack.className, TIMING.attackDuration);
}

export function playShieldEffect(characterEl) {
  if (!characterEl) return Promise.resolve();
  const el = document.createElement('div');
  el.className = 'fx ' + EFFECT_ASSETS.shield.className;
  characterEl.appendChild(el);
  return wait(TIMING.shieldDuration).then(() => el.remove());
}

/**
 * Stylized Player elimination burst, centred on a world position.
 * Layers every sprite in EFFECT_ASSETS.playerElimination. Presentation only -
 * it decides nothing and is called only for an actually eliminated Player.
 * @param {{x:number,y:number}} pos world coordinates
 */
export function playPlayerElimination(mapApi, pos) {
  const cfg = EFFECT_ASSETS.playerElimination;
  if (!pos || !cfg || !cfg.sprites || !cfg.sprites.length) return Promise.resolve();

  const host = document.createElement('div');
  host.className = 'fx ' + cfg.className;
  host.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px)';

  for (const sp of cfg.sprites) {
    const el = document.createElement('span');
    el.className = 'fx-elim-sprite';
    el.style.backgroundImage = 'url("' + String(sp.src).replace(/ /g, '%20') + '")';
    el.style.setProperty('--size', (sp.size || 48) + 'px');
    el.style.setProperty('--rot', (sp.rotate || 0) + 'deg');
    el.style.setProperty('--dx', ((sp.offset && sp.offset[0]) || 0) * (sp.size || 48) + 'px');
    el.style.setProperty('--dy', ((sp.offset && sp.offset[1]) || 0) * (sp.size || 48) + 'px');
    el.style.setProperty('--dur', TIMING.eliminateDuration + 'ms');
    if (cfg.pixelated) el.style.imageRendering = 'pixelated';
    el.style.animationDelay = (sp.delay || 0) + 'ms';
    host.appendChild(el);
  }

  mapApi.effectLayer.appendChild(host);
  const maxDelay = Math.max(...cfg.sprites.map(sp => sp.delay || 0));
  return wait(TIMING.eliminateDuration + maxDelay).then(() => host.remove());
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
  if (result.hunterTarget) mapApi.focusRoom(result.hunterTarget);
  await wait(TIMING.cameraDuration);

  if (!result.hunterCorrect) {
    await bigMessage('HUNTER ANSWERED WRONG!');
    mapApi.resetCamera();
    releaseHolds(chars, result);
    return;
  }

  // 1. Hunter emerges from the pipe of the target room.
  if (chars.has(HUNTER_CHAR_ID)) {
    chars.setHidden(HUNTER_CHAR_ID, false);
    chars.placeAtPipe(HUNTER_CHAR_ID, result.hunterTarget);
  }
  await playHunterEmerge(mapApi, result.hunterTarget);

  // 2. Exactly one second.
  await wait(TIMING.hunterEmergeWait);

  // 3. Attack.
  await playHunterAttack(mapApi, result.hunterTarget);

  // 4. Per-player outcome.
  const jobs = [];
  for (const [uid, outcome] of Object.entries(result.outcomes || {})) {
    const el = chars.getEl(uid);
    if (outcome === 'shielded') jobs.push(playShieldEffect(el));
    if (outcome === 'eliminated') {
      const pos = chars.centerOf(uid);
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
}
