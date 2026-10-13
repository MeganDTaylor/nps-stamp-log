// From Firebase console → Project settings → Your apps → Web app. These identify the project and
// aren't secret; firestore.rules is what keeps each person's data private.
// Empty the apiKey to run in demo mode, which saves to this browser only.
export const firebaseConfig = {
  apiKey: "AIzaSyDrEukR218svdKrJVj43k44lq7SwpTjGlo",
  authDomain: "nps-stamp-log.firebaseapp.com",
  projectId: "nps-stamp-log",
  storageBucket: "nps-stamp-log.firebasestorage.app",
  messagingSenderId: "160813169305",
  appId: "1:160813169305:web:52040ea2025fe1d0915608",
};

// Set to true to point at the local Firebase emulators (firebase emulators:start).
export const useEmulators = false;
