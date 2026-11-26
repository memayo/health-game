// Procedural pixel-art dungeon: stone rooms, brick walls, corridors between
// adjacent rooms, sewer grates (the Hunter's "pipes") and torch sconces.
// Pure drawing into a Uint32Array (ABGR, the pixelfx frame format). No game rules.

const rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return (255 << 24 | (n & 255) << 16 | ((n >> 8) & 255) << 8 | (n >> 16)) >>> 0;
};

export const DUNGEON_PAL = {
  void:     ['#07060a', '#0c0a11', '#110e17'],
  rock:     ['#16131d', '#1d1925', '#25202f'],
  brick:    ['#2e2838', '#3a3346', '#463e54'],
  brickHi:  '#584d68',
  mortar:   '#16131c',
  wallCap:  ['#4c4359', '#625673'],
  wallBase: '#120f17',
  floor:    ['#221e2a', '#28232f', '#2d2836', '#332d3d'],
  floorLine:'#17141d',
  floorHi:  '#3b3447',
  moss:     ['#24331f', '#2f4426', '#3d5a2e'],
  crack:    '#120f16',
  iron:     ['#0d0b12', '#2a2732', '#4a4655', '#6e6a7a'],
  plaque:   ['#3a2c1c', '#5c4428', '#8a6a3a', '#c9a35a'],
  bone:     ['#6f6658', '#a39885', '#d8cdb5']
};
const P = Object.fromEntries(Object.entries(DUNGEON_PAL).map(([k, v]) =>
  [k, Array.isArray(v) ? v.map(rgb) : rgb(v)]));

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * @param {Uint32Array} buf  W*H
 * @param {number} W
 * @param {number} H
 * @param {{rooms:Array<{id:string,x:number,y:number,w:number,h:number,col:number,row:number,grate:{x:number,y:number}}>, wallH:number}} layout
 *        All coordinates in game pixels.
 */
export function drawDungeon(buf, W, H, layout) {
  const rnd = mulberry(1337);
  const set = (x, y, c) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    buf[y * W + x] = c;
  };
  const rect = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
  };

  // 1. Bedrock with a little grain.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = rnd();
    buf[y * W + x] = r < 0.06 ? P.rock[1] : r < 0.1 ? P.void[2] : r < 0.5 ? P.void[1] : P.void[0];
  }
  // Rock chunks.
  for (let n = 0; n < (W * H) / 90; n++) {
    const x = rnd() * W | 0, y = rnd() * H | 0, s = 1 + (rnd() * 3 | 0);
    rect(x, y, s, s, P.rock[0]);
    rect(x, y, s, 1, P.rock[1]);
  }

  const { rooms, wallH } = layout;
  const byPos = new Map(rooms.map(r => [r.col + ',' + r.row, r]));

  // 2. Corridors first, so rooms paint over their ends.
  const corridors = [];
  for (const r of rooms) {
    const right = byPos.get((r.col + 1) + ',' + r.row);
    if (right) {
      const top = r.y + wallH + Math.round((r.h - wallH) * 0.3);
      const bot = r.y + r.h - Math.round((r.h - wallH) * 0.25);
      corridors.push({ x: r.x + r.w - 2, y: top, w: right.x - (r.x + r.w) + 4, h: bot - top, dir: 'h' });
    }
    const down = byPos.get(r.col + ',' + (r.row + 1));
    if (down) {
      const cw = Math.max(8, Math.round(r.w * 0.26));
      const cx = r.x + Math.round((r.w - cw) / 2);
      corridors.push({ x: cx, y: r.y + r.h - 2, w: cw, h: down.y + wallH - (r.y + r.h) + 4, dir: 'v' });
    }
  }

  const floorPx = (x, y, ox, oy) => {
    // 6x6 flagstones with offset rows, slight per-stone tone.
    const tx = Math.floor((x - ox) / 6), ty = Math.floor((y - oy) / 5);
    const sx = (x - ox + (ty & 1) * 3) % 6, sy = (y - oy) % 5;
    const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    if (sx === 0 || sy === 0) return P.floorLine;
    if (sy === 1 && sx < 4 && (h & 3) === 0) return P.floorHi;
    return P.floor[h % 3 + ((h >> 5) % 5 === 0 ? 1 : 0)];
  };

  const paintFloor = (x0, y0, w, h, ox, oy) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, floorPx(x, y, ox, oy));
  };

  for (const c of corridors) {
    paintFloor(c.x, c.y, c.w, c.h, 0, 0);
    // Corridor walls.
    if (c.dir === 'h') {
      rect(c.x, c.y - 1, c.w, 1, P.wallCap[0]);
      rect(c.x, c.y, c.w, 1, P.brick[0]);
      rect(c.x, c.y + c.h, c.w, 1, P.wallBase);
    } else {
      rect(c.x - 1, c.y, 1, c.h, P.wallCap[0]);
      rect(c.x + c.w, c.y, 1, c.h, P.wallBase);
    }
  }

  // 3. Rooms.
  for (const r of rooms) {
    const fx = r.x + 1, fy = r.y + wallH, fw = r.w - 2, fh = r.h - wallH - 1;

    // Outer rim.
    rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, P.void[0]);

    // Back wall: bricks 6x3 with offset courses.
    for (let y = r.y; y < r.y + wallH; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const row = Math.floor((y - r.y) / 3);
        const bx = (x - r.x + (row & 1) * 3) % 6;
        const by = (y - r.y) % 3;
        const hsh = ((Math.floor((x - r.x + (row & 1) * 3) / 6) * 92837111) ^ (row * 689287499)) >>> 0;
        let c = P.brick[hsh % 3];
        if (by === 0 && bx > 0) c = hsh % 7 === 0 ? P.brickHi : P.brick[Math.min(2, hsh % 3 + 1)];
        if (bx === 0 || by === 2) c = P.mortar;
        set(x, y, c);
      }
    }
    // Wall cap and the dark seam where the wall meets the floor.
    rect(r.x, r.y, r.w, 1, P.wallCap[1]);
    rect(r.x, r.y + 1, r.w, 1, P.wallCap[0]);
    rect(r.x, r.y + wallH - 1, r.w, 1, P.wallBase);

    // Floor.
    paintFloor(fx, fy, fw, fh, r.x, r.y);
    // Shadow under the back wall (two dithered rows) and along the side walls.
    for (let x = fx; x < fx + fw; x++) {
      set(x, fy, P.floorLine);
      if ((x & 1) === 0) set(x, fy + 1, P.floorLine);
    }
    for (let y = fy; y < fy + fh; y++) {
      set(fx, y, P.wallBase);
      if ((y & 1) === 0) set(fx + 1, y, P.floorLine);
      set(fx + fw - 1, y, P.floorLine);
    }
    rect(r.x, r.y + r.h - 1, r.w, 1, P.wallBase);
    rect(r.x, r.y, 1, r.h, P.wallBase);
    rect(r.x + r.w - 1, r.y, 1, r.h, P.wallBase);

    // Moss patches and cracks, seeded per room.
    const rr = mulberry(r.col * 31 + r.row * 7 + 3);
    for (let n = 0; n < 3; n++) {
      const mx = fx + 3 + (rr() * (fw - 8) | 0), my = fy + 3 + (rr() * (fh - 6) | 0);
      for (let k = 0; k < 9; k++) {
        const dx = (rr() * 5 | 0) - 2, dy = (rr() * 3 | 0) - 1;
        set(mx + dx, my + dy, P.moss[rr() * 3 | 0]);
      }
    }
    for (let n = 0; n < 2; n++) {
      let cx = fx + 4 + (rr() * (fw - 8) | 0), cy = fy + 4 + (rr() * (fh - 8) | 0);
      for (let k = 0; k < 6; k++) {
        set(cx, cy, P.crack);
        cx += rr() < 0.5 ? 1 : 0; cy += rr() < 0.6 ? 1 : 0;
      }
    }
    // A few bones in the corner of some rooms.
    if (rr() < 0.6) {
      const bx = fx + fw - 9, by = fy + fh - 4;
      for (let i = 0; i < 5; i++) set(bx + i, by, P.bone[1]);
      set(bx - 1, by - 1, P.bone[2]); set(bx - 1, by + 1, P.bone[2]);
      set(bx + 5, by - 1, P.bone[2]); set(bx + 5, by + 1, P.bone[2]);
      // skull
      rect(bx + 1, by - 4, 3, 2, P.bone[1]);
      set(bx + 1, by - 3, P.crack); set(bx + 3, by - 3, P.crack);
      set(bx + 2, by - 5, P.bone[2]);
    }

    // Sewer grate in the wall (where the Hunter comes from).
    if (r.grate) drawGrate(set, rect, r.grate.x, r.grate.y, wallH);
  }
}

function drawGrate(set, rect, cx, cy, wallH) {
  const w = 7, h = Math.max(5, Math.min(7, wallH - 2));
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  rect(x0 - 1, y0 - 1, w + 2, h + 2, P.iron[1]);
  rect(x0, y0, w, h, P.void[0]);
  // a faint sickly glow at the bottom of the hole
  for (let x = x0 + 1; x < x0 + w - 1; x++) set(x, y0 + h - 1, P.moss[0]);
  for (let x = x0; x < x0 + w; x += 2) for (let y = y0; y < y0 + h; y++) set(x, y, P.iron[2]);
  rect(x0 - 1, y0 - 1, w + 2, 1, P.iron[3]);
  set(x0 - 1, y0 + h, P.iron[0]); set(x0 + w, y0 + h, P.iron[0]);
}
