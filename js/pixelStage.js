// Live pixel layer for the map: draws the dungeon, plays ambient loops (torches)
// and one-shot pixelfx effects. Presentation only - it decides nothing.
//
// Two canvases share one pixel grid of `k` CSS px per game pixel:
//   bg - dungeon art + ambient loops, behind the room overlays and characters
//   fg - one-shot effects, above the characters

import { createFrame, clearFrame, createFx, composite } from './vendor/pixelfx/core/index.js';
import { drawDungeon } from './dungeonArt.js';

const FX_ROOT = './vendor/pixelfx/fx/';
const modules = new Map();

/** Lazy-load an effect module, e.g. 'melee/claw-swipe'. Cached. */
export function loadFx(id) {
  if (!modules.has(id)) {
    modules.set(id, import(FX_ROOT + id + '.js').catch(err => {
      console.error('[pixelfx] failed to load ' + id, err);
      modules.delete(id);
      return null;
    }));
  }
  return modules.get(id);
}

/** Game pixels per CSS px for a world of this width. Integer, so pixels stay square. */
export function pixelScaleFor(worldWidth) {
  return Math.max(2, Math.round(worldWidth / 260));
}

const FRAME_MS = 1000 / 30;

export class PixelStage {
  /**
   * @param {HTMLElement} world   the map's world element (positioned)
   * @param {() => object} layoutFn returns {rooms, wallH} in CSS px of the world
   */
  constructor(world, layoutFn) {
    this.world = world;
    this.layoutFn = layoutFn;
    this.k = 2;
    this.ambient = [];   // {id, opts, at:{roomId, fx, fy}, inst}
    this.oneShots = [];  // {inst, resolve}
    this.fgDirty = false;

    this.bg = document.createElement('canvas');
    this.bg.className = 'pixel-canvas pixel-bg';
    this.fg = document.createElement('canvas');
    this.fg.className = 'pixel-canvas pixel-fg';
    world.prepend(this.bg);

    this._last = 0;
    this._acc = 0;
    this._raf = 0;
    this._tick = (t) => this._frame(t);
    this._raf = requestAnimationFrame(this._tick);
  }

  /** The fg canvas goes into the effect layer (above characters). */
  mountFg(layer) { layer.appendChild(this.fg); }

  /** Rebuild buffers and redraw the dungeon. Call after layout changes. */
  resize() {
    const ww = this.world.clientWidth, wh = this.world.clientHeight;
    if (!ww || !wh) return false;
    const k = pixelScaleFor(ww);
    const W = Math.ceil(ww / k), H = Math.ceil(wh / k);
    if (this.W === W && this.H === H && this.k === k && this._sig === this._layoutSig()) return false;
    this.k = k; this.W = W; this.H = H;
    this._sig = this._layoutSig();

    for (const c of [this.bg, this.fg]) {
      c.width = W; c.height = H;
      c.style.width = (W * k) + 'px';
      c.style.height = (H * k) + 'px';
    }
    this.bgCtx = this.bg.getContext('2d');
    this.fgCtx = this.fg.getContext('2d');
    this.bgFrame = createFrame(W, H);
    this.fgFrame = createFrame(W, H);
    this.bgImg = this.bgCtx.createImageData(W, H);
    this.fgImg = this.fgCtx.createImageData(W, H);
    this.base = new Uint32Array(W * H);

    const L = this.layoutFn();
    const toPx = (v) => Math.round(v / k);
    const rooms = L.rooms.map(r => ({
      ...r,
      x: toPx(r.x), y: toPx(r.y), w: toPx(r.w), h: toPx(r.h),
      grate: r.grate ? { x: toPx(r.grate.x), y: toPx(r.grate.y) } : null
    }));
    this.rooms = rooms;
    this.wallH = Math.max(6, Math.min(14, Math.round(Math.min(...rooms.map(r => r.h)) * 0.24)));
    drawDungeon(this.base, W, H, { rooms, wallH: this.wallH });
    this.fgDirty = true;
    return true;
  }

  _layoutSig() {
    const L = this.layoutFn();
    return L.rooms.map(r => [r.x, r.y, r.w, r.h].map(Math.round).join(',')).join('|');
  }

  /** World CSS px -> game px. */
  toGame(x, y) { return { x: Math.round(x / this.k), y: Math.round(y / this.k) }; }

  /** Room rect in game px (after resize()). */
  roomRect(id) { return (this.rooms || []).find(r => r.id === id) || null; }

  /**
   * Ambient loop anchored to a room, at fractions of the room rect.
   * `at.wall` true puts fy relative to the wall band instead of the room.
   */
  async addAmbient(id, roomId, at, opts = {}) {
    const mod = await loadFx(id);
    if (!mod) return;
    this.ambient.push({ mod, roomId, at, opts, inst: null });
  }

  _ambientPos(a) {
    const r = this.roomRect(a.roomId);
    if (!r) return null;
    const y = a.at.wall ? r.y + Math.round(this.wallH * a.at.fy) : r.y + Math.round(r.h * a.at.fy);
    return { x: r.x + Math.round(r.w * a.at.fx), y };
  }

  /**
   * Play a one-shot effect at a world CSS position. Resolves when it has ended.
   * Never rejects: a missing effect resolves immediately.
   */
  async play(id, pos, opts = {}) {
    const mod = await loadFx(id);
    if (!mod || !pos) return;
    const g = this.toGame(pos.x, pos.y);
    const { hold, ...rest } = opts;
    const inst = createFx(mod, { seed: (Math.random() * 1e6) | 0, ...rest, x: g.x, y: g.y });
    // Loops never end by themselves: fade them out after `hold` ms.
    if (mod.meta && mod.meta.loop) setTimeout(() => inst.stop(), hold || 1500);
    return new Promise(resolve => this.oneShots.push({ inst, resolve }));
  }

  _frame(t) {
    this._raf = requestAnimationFrame(this._tick);
    if (!this._last) this._last = t;
    const dtMs = Math.min(250, t - this._last);
    this._last = t;
    this._acc += dtMs;
    if (this._acc < FRAME_MS) return;
    const dt = this._acc / 1000;
    this._acc = 0;

    if (!this.world.offsetParent) return;          // board hidden: no work
    if (!this.bgFrame) { this.resize(); if (!this.bgFrame) return; }

    // Background: dungeon + ambient loops.
    const bf = clearFrame(this.bgFrame);
    for (const a of this.ambient) {
      const p = this._ambientPos(a);
      if (!p) continue;
      if (!a.inst) a.inst = createFx(a.mod, { ...a.opts, x: p.x, y: p.y });
      a.inst.update(dt);
      // createFx keeps its own x/y; follow layout changes.
      a.inst.options.x = p.x; a.inst.options.y = p.y;
      a.inst.draw(bf);
    }
    composite(bf, this.bgImg.data, this.base);
    this.bgCtx.putImageData(this.bgImg, 0, 0);

    // Foreground: one-shots. Skip the work entirely when nothing is playing.
    if (!this.oneShots.length) {
      if (this.fgDirty) { this.fgCtx.clearRect(0, 0, this.W, this.H); this.fgDirty = false; }
      return;
    }
    const ff = clearFrame(this.fgFrame);
    for (const s of this.oneShots) { s.inst.update(dt); s.inst.draw(ff); }
    composite(ff, this.fgImg.data, null);
    this.fgCtx.putImageData(this.fgImg, 0, 0);
    this.fgDirty = true;
    this.oneShots = this.oneShots.filter(s => {
      if (s.inst.done()) { s.resolve(); return false; }
      return true;
    });
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    for (const s of this.oneShots) s.resolve();
    this.oneShots = [];
    this.bg.remove(); this.fg.remove();
  }
}

/**
 * A looping pixelfx effect drawn as a standalone sprite (e.g. the Hunter).
 * box: [w, h] in art pixels of the visible body, used for layout; the canvas
 * may overflow it (glow, smoke). Feet/origin sit at the bottom centre of the box.
 */
export class LiveSprite {
  constructor(id, { box = [24, 32], opts = {}, scale = 2, repeatGap = 0 } = {}) {
    this.box = box;
    this.repeatGap = repeatGap;   // one-shots replay after this many seconds
    this.el = document.createElement('div');
    this.el.className = 'live-sprite';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pixel-canvas';
    this.el.appendChild(this.canvas);
    this.k = scale;
    this.inst = null;
    this._last = 0;
    this._acc = 0;
    loadFx(id).then(mod => {
      if (!mod || this.dead) return;
      const [w, h] = mod.meta.size;
      this.origin = mod.meta.origin || [w / 2, h];
      this.canvas.width = w; this.canvas.height = h;
      this.ctx = this.canvas.getContext('2d');
      this.frame = createFrame(w, h);
      this.img = this.ctx.createImageData(w, h);
      this._make = (n) => createFx(mod, { ...opts, seed: (opts.seed || 1) + n, x: this.origin[0], y: this.origin[1] });
      this._runs = 0;
      this.inst = this._make(0);
      this.setScale(this.k);
      this._raf = requestAnimationFrame(t => this._tick(t));
    });
    this.setScale(scale);
  }

  setScale(k) {
    this.k = k;
    this.el.style.width = (this.box[0] * k) + 'px';
    this.el.style.height = (this.box[1] * k) + 'px';
    if (this.frame) {
      const [w, h] = [this.frame.w, this.frame.h];
      this.canvas.style.width = (w * k) + 'px';
      this.canvas.style.height = (h * k) + 'px';
      this.canvas.style.left = ((this.box[0] / 2 - this.origin[0]) * k) + 'px';
      this.canvas.style.top = ((this.box[1] - this.origin[1]) * k) + 'px';
    }
  }

  _tick(t) {
    if (this.dead) return;
    this._raf = requestAnimationFrame(tt => this._tick(tt));
    if (!this._last) this._last = t;
    this._acc += Math.min(250, t - this._last);
    this._last = t;
    if (this._acc < FRAME_MS) return;
    // Do no work while hidden (display:none gives no layout box).
    if (!this.el.offsetParent) { this._acc = 0; return; }
    this.inst.update(this._acc / 1000);
    this._acc = 0;
    if (!this.inst.meta.loop && this.inst.t >= this.inst.meta.duration + this.repeatGap) {
      this.inst = this._make(++this._runs);
    }
    clearFrame(this.frame);
    this.inst.draw(this.frame);
    composite(this.frame, this.img.data, null);
    this.ctx.putImageData(this.img, 0, 0);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this._raf);
    this.el.remove();
  }
}
