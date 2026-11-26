// 6-room map: layout, adjacency, DOM rendering, anchors and camera.
// Contains no game rules.

import { SLOT_SPACING, TIMING } from './gameConfig.js';
import { PixelStage } from './pixelStage.js';

export const ROOMS = [
  { id: 'roomA', label: 'A', col: 0, row: 0 },
  { id: 'roomB', label: 'B', col: 1, row: 0 },
  { id: 'roomC', label: 'C', col: 2, row: 0 },
  { id: 'roomD', label: 'D', col: 0, row: 1 },
  { id: 'roomE', label: 'E', col: 1, row: 1 },
  { id: 'roomF', label: 'F', col: 2, row: 1 }
];

export const ROOM_IDS = ROOMS.map(r => r.id);

// Orthogonal connections only.
export const ADJACENCY = Object.freeze({
  roomA: ['roomB', 'roomD'],
  roomB: ['roomA', 'roomC', 'roomE'],
  roomC: ['roomB', 'roomF'],
  roomD: ['roomA', 'roomE'],
  roomE: ['roomB', 'roomD', 'roomF'],
  roomF: ['roomC', 'roomE']
});

export function isAdjacent(from, to) {
  return !!from && !!to && (ADJACENCY[from] || []).includes(to);
}

export function roomMeta(id) {
  return ROOMS.find(r => r.id === id) || null;
}

/**
 * Builds the map DOM inside `stage`.
 * Structure: stage > camera > world > (room* , characterLayer, effectLayer)
 */
export function buildMap(stage) {
  stage.innerHTML = '';
  stage.classList.add('stage');

  const camera = document.createElement('div');
  camera.className = 'camera';

  const world = document.createElement('div');
  world.className = 'world';

  const roomEls = {};
  for (const r of ROOMS) {
    const el = document.createElement('div');
    el.className = 'room';
    el.dataset.room = r.id;
    el.style.gridColumn = String(r.col + 1);
    el.style.gridRow = String(r.row + 1);
    el.innerHTML =
      '<span class="room-label">' + r.label + '</span>' +
      '<span class="pipe" data-pipe="' + r.id + '"></span>' +
      '<span class="room-floor"></span>';
    roomEls[r.id] = el;
    world.appendChild(el);
  }

  const characterLayer = document.createElement('div');
  characterLayer.className = 'layer character-layer';
  const effectLayer = document.createElement('div');
  effectLayer.className = 'layer effect-layer';

  world.appendChild(characterLayer);
  world.appendChild(effectLayer);
  camera.appendChild(world);
  stage.appendChild(camera);

  // Pixel-art dungeon + live effects, drawn on canvases under/over the DOM.
  const pixels = new PixelStage(world, () => ({
    rooms: ROOMS.map(r => {
      const el = roomEls[r.id];
      const pipe = el.querySelector('.pipe');
      return {
        id: r.id, col: r.col, row: r.row,
        x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight,
        grate: pipe ? {
          x: el.offsetLeft + pipe.offsetLeft + pipe.offsetWidth / 2,
          y: el.offsetTop + pipe.offsetTop + pipe.offsetHeight / 2
        } : null
      };
    })
  }));
  pixels.mountFg(effectLayer);
  const relayout = () => pixels.resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null;
  if (ro) ro.observe(world);
  window.addEventListener('resize', relayout);
  // A candle in each room, standing against the back wall away from the grate.
  ROOMS.forEach((r, i) => {
    pixels.addAmbient('fire/candle', r.id, { fx: 0.13, fy: 2.1, wall: true }, { seed: 11 + i * 7, light: 0.9 });
  });

  const api = {
    stage, camera, world, roomEls, characterLayer, effectLayer, pixels,

    /** Game-pixel scale (CSS px per art pixel). Sprites use it to match the map. */
    pixelScale() { return pixels.k; },

    /** Centre point of a room in world coordinates. */
    roomCenter(roomId) {
      const el = roomEls[roomId];
      if (!el) return { x: 0, y: 0 };
      return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
    },

    /** Standing anchor for a character, offset by slot so sprites do not overlap. */
    characterAnchor(roomId, slotIndex = 0, slotCount = 1) {
      const c = api.roomCenter(roomId);
      // Slots scale with the art so sprites keep the same relative spacing.
      const spread = (slotIndex - (slotCount - 1) / 2) * SLOT_SPACING * (pixels.k / 2);
      const el = roomEls[roomId];
      // Stand on the floor below the back wall, not the room's geometric centre.
      return { x: c.x + spread, y: c.y + (el ? el.offsetHeight * 0.2 : 8) };
    },

    /** Configurable pipe/vent spawn anchor used by the Hunter reveal. */
    pipeAnchor(roomId) {
      const el = roomEls[roomId];
      const pipe = el && el.querySelector('.pipe');
      if (!pipe) return api.roomCenter(roomId);
      return {
        x: el.offsetLeft + pipe.offsetLeft + pipe.offsetWidth / 2,
        y: el.offsetTop + pipe.offsetTop + pipe.offsetHeight / 2
      };
    },

    /** On the floor just below a room's grate: where the Hunter surfaces. */
    pipeFloorAnchor(roomId) {
      const p = api.pipeAnchor(roomId);
      const el = roomEls[roomId];
      if (!el) return p;
      return { x: p.x - el.offsetWidth * 0.08, y: el.offsetTop + el.offsetHeight * 0.92 };
    },

    setRoomState(roomId, state) {
      const el = roomEls[roomId];
      if (el) el.dataset.state = state || '';
    },

    clearRoomStates() {
      for (const id of ROOM_IDS) api.setRoomState(id, '');
    },

    onRoomClick(handler) {
      for (const id of ROOM_IDS) {
        roomEls[id].addEventListener('click', () => handler(id));
      }
    },

    /** Camera transform only - the layout itself is never mutated. */
    focusRoom(roomId, scale = 1.9) {
      const c = api.roomCenter(roomId);
      const w = stage.clientWidth, h = stage.clientHeight;
      camera.style.transition = 'transform ' + TIMING.cameraDuration + 'ms ease-in-out';
      camera.style.transform =
        'translate(' + (w / 2 - c.x * scale) + 'px,' + (h / 2 - c.y * scale) + 'px) scale(' + scale + ')';
    },

    /** Stop the pixel layer and listeners (used by the tutorial's demo maps). */
    destroy() {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', relayout);
      pixels.destroy();
      stage.innerHTML = '';
    },

    resetCamera() {
      camera.style.transition = 'transform ' + TIMING.cameraDuration + 'ms ease-in-out';
      camera.style.transform = 'translate(0px,0px) scale(1)';
    }
  };

  return api;
}
