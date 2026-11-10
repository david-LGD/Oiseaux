"use strict";
/* Jeu et progression : quiz (3 photos, 1 chant), séries, médailles, confettis, carnet d'ornithologue.
   S'appuie sur app.js (données, sons, progression). */

const QUIZ_LEN = 10;
const SOLUTION_MS = 5000;      // solution visible + chant, puis groupe suivant (ou toucher)
const STREAKS = [3, 5];        // séries saluées pendant une partie
const MEDALS = {
  or: { color: "#e9b949", label: "Médaille d'or" },
  argent: { color: "#cfd6dc", label: "Médaille d'argent" },
  bronze: { color: "#cd8a4b", label: "Médaille de bronze" },
};
function medalOf(score, total) {
  const r = total ? score / total : 0;
  return r >= 0.9 ? "or" : r >= 0.7 ? "argent" : r >= 0.5 ? "bronze" : null;
}
function medalSvg(kind) {
  return `<svg class="medal" viewBox="0 0 72 88" role="img" aria-label="${MEDALS[kind].label}">
    <defs><clipPath id="medal-clip"><circle cx="36" cy="56" r="26"/></clipPath></defs>
    <path d="M20 2h13l9 30H29z" fill="#2f6b45"/><path d="M52 2H39l-9 30h13z" fill="#3d8a59"/>
    <circle cx="36" cy="56" r="28.5" fill="#00000040"/>
    <circle cx="36" cy="56" r="26" fill="${MEDALS[kind].color}"/>
    <circle cx="36" cy="56" r="20.5" fill="none" stroke="#00000029" stroke-width="2"/>
    <polygon points="36.0,43.5 39.3,51.5 47.9,52.1 41.3,57.7 43.3,66.1 36.0,61.6 28.7,66.1 30.7,57.7 24.1,52.1 32.7,51.5" fill="#ffffff8c"/>
    <g clip-path="url(#medal-clip)"><g transform="rotate(22 36 56)"><rect class="shine" x="-34" y="18" width="13" height="76" fill="#ffffff" opacity=".42"/></g></g>
  </svg>`;
}

/* ---------- Tirage des questions : les oiseaux ratés reviennent plus souvent ---------- */
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

/* ---------- Déroulement du quiz ---------- */
let qs = null;

/* Catégories (collection Bretagne) */
const CATS = {
  all: { label: "Tous les oiseaux", test: () => true },
  terre: { label: "Oiseaux de terre", test: (b) => b.milieu === "terre" },
  mer: { label: "Oiseaux marins", test: (b) => b.milieu === "mer" },
  migr: { label: "Migrateurs", test: (b) => b.migr },
  sed: { label: "Sédentaires", test: (b) => b.milieu && !b.migr },
};
let lastCat = "all";

function startQuiz() {
  Sfx.init();                                   // ce toucher autorise le son
  if (COL !== "bretagne") return runQuiz("all");
  $("quiz-cat").hidden = false;                 // Bretagne : choix de la catégorie
}

function setAmbBtn() {
  $("btn-amb").innerHTML = ic(Sfx.off ? "mute" : "volume");
  $("btn-amb").style.visibility = isLocal("_ambiance", "file") ? "visible" : "hidden";
}
function scoreHtml() {
  return `${qs.score}${ic("check")}` + (qs.streak >= 2 ? `<span class="sep">·</span>${ic("flame")}${qs.streak}` : "");
}

async function runQuiz(cat) {
  Sfx.init();
  $("quiz-cat").hidden = true; lastCat = cat;
  await syncLocal();
  await ensurePhotos();
  const withPhoto = activeBirds().filter((b) => photoUrls[b.id] || paysageUrls[b.id]);
  const inCat = withPhoto.filter(CATS[cat].test);
  const targets = inCat.filter((b) => hasSong(b.id));
  if (targets.length < 3) { alert("Il faut au moins 3 oiseaux avec leur chant dans cette catégorie."); return; }
  const chosen = weightedPick(targets, Math.min(QUIZ_LEN, targets.length));
  const pool = inCat.length >= 3 ? inCat : withPhoto;   // les 3 photos viennent de la même catégorie
  qs = {
    i: 0, score: 0, streak: 0, missed: [], newMasters: [], token: 0, listenId: 0, song: null, cat,
    questions: chosen.map((t) => ({ target: t, options: shuffle([t, ...shuffle(pool.filter((b) => b.id !== t.id)).slice(0, 2)]) })),
  };
  clearTimeout(autoTimer);
  setAmbBtn();
  $("quiz-visu").hidden = !visuOn();
  $("streak-toast").hidden = true;
  Sfx.startAmbience();
  show("quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = qs.questions[qs.i], token = ++qs.token;
  qs.answered = false;
  $("quiz-count").textContent = `Question ${qs.i + 1} / ${qs.questions.length}`;
  $("quiz-score").innerHTML = scoreHtml();
  $("quiz-feedback").textContent = "Écoutez… quel oiseau chante ?";
  $("quiz-feedback").className = "";
  const tiles = $("quiz-tiles");
  tiles.innerHTML = ""; tiles.classList.remove("enter"); void tiles.offsetWidth; tiles.classList.add("enter");
  q.options.forEach((b) => {
    const t = document.createElement("button");
    t.className = "tile"; t.dataset.id = b.id;
    if (paysageUrls[b.id]) {            // votre recadrage paysage : plein cadre
      t.innerHTML = `<img class="cover" alt="" draggable="false"><span class="badge"></span><span class="tname">${esc(b.fr)}</span>`;
      t.querySelector("img").src = paysageUrls[b.id];
    } else {                            // photo d'origine : entière, sur fond flou
      t.innerHTML = `<img class="bg" alt="" draggable="false"><img class="fg" alt="" draggable="false"><span class="badge"></span><span class="tname">${esc(b.fr)}</span>`;
      t.querySelectorAll("img").forEach((im) => (im.src = photoUrls[b.id]));
    }
    t.onclick = () => answer(b.id);
    tiles.appendChild(t);
  });
  setTimeout(() => { if (qs && qs.token === token) listen(); }, 700);
}

async function listen() {
  if (!qs || qs.answered) return;
  const token = qs.token, lid = ++qs.listenId, bar = $("quiz-bar");
  if (qs.song) { qs.song.stop(150); qs.song = null; }
  bar.style.transition = "none"; bar.style.width = "0";
  const song = await playSong(qs.questions[qs.i].target.id, SONG_MS);
  if (!qs || qs.token !== token || qs.listenId !== lid || qs.answered) { if (song) song.stop(0); return; }
  qs.song = song;
  if (!song) { $("quiz-feedback").textContent = "Lecture impossible, touchez « Réécouter »."; return; }
  Visu.start($("quiz-visu"), song);
  requestAnimationFrame(() => { bar.style.transition = `width ${SONG_MS}ms linear`; bar.style.width = "100%"; });
}

function streakToast(n) {
  const t = $("streak-toast");
  t.innerHTML = `${ic("flame")} ${n} d'affilée !`;
  t.hidden = true; void t.offsetWidth; t.hidden = false;      // relance l'animation
  clearTimeout(streakToast.timer);
  streakToast.timer = setTimeout(() => (t.hidden = true), 1700);
}

function answer(id) {
  if (!qs || qs.answered) return;
  qs.answered = true; qs.listenId++;
  const q = qs.questions[qs.i], ok = id === q.target.id, token = qs.token;
  document.querySelectorAll("#quiz-tiles .tile").forEach((t) => {
    t.classList.add("revealed");
    if (t.dataset.id === q.target.id) { t.classList.add("good"); t.querySelector(".badge").innerHTML = ok ? ic("check") : `${ic("check")} bonne réponse`; }
    else if (t.dataset.id === id) { t.classList.add("bad"); t.querySelector(".badge").innerHTML = `${ic("close")} votre choix`; }
    else t.classList.add("dim");
  });
  // progression : score, série dans la partie, série par oiseau (3 de suite = maîtrisé)
  const s = progress.birds[q.target.id] = progress.birds[q.target.id] || { ok: 0, ko: 0, streak: 0 };
  const wasMaster = (s.streak || 0) >= MASTER_N;
  if (ok) {
    qs.score++; qs.streak++; s.ok++; s.streak = (s.streak || 0) + 1;
    if (!wasMaster && s.streak >= MASTER_N) qs.newMasters.push(q.target);
    Sfx.good();
    if (STREAKS.includes(qs.streak)) { Sfx.streak(qs.streak); streakToast(qs.streak); }
    if (navigator.vibrate) navigator.vibrate(12);
  } else {
    qs.streak = 0; s.ko++; s.streak = 0; qs.missed.push(q.target);
    Sfx.bad();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  }
  saveQuiz(progress);
  $("quiz-score").innerHTML = scoreHtml();
  const fb = $("quiz-feedback");
  fb.innerHTML = esc(ok ? `Bravo ! ${q.target.fr}.` : `Raté… la réponse : ${q.target.fr}.`) + `<br><small>Touchez l'écran pour continuer</small>`;
  fb.className = ok ? "ok" : "ko";

  // la solution reste visible 5 s avec le chant de l'oiseau
  const bar = $("quiz-bar");
  bar.style.transition = "none"; bar.style.width = "0";
  requestAnimationFrame(() => { bar.style.transition = `width ${SOLUTION_MS}ms linear`; bar.style.width = "100%"; });
  if (!(qs.song && qs.song.active)) {
    playSong(q.target.id, SOLUTION_MS).then((sg) => {
      if (qs && qs.token === token && qs.answered) { qs.song = sg; if (sg) Visu.start($("quiz-visu"), sg); }
      else if (sg) sg.stop(0);
    });
  }
  const timer = setTimeout(next, SOLUTION_MS);
  const quiz = $("quiz");
  function onTap(e) { if (e.target.closest("#btn-quiz-quit, #btn-amb")) return; next(); }
  function next() {
    clearTimeout(timer); quiz.removeEventListener("click", onTap);
    if (!qs || qs.token !== token) return;
    if (qs.song) { qs.song.stop(300); qs.song = null; }
    qs.i++;
    if (qs.i < qs.questions.length) { Sfx.chime(); renderQuestion(); }
    else finishQuiz();
  }
  // la solution reste au moins 1,5 s à l'écran (évite un double toucher accidentel), puis un toucher passe à la suite
  setTimeout(() => { if (qs && qs.token === token) quiz.addEventListener("click", onTap); }, 1500);
}

/* Confettis aux couleurs de l'appli */
function confetti(ms = 2800) {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.className = "confetti"; document.body.appendChild(c);
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d"); g.scale(dpr, dpr);
  const colors = ["#e9b949", "#f07832", "#8fd694", "#f3f1ea", "#3d8a59"];
  const parts = Array.from({ length: 120 }, (_, k) => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.45, y: H * 0.3 + (Math.random() - 0.5) * 30,
    vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 12 - 3,
    s: 6 + Math.random() * 7, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.45, c: colors[k % colors.length], rect: k % 3 !== 0,
  }));
  const t0 = performance.now();
  const frame = (t) => {
    const k = (t - t0) / ms;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.3; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, (1 - k) / 0.3));
      g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
      if (p.rect) g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      else { g.beginPath(); g.arc(0, 0, p.s / 2.6, 0, 6.2832); g.fill(); }
      g.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

const thumbOf = (b) => paysageUrls[b.id] || photoUrls[b.id] || portraitUrls[b.id] || "";

function finishQuiz() {
  const total = qs.questions.length, score = qs.score, ratio = score / total;
  Sfx.stopAmbience(1.2);
  Visu.stop();
  $("streak-toast").hidden = true;
  setTimeout(() => Sfx.end(), 300);
  const mine = (s) => (s.col || "monde") === COL && (s.cat || "all") === qs.cat;   // scores séparés par collection et catégorie
  const prevBest = progress.sessions.filter(mine).reduce((m, s) => Math.max(m, Math.round((s.score / s.total) * 100)), -1);
  progress.sessions.push({ date: new Date().toISOString(), score, total, col: COL, cat: qs.cat });
  if (progress.sessions.length > 200) progress.sessions = progress.sessions.slice(-200);
  saveQuiz(progress);

  // médaille et confettis
  const medal = medalOf(score, total);
  $("end-medal").innerHTML = medal
    ? `${medalSvg(medal)}<p class="medal-label" style="--medal:${MEDALS[medal].color}">${MEDALS[medal].label}</p>` : "";
  if (ratio >= 0.8) setTimeout(confetti, 450);

  const pct = Math.round(ratio * 100);
  $("end-score").textContent = `${score} / ${total}`;
  $("end-msg").textContent = pct === 100 ? "Sans faute ! Une oreille d'ornithologue."
    : pct >= 70 ? "Très belle oreille !" : pct >= 40 ? "Pas mal, ça progresse !" : "Les chants s'apprennent en jouant : on recommence ?";
  $("end-best").textContent = prevBest < 0 ? "Première partie enregistrée."
    : pct > prevBest ? `Nouveau record ! (avant : ${prevBest} %)` : `Meilleur résultat : ${prevBest} %`;
  $("end-cat").textContent = COLS[COL].title + (qs.cat !== "all" ? " · " + CATS[qs.cat].label : "");

  const thumbs = (list, cls) => `<div class="missed">${list.map((b) =>
    `<div class="mb${cls}"><img src="${thumbOf(b)}" alt=""><span>${esc(b.fr)}</span></div>`).join("")}</div>`;
  $("end-new").innerHTML = qs.newMasters.length
    ? `<h3>${ic("star")} ${qs.newMasters.length > 1 ? "Nouveaux oiseaux maîtrisés" : "Nouvel oiseau maîtrisé"}</h3>${thumbs(qs.newMasters, " new")}` : "";

  // graphique des dernières parties
  const hist = progress.sessions.filter(mine);
  const last = hist.slice(-12);
  $("end-chart").innerHTML = last.map((s, k) => {
    const p = Math.round((s.score / s.total) * 100), d = new Date(s.date);
    return `<div class="col${k === last.length - 1 ? " now" : ""}"><span class="v">${s.score}</span><div class="b" style="height:${Math.max(4, p)}%"></div>
      <span class="d">${d.getDate()}/${d.getMonth() + 1}</span></div>`;
  }).join("");
  $("end-total").textContent = `${hist.length} partie${hist.length > 1 ? "s" : ""} jouée${hist.length > 1 ? "s" : ""} dans cette série`;
  const uniq = [...new Map(qs.missed.map((b) => [b.id, b])).values()];
  $("end-missed").innerHTML = uniq.length
    ? `<h3>À revoir</h3>${thumbs(uniq, "")}<p class="small">Ces oiseaux reviendront plus souvent dans les prochaines parties.</p>` : "";
  qs = null;
  show("quiz-end");
  $("quiz-end").scrollTop = 0;
}

function quitQuiz() {
  if (qs) { qs.token++; if (qs.song) qs.song.stop(200); }
  qs = null;
  Visu.stop();
  $("streak-toast").hidden = true;
  Sfx.stopAmbience(0.6);
  refreshHome();
}

/* ---------- Carnet d'ornithologue ---------- */
async function openCarnet() {
  Sfx.init();
  await ensurePhotos();
  renderCarnet();
  show("carnet");
  $("carnet").scrollTop = 0;
}

function renderCarnet() {
  const list = activeBirds().filter((b) => thumbOf(b));
  const n = list.filter((b) => isMastered(b.id)).length;
  $("carnet-col").textContent = COLS[COL].title;
  $("carnet-count").textContent = `${n} / ${list.length || TARGET} maîtrisés`;
  $("carnet-bar").style.width = (list.length ? Math.round((n / list.length) * 100) : 0) + "%";
  // médailles gagnées dans cette collection
  const tally = { or: 0, argent: 0, bronze: 0 };
  progress.sessions.filter((s) => (s.col || "monde") === COL).forEach((s) => { const m = medalOf(s.score, s.total); if (m) tally[m]++; });
  $("carnet-medals").innerHTML = Object.keys(tally).map((k) =>
    `<span title="${MEDALS[k].label}"><i style="--medal:${MEDALS[k].color}"></i>${tally[k]}</span>`).join("");

  $("btn-carnet-quiz").hidden = list.filter((b) => hasSong(b.id)).length < 3;
  if (!list.length) {
    $("carnet-grid").innerHTML = `<p class="carnet-empty">Cette collection n'est pas encore préparée.<br>Revenez à l'accueil et touchez « Préparer l'appli ».</p>`;
    return;
  }
  // regroupement : terre / mer pour la Bretagne, continents pour le monde
  const groups = [];
  list.forEach((b) => {
    const key = b.milieu ? (b.milieu === "mer" ? "Mer et littoral" : "Terre") : b.zone;
    let grp = groups.find((x) => x.key === key);
    if (!grp) groups.push(grp = { key, icon: b.milieu ? (b.milieu === "mer" ? "waves" : "tree") : "", birds: [] });
    grp.birds.push(b);
  });
  groups.sort((a, b) => (a.key === "France") - (b.key === "France"));     // les remplaçants français en dernier
  $("carnet-grid").innerHTML = groups.map((grp) => {
    const done = grp.birds.filter((b) => isMastered(b.id)).length;
    return `<section class="grp"><h3>${grp.icon ? ic(grp.icon) : ""}${esc(grp.key)}<small>${done} / ${grp.birds.length}</small></h3>
      <div class="cells">${grp.birds.map((b) => {
        const ok = isMastered(b.id), st = Math.min(streakOf(b.id), MASTER_N);
        return `<button class="cell${ok ? " ok" : ""}" data-id="${b.id}" aria-label="${esc(b.fr)}${ok ? ", maîtrisé" : ""}">
          <span class="ph"><img src="${thumbOf(b)}" alt="" loading="lazy" decoding="async" draggable="false"></span>
          <span class="tick">${ic("check")}</span>
          <span class="dots">${[0, 1, 2].map((k) => `<i${k < st ? ' class="on"' : ""}></i>`).join("")}</span>
          <span class="nm">${esc(b.fr)}</span></button>`;
      }).join("")}</div></section>`;
  }).join("");
}

/* Fiche complète d'un oiseau, avec écoute du chant */
const fiche = { id: null, song: null };
function setListenBtn(on) { $("btn-fiche-listen").innerHTML = on ? `${ic("stop")} Arrêter` : `${ic("play")} Écouter`; }

function openFiche(id) {
  const b = byId(id);
  if (!b) return;
  fiche.id = id;
  $("fiche-bg").src = $("fiche-img").src = thumbOf(b);
  $("fiche-badge").hidden = !isMastered(id);
  $("fiche-name").textContent = b.fr;
  $("fiche-latin").textContent = latinLine(b);
  $("fiche-dl").innerHTML = birdFacts(b);
  $("fiche-anecdote").textContent = b.anecdote;
  const s = progress.birds[id];
  $("fiche-stats").textContent = !s || (!s.ok && !s.ko) ? "Pas encore rencontré au quiz."
    : `Au quiz : reconnu ${s.ok} fois, raté ${s.ko} fois. ` + (isMastered(id) ? "Oiseau maîtrisé." : `Série en cours : ${streakOf(id)} / ${MASTER_N}.`);
  $("fiche-visu").hidden = true;
  const btn = $("btn-fiche-listen");
  btn.disabled = !hasSong(id);
  if (hasSong(id)) setListenBtn(false); else btn.textContent = "Chant indisponible";
  $("fiche").hidden = false;
  $("fiche").querySelector(".sheet-inner").scrollTop = 0;
}

async function toggleListen() {
  if (fiche.song && fiche.song.active) { fiche.song.stop(250); return; }
  Sfx.init();                                   // ce toucher autorise le son
  const id = fiche.id, btn = $("btn-fiche-listen");
  btn.disabled = true;
  const song = await playSong(id, SONG_MS);
  btn.disabled = false;
  if (fiche.id !== id || $("fiche").hidden) { if (song) song.stop(0); return; }
  if (!song) { btn.textContent = "Lecture impossible"; return; }
  fiche.song = song;
  song.onstop = () => { if (fiche.song === song) { fiche.song = null; if (fiche.id === id) setListenBtn(false); } };
  setListenBtn(true);
  Visu.start($("fiche-visu"), song);
}

function closeFiche() {
  if (fiche.song) fiche.song.stop(200);
  fiche.id = null;
  $("fiche").hidden = true;
}

/* ---------- Boutons ---------- */
$("btn-quiz").onclick = startQuiz;
$("btn-menu-quiz").onclick = () => { $("menu").hidden = true; menuOpen = false; startQuiz(); };
$("btn-replay").onclick = () => { if (qs && !qs.answered) listen(); };
$("btn-quiz-quit").onclick = quitQuiz;
$("btn-amb").onclick = () => { Sfx.setOff(!Sfx.off); setAmbBtn(); };
$("btn-again").onclick = () => runQuiz(lastCat);
document.querySelectorAll("#quiz-cat [data-cat]").forEach((b) => (b.onclick = () => runQuiz(b.dataset.cat)));
$("btn-cat-close").onclick = () => { $("quiz-cat").hidden = true; if (!feed.hidden) scheduleAuto(); };
$("btn-end-home").onclick = () => refreshHome();
$("btn-end-carnet").onclick = openCarnet;
$("btn-home-carnet").onclick = openCarnet;
$("btn-carnet-close").onclick = () => refreshHome();
$("btn-carnet-quiz").onclick = startQuiz;
$("carnet-grid").onclick = (e) => { const c = e.target.closest(".cell"); if (c) openFiche(c.dataset.id); };
$("btn-fiche-listen").onclick = toggleListen;
$("btn-fiche-close").onclick = closeFiche;
