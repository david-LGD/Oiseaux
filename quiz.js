"use strict";
/* Mode quiz : 3 photos, 1 chant, trouver l'oiseau. Sons générés par l'appli (aucun fichier). */

const QUIZ_KEY = "oiseaux-quiz-v1";
const AMB_KEY = "oiseaux-ambiance-off";
const QUIZ_LEN = 10;
const NEXT_MS = 1000;          // passage au groupe suivant

/* ---------- Progression ---------- */
function loadQuiz() { try { return JSON.parse(localStorage.getItem(QUIZ_KEY)) || { sessions: [], birds: {} }; } catch { return { sessions: [], birds: {} }; } }
function saveQuiz(q) { try { localStorage.setItem(QUIZ_KEY, JSON.stringify(q)); } catch {} }
let progress = loadQuiz();

/* ---------- Sons (Web Audio) ---------- */
const Sfx = {
  ctx: null, amb: null, off: localStorage.getItem(AMB_KEY) === "1",
  init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
  },
  tone(freq, at, dur, type = "sine", vol = 0.22, toFreq) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  },
  chime() { this.tone(659, 0, 0.6, "sine", 0.18); this.tone(988, 0.12, 0.8, "sine", 0.14); },             // groupe suivant
  good() { this.tone(784, 0, 0.25, "triangle", 0.2); this.tone(1175, 0.1, 0.4, "triangle", 0.18); },
  bad() { this.tone(240, 0, 0.45, "triangle", 0.22, 150); },
  end() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.16, i === 3 ? 1.6 : 0.5, "sine", 0.2));
          this.tone(1568, 0.64, 1.6, "sine", 0.06); },                                                    // fin du quiz
  // ambiance : votre fichier ambiance.mp3 déposé sur GitHub (joué en boucle)
  async startAmbience() {
    if (this.off || this.amb || !isLocal("_ambiance", "file")) return;
    const r = await (await caches.open(MEDIA_CACHE)).match(localKey("_ambiance", "file"));
    if (!r || this.amb) return;
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url); a.loop = true; a.volume = 0;
    this.amb = { a, url };
    try { await a.play(); } catch { return; }
    for (let k = 1; k <= 20 && this.amb && this.amb.a === a; k++) { a.volume = 0.35 * k / 20; await sleep(100); }
  },
  async stopAmbience(fade = 1) {
    if (!this.amb) return;
    const { a, url } = this.amb; this.amb = null;
    const v0 = a.volume, steps = Math.max(1, Math.round(fade * 10));
    for (let k = 1; k <= steps; k++) { a.volume = Math.max(0, v0 * (1 - k / steps)); await sleep(100); }
    a.pause(); URL.revokeObjectURL(url);
  },
};

/* ---------- Lecture d'un chant ---------- */
async function playSong(id, ms) {
  const r = await (await caches.open(MEDIA_CACHE)).match(mediaKey(id, "audio"));
  if (!r) return null;
  const url = URL.createObjectURL(await r.blob());
  const audio = new Audio(url); audio.loop = true;
  await new Promise((res) => { audio.onloadedmetadata = res; audio.onerror = res; setTimeout(res, 2500); });
  if (isFinite(audio.duration) && audio.duration > 15) audio.currentTime = 1;
  let stopped = false;
  const ctrl = {
    async stop(fade = 500) {
      if (stopped) return; stopped = true; clearTimeout(timer);
      const v0 = audio.volume, steps = Math.max(1, Math.round(fade / 50));
      for (let k = 1; k <= steps; k++) { audio.volume = Math.max(0, v0 * (1 - k / steps)); await sleep(50); }
      audio.pause(); URL.revokeObjectURL(url);
    },
  };
  const timer = setTimeout(() => ctrl.stop(600), ms);
  try { await audio.play(); } catch { ctrl.stop(0); return null; }
  return ctrl;
}

/* ---------- Tirage des questions ---------- */
function weightOf(id) { const s = progress.birds[id] || { ok: 0, ko: 0 }; return Math.max(0.5, 1 + 2 * s.ko - 0.5 * s.ok); }
function weightedPick(list, n) {
  const pool = list.slice(), out = [];
  while (out.length < n && pool.length) {
    const tot = pool.reduce((a, b) => a + weightOf(b.id), 0);
    let r = Math.random() * tot, i = 0;
    while ((r -= weightOf(pool[i].id)) > 0 && i < pool.length - 1) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/* ---------- Déroulement ---------- */
let qs = null;
const Q = (id) => document.getElementById(id);

async function startQuiz() {
  await syncLocal();
  await ensurePhotos();
  const withPhoto = activeBirds().filter((b) => photoUrls[b.id] || paysageUrls[b.id]);
  const targets = withPhoto.filter((b) => hasSong(b.id));
  if (targets.length < 3) { alert("Il faut au moins 3 oiseaux avec leur chant pour jouer."); return; }
  const chosen = weightedPick(targets, Math.min(QUIZ_LEN, targets.length));
  qs = {
    i: 0, score: 0, missed: [], token: 0, song: null,
    questions: chosen.map((t) => ({ target: t, options: shuffle([t, ...shuffle(withPhoto.filter((b) => b.id !== t.id)).slice(0, 2)]) })),
  };
  clearTimeout(autoTimer);
  Sfx.init();
  Q("btn-amb").textContent = Sfx.off ? "🔇" : "🔊";
  Q("btn-amb").style.visibility = isLocal("_ambiance", "file") ? "visible" : "hidden";
  Sfx.startAmbience();
  show("quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = qs.questions[qs.i], token = ++qs.token;
  qs.answered = false;
  Q("quiz-count").textContent = `Question ${qs.i + 1} / ${qs.questions.length}`;
  Q("quiz-score").textContent = `${qs.score} ✓`;
  Q("quiz-feedback").textContent = "Écoutez… quel oiseau chante ?";
  Q("quiz-feedback").className = "";
  const tiles = Q("quiz-tiles");
  tiles.innerHTML = ""; tiles.classList.remove("enter"); void tiles.offsetWidth; tiles.classList.add("enter");
  q.options.forEach((b) => {
    const t = document.createElement("button");
    t.className = "tile"; t.dataset.id = b.id;
    if (paysageUrls[b.id]) {            // votre recadrage paysage : plein cadre
      t.innerHTML = `<img class="cover" alt="" draggable="false"><span class="badge"></span><span class="tname">${b.fr}</span>`;
      t.querySelector("img").src = paysageUrls[b.id];
    } else {                            // photo d'origine : entière, sur fond flou
      t.innerHTML = `<img class="bg" alt="" draggable="false"><img class="fg" alt="" draggable="false"><span class="badge"></span><span class="tname">${b.fr}</span>`;
      t.querySelectorAll("img").forEach((im) => (im.src = photoUrls[b.id]));
    }
    t.onclick = () => answer(b.id);
    tiles.appendChild(t);
  });
  setTimeout(() => { if (qs && qs.token === token) listen(); }, 700);
}

async function listen() {
  if (!qs || qs.answered) return;
  const token = qs.token, bar = Q("quiz-bar");
  if (qs.song) { qs.song.stop(150); qs.song = null; }
  bar.style.transition = "none"; bar.style.width = "0";
  const song = await playSong(qs.questions[qs.i].target.id, SONG_MS);
  if (!qs || qs.token !== token || qs.answered) { if (song) song.stop(0); return; }
  qs.song = song;
  if (!song) { Q("quiz-feedback").textContent = "Lecture impossible, touchez « Réécouter »."; return; }
  requestAnimationFrame(() => { bar.style.transition = `width ${SONG_MS}ms linear`; bar.style.width = "100%"; });
}

function answer(id) {
  if (!qs || qs.answered) return;
  qs.answered = true;
  const q = qs.questions[qs.i], ok = id === q.target.id;
  if (qs.song) { qs.song.stop(400); qs.song = null; }
  const bar = Q("quiz-bar"); bar.style.transition = "none"; bar.style.width = "0";
  document.querySelectorAll("#quiz-tiles .tile").forEach((t) => {
    t.classList.add("revealed");
    if (t.dataset.id === q.target.id) { t.classList.add("good"); t.querySelector(".badge").textContent = ok ? "✓" : "✓ bonne réponse"; }
    else if (t.dataset.id === id) { t.classList.add("bad"); t.querySelector(".badge").textContent = "✗ votre choix"; }
    else t.classList.add("dim");
  });
  const s = progress.birds[q.target.id] = progress.birds[q.target.id] || { ok: 0, ko: 0 };
  if (ok) { qs.score++; s.ok++; Sfx.good(); } else { s.ko++; qs.missed.push(q.target); Sfx.bad(); }
  saveQuiz(progress);
  Q("quiz-score").textContent = `${qs.score} ✓`;
  const fb = Q("quiz-feedback");
  fb.textContent = ok ? `Bravo ! ${q.target.fr}.` : `Raté… la réponse : ${q.target.fr}.`;
  fb.className = ok ? "ok" : "ko";
  const token = qs.token;
  setTimeout(() => {
    if (!qs || qs.token !== token) return;
    qs.i++;
    if (qs.i < qs.questions.length) { Sfx.chime(); renderQuestion(); }
    else finishQuiz();
  }, NEXT_MS);
}

function finishQuiz() {
  const total = qs.questions.length, score = qs.score;
  Sfx.stopAmbience(1.2);
  setTimeout(() => Sfx.end(), 300);
  const prevBest = progress.sessions.reduce((m, s) => Math.max(m, Math.round((s.score / s.total) * 100)), -1);
  progress.sessions.push({ date: new Date().toISOString(), score, total });
  if (progress.sessions.length > 200) progress.sessions = progress.sessions.slice(-200);
  saveQuiz(progress);

  const pct = Math.round((score / total) * 100);
  Q("end-score").textContent = `${score} / ${total}`;
  Q("end-msg").textContent = pct === 100 ? "Sans faute ! Une oreille d'ornithologue."
    : pct >= 70 ? "Très belle oreille !" : pct >= 40 ? "Pas mal, ça progresse !" : "Les chants s'apprennent en jouant : on recommence ?";
  Q("end-best").textContent = prevBest < 0 ? "Première partie enregistrée."
    : pct > prevBest ? `Nouveau record ! (avant : ${prevBest} %)` : `Meilleur résultat : ${prevBest} %`;
  // graphique des dernières parties
  const last = progress.sessions.slice(-12);
  Q("end-chart").innerHTML = last.map((s, k) => {
    const p = Math.round((s.score / s.total) * 100), d = new Date(s.date);
    return `<div class="col${k === last.length - 1 ? " now" : ""}"><span class="v">${s.score}</span><div class="b" style="height:${Math.max(4, p)}%"></div>
      <span class="d">${d.getDate()}/${d.getMonth() + 1}</span></div>`;
  }).join("");
  Q("end-total").textContent = `${progress.sessions.length} partie${progress.sessions.length > 1 ? "s" : ""} jouée${progress.sessions.length > 1 ? "s" : ""} au total`;
  const uniq = [...new Map(qs.missed.map((b) => [b.id, b])).values()];
  Q("end-missed").innerHTML = uniq.length
    ? `<h3>À revoir</h3><div class="missed">${uniq.map((b) => `<div class="mb"><img src="${paysageUrls[b.id] || photoUrls[b.id]}" alt=""><span>${b.fr}</span></div>`).join("")}</div>
       <p class="small">Ces oiseaux reviendront plus souvent dans les prochaines parties.</p>`
    : "";
  qs = null;
  show("quiz-end");
}

function quitQuiz() {
  if (qs) { qs.token++; if (qs.song) qs.song.stop(200); }
  qs = null;
  Sfx.stopAmbience(0.6);
  refreshHome();
}

/* ---------- Boutons ---------- */
Q("btn-quiz").onclick = startQuiz;
Q("btn-menu-quiz").onclick = () => { Q("menu").hidden = true; menuOpen = false; startQuiz(); };
Q("btn-replay").onclick = () => { if (qs && !qs.answered) listen(); };
Q("btn-quiz-quit").onclick = quitQuiz;
Q("btn-amb").onclick = () => {
  Sfx.off = !Sfx.off; localStorage.setItem(AMB_KEY, Sfx.off ? "1" : "0");
  Q("btn-amb").textContent = Sfx.off ? "🔇" : "🔊";
  Q("btn-amb").style.visibility = isLocal("_ambiance", "file") ? "visible" : "hidden";
  if (Sfx.off) Sfx.stopAmbience(0.5); else { Sfx.init(); Sfx.startAmbience(); }
};
Q("btn-again").onclick = startQuiz;
Q("btn-end-home").onclick = refreshHome;
document.addEventListener("visibilitychange", () => {
  if (!Sfx.ctx) return;
  if (document.visibilityState === "hidden") Sfx.ctx.suspend(); else Sfx.ctx.resume();
});
