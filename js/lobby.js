// Landing screens: Home -> Host, Home -> Join, or Home -> Rejoin a room this
// device was in (same anonymous uid, remembered on the device).

import { signIn, lastRoom } from './auth.js';
import { db, ref, get, set, update, serverTimestamp } from './firebase.js';
import { makeRoomCode, PHASE } from './gameState.js';

const $ = (id) => document.getElementById(id);

function showView(name) {
  $('view-home').classList.toggle('hidden', name !== 'home');
  $('view-join').classList.toggle('hidden', name !== 'join');
  $('msg-home').textContent = '';
  $('msg-join').textContent = '';
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) {
    if (on) { btn.dataset.label = btn.innerHTML; btn.textContent = label; }
    else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

$('btn-join').addEventListener('click', () => {
  showView('join');
  $('join-code').focus();
});

$('btn-back').addEventListener('click', () => showView('home'));

$('join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('btn-host').addEventListener('click', async () => {
  busy($('btn-host'), true, 'กำลังสร้างห้อง…');
  try {
    const user = await signIn();
    let code = null;
    for (let i = 0; i < 8 && !code; i++) {
      const candidate = makeRoomCode();
      const snap = await get(ref(db, 'rooms/' + candidate + '/meta'));
      if (!snap.exists()) code = candidate;
    }
    if (!code) throw new Error('room code');

    // meta first: the security rules key every other node off meta/hostUid.
    await set(ref(db, 'rooms/' + code + '/meta'), {
      hostUid: user.uid, createdAt: serverTimestamp()
    });
    await set(ref(db, 'rooms/' + code + '/public'), {
      phase: PHASE.LOBBY, turn: 0, phaseResolved: false
    });
    lastRoom.save(code, 'host');
    location.href = 'host.html?room=' + code;
  } catch (e) {
    console.error(e);
    $('msg-home').textContent = 'สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง';
    busy($('btn-host'), false, true);
  }
});

$('join-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('join-name').value.trim().slice(0, 14);
  if (!code || !name) return;
  $('msg-join').textContent = '';
  const btn = ev.submitter || $('join-form').querySelector('[type="submit"]');
  busy(btn, true, 'กำลังเข้าห้อง…');
  try {
    const user = await signIn();
    const metaSnap = await get(ref(db, 'rooms/' + code + '/meta'));
    if (!metaSnap.exists()) { $('msg-join').textContent = 'ไม่พบห้องนี้'; return; }

    // Already in this room (dropped out earlier)? Then just walk back in.
    const mine = await get(ref(db, 'rooms/' + code + '/players/' + user.uid));
    if (!mine.exists()) {
      const phaseSnap = await get(ref(db, 'rooms/' + code + '/public/phase'));
      if (phaseSnap.val() !== PHASE.LOBBY) { $('msg-join').textContent = 'ห้องนี้เริ่มเล่นไปแล้ว'; return; }
    }

    await update(ref(db, 'rooms/' + code + '/players/' + user.uid), {
      displayName: mine.exists() ? (mine.val().displayName || name) : name,
      connected: true
    });
    lastRoom.save(code, 'player', name);
    location.href = 'game.html?room=' + code;
  } catch (e) {
    console.error(e);
    $('msg-join').textContent = 'เข้าห้องไม่สำเร็จ ลองใหม่อีกครั้ง';
  } finally {
    busy(btn, false, true);
  }
});

/* ---------------- rejoin ---------------- */

async function checkRejoin() {
  const last = lastRoom.get();
  if (!last || !last.code) return;
  try {
    const user = await signIn();
    const base = 'rooms/' + last.code;
    const meta = await get(ref(db, base + '/meta'));
    if (!meta.exists()) { lastRoom.clear(); return; }
    const phase = (await get(ref(db, base + '/public/phase'))).val();
    if (phase === PHASE.ENDED) { lastRoom.clear(); return; }

    let target = null;
    if (meta.val().hostUid === user.uid) target = 'host.html?room=' + last.code;
    else if ((await get(ref(db, base + '/players/' + user.uid))).exists()) target = 'game.html?room=' + last.code;
    if (!target) { lastRoom.clear(); return; }

    $('rejoin-code').textContent = 'ห้อง ' + last.code + (last.role === 'host' ? ' (Host)' : '');
    $('rejoin').classList.remove('hidden');
    $('btn-rejoin').onclick = () => { location.href = target; };
    $('btn-rejoin-no').onclick = () => { lastRoom.clear(); $('rejoin').classList.add('hidden'); };
  } catch (e) {
    console.error(e);
  }
}

checkRejoin();
