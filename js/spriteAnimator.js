// Generic frame animator, conceptually an AnimatedSprite2D.
// Knows nothing about the game.
//
// Each animation may carry its OWN spritesheet:
//   idle_down: { sheet: '.../Idle-Sheet.png', row: 0, frames: 4 }
//   walk_down: { sheet: '.../Walk-Sheet.png', row: 0, frames: 4 }
// A character-level `sheet` still works as a fallback for animations that omit one.
// If neither exists the element stays in CSS placeholder mode.

export const STATES = [
  'idle_down', 'idle_up', 'idle_left', 'idle_right',
  'walk_down', 'walk_up', 'walk_left', 'walk_right'
];

// Filenames may contain spaces; encode only those so a path is never double-encoded.
const toUrl = (src) => String(src).replace(/ /g, '%20');

// Natural sheet size is read once per file so background-size can be scaled
// correctly for any grid without extra configuration.
const sheetSizes = new Map();
function loadSheetSize(src) {
  if (sheetSizes.has(src)) return sheetSizes.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => {
      console.error('[sprite] failed to load spritesheet: ' + src);
      resolve(null);
    };
    img.src = toUrl(src);
  });
  sheetSizes.set(src, p);
  return p;
}

export class SpriteAnimator {
  /**
   * @param {HTMLElement} el
   * @param {{sheet?:string,frameWidth:number,frameHeight:number,fps:number,scale:number,
   *          animations:Object<string,{sheet?:string,row:number,frames:number,fps?:number}>}} config
   */
  constructor(el, config) {
    this.el = el;
    this.config = config;
    this.current = null;
    this.frame = 0;
    this.timer = null;
    this.sheetSrc = null;

    el.style.width = (config.frameWidth * config.scale) + 'px';
    el.style.height = (config.frameHeight * config.scale) + 'px';

    const anims = config.animations || {};
    this.usesSheets = !!config.sheet || Object.values(anims).some(a => a && a.sheet);

    if (this.usesSheets) {
      el.classList.add('sprite-sheet');
      el.style.imageRendering = 'pixelated';
      el.style.backgroundRepeat = 'no-repeat';
    } else {
      el.classList.add('sprite-placeholder');
    }
    this.play('idle_down');
  }

  /** Which sheet does this animation draw from? */
  _sheetFor(name) {
    const anim = this.config.animations[name];
    return (anim && anim.sheet) || this.config.sheet || null;
  }

  play(name) {
    if (this.current === name) return;
    if (!this.config.animations[name]) name = 'idle_down';
    this.current = name;
    this.frame = 0;
    this.el.dataset.anim = name;
    this._stopTimer();

    const sheet = this._sheetFor(name);
    if (!sheet) return;            // placeholder mode is driven by CSS

    this._applySheet(sheet);
    this._draw();

    const anim = this.config.animations[name];
    const fps = anim.fps || this.config.fps;
    if (anim.frames > 1) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % anim.frames;
        this._draw();
      }, 1000 / fps);
    }
  }

  _applySheet(src) {
    if (this.sheetSrc === src) return;
    this.sheetSrc = src;
    this.el.style.backgroundImage = 'url("' + toUrl(src) + '")';
    loadSheetSize(src).then((dim) => {
      if (!dim || this.sheetSrc !== src) return;
      const s = this.config.scale;
      this.el.style.backgroundSize = (dim.w * s) + 'px ' + (dim.h * s) + 'px';
      this._draw();
    });
  }

  _draw() {
    const c = this.config;
    const anim = c.animations[this.current];
    if (!anim || !this._sheetFor(this.current)) return;
    const fw = c.frameWidth * c.scale;
    const fh = c.frameHeight * c.scale;
    const col = (anim.startCol || 0) + this.frame;
    this.el.style.backgroundPosition = (-col * fw) + 'px ' + (-anim.row * fh) + 'px';
  }

  _stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  destroy() {
    this._stopTimer();
    this.el.remove();
  }
}

/** Direction from a movement delta. Falls back to the previous facing. */
export function directionFromDelta(dx, dy, fallback = 'down') {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
