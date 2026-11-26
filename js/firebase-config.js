// Config values only. js/firebase.js is the single place that calls initializeApp()
// and it loads the SDK from the gstatic CDN, so this file imports nothing.
// Committed so GitHub Pages can serve the game. A Firebase web config is not a
// secret: access is controlled by database.rules.json and Authentication.
export const firebaseConfig = {
  apiKey: "AIzaSyDIZlklgwQJSpNufbI6lIADdjIratWwA7A",
  authDomain: "healthgame-2b63b.firebaseapp.com",
  projectId: "healthgame-2b63b",
  storageBucket: "healthgame-2b63b.firebasestorage.app",
  messagingSenderId: "160850692971",
  appId: "1:160850692971:web:e344bbf48eb8c72be59a2e",
  measurementId: "G-RHFDKYY3HC",
  databaseURL: "https://healthgame-2b63b-default-rtdb.asia-southeast1.firebasedatabase.app"
};
