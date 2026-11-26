// Lobby hall: every player stands as their pixel character with a name plate.
// Presentation only. Updated in place so sprites don't restart on every change.

import { SpriteAnimator } from './spriteAnimator.js';
import { CHARACTER_ASSETS } from './assetConfig.js';

const slots = new Map();   // uid -> { li, anim, name }

/**
 * @param {HTMLElement} ul
 * @param {Object<string,{displayName?:string,connected?:boolean}>} players
 * @param {string|null} meUid highlight this player
 */
export function renderLobbyHall(ul, players, meUid = null) {
  const ids = Object.keys(players || {});
  for (const [id, s] of slots) {
    if (!players[id] || s.li.parentNode !== ul) { s.anim.destroy(); s.li.remove(); slots.delete(id); }
  }
  const empty = ul.querySelector('li.empty');
  if (!ids.length) {
    if (!empty) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'รอผู้กล้าเข้าห้อง…';
      ul.appendChild(li);
    }
    return;
  }
  if (empty) empty.remove();
  ids.forEach((id, i) => {
    const p = players[id];
    let s = slots.get(id);
    if (!s) {
      const li = document.createElement('li');
      li.className = 'hero';
      li.style.animationDelay = (i % 8) * 40 + 'ms';
      const spr = document.createElement('div');
      spr.className = 'hero-sprite sprite';
      const name = document.createElement('span');
      name.className = 'hero-name';
      li.append(spr, name);
      ul.appendChild(li);
      const anim = new SpriteAnimator(spr, CHARACTER_ASSETS.player);
      anim.setScale(3);
      s = { li, anim, name };
      slots.set(id, s);
    }
    s.name.textContent = p.displayName || '?';
    s.li.classList.toggle('offline', p.connected === false);
    s.li.classList.toggle('me', id === meUid);
    s.li.title = p.connected === false ? 'หลุดการเชื่อมต่อ' : '';
  });
}
