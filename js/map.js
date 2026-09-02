// 6-room map: layout, adjacency, DOM rendering, anchors and camera.
// Contains no game rules.

import { SLOT_SPACING, TIMING } from './gameConfig.js';

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

  const api = {
    stage, camera, world, roomEls, characterLayer, effectLayer,

    /** Centre point of a room in world coordinates. */
    roomCenter(roomId) {
      const el = roomEls[roomId];
      if (!el) return { x: 0, y: 0 };
      return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
    },

    /** Standing anchor for a character, offset by slot so sprites do not overlap. */
    characterAnchor(roomId, slotIndex = 0, slotCount = 1) {
      const c = api.roomCenter(roomId);
      const spread = (slotIndex - (slotCount - 1) / 2) * SLOT_SPACING;
      return { x: c.x + spread, y: c.y + 8 };
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

    resetCamera() {
      camera.style.transition = 'transform ' + TIMING.cameraDuration + 'ms ease-in-out';
      camera.style.transform = 'translate(0px,0px) scale(1)';
    }
  };

  return api;
}
