// Owns character DOM + movement animation. Gameplay only calls moveCharacter().

import { SpriteAnimator, directionFromDelta } from './spriteAnimator.js';
import { CHARACTER_ASSETS } from './assetConfig.js';
import { TIMING } from './gameConfig.js';

export class CharacterRenderer {
  constructor(mapApi) {
    this.map = mapApi;
    this.chars = new Map(); // id -> {el, anim, roomId, facing, kind, hidden}
    this._onResize = () => this.layoutAll();
    window.addEventListener('resize', this._onResize);
    // The map can be laid out after the characters are created (fonts, CSS,
    // orientation change, tab becoming visible), so re-anchor on any size change.
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(this._onResize);
      this._observer.observe(mapApi.world);
    }
  }

  add(id, { kind = 'player', name = '', roomId = null, hidden = false } = {}) {
    if (this.chars.has(id)) {
      const c = this.chars.get(id);
      c.roomId = roomId ?? c.roomId;
      this.setHidden(id, hidden);
      this.layoutAll();
      return c;
    }
    const wrap = document.createElement('div');
    wrap.className = 'character character-' + kind;
    wrap.dataset.charId = id;

    const sprite = document.createElement('div');
    sprite.className = 'sprite';
    wrap.appendChild(sprite);

    const tag = document.createElement('div');
    tag.className = 'name-tag';
    tag.textContent = name;
    wrap.appendChild(tag);

    this.map.characterLayer.appendChild(wrap);
    const anim = new SpriteAnimator(sprite, CHARACTER_ASSETS[kind] || CHARACTER_ASSETS.player);

    const c = { el: wrap, anim, roomId, facing: 'down', kind, hidden, eliminated: false, hold: false };
    this.chars.set(id, c);
    this.setHidden(id, hidden);
    this.layoutAll();
    return c;
  }

  remove(id) {
    const c = this.chars.get(id);
    if (!c) return;
    c.anim.destroy();
    c.el.remove();
    this.chars.delete(id);
    this.layoutAll();
  }

  has(id) { return this.chars.has(id); }
  getEl(id) { const c = this.chars.get(id); return c ? c.el : null; }

  setHidden(id, hidden) {
    const c = this.chars.get(id);
    if (!c) return;
    c.hidden = !!hidden;
    this._applyVisibility(c);
  }

  /** An eliminated character is removed from the map (and from slot packing). */
  setEliminated(id, eliminated) {
    const c = this.chars.get(id);
    if (!c) return;
    c.eliminated = !!eliminated;
    c.el.classList.toggle('eliminated', !!eliminated);
    this._applyVisibility(c);
    this.layoutAll();
  }

  /**
   * Force a character to stay on screen regardless of its eliminated flag, so its
   * own death effect can play before it disappears. Presentation only.
   */
  holdVisible(id, hold) {
    const c = this.chars.get(id);
    if (!c) return;
    c.hold = !!hold;
    this._applyVisibility(c);
  }

  _applyVisibility(c) {
    const hide = !c.hold && (c.hidden || c.eliminated);
    c.el.classList.toggle('hidden', hide);
  }

  /** Visual centre of a character in world coordinates (for centred effects). */
  centerOf(id) {
    const c = this.chars.get(id);
    if (!c || !c.roomId) return null;
    const feet = this._anchorOf(id, c.roomId);
    return { x: feet.x, y: feet.y - (c.el.offsetHeight || 48) / 2 };
  }

  /** Teleport (used on join / reconnect / restore). */
  setRoom(id, roomId) {
    const c = this.chars.get(id);
    if (!c) return;
    if (c.roomId === roomId) return;   // nothing moved: skip the relayout
    c.roomId = roomId;
    this.layoutAll(true);
  }

  /** Place at the pipe anchor of a room without walking (Hunter emergence). */
  placeAtPipe(id, roomId) {
    const c = this.chars.get(id);
    if (!c) return;
    c.roomId = roomId;
    const p = this.map.pipeAnchor(roomId);
    this._apply(c, p, true);
  }

  /** Animated walk to a room. Resolves when the character arrives. */
  moveCharacter(id, roomId) {
    const c = this.chars.get(id);
    if (!c) return Promise.resolve();
    if (!roomId || roomId === c.roomId) return Promise.resolve();

    const from = this._anchorOf(id, c.roomId);
    c.roomId = roomId;
    const to = this._anchorOf(id, roomId);
    const facing = directionFromDelta(to.x - from.x, to.y - from.y, c.facing);
    c.facing = facing;
    c.anim.play('walk_' + facing);
    c.el.classList.add('walking');
    this._apply(c, to, false);

    return new Promise(resolve => {
      setTimeout(() => {
        c.anim.play('idle_' + c.facing);
        c.el.classList.remove('walking');
        this.layoutAll();
        resolve();
      }, TIMING.moveDuration);
    });
  }

  /** Movement failed: stay put, stay idle, no walk animation. */
  stayIdle(id) {
    const c = this.chars.get(id);
    if (!c) return;
    c.anim.play('idle_' + c.facing);
  }

  _occupants(roomId) {
    return [...this.chars.entries()]
      .filter(([, c]) => c.roomId === roomId && !c.hidden && !c.eliminated)
      .map(([id]) => id)
      .sort();
  }

  _anchorOf(id, roomId) {
    if (!roomId) return { x: -9999, y: -9999 };
    const list = this._occupants(roomId);
    const idx = Math.max(0, list.indexOf(id));
    return this.map.characterAnchor(roomId, idx, Math.max(1, list.length));
  }

  _apply(c, pos, instant) {
    c.el.style.transition = instant ? 'none' : 'transform ' + TIMING.moveDuration + 'ms linear';
    c.el.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px) translate(-50%,-100%)';
  }

  /** Re-place everyone (resize, room changes, occupancy changes). */
  layoutAll(instant = true) {
    for (const [id, c] of this.chars) {
      if (!c.roomId) { c.el.style.opacity = '0'; continue; }
      if (c.el.classList.contains('walking')) continue;
      c.el.style.opacity = '';
      this._apply(c, this._anchorOf(id, c.roomId), instant);
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._observer) this._observer.disconnect();
    for (const id of [...this.chars.keys()]) this.remove(id);
  }
}
