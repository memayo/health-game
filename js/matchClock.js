// HUD clock for the whole match (display only; the Host decides when time is up).

export function startMatchClock(el, getEndsAt, now) {
  if (!el) return () => {};
  const paint = () => {
    const end = getEndsAt();
    if (!end) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const left = Math.max(0, Math.ceil((end - now()) / 1000));
    const m = Math.floor(left / 60), s = left % 60;
    el.textContent = '⏳ ' + m + ':' + String(s).padStart(2, '0');
    el.classList.toggle('low', left <= 60);
    el.classList.toggle('over', left === 0);
  };
  paint();
  const t = setInterval(paint, 500);
  return () => clearInterval(t);
}
