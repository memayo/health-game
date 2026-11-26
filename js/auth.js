import { auth } from './firebase.js';
import {
  signInAnonymously,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

let ready = null;

/**
 * Anonymous identity remembered on this device (local persistence), so a player
 * who closes the tab, loses the network or refreshes comes back as the same uid
 * and can rejoin their room. All tabs of one browser share it: test several
 * players with different browsers / private windows / devices.
 */
export function signIn() {
  if (ready) return ready;
  ready = (async () => {
    await setPersistence(auth, browserLocalPersistence);
    if (auth.currentUser) return auth.currentUser;
    // Wait for a remembered user to be restored before creating a new one.
    const restored = await new Promise(resolve => {
      const off = auth.onAuthStateChanged(u => { off(); resolve(u); });
    });
    if (restored) return restored;
    const cred = await signInAnonymously(auth);
    return cred.user;
  })();
  return ready;
}

/**
 * The room this device was last in, for the Home "rejoin" button.
 * { code, role: 'host' | 'player', name }
 */
const KEY = 'hg.lastRoom';
export const lastRoom = {
  save(code, role, name = '') {
    try { localStorage.setItem(KEY, JSON.stringify({ code, role, name, at: Date.now() })); } catch { /* ignore */ }
  },
  get() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  },
  clear(code) {
    try {
      const cur = lastRoom.get();
      if (!code || !cur || cur.code === code) localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }
};
