// Landing screens: Home -> Host, or Home -> Join.
// No localStorage, no session restore.

import { signIn, handoff } from './auth.js';
import { db, ref, get, set, update, serverTimestamp } from './firebase.js';
import { makeRoomCode, PHASE } from './gameState.js';

const $ = (id) => document.getElementById(id);

function showView(name) {
  $('view-home').classList.toggle('hidden', name !== 'home');
  $('view-join').classList.toggle('hidden', name !== 'join');
  $('msg-home').textContent = '';
  $('msg-join').textContent = '';
}

$('btn-join').addEventListener('click', () => {
  showView('join');
  $('join-code').focus();
});

$('btn-back').addEventListener('click', () => showView('home'));

$('btn-host').addEventListener('click', async () => {
  $('btn-host').disabled = true;
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
    handoff.give(code);
    location.href = 'host.html?room=' + code;
  } catch (e) {
    console.error(e);
    $('msg-home').textContent = 'failed';
    $('btn-host').disabled = false;
  }
});

$('join-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('join-name').value.trim().slice(0, 14);
  if (!code || !name) return;
  $('msg-join').textContent = '';
  try {
    const user = await signIn();
    const metaSnap = await get(ref(db, 'rooms/' + code + '/meta'));
    if (!metaSnap.exists()) { $('msg-join').textContent = 'no room'; return; }

    const phaseSnap = await get(ref(db, 'rooms/' + code + '/public/phase'));
    if (phaseSnap.val() !== PHASE.LOBBY) { $('msg-join').textContent = 'started'; return; }

    await update(ref(db, 'rooms/' + code + '/players/' + user.uid), {
      displayName: name,
      connected: true
    });
    handoff.give(code);
    location.href = 'game.html?room=' + code;
  } catch (e) {
    console.error(e);
    $('msg-join').textContent = 'failed';
  }
});
