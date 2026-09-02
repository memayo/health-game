// Copy this file to js/firebase-config.js and paste your own Firebase project values.
//
// Paste ONLY the values. The snippet shown in the Firebase console is written for a
// bundler: it starts with `import { initializeApp } from "firebase/app"` and calls
// initializeApp() itself. Both are wrong here -- a browser cannot resolve "firebase/app"
// ("Failed to resolve module specifier"), and js/firebase.js already does the init.
// This file must import nothing and only export firebaseConfig.
//
// databaseURL is required and is NOT in the default console snippet. Copy it from
// Realtime Database -> Data (it carries your region, e.g. asia-southeast1).
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  databaseURL: 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID'
};
