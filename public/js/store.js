// Data layer. Three backends with the same shape:
//   FirebaseStore — Firebase Auth + Firestore, data under users/{uid}/...
//   ArtifactStore — the claude.ai preview page, data in the viewer's private artifact storage.
//   LocalStore    — demo mode, saves to localStorage, no sign-in.
// Collections used by the app: "visits", "stamps", "places".
import { firebaseConfig, useEmulators } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

export async function createStore() {
  if (firebaseConfig.apiKey) return new FirebaseStore(await loadFirebase());
  if (window.claude?.use) {
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    const uid = db && user ? await user.id() : null;
    if (uid) return new ArtifactStore(db, uid);
  }
  return new LocalStore();
}

async function loadFirebase() {
  const [app, auth, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  return { app, auth, fs };
}

class FirebaseStore {
  constructor({ app, auth, fs }) {
    this.mode = "firebase";
    this.sdk = { auth, fs };
    const a = app.initializeApp(firebaseConfig);
    this.auth = auth.getAuth(a);
    this.db = fs.initializeFirestore(a, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    if (useEmulators) {
      auth.connectAuthEmulator(this.auth, "http://127.0.0.1:9099", { disableWarnings: true });
      fs.connectFirestoreEmulator(this.db, "127.0.0.1", 8080);
    }
    this.uid = null;
  }
  onAuth(cb) {
    return this.sdk.auth.onAuthStateChanged(this.auth, (u) => {
      this.uid = u ? u.uid : null;
      cb(u ? { uid: u.uid, email: u.email, name: u.displayName || "" } : null);
    });
  }
  signIn(email, pw) { return this.sdk.auth.signInWithEmailAndPassword(this.auth, email, pw); }
  signUp(email, pw) { return this.sdk.auth.createUserWithEmailAndPassword(this.auth, email, pw); }
  signInGoogle() { return this.sdk.auth.signInWithPopup(this.auth, new this.sdk.auth.GoogleAuthProvider()); }
  resetPassword(email) { return this.sdk.auth.sendPasswordResetEmail(this.auth, email); }
  signOut() { return this.sdk.auth.signOut(this.auth); }

  col(name) { return this.sdk.fs.collection(this.db, "users", this.uid, name); }
  subscribe(name, cb, onError) {
    return this.sdk.fs.onSnapshot(this.col(name),
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
  }
  async add(name, data) {
    const ref = await this.sdk.fs.addDoc(this.col(name), { ...data, createdAt: this.sdk.fs.serverTimestamp() });
    return ref.id;
  }
  update(name, id, data) {
    return this.sdk.fs.updateDoc(this.sdk.fs.doc(this.col(name), id), { ...data, updatedAt: this.sdk.fs.serverTimestamp() });
  }
  set(name, id, data) {
    return this.sdk.fs.setDoc(this.sdk.fs.doc(this.col(name), id), { ...data, updatedAt: this.sdk.fs.serverTimestamp() });
  }
  remove(name, id) { return this.sdk.fs.deleteDoc(this.sdk.fs.doc(this.col(name), id)); }
}

class ArtifactStore {
  constructor(db, uid) {
    this.mode = "artifact";
    this.uid = uid;
    // data/users/<id>/ is private to each viewer.
    this.root = db.doc(`data/users/${uid}/passport`);
  }
  onAuth(cb) { setTimeout(() => cb({ uid: this.uid, email: "", name: "" }), 0); return () => {}; }
  signOut() {}
  subscribe(name, cb, onError) {
    return this.root.collection(name).onSnapshot((s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
  }
  async add(name, data) {
    const ref = await this.root.collection(name).add({ ...data, createdAt: new Date().toISOString() });
    return ref.id;
  }
  update(name, id, data) { return this.root.collection(name).doc(id).update(data); }
  set(name, id, data) { return this.root.collection(name).doc(id).set(data); }
  remove(name, id) { return this.root.collection(name).doc(id).delete(); }
}

class LocalStore {
  constructor() {
    this.mode = "local";
    this.uid = "local";
    this.listeners = {};
  }
  onAuth(cb) { setTimeout(() => cb({ uid: "local", email: "", name: "" }), 0); return () => {}; }
  signOut() {}
  read(name) {
    try { return JSON.parse(localStorage.getItem("stamptrail:" + name) || "[]"); } catch { return []; }
  }
  write(name, rows) {
    try { localStorage.setItem("stamptrail:" + name, JSON.stringify(rows)); }
    catch { throw new Error("This browser won't let the page save. Try a normal (not private) window."); }
    (this.listeners[name] || []).forEach((cb) => cb(rows));
  }
  subscribe(name, cb) {
    (this.listeners[name] ||= []).push(cb);
    setTimeout(() => cb(this.read(name)), 0);
    return () => { this.listeners[name] = this.listeners[name].filter((x) => x !== cb); };
  }
  async add(name, data) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    this.write(name, [...this.read(name), { id, ...data, createdAt: new Date().toISOString() }]);
    return id;
  }
  async update(name, id, data) {
    this.write(name, this.read(name).map((r) => (r.id === id ? { ...r, ...data } : r)));
  }
  async set(name, id, data) {
    this.write(name, [...this.read(name).filter((r) => r.id !== id), { id, ...data }]);
  }
  async remove(name, id) { this.write(name, this.read(name).filter((r) => r.id !== id)); }
}
