import { auth } from './firebase.js';
import {
  signInAnonymously,
  setPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

let ready = null;

/**
 * Temporary identity for this tab only.
 * Session persistence (not local) so the uid survives the index -> host/game
 * navigation but dies with the tab. Nothing is ever restored from a previous run.
 */
export function signIn() {
  if (ready) return ready;
  ready = (async () => {
    await setPersistence(auth, browserSessionPersistence);
    const cred = await signInAnonymously(auth);
    return cred.user;
  })();
  return ready;
}

/**
 * One-shot ticket handing a room code from the landing page to the game page.
 * This is the OPPOSITE of session recovery: the ticket is consumed on read, so a
 * refresh arrives without one and the client is sent back to Home rather than
 * rejoining. Nothing here survives a tab close.
 */
export const handoff = {
  give(code) {
    try { sessionStorage.setItem('hg.enter', code); } catch { /* ignore */ }
  },
  take(code) {
    let v = null;
    try {
      v = sessionStorage.getItem('hg.enter');
      sessionStorage.removeItem('hg.enter');
    } catch { /* ignore */ }
    return v === code;
  }
};
