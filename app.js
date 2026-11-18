{
const $ = s => document.querySelector(s);
const app = $("#app"), ov = $("#overlay");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const TEAMS = ["A", "B"];
const ROOMS = [1, 2, 3, 4, 5];

let S = {};                 // whole database snapshot
let loaded = false, online = true;
let lang = ls.get("yep_lang", "ar");
const PIDK = "yep_pid" + (new URLSearchParams(location.search).get("u") || "");
let me = ls.get(PIDK, "");
let tab = "journey", roomView = 0;
let isAdmin = location.hash === "#admin";
let adminOk = sessionStorage.getItem("yep_admin") === "1";
const drafts = {};          // unsaved text inputs, by element id
let lastReveal = null;
let popQueue = [], popOpen = false, modalOpen = false;

const t = o => (o && typeof o === "object") ? (o[lang] ?? o.en) : o;
const U = k => t(C.ui[k]);
const P = id => (S.participants || {})[id];
const teamOf = id => (P(id) || {}).team || "";
const membersOf = T => Object.entries(S.participants || {}).filter(([, p]) => p.team === T).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
const TS = T => (S.teams || {})[T] || {};
const coachOf = (T, r) => ((S.coach || {})[T] || {})[r] || "";
const pw = (T, r) => ((S.passwords || {})[T] || {})[r] || "";
const board = T => (S.boards || {})[T] || "";
const llUsed = T => TS(T).llUsed || 0;
const teamName = T => C.ui.teamName[T] ? t(C.ui.teamName[T]) : T;
const roleLabel = r => ({ A: "Team A", B: "Team B", OBS: "Observer", VIL: "Villain actor" }[r] || "Unassigned");

// ---------- sound ----------
let actx = null;
function unlockAudio() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {} }
document.addEventListener("pointerdown", unlockAudio, { capture: true });
function beep(kind) {
  try {
    unlockAudio(); if (!actx) return;
    const notes = kind === "alert" ? [880, 660, 880, 660] : [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      const s = actx.currentTime + i * 0.14; g.gain.setValueAtTime(0.12, s); g.gain.exponentialRampToValueAtTime(0.001, s + 0.13);
      o.start(s); o.stop(s + 0.14);
    });
    if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
  } catch (e) {}
}

// ---------- helpers ----------
function setLang(l) {
  lang = l; ls.set("yep_lang", l);
  document.documentElement.lang = l; document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
  if (me && P(me)) DB.update("participants/" + me, { lang: l });
  render();
}
function poster(r, big) {
  const R = C.rooms[r];
  return `<div class="poster"><img src="${R.img}" alt="${esc(t(R.boss))}" onerror="this.parentNode.classList.add('noimg')"><span class="pname">${esc(t(R.boss))}</span></div>`;
}
function vline(r) {
  const R = C.rooms[r];
  return `<div class="vline">«${R.line}»</div>${lang === "en" ? `<div class="gloss">${esc(R.lineEn)}</div>` : ""}`;
}
function timerLeft(T) {
  const tm = TS(T).timer; if (!tm) return null;
  if (tm.paused) return tm.left || 0;
  return Math.max(0, (tm.end || 0) - DB.now());
}
const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function timerHtml(T) {
  const l = timerLeft(T); if (l == null) return "";
  return `<span class="timer ${l < 120000 ? "low" : ""}" data-timer="${T}">${fmt(l)}</span>${TS(T).timer.paused ? ` <span class="tag">${U("paused")}</span>` : ""}`;
}
setInterval(() => {
  document.querySelectorAll("[data-timer]").forEach(el => {
    const l = timerLeft(el.dataset.timer); if (l == null) return;
    el.textContent = fmt(l); el.classList.toggle("low", l < 120000);
  });
}, 1000);

function withFocus(fn) {
  const a = document.activeElement, id = a && a.id, ss = a && a.selectionStart, se = a && a.selectionEnd;
  const y = window.scrollY;
  fn();
  if (id) { const n = document.getElementById(id); if (n) { n.focus({ preventScroll: true }); try { if (ss != null) n.setSelectionRange(ss, se); } catch (e) {} } }
  window.scrollTo(0, y);
}
const val = (id, def) => drafts[id] !== undefined ? drafts[id] : (def ?? "");

// ---------- overlay: modal + surprise popups ----------
function modal(html) { modalOpen = true; ov.innerHTML = `<div class="pop">${html}</div>`; ov.classList.add("show"); }
function closeOv() { ov.classList.remove("show"); ov.innerHTML = ""; modalOpen = false; popOpen = false; setTimeout(nextPop, 50); }
ov.addEventListener("click", e => { if (e.target === ov && !popOpen) closeOv(); });
function confirmBox(text, yes) {
  modal(`<div class="txt">${text}</div><div class="seg"><button class="btn red" id="cy">${U("yes")}</button><button class="btn ghost" id="cn">${U("no")}</button></div>`);
  $("#cy").onclick = () => { closeOv(); yes(); }; $("#cn").onclick = closeOv;
}
function nextPop() {
  if (popOpen || modalOpen || !popQueue.length) return;
  const s = popQueue.shift(); popOpen = true;
  ov.innerHTML = `<div class="pop surp"><div class="big">${U("surprise")}</div><div class="txt">${esc(lang === "ar" ? (s.ar || s.en) : (s.en || s.ar))}</div>${lang === "en" && s.ar ? `<div class="muted" dir="rtl" style="color:#3a2f24">${esc(s.ar)}</div>` : ""}<button class="btn red" id="pc" style="width:100%;margin-top:12px">${U("close")}</button></div>`;
  ov.classList.add("show"); beep("surp");
  $("#pc").onclick = () => { popOpen = false; ov.classList.remove("show"); ov.innerHTML = ""; setTimeout(nextPop, 120); };
}
function isForMe(s) {
  if (!me) return false;
  if (s.targetType === "team") return s.team === teamOf(me);
  return s.targetId === me;
}
function checkSurprises() {
  if (isAdmin || !me || !P(me)) return;
  const key = "yep_seen_" + me;
  let seen = +ls.get(key, "0");
  if (!seen) { seen = DB.now(); ls.set(key, String(seen)); }
  const list = Object.values(S.surprises || {}).filter(s => s.sentAt > seen && isForMe(s)).sort((a, b) => a.sentAt - b.sentAt);
  if (list.length) { ls.set(key, String(list[list.length - 1].sentAt)); popQueue.push(...list); nextPop(); }
}

// ---------- data actions ----------
const genCode = () => String(Math.floor(1000 + Math.random() * 9000));
function ensurePasswords() {
  const up = {};
  TEAMS.forEach(T => ROOMS.forEach(r => { if (r > 1 && !pw(T, r)) up[`${T}/${r}`] = genCode(); }));
  if (Object.keys(up).length) DB.update("passwords", up);
}
function openRoom(T, r) {
  const up = {};
  up[`teams/${T}/unlocked/${r}`] = true;
  up[`teams/${T}/currentRoom`] = r;
  up[`teams/${T}/status`] = "in";
  up[`teams/${T}/timer`] = { end: DB.now() + C.durations[r] * 60000, paused: false, left: 0 };
  return DB.update("/", up);
}
async function useLifeline(type, r) {
  const T = teamOf(me);
  const res = await DB.txn(`teams/${T}/llUsed`, c => ((c || 0) >= 3 ? undefined : (c || 0) + 1));
  if (!res.committed) { render(); return; }
  const up = {};
  if (type === "hint" || type === "example") up[`teams/${T}/opened/${r}/${type}`] = true;
  if (type === "time") {
    const tm = TS(T).timer;
    if (tm) { if (tm.paused) up[`teams/${T}/timer/left`] = (tm.left || 0) + 180000; else up[`teams/${T}/timer/end`] = Math.max(tm.end || 0, DB.now()) + 180000; }
  }
  if (Object.keys(up).length) await DB.update("/", up);
  if (type === "call") { await DB.push("alerts", { team: T, room: r, by: me, at: DB.now(), done: false }); modal(`<div class="txt">${U("gmCalled")}</div><button class="btn red" id="cx">${U("close")}</button>`); $("#cx").onclick = closeOv; }
  DB.push("lifelineLog", { team: T, type, room: r, by: me, at: DB.now() });
}
async function tryPassword(r) {
  const T = teamOf(me), inp = $("#pw" + r), v = (inp.value || "").trim().toLowerCase();
  const want = String(pw(T, r + 1)).trim().toLowerCase();
  if (v && want && v === want && TS(T).currentRoom === r) {
    delete drafts["pw" + r]; await openRoom(T, r + 1); roomView = r + 1; tab = "room"; window.scrollTo(0, 0);
  } else { $("#pwerr" + r).textContent = U("wrongPw"); inp.select(); }
}

// ---------- participant screens ----------
function header(extra) {
  const p = P(me);
  return `${DB.live ? "" : `<div class="demo">DEMO MODE — not connected to Firebase (works only in this browser)</div>`}
  <div class="top"><span class="conn ${online ? "on" : ""}" title="connection"></span><span class="brand">${U("title")}</span>${p ? `<span class="who">${esc(p.name)}${p.team && TEAMS.includes(p.team) ? " · " + teamName(p.team) : ""}</span>` : ""}${extra || ""}<button class="lang" id="lng">${lang === "ar" ? "EN" : "عربي"}</button></div>`;
}
function joinScreen() {
  return `${header()}<main><div class="paper" style="max-width:520px;margin:6vh auto 0">
  <h1>${U("title")}</h1><p class="muted">${esc(t(C.challenge))}</p>
  <label for="jn"><b>${U("joinName")}</b></label><input id="jn" autocomplete="name" value="${esc(val("jn"))}" maxlength="40">
  <p style="margin-top:14px"><b>${U("pickLang")}</b></p>
  <div class="seg"><button class="btn ${lang === "ar" ? "on" : ""}" data-l="ar">عربي</button><button class="btn ${lang === "en" ? "on" : ""}" data-l="en">English</button></div>
  <button class="btn red" id="jb" style="width:100%;margin-top:18px">${U("joinBtn")}</button></div></main>`;
}
function waitScreen() {
  return `${header()}<main><div class="paper dark" style="max-width:560px;margin:8vh auto 0;text-align:center">
  <div class="spinner" style="margin:0 auto 16px"></div><h2>${U("waiting")}</h2><p>${U("waitingSub")}</p></div></main>`;
}
function navBar(hasTeam) {
  const items = hasTeam ? ["journey", "card", "team", "room"] : ["journey", "card"];
  if (S.game && S.game.reveal) items.push("debrief");
  return `<nav class="nav">${items.map(k => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${U({ journey: "tabJourney", card: "tabCard", team: "tabTeam", room: "tabRoom", debrief: "tabDebrief" }[k])}</button>`).join("")}</nav>`;
}
function journey() {
  const T = teamOf(me), ts = TS(T), hasTeam = TEAMS.includes(T);
  const st = ROOMS.map(r => {
    const unl = hasTeam && ts.unlocked && ts.unlocked[r];
    const done = hasTeam && ((ts.unlocked && ts.unlocked[r + 1]) || (r === 5 && ts.status === "escaped"));
    const cur = hasTeam && ts.currentRoom === r && !done;
    const R = C.rooms[r];
    return `<div class="st ${done ? "done" : cur ? "cur" : unl ? "" : "locked"}" data-go="${unl ? r : ""}">
      <span class="num">${r}</span>${poster(r)}
      <div><div class="vl">${esc(t(R.boss))}</div><div class="vl" style="color:var(--ink)">«${R.line}»</div><div class="sg">${esc(t(R.stage))}</div><div class="ol">${esc(t(R.oneLine))}</div>
      <div class="badge">${done ? "✓ " + U("cleared") : cur ? "▶ " + U("current") : unl ? "" : "🔒 " + U("locked")}</div></div></div>`;
  }).join("");
  return `<div class="paper"><h1>${U("title")}</h1><p style="font-size:18px">${esc(t(C.intro))}</p></div>
  <div class="road">${st}</div>
  <div class="paper dark" style="margin-top:16px"><h2>${esc(t(C.challengeLine))}</h2></div>
  <div class="paper"><h2>${U("rulesH")}</h2><ol class="rules">${C.rules[lang].map(x => `<li>${esc(x)}</li>`).join("")}</ol></div>
  ${hasTeam && ts.status === "escaped" ? `<div class="paper dark" style="text-align:center"><h1 style="color:var(--mus)">${U("escaped")}</h1></div>` : ""}`;
}
function missionFor(id) {
  // returns list of missions visible to this person now
  const out = [], M = S.missions || {};
  TEAMS.forEach(T => {
    const m = M[T] || {}, cr = TS(T).currentRoom || 0;
    if (m.meligy === id && cr >= 2) out.push({ type: "meligy", team: T });
    if (m.raya === id && cr >= 4) out.push({ type: "raya", team: T });
  });
  return out;
}
function missionHtml(m) {
  if (m.type === "meligy") {
    const M = C.missions.meligy;
    return `<div class="paper dark"><span class="tag">${U("mission")}</span><h2 style="margin-top:8px">${U("meligyMan")}</h2><p style="font-size:17px">${esc(t(M))}</p>
    <ol>${M.notes.map(n => `<li style="margin-bottom:8px"><b>${esc(t(n))}</b></li>`).join("")}</ol></div>`;
  }
  const b = TS(m.team).bites || 0;
  return `<div class="paper dark"><span class="tag">${U("mission")} · ${teamName(m.team)}</span><h2 style="margin-top:8px">${U("rayaTester")}</h2>
  <p style="font-size:17px">${esc(t(C.missions.raya))}</p>
  <button class="btn" data-bite="${m.team}" style="width:100%;font-size:22px;min-height:70px">🦷 ${U("bite")} <span class="tag">${b}</span></button></div>`;
}
function myCard() {
  const p = P(me), T = p.team;
  let h = "";
  if (TEAMS.includes(T)) {
    const pr = C.personas[p.persona];
    const coachRooms = ROOMS.filter(r => coachOf(T, r) === me);
    h += pr ? `<div class="pcard"><div class="muted" style="color:var(--cream)">${U("persona")}</div><div class="pn">${esc(t(pr))}</div>
      <p style="font-size:18px;margin-top:10px"><b>${U("behaviour")}:</b> ${esc(lang === "ar" ? pr.bar : pr.ben)}</p>
      <p><b>${U("when")}:</b> ${esc(lang === "ar" ? pr.war : pr.wen)}</p>
      ${coachRooms.map(r => `<p class="card-reveal" style="color:var(--ink)">${esc(C.coachNote[lang](r))}</p>`).join("")}</div>`
      : `<div class="paper"><p>${U("persona")}: —</p></div>`;
    h += `<div class="paper" style="margin-top:16px"><h2>${U("coachSchedule")}</h2><table class="sched">${ROOMS.map(r => {
      const c = coachOf(T, r); return `<tr class="${c === me ? "me" : ""}"><td>${U("room")} ${r} · ${esc(t(C.rooms[r].boss))}</td><td>${c ? esc((P(c) || {}).name || "?") + (c === me ? " (" + U("you") + ")" : "") : "—"}</td></tr>`;
    }).join("")}</table></div>`;
  } else {
    h += `<div class="paper dark"><h2>${T === "OBS" ? U("observerMsg") : U("villainMsg")}</h2></div>`;
  }
  const ms = missionFor(me);
  h += ms.length ? ms.map(missionHtml).join("") : `<div class="paper"><p class="muted">${U("noMission")}</p></div>`;
  return h;
}
function boardLink(T) {
  const b = board(T);
  return b ? `<a class="btn" href="${esc(b)}" target="_blank" rel="noopener" style="width:100%">📋 ${U("board")}</a>` : `<p class="muted">${U("noBoard")}</p>`;
}
function llBar(T, r) {
  const used = llUsed(T), left = 3 - used, dis = left <= 0 ? "disabled" : "";
  const op = ((TS(T).opened || {})[r]) || {};
  return `<div class="paper"><h3>${U("lifelines")} <span class="dots">${[0, 1, 2].map(i => `<i class="${i < used ? "used" : ""}"></i>`).join("")}</span> <span class="muted">${left} ${U("left")}</span></h3>
  <div class="ll">
   <button class="btn" data-ll="hint" data-r="${r}" ${op.hint || !r ? "disabled" : dis}>💡<span>${U("hint")}</span></button>
   <button class="btn" data-ll="example" data-r="${r}" ${op.example || !r ? "disabled" : dis}>📄<span>${U("example")}</span></button>
   <button class="btn" data-ll="time" data-r="${r}" ${!r ? "disabled" : dis}>⏱<span>${U("plus3")}</span></button>
   <button class="btn" data-ll="call" data-r="${r}" ${dis}>📣<span>${U("callGM")}</span></button>
  </div></div>`;
}
function teamScreen() {
  const T = teamOf(me), ts = TS(T);
  return `<div class="paper"><h1>${teamName(T)}</h1>
   <p><b>${U("room")}:</b> ${ts.status === "escaped" ? U("escaped") : ts.currentRoom ? ts.currentRoom + " · " + esc(t(C.rooms[ts.currentRoom].boss)) : U("notStarted")} ${timerHtml(T)}</p>
   <h3>${U("members")}</h3><ul>${membersOf(T).map(([id, p]) => `<li>${esc(p.name)}${id === me ? " (" + U("you") + ")" : ""}${ts.currentRoom && coachOf(T, ts.currentRoom) === id ? ` <span class="tag">${U("coachIs")}</span>` : ""}</li>`).join("")}</ul>
   ${boardLink(T)}</div>${llBar(T, ts.currentRoom || 0)}`;
}
function surprisesIn(r) {
  return Object.values(S.surprises || {}).filter(s => s.room === r && isForMe(s)).sort((a, b) => a.sentAt - b.sentAt);
}
function roomScreen(r) {
  const T = teamOf(me), ts = TS(T);
  if (!r || !(ts.unlocked || {})[r]) return `<div class="paper dark" style="text-align:center"><h2>🔒 ${U("notStarted")}</h2></div>`;
  const R = C.rooms[r], isCoach = coachOf(T, r) === me, op = (ts.opened || {})[r] || {};
  const coachName = (P(coachOf(T, r)) || {}).name;
  const cleared = (ts.unlocked || {})[r + 1] || (r === 5 && ts.status === "escaped");
  return `<div class="paper" style="padding:10px">${boardLink(T)}</div>
  <div class="paper"><div class="vhead">${poster(r)}<div><span class="tag">${U("room")} ${r} · ${esc(t(R.stage))}</span>
   <h1 style="margin-top:6px">${esc(t(R.boss))}</h1><div class="muted">${esc(t(R.film))}</div>${vline(r)}
   <div style="margin-top:8px">${ts.currentRoom === r ? timerHtml(T) : ""}</div>
   ${coachName ? `<p style="margin-top:8px">${isCoach ? `<span class="tag">★ ${U("youAreCoach")}</span>` : `<b>${U("coachIs")}:</b> ${esc(coachName)}`}</p>` : ""}</div></div>
   <p class="card-reveal"><b>${U("meaning")}:</b> ${esc(t(R.meaning))}<br><span class="muted">${U("programLink")}: ${esc(t(R.program))}</span></p></div>
  <div class="paper dark"><h2>${U("story")}</h2><p style="font-size:18px">${esc(t(R.story))}</p></div>
  <div class="paper"><h2>${U("steps")}</h2><ol class="steps">${R.steps.map(s => `<li><div class="mn">${s[2]}<small>${U("min")}</small></div><div><b>${esc(lang === "ar" ? s[1] : s[0])}</b>${esc(lang === "ar" ? s[4] : s[3])}</div></li>`).join("")}</ol>
   ${R.rule ? `<p class="card-reveal"><b>${U("rule")}:</b> ${esc(t(R.rule))}</p>` : ""}${R.win ? `<p class="card-reveal"><b>${U("win")}:</b> ${esc(t(R.win))}</p>` : ""}</div>
  <div class="paper"><h2>${U("output")}</h2><ul class="out">${R.output[lang].map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
  ${isCoach ? `<div class="paper coach"><h2 style="color:var(--ink)">★ ${U("coachTips")}</h2><p style="font-size:17px">${esc(t(R.tips))}</p></div>` : ""}
  ${op.hint ? `<div class="paper"><h3>💡 ${U("hint")}</h3><p>${esc(t(R.hint))}</p></div>` : ""}
  ${op.example ? `<div class="paper"><h3>📄 ${U("example")}</h3><ul>${R.example[lang].map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  <div class="paper dark">${cleared ? `<h2>✓ ${U("cleared")}</h2>` : r === 5 ? `<p>${U("finalRoom")}</p>` : `
   <label for="pw${r}"><h3 style="color:var(--mus)">🔑 ${U("password")}</h3></label>
   <div class="row"><input id="pw${r}" inputmode="numeric" autocomplete="off" value="${esc(val("pw" + r))}" style="flex:2;font-size:22px;text-align:center;letter-spacing:.2em;direction:ltr"><button class="btn" data-pw="${r}" style="flex:1">${U("unlock")}</button></div>
   <p id="pwerr${r}" style="color:var(--mus);font-weight:800;margin-top:6px"></p>`}</div>
  ${llBar(T, r)}
  <div class="paper"><h3>${U("surprisesLog")}</h3>${(() => { const l = surprisesIn(r); return l.length ? `<ul>${l.map(s => `<li>${esc(lang === "ar" ? s.ar || s.en : s.en || s.ar)}</li>`).join("")}</ul>` : `<p class="muted">${U("none")}</p>`; })()}</div>`;
}
function debrief() {
  if (!(S.game && S.game.reveal)) return `<div class="paper"><p>${U("debriefLocked")}</p></div>`;
  const M = S.missions || {};
  const nm = id => esc((P(id) || {}).name || "—");
  const lc = T => Object.values(S.lifelineLog || {}).filter(l => l.team === T).length;
  const sc = T => Object.values(S.surprises || {}).filter(s => s.team === T).length;
  return `<div class="paper dark" style="text-align:center"><h1 style="color:var(--mus)">${U("reveal")}</h1></div>
  ${TEAMS.filter(T => membersOf(T).length).map(T => `<div class="paper"><h2>${U("personasH")} · ${teamName(T)}</h2><p class="muted">${U("tapFlip")}</p>
   <div class="flips">${membersOf(T).map(([id, p]) => { const pr = C.personas[p.persona]; return `<div class="flip" data-flip><div class="in"><div class="f">${esc(p.name)}</div><div class="b">${pr ? esc(t(pr)) : "—"}<small>${esc(p.name)}</small></div></div></div>`; }).join("")}</div></div>`).join("")}
  <div class="paper"><h2>${U("missionsH")}</h2><table class="t">${TEAMS.map(T => `<tr><td><b>${teamName(T)}</b></td><td>${U("meligyMan")}: ${nm((M[T] || {}).meligy)}</td><td>${U("rayaTester")}: ${nm((M[T] || {}).raya)}</td></tr>`).join("")}</table></div>
  <div class="paper"><h2>${U("statsH")}</h2><div class="scroll"><table class="t"><tr><th></th><th>${U("bites")}</th><th>${U("llUsed")}</th><th>${U("surprisesRecv")}</th></tr>
   ${TEAMS.map(T => `<tr><td><b>${teamName(T)}</b></td><td>${TS(T).bites || 0}</td><td>${lc(T)}</td><td>${sc(T)}</td></tr>`).join("")}</table></div></div>
  <div class="paper"><h2>${U("mapH")}</h2><div class="scroll"><table class="t">${ROOMS.map(r => `<tr><td style="width:120px"><b>${r} · ${esc(t(C.rooms[r].boss))}</b></td><td>${esc(t(C.programMap[r]))}</td></tr>`).join("")}</table></div></div>`;
}
function participantView() {
  const p = P(me);
  if (!me || !p) return joinScreen();
  if (!p.team) return waitScreen();
  const hasTeam = TEAMS.includes(p.team);
  if (!hasTeam && (tab === "team" || tab === "room")) tab = "journey";
  if (tab === "debrief" && !(S.game && S.game.reveal)) tab = "journey";
  let body;
  if (tab === "card") body = myCard();
  else if (tab === "team") body = teamScreen();
  else if (tab === "room") body = roomScreen(roomView || TS(p.team).currentRoom || 0);
  else if (tab === "debrief") body = debrief();
  else body = journey();
  return `${header()}<main>${body}</main>${navBar(hasTeam)}`;
}

// ---------- admin ----------
function adminLogin() {
  return `<div class="top"><span class="brand">Game Master</span></div><main><div class="paper" style="max-width:420px;margin:8vh auto 0">
  <h2>Admin PIN</h2><input id="pin" type="password" inputmode="numeric" autocomplete="off"><button class="btn red" id="pinb" style="width:100%;margin-top:12px">Enter</button><p id="pinerr" class="warn"></p></div></main>`;
}
function opt(v, label, cur) { return `<option value="${esc(v)}" ${String(cur ?? "") === String(v) ? "selected" : ""}>${esc(label)}</option>`; }
function adminView() {
  const parts = Object.entries(S.participants || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const alerts = Object.entries(S.alerts || {}).filter(([, a]) => !a.done).sort((a, b) => a[1].at - b[1].at);
  const unassigned = parts.filter(([, p]) => !p.team);
  const sel = S.__target || ls.get("yep_tgt", "team:A");
  const personaPicker = (id, p) => `<select data-pp="${id}" ${TEAMS.includes(p.team) ? "" : "disabled"}>${opt("", "—", p.persona)}${C.personas.slice(1).map((x, i) => opt(i + 1, x.en, p.persona)).join("")}</select>`;
  const teamPicker = (id, p) => `<select data-tp="${id}">${["", "A", "B", "OBS", "VIL"].map(v => opt(v, roleLabel(v), p.team)).join("")}</select>`;
  const teamPanel = T => {
    const ts = TS(T), mem = membersOf(T);
    const counts = {}; mem.forEach(([, p]) => { if (p.persona) counts[p.persona] = (counts[p.persona] || 0) + 1; });
    const dup = Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => C.personas[k].en);
    const noPers = mem.filter(([, p]) => !p.persona).length;
    const anyone = parts.filter(([id, p]) => p.team !== T);
    const status = ts.status === "escaped" ? "ESCAPED" : ts.currentRoom ? `In room ${ts.currentRoom}` : "Not started";
    return `<div class="paper"><h2>Team ${T} <span class="tag">${status}</span> ${timerHtml(T)}</h2>
     <p><b>${mem.length}</b> members: ${mem.map(([, p]) => esc(p.name) + (p.persona ? ` <span class="muted">(${esc(C.personas[p.persona].en)})</span>` : "")).join(", ") || "—"}</p>
     ${dup.length ? `<p class="warn">Duplicate persona: ${dup.join(", ")}</p>` : ""}${noPers ? `<p class="warn">${noPers} member(s) without a persona</p>` : ""}
     <div class="row" style="margin:8px 0"><button class="btn red" data-start="${T}" ${ts.currentRoom ? "disabled" : ""}>▶ Start (open Room 1)</button><button class="btn" data-esc="${T}">🏁 Mark Escaped</button><button class="btn ghost sm" data-rnd="${T}">🎲 Suggest random</button></div>
     <h3>Unlock rooms (manual)</h3><div class="unl">${ROOMS.map(r => `<button class="btn sm ${(ts.unlocked || {})[r] ? "on" : ""}" data-unl="${T}:${r}">R${r}${(ts.unlocked || {})[r] ? " ✓" : ""}</button>`).join("")}</div>
     <h3 style="margin-top:12px">Timer</h3><div class="row">${ts.timer ? `<button class="btn sm" data-tpause="${T}">${ts.timer.paused ? "▶ Resume" : "⏸ Pause"}</button><button class="btn sm" data-tadd="${T}:1">+1 min</button><button class="btn sm" data-tadd="${T}:3">+3 min</button><button class="btn sm" data-tadd="${T}:-1">−1 min</button>` : `<span class="muted">Starts when a room opens.</span>`}</div>
     <h3 style="margin-top:12px">Passwords (entered inside the previous room)</h3>
     <div class="pwgrid">${ROOMS.map(r => r === 1 ? `<div><label>R1</label><input disabled value="Start"></div>` : `<div><label for="pwd_${T}_${r}">→ R${r}</label><input id="pwd_${T}_${r}" data-pwd="${T}:${r}" value="${esc(val(`pwd_${T}_${r}`, pw(T, r)))}"></div>`).join("")}</div>
     <h3 style="margin-top:12px">Board link</h3><input id="brd_${T}" data-brd="${T}" placeholder="https://miro.com/..." value="${esc(val("brd_" + T, board(T)))}">
     <h3 style="margin-top:12px">Coach rotation</h3><div class="pwgrid">${ROOMS.map(r => `<div><label>R${r}</label><select data-coach="${T}:${r}">${opt("", "—", coachOf(T, r))}${mem.map(([id, p]) => opt(id, p.name, coachOf(T, r))).join("")}</select></div>`).join("")}</div>
     <button class="btn ghost sm" data-autorot="${T}" style="margin-top:6px">Default rotation (next member each room)</button>
     <h3 style="margin-top:12px">Secret missions</h3><div class="kv">
      <label>Meligy's man (R2)</label><select data-mis="${T}:meligy">${opt("", "—", (S.missions?.[T] || {}).meligy)}${mem.filter(([id]) => id !== coachOf(T, 2)).map(([id, p]) => opt(id, p.name, (S.missions?.[T] || {}).meligy)).join("")}</select>
      <label>Raya tester (R4)</label><select data-mis="${T}:raya">${opt("", "— (admin plays it)", (S.missions?.[T] || {}).raya)}${anyone.map(([id, p]) => opt(id, `${p.name} (${roleLabel(p.team)})`, (S.missions?.[T] || {}).raya)).join("")}</select></div>
     ${(S.missions?.[T] || {}).meligy && (S.missions[T].meligy === coachOf(T, 2)) ? `<p class="warn">Meligy's man is also the Room 2 coach.</p>` : ""}
     <h3 style="margin-top:12px">Lifelines: ${llUsed(T)} / 3 used · Bites: ${ts.bites || 0}</h3>
     <div class="row"><button class="btn sm" data-llreset="${T}">Reset lifelines</button><button class="btn sm" data-bitesadj="${T}:1">+1 bite</button><button class="btn sm" data-bitesadj="${T}:-1">−1 bite</button></div></div>`;
  };
  const tgtOpts = [["team:A", "Whole Team A"], ["team:B", "Whole Team B"], ["coach:A", "Team A's current coach"], ["coach:B", "Team B's current coach"]].concat(parts.map(([id, p]) => [`person:${id}`, `Person: ${p.name} (${roleLabel(p.team)}${p.persona ? ", " + C.personas[p.persona].en : ""})`]));
  const libItem = (s, i, kind) => `<div class="it"><div><b>${s.room ? `R${s.room} · ` : ""}${esc(s.en)}</b><div class="ar">${esc(s.ar)}</div></div><button class="btn sm red" data-send="${kind}:${i}">Send</button></div>`;
  const log = Object.values(S.lifelineLog || {}).sort((a, b) => b.at - a.at);
  return `${DB.live ? "" : `<div class="demo">DEMO MODE — paste the Firebase config into config.js to go live</div>`}
  <div class="top"><span class="conn ${online ? "on" : ""}"></span><span class="brand">Game Master · YEP Escape Room</span>${alerts.length ? `<span class="tag" style="background:#ff3b30;color:#fff">🔔 ${alerts.length}</span>` : ""}</div>
  <main>
  ${alerts.map(([k, a]) => `<div class="alert">📣 Team ${a.team} needs you (Room ${a.room || "-"}, ${esc((P(a.by) || {}).name || "")}, ${new Date(a.at).toLocaleTimeString()}) <button class="btn sm" data-ack="${k}">Done</button></div>`).join("")}
  <div class="paper"><h2>Participants (${parts.length}) ${unassigned.length ? `<span class="tag">${unassigned.length} waiting</span>` : ""}</h2>
   <p class="muted">Changes save instantly and appear live on phones. Join link: <b>${esc(location.href.replace(/#.*$/, ""))}</b></p>
   <div class="scroll"><table class="t"><tr><th>Name</th><th>Lang</th><th>Assign</th><th>Persona</th><th></th></tr>
   ${parts.map(([id, p]) => `<tr style="${p.team ? "" : "background:#fff3c4"}"><td><b>${esc(p.name)}</b></td><td>${p.lang || ""}</td><td>${teamPicker(id, p)}</td><td>${personaPicker(id, p)}</td><td><button class="btn sm ghost" data-del="${id}" title="Remove">✕</button></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nobody has joined yet.</td></tr>`}</table></div></div>
  <div class="grid2">${TEAMS.map(teamPanel).join("")}</div>
  <div class="paper"><h2>Surprises</h2><label for="tgt"><b>Send to</b></label><select id="tgt">${tgtOpts.map(([v, l]) => opt(v, l, sel)).join("")}</select>
   <details id="d_team" open><summary>Team events</summary><div class="lib">${C.surprises.team.map((s, i) => libItem(s, i, "team")).join("")}</div></details>
   <details id="d_coach"><summary>Coach only</summary><div class="lib">${C.surprises.coach.map((s, i) => libItem(s, i, "coach")).join("")}</div></details>
   <details id="d_nudge"><summary>Persona nudges (pick the person above)</summary><div class="lib">${C.surprises.nudge.map((s, i) => s ? libItem({ en: C.personas[i].en + ": " + s.en, ar: s.ar }, i, "nudge") : "").join("")}</div></details>
   <details id="d_custom"><summary>Custom surprise</summary><label for="cen">English</label><textarea id="cen">${esc(val("cen"))}</textarea><label for="car">Arabic</label><textarea id="car" dir="rtl">${esc(val("car"))}</textarea><button class="btn red" data-send="custom:0" style="margin-top:8px">Send custom</button></details>
   <p id="sentmsg" class="muted"></p></div>
  <div class="paper"><h2>Room checklists</h2>${ROOMS.map(r => `<details id="d_ck${r}"><summary>Room ${r} · ${esc(C.rooms[r].boss.en)}</summary><ol>${C.rooms[r].checklist.map(x => `<li>${esc(x)}</li>`).join("")}</ol><p class="muted">Hint: ${esc(C.rooms[r].hint.en)}</p></details>`).join("")}</div>
  <div class="paper"><h2>Lifeline log (${log.length})</h2><div class="scroll"><table class="t"><tr><th>Time</th><th>Team</th><th>Type</th><th>Room</th><th>By</th></tr>${log.map(l => `<tr><td>${new Date(l.at).toLocaleTimeString()}</td><td>${l.team}</td><td>${l.type}</td><td>${l.room}</td><td>${esc((P(l.by) || {}).name || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">None</td></tr>`}</table></div></div>
  <div class="paper dark"><h2>Game</h2><div class="row">
   <button class="btn" id="reveal">${S.game && S.game.reveal ? "Hide Debrief" : "🎭 REVEAL"}</button>
   <button class="btn ghost" id="regen" style="color:var(--cream);border-color:var(--cream)">New random passwords</button>
   <button class="btn ghost" id="reset" style="color:var(--cream);border-color:var(--cream)">Reset game (keep people)</button>
   <button class="btn ghost" id="wipe" style="color:var(--cream);border-color:var(--cream)">Delete everyone</button></div></div>
  </main>`;
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function rotation(ids) { const o = {}; ROOMS.forEach((r, i) => { o[r] = ids.length ? ids[i % ids.length] : null; }); return o; }
function suggestRandom(T) {
  const ids = membersOf(T).map(([id]) => id); if (!ids.length) return;
  const up = {}, pers = shuffle([1, 2, 3, 4, 5, 6]);
  shuffle(ids).forEach((id, i) => { up[`participants/${id}/persona`] = pers[i % 6]; });
  const rot = rotation(shuffle(ids)); ROOMS.forEach(r => { up[`coach/${T}/${r}`] = rot[r]; });
  const mel = ids.filter(id => id !== rot[2]); up[`missions/${T}/meligy`] = mel.length ? shuffle(mel)[0] : null;
  const others = Object.entries(S.participants || {}).filter(([, p]) => p.team && p.team !== T).map(([id, p]) => [id, p.team]);
  const pref = others.filter(o => o[1] === "VIL" || o[1] === "OBS"); const pool = pref.length ? pref : others;
  up[`missions/${T}/raya`] = pool.length ? shuffle(pool)[0][0] : null;
  DB.update("/", up);
}
function sendSurprise(kind, i) {
  const [tt, tv] = ($("#tgt").value || "team:A").split(":");
  let s;
  if (kind === "team") s = C.surprises.team[i]; else if (kind === "coach") s = C.surprises.coach[i]; else if (kind === "nudge") s = C.surprises.nudge[i];
  else { const en = $("#cen").value.trim(), ar = $("#car").value.trim(); if (!en && !ar) return; s = { en, ar }; delete drafts.cen; delete drafts.car; }
  const rec = { targetType: tt, en: s.en || "", ar: s.ar || "", sentAt: DB.now() };
  if (tt === "team") { rec.team = tv; rec.room = TS(tv).currentRoom || 0; }
  else if (tt === "coach") { rec.team = tv; rec.room = TS(tv).currentRoom || 0; rec.targetId = coachOf(tv, rec.room); if (!rec.targetId) { $("#sentmsg").textContent = "No coach set for that team's current room."; return; } }
  else { rec.targetId = tv; const tm = teamOf(tv); rec.team = tm; rec.room = TEAMS.includes(tm) ? (TS(tm).currentRoom || 0) : 0; }
  DB.push("surprises", rec).then(() => { const n = $("#sentmsg"); if (n) n.textContent = "Sent ✓ " + new Date().toLocaleTimeString(); if (kind === "custom") render(); });
}

// ---------- render ----------
function render() {
  document.documentElement.lang = lang; document.documentElement.dir = (isAdmin ? "ltr" : (lang === "ar" ? "rtl" : "ltr"));
  document.body.classList.toggle("adm", isAdmin);
  const openD = [...document.querySelectorAll("details[id]")].map(d => [d.id, d.open]);
  withFocus(() => { app.innerHTML = !loaded ? `<div class="center"><div class="spinner"></div></div>` : isAdmin ? (adminOk ? adminView() : adminLogin()) : participantView(); openD.forEach(([id, o]) => { const d = document.getElementById(id); if (d) d.open = o; }); });
}

// ---------- events ----------
app.addEventListener("input", e => { if (e.target.id && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) drafts[e.target.id] = e.target.value; });
app.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (e.target.id === "jn") $("#jb").click();
  if (e.target.id === "pin") $("#pinb").click();
  if (e.target.id && e.target.id.startsWith("pw") && !e.target.id.startsWith("pwd")) tryPassword(+e.target.id.slice(2));
});
app.addEventListener("change", e => {
  const d = e.target.dataset;
  if (d.tp) { const v = e.target.value; const up = { team: v || null }; if (!TEAMS.includes(v)) up.persona = null; DB.update("participants/" + d.tp, up); }
  else if (d.pp) DB.update("participants/" + d.pp, { persona: e.target.value ? +e.target.value : null });
  else if (d.coach) { const [T, r] = d.coach.split(":"); DB.set(`coach/${T}/${r}`, e.target.value || null); }
  else if (d.mis) { const [T, k] = d.mis.split(":"); DB.set(`missions/${T}/${k}`, e.target.value || null); }
  else if (d.pwd) { const [T, r] = d.pwd.split(":"); delete drafts[e.target.id]; DB.set(`passwords/${T}/${r}`, e.target.value.trim()); }
  else if (d.brd) { let v = e.target.value.trim(); if (v && !/^https?:\/\//i.test(v)) v = "https://" + v; delete drafts[e.target.id]; DB.set("boards/" + d.brd, v || null); }
  else if (e.target.id === "tgt") ls.set("yep_tgt", e.target.value);
});
app.addEventListener("click", async e => {
  const b = e.target.closest("button, [data-go], [data-flip]"); if (!b) return;
  const d = b.dataset;
  if (b.id === "lng") return setLang(lang === "ar" ? "en" : "ar");
  if (d.l && !me) return setLang(d.l);
  if (b.id === "jb") {
    const name = ($("#jn").value || "").trim(); if (!name) { $("#jn").focus(); return; }
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await DB.set("participants/" + id, { name, lang, team: null, joinedAt: DB.now() });
    me = id; ls.set(PIDK, id); ls.set("yep_seen_" + id, String(DB.now())); delete drafts.jn; render(); return;
  }
  if (d.tab) { tab = d.tab; if (tab === "room") roomView = 0; window.scrollTo(0, 0); return render(); }
  if (d.go) { roomView = +d.go; tab = "room"; window.scrollTo(0, 0); return render(); }
  if (d.flip !== undefined) { b.classList.toggle("on"); return; }
  if (d.pw) return tryPassword(+d.pw);
  if (d.ll) {
    const type = d.ll, r = +d.r;
    return confirmBox(U("confirmLL"), () => useLifeline(type, r));
  }
  if (d.bite) { DB.txn(`teams/${d.bite}/bites`, c => (c || 0) + 1); return; }
  // admin
  if (b.id === "pinb") { if ($("#pin").value === String(window.ADMIN_PIN)) { adminOk = true; sessionStorage.setItem("yep_admin", "1"); ensurePasswords(); render(); } else $("#pinerr").textContent = "Wrong PIN"; return; }
  if (!isAdmin || !adminOk) return;
  if (d.del) return confirmBox(`Remove ${esc((P(d.del) || {}).name)}?`, () => DB.remove("participants/" + d.del));
  if (d.start) return openRoom(d.start, 1);
  if (d.esc) { const T = d.esc; const tm = TS(T).timer; return DB.update(`teams/${T}`, { status: "escaped", timer: tm ? { paused: true, left: timerLeft(T) || 0, end: 0 } : null }); }
  if (d.unl) { const [T, r] = d.unl.split(":"); return openRoom(T, +r); }
  if (d.rnd) return confirmBox(`Fill Team ${d.rnd}'s personas, coach rotation and missions randomly? You can edit after.`, () => suggestRandom(d.rnd));
  if (d.autorot) { const T = d.autorot; const rot = rotation(membersOf(T).map(([id]) => id)); const up = {}; ROOMS.forEach(r => up[`coach/${T}/${r}`] = rot[r]); return DB.update("/", up); }
  if (d.tpause) { const T = d.tpause, tm = TS(T).timer; if (!tm) return; return DB.set(`teams/${T}/timer`, tm.paused ? { paused: false, left: 0, end: DB.now() + (tm.left || 0) } : { paused: true, left: timerLeft(T), end: 0 }); }
  if (d.tadd) { const [T, m] = d.tadd.split(":"), tm = TS(T).timer, ms = +m * 60000; if (!tm) return; return DB.set(`teams/${T}/timer`, tm.paused ? { ...tm, left: Math.max(0, (tm.left || 0) + ms) } : { ...tm, end: tm.end + ms }); }
  if (d.llreset) return confirmBox(`Reset Team ${d.llreset}'s lifelines to 3?`, () => DB.update(`teams/${d.llreset}`, { llUsed: 0, opened: null }));
  if (d.bitesadj) { const [T, n] = d.bitesadj.split(":"); return DB.txn(`teams/${T}/bites`, c => Math.max(0, (c || 0) + +n)); }
  if (d.ack) return DB.update("alerts/" + d.ack, { done: true });
  if (d.send) { const [k, i] = d.send.split(":"); return sendSurprise(k, +i); }
  if (b.id === "reveal") return DB.set("game/reveal", !(S.game && S.game.reveal));
  if (b.id === "regen") return confirmBox("Generate new random passwords for both teams?", () => { const up = {}; TEAMS.forEach(T => ROOMS.forEach(r => { if (r > 1) up[`${T}/${r}`] = genCode(); })); DB.update("passwords", up); });
  if (b.id === "reset") return confirmBox("Reset the game? This clears room progress, timers, lifelines, bites, surprises, alerts and the Reveal. People, teams, personas, coaches, missions, passwords and board links stay.", () => DB.update("/", { teams: null, lifelineLog: null, surprises: null, alerts: null, game: null }));
  if (b.id === "wipe") return confirmBox("Delete ALL participants and all game data? Use this after testing.", () => DB.update("/", { participants: null, coach: null, missions: null, teams: null, lifelineLog: null, surprises: null, alerts: null, game: null }));
});
window.addEventListener("hashchange", () => { isAdmin = location.hash === "#admin"; render(); });

// ---------- boot ----------
let alertSeen = null;
DB.initSkew();
DB.onConn(c => { online = c; const el = document.querySelector(".conn"); if (el) el.classList.toggle("on", c); });
DB.onRoot(data => {
  S = data || {}; loaded = true;
  if (me && !P(me) && S.participants === undefined) { /* empty db */ }
  const rv = !!(S.game && S.game.reveal);
  if (lastReveal !== null && rv && !lastReveal && !isAdmin) { tab = "debrief"; window.scrollTo(0, 0); }
  lastReveal = rv;
  if (isAdmin && adminOk) {
    const ids = Object.entries(S.alerts || {}).filter(([, a]) => !a.done).map(([k]) => k);
    if (alertSeen && ids.some(k => !alertSeen.includes(k))) beep("alert");
    alertSeen = ids;
  }
  if (me && P(me) && P(me).lang && P(me).lang !== lang && !ls.get("yep_lang", "")) lang = P(me).lang;
  render(); checkSurprises();
});
if (isAdmin && adminOk) setTimeout(ensurePasswords, 1500);
}
