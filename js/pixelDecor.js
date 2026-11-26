// Decorative pixelfx sprites for plain pages (home, lobby, game over).
// Markup: <div data-pixelfx="fire/torch" data-box="16,40" data-scale="2"></div>
// Optional: data-opts='{"palette":[...]}', data-repeat="1.2" (seconds between one-shot replays).

import { LiveSprite } from './pixelStage.js';

const live = new WeakMap();

export function mountDecor(root = document) {
  for (const el of root.querySelectorAll('[data-pixelfx]')) mountOne(el);
}

/** (Re)mount one slot, e.g. after changing data-pixelfx. */
export function mountOne(el) {
  const prev = live.get(el);
  if (prev) prev.destroy();
  const id = el.dataset.pixelfx;
  if (!id) return;
  const box = (el.dataset.box || '24,32').split(',').map(Number);
  let opts = {};
  try { opts = el.dataset.opts ? JSON.parse(el.dataset.opts) : {}; } catch { opts = {}; }
  const scale = Number(el.dataset.scale) || 2;
  const s = new LiveSprite(id, { box, opts, scale, repeatGap: Number(el.dataset.repeat) || 0 });
  el.appendChild(s.el);
  live.set(el, s);
}

/** Game-over flourish: confetti for the Players, the burning skull for the Hunter. */
export function showGameOverFx(el, hunterWon) {
  document.body.classList.toggle('hunter-won', !!hunterWon);
  if (!el) return;
  const want = hunterWon ? 'critters/flying-skull' : 'ui/confetti';
  if (el.dataset.pixelfx === want) return;
  el.dataset.pixelfx = want;
  el.dataset.box = hunterWon ? '28,46' : '60,55';
  el.dataset.scale = '2';
  el.dataset.repeat = hunterWon ? '' : '0.6';
  el.dataset.opts = JSON.stringify({ seed: 5 });
  mountOne(el);
}
