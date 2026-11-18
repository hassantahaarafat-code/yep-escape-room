// Tiny data layer: Firebase Realtime Database when configured, otherwise a local demo mode
// (localStorage, syncs between tabs in the same browser only — for testing).
window.DB = (function () {
  const cfg = window.FIREBASE_CONFIG;
  const live = !!(cfg && cfg.databaseURL && window.firebase);
  if (live) {
    firebase.initializeApp(cfg);
    const db = firebase.database();
    const r = p => db.ref(p);
    return {
      live: true,
      onRoot(cb) { r("/").on("value", s => cb(s.val() || {})); },
      onConn(cb) { r(".info/connected").on("value", s => cb(!!s.val())); },
      set: (p, v) => r(p).set(v),
      update: (p, o) => r(p).update(o),
      push: (p, v) => r(p).push(v),
      remove: p => r(p).remove(),
      txn: (p, fn) => r(p).transaction(fn).then(res => ({ committed: res.committed, value: res.snapshot.val() })),
      now: () => Date.now() + (window.__skew || 0),
      initSkew() { r(".info/serverTimeOffset").on("value", s => { window.__skew = s.val() || 0; }); }
    };
  }
  // ---- demo mode ----
  const KEY = "yep_demo_db";
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { state = {}; }
  const subs = [];
  const parts = p => p.split("/").filter(Boolean);
  function getAt(o, ks) { for (const k of ks) { if (o == null) return undefined; o = o[k]; } return o; }
  function setAt(ks, v) {
    if (!ks.length) { state = v || {}; return; }
    let o = state;
    for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== "object" || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  }
  function emit() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    const snap = JSON.parse(JSON.stringify(state));
    subs.forEach(cb => setTimeout(() => cb(snap), 0));
  }
  window.addEventListener("storage", e => {
    if (e.key !== KEY) return;
    try { state = JSON.parse(e.newValue || "{}"); } catch (x) { state = {}; }
    const snap = JSON.parse(JSON.stringify(state));
    subs.forEach(cb => cb(snap));
  });
  const reload = () => { try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {} };
  let n = 0;
  return {
    live: false,
    onRoot(cb) { subs.push(cb); setTimeout(() => cb(JSON.parse(JSON.stringify(state))), 0); },
    onConn(cb) { cb(true); },
    async set(p, v) { reload(); setAt(parts(p), v); emit(); },
    async update(p, o) { reload(); const base = parts(p); for (const k in o) setAt(base.concat(parts(k)), o[k]); emit(); },
    async push(p, v) { reload(); const id = "k" + Date.now().toString(36) + (n++) + Math.random().toString(36).slice(2, 6); setAt(parts(p).concat(id), v); emit(); return { key: id }; },
    async remove(p) { reload(); setAt(parts(p), null); emit(); },
    async txn(p, fn) {
      reload(); const ks = parts(p); const cur = getAt(state, ks);
      const nv = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur)));
      if (nv === undefined) return { committed: false, value: cur };
      setAt(ks, nv); emit(); return { committed: true, value: nv };
    },
    now: () => Date.now(),
    initSkew() {}
  };
})();
