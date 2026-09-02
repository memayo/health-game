import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

// Fail loudly if firebase-config.js was copied but never filled in.
for (const key of ['apiKey', 'databaseURL', 'projectId']) {
  const value = firebaseConfig[key];
  if (!value || String(value).startsWith('YOUR_')) {
    throw new Error('js/firebase-config.js: "' + key + '" is not set. '
      + 'Copy js/firebase-config.example.js and paste your own Firebase values.');
  }
}

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

export * from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
