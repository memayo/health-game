// Full-screen animated dungeon hall behind the start screens (home, lobby, game over).
// Presentation only.

import { createFrame, clearFrame, createFx, composite } from './vendor/pixelfx/core/index.js';
import { drawHall } from './dungeonArt.js';
import { loadFx } from './pixelStage.js';

const FRAME_MS = 1000 / 30;

export class Backdrop {
  constructor(el = document.body) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'backdrop pixel-canvas';
    el.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ambient = [];
    this._last = 0; this._acc = 0;
    this._mods = Promise.all([loadFx('fire/torch'), loadFx('critters/bat')]);
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this._raf = requestAnimationFrame(t => this._tick(t));
  }

  async resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const k = Math.max(2, Math.round(Math.min(vw / 220, vh / 160)));
    const W = Math.ceil(vw / k), H = Math.ceil(vh / k);
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H; this.k = k;
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.style.width = (W * k) + 'px';
    this.canvas.style.height = (H * k) + 'px';
    this.frame = createFrame(W, H);
    this.img = this.ctx.createImageData(W, H);
    this.base = new Uint32Array(W * H);
    const anchors = drawHall(this.base, W, H);
    const [torch, bat] = await this._mods;
    this.ambient = [];
    anchors.torches.forEach((p, i) => {
      if (torch && (i < 2 || W > 200)) this.ambient.push(createFx(torch, { x: p.x, y: p.y, seed: 3 + i * 5, light: 0.75 }));
    });
    if (bat) {
      this.ambient.push(createFx(bat, { x: Math.round(W * 0.27), y: Math.round(H * 0.2), seed: 4 }));
      if (W > 160) this.ambient.push(createFx(bat, { x: Math.round(W * 0.78), y: Math.round(H * 0.14), seed: 9, flip: true }));
    }
  }

  _tick(t) {
    this._raf = requestAnimationFrame(tt => this._tick(tt));
    if (!this._last) this._last = t;
    this._acc += Math.min(250, t - this._last);
    this._last = t;
    if (this._acc < FRAME_MS || !this.frame || document.hidden) return;
    const dt = this._acc / 1000;
    this._acc = 0;
    if (this.canvas.offsetParent === null && getComputedStyle(this.canvas).display === 'none') return;
    const f = clearFrame(this.frame);
    for (const a of this.ambient) { a.update(dt); a.draw(f); }
    composite(f, this.img.data, this.base);
    this.ctx.putImageData(this.img, 0, 0);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.canvas.remove();
  }
}
