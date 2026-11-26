// QR code that opens the Join screen with the room code already filled in.
// Generated locally (vendor/qrcode.js, MIT); nothing is sent anywhere.

import qrcode from './vendor/qrcode.js';

/** URL a phone opens to join this room. Works from any host (Firebase, Pages, LAN). */
export function joinUrl(code) {
  const dir = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  return dir + 'index.html?room=' + encodeURIComponent(code);
}

/**
 * Draw the QR into a canvas as crisp pixels (dark ink on parchment).
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {number} px CSS size of one module
 */
export function drawQr(canvas, text, px = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, size = n + quiet * 2;
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = canvas.style.height = (size * px) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f3e3b8';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1e150c';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) ctx.fillRect(c + quiet, r + quiet, 1, 1);
  }
}
