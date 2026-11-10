"use strict";
/* Chants d'oiseaux — web-app hors ligne
   Médias : Wikimedia Commons (licences libres), téléchargés une fois puis gardés en cache.
   Ce fichier : données, progression, sons, accueil, défilement, réglages.
   quiz.js : quiz, séries, médailles, carnet d'ornithologue. */

const ENWIKI = "https://en.wikipedia.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const MEDIA_CACHE = "oiseaux-media-v1";
const META_KEY = "oiseaux-meta-v1";
const SPEED_KEY = "oiseaux-speed";
const SONG_MS = 10000;          // durée du chant
const HOLD_MS = 300;            // doigt immobile => chant
const MOVE_PX = 12;             // au-delà => c'est un glissement
const MAX_AUDIO_BYTES = 8e6;
// enregistrements à écarter : prononciations du nom, voix humaines, extraits radio…
const BAD_AUDIO = /^file:\s*(en|fr|de|nl|es|it|pt|sv|pl|ru)(-[a-z]{2})?-|ll-q\d+|pronunciation|prononciation|aussprache|spoken|voice|narrat|wikipedia|podcast|radio|interview/i;

const APP_VERSION = "14";      // à augmenter à chaque mise à jour (avec sw.js)
const $ = (id) => document.getElementById(id);
document.querySelectorAll(".app-version").forEach((e) => (e.textContent = APP_VERSION));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// icône du jeu SVG défini dans index.html
const ic = (name, cls = "") => `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/* ---------- Métadonnées (sources, crédits) ---------- */
let meta = loadMeta();
function loadMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || { birds: {} }; } catch { return { birds: {} }; } }
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} }
const bm = (id) => (meta.birds[id] = meta.birds[id] || {});
const mediaKey = (id, kind) => `media/${id}/${kind}`;
const localKey = (id, kind) => `local/${id}/${kind}`;

/* ---------- Collections : 30 oiseaux avec chant (réserves si besoin) ---------- */
const COLS = {
  monde: { title: "Oiseaux du monde", sub: "30 oiseaux du monde entier.", list: BIRDS, reserves: RESERVES,
           replaceNote: "un oiseau de France" },
  bretagne: { title: "Oiseaux de Bretagne", sub: "30 oiseaux de Bretagne, de la terre et de la mer.", list: BRETAGNE, reserves: BRETAGNE_RESERVES,
              replaceNote: "un autre oiseau de Bretagne du même milieu" },
};
const COL_KEY = "oiseaux-collection";
let COL = localStorage.getItem(COL_KEY) === "bretagne" ? "bretagne" : "monde";
const colList = () => COLS[COL].list;
const colReserves = () => COLS[COL].reserves;
const TARGET = 30;
// recherche d'un oiseau : d'abord dans la collection demandée (les fiches diffèrent d'une collection à l'autre)
function findIn(col, id) {
  const c = COLS[col];
  return c.list.concat(c.reserves, BIRDS, RESERVES, BRETAGNE, BRETAGNE_RESERVES).find((b) => b.id === id);
}
const byId = (id) => findIn(COL, id);
// anciennes données (une seule collection) -> par collection
if (Array.isArray(meta.active) && !meta.activeBy) { meta.activeBy = { monde: meta.active }; }
if (meta.prepared && !meta.preparedBy) { meta.preparedBy = { monde: true }; }
meta.activeBy = meta.activeBy || {}; meta.preparedBy = meta.preparedBy || {};
function isReady(id) { const m = meta.birds[id]; return !!(m && m.photo); }
function activeOf(col) {
  const ids = meta.activeBy[col];
  if (Array.isArray(ids) && ids.length) return ids.map((id) => findIn(col, id)).filter(Boolean);
  return COLS[col].list.filter((b) => isReady(b.id));
}
const activeBirds = () => activeOf(COL);
const hasSong = (id) => !!(meta.birds[id] && meta.birds[id].audio);
const isLocal = (id, kind) => !!(meta.local && meta.local[id] && meta.local[id][kind]);

/* ---------- Progression au quiz et maîtrise ---------- */
const QUIZ_KEY = "oiseaux-quiz-v1";
const MASTER_N = 3;             // reconnu 3 fois de suite = maîtrisé
function loadQuiz() { try { return JSON.parse(localStorage.getItem(QUIZ_KEY)) || { sessions: [], birds: {} }; } catch { return { sessions: [], birds: {} }; } }
function saveQuiz(q) { try { localStorage.setItem(QUIZ_KEY, JSON.stringify(q)); } catch {} }
let progress = loadQuiz();
progress.sessions = progress.sessions || []; progress.birds = progress.birds || {};
// données d'avant la version 14 : la série en cours n'était pas notée. On ne la déduit que lorsqu'elle est certaine
// (jamais d'erreur sur cet oiseau) ; sinon elle repart de zéro.
Object.values(progress.birds).forEach((s) => {
  if (typeof s.streak !== "number") s.streak = !s.ko && s.ok >= MASTER_N ? s.ok : 0;
});
const streakOf = (id) => (progress.birds[id] && progress.birds[id].streak) || 0;
const isMastered = (id) => streakOf(id) >= MASTER_N;
function masteryOf(col) {
  const list = activeOf(col), n = list.filter((b) => isMastered(b.id)).length;
  return { n, total: list.length, pct: list.length ? Math.round((n / list.length) * 100) : 0 };
}

/* ---------- Vos fichiers déposés sur GitHub : photos/<id>-portrait.jpg, photos/<id>-paysage.jpg, ambiance.mp3 ---------- */
async function syncLocal() {
  if (!navigator.onLine) return;
  meta.local = meta.local || {};
  const cache = await caches.open(MEDIA_CACHE);
  const jobs = [];
  activeBirds().forEach((b) => ["portrait", "paysage"].forEach((k) => jobs.push([`photos/${b.id}-${k}.jpg`, b.id, k])));
  jobs.push(["ambiance.mp3", "_ambiance", "file"]);
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const [url, id, kind] = jobs[i++];
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(url, { cache: "no-cache", signal: ctl.signal });
        const type = r.headers.get("content-type") || "";
        meta.local[id] = meta.local[id] || {};
        if (r.ok && /image|audio|mpeg|octet/.test(type)) {
          await cache.put(localKey(id, kind), new Response(await r.blob(), { headers: { "Content-Type": type } }));
          meta.local[id][kind] = true;
        } else if (r.status === 404) {
          await cache.delete(localKey(id, kind));
          meta.local[id][kind] = false;
        }
      } catch {} finally { clearTimeout(t); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  saveMeta();
}

/* ---------- API Wikimedia ---------- */
async function api(base, params) {
  const u = new URL(base);
  Object.entries({ ...params, format: "json", formatversion: "2", origin: "*" })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
function cleanText(html, max = 140) {
  if (!html) return "Auteur inconnu";
  const t = new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t || "Auteur inconnu";
}
function creditFrom(info, fallbackPage) {
  const m = (info && info.extmetadata) || {};
  return {
    artist: cleanText(m.Artist && m.Artist.value),
    license: cleanText((m.LicenseShortName && m.LicenseShortName.value) || "Licence libre", 60),
    licenseUrl: (m.LicenseUrl && m.LicenseUrl.value) || "",
    page: (info && info.descriptionurl) || fallbackPage || "",
  };
}
async function fileCredit(fileName) {
  const params = { action: "query", titles: "File:" + fileName, prop: "imageinfo",
    iiprop: "extmetadata|url", iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl" };
  for (const base of [COMMONS, ENWIKI]) {
    try {
      const r = await api(base, params);
      const p = r.query && r.query.pages && r.query.pages[0];
      if (p && !p.missing && p.imageinfo) return creditFrom(p.imageinfo[0]);
    } catch {}
  }
  return creditFrom(null, "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(fileName));
}

async function findPhoto(b) {
  // 1) image principale (libre) de l'article Wikipédia de l'espèce
  try {
    const r = await api(ENWIKI, { action: "query", titles: b.latin, redirects: "1", prop: "pageimages",
      piprop: "thumbnail|name", pithumbsize: "1280", pilicense: "free" });
    const p = r.query.pages[0];
    if (p && p.thumbnail && p.pageimage) return { url: p.thumbnail.source, file: p.pageimage };
  } catch {}
  // 2) sinon, recherche sur Commons
  const r = await api(COMMONS, { action: "query", generator: "search", gsrnamespace: "6", gsrlimit: "8",
    gsrsearch: `filetype:bitmap "${b.latin}"`, prop: "imageinfo", iiprop: "url|mime", iiurlwidth: "1280" });
  const pages = (r.query && r.query.pages) || [];
  pages.sort((a, c) => (a.index || 0) - (c.index || 0));
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0];
    if (ii && /jpeg|png|webp/.test(ii.mime) && (ii.thumburl || ii.url))
      return { url: ii.thumburl || ii.url, file: p.title.replace(/^File:/, "") };
  }
  throw new Error("aucune photo");
}

function transcodeUrl(orig, ext) {
  const i = orig.lastIndexOf("/");
  return orig.slice(0, i).replace("/wikipedia/commons/", "/wikipedia/commons/transcoded/") + orig.slice(i) + "/" + orig.slice(i + 1) + "." + ext;
}
function audioUrls(ii) {
  const mime = ii.mime || "", size = ii.size || 0, out = [];
  const direct = /mpeg|mp3|ogg|opus|webm/.test(mime);
  if (direct && size <= MAX_AUDIO_BYTES) out.push(ii.url);
  out.push(transcodeUrl(ii.url, "mp3"));
  if (!/ogg/.test(mime)) out.push(transcodeUrl(ii.url, "ogg"));
  return out;
}
async function findAudioCandidates(b) {
  const latin = b.latin.toLowerCase(), en = b.en.toLowerCase();
  const queries = [`filetype:audio "${b.latin}"`, `filetype:audio ${b.latin}`, `filetype:audio "${b.en}"`];
  const seen = new Set(), cands = [];
  for (const q of queries) {
    let r;
    try {
      r = await api(COMMONS, { action: "query", generator: "search", gsrnamespace: "6", gsrlimit: "20", gsrsearch: q,
        prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl" });
    } catch { continue; }
    for (const p of (r.query && r.query.pages) || []) {
      if (seen.has(p.title) || !p.imageinfo) continue;
      seen.add(p.title);
      if (BAD_AUDIO.test(p.title)) continue;
      if (((meta.badAudio || {})[b.id] || []).includes(p.title.replace(/^File:/, ""))) continue;
      const t = p.title.toLowerCase().replace(/_/g, " ");
      if (!t.includes(latin) && !t.includes(en)) continue;   // jamais un autre oiseau
      let score = 0;
      if (/song|chant|singing|sings|gesang|canto|zang/.test(t)) score += 3;
      if (/\bxc\d+|xeno/.test(t)) score += 1;
      if (/call|cri/.test(t)) score += 1;
      if (/alarm|juvenile|chick|begging/.test(t)) score -= 1;
      cands.push({ title: p.title, info: p.imageinfo[0], score });
    }
    if (cands.length >= 3) break;
  }
  cands.sort((a, c) => c.score - a.score || (a.info.size || 0) - (c.info.size || 0));
  return cands;
}

async function store(url, key) {
  const r = await fetch(url, { mode: "cors" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const blob = await r.blob();
  if (blob.size < 500) throw new Error("fichier vide");
  if (blob.size > 15e6) throw new Error("fichier trop lourd");
  const cache = await caches.open(MEDIA_CACHE);
  await cache.put(key, new Response(blob, { headers: { "Content-Type": blob.type || r.headers.get("content-type") || "" } }));
}

async function fetchBird(b) {
  const m = bm(b.id);
  if (!m.photo) {
    const ph = await findPhoto(b);
    await store(ph.url, mediaKey(b.id, "photo"));
    m.photo = await fileCredit(ph.file);
    saveMeta();
  }
  if (!m.audio) {
    const cands = await findAudioCandidates(b);
    for (const c of cands.slice(0, 5)) {
      for (const url of audioUrls(c.info)) {
        try {
          await store(url, mediaKey(b.id, "audio"));
          m.audio = { ...creditFrom(c.info), title: c.title.replace(/^File:/, "") };
          saveMeta();
          return;
        } catch {}
      }
    }
  }
}

/* ---------- Affichage selon la collection ---------- */
function zoneLabel(b) {
  if (!b.milieu) return esc(b.zone);
  return `${ic(b.milieu === "mer" ? "waves" : "tree")}${b.milieu === "mer" ? "Mer" : "Terre"}<span class="sep">·</span>${b.migr ? "Migrateur" : "Sédentaire"}`;
}
// lignes de la fiche d'un oiseau (défilement et carnet)
function birdFacts(b) {
  const rows = b.milieu
    ? [["Milieu", b.milieu === "mer" ? "Mer et littoral" : "Terre"], ["Statut", b.statut], ["Présence", b.presence],
       ["Où l'observer", b.lieu], ["Taille", b.taille]]
    : [["Répartition", b.repartition], ["Habitat", b.habitat], ["Taille", b.taille]];
  return rows.filter((r) => r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
}
function latinLine(b) {
  const br = meta.birds[b.id] && meta.birds[b.id].breton;
  return b.latin + (b.milieu && br ? ` · en breton : ${br}` : "");
}
function fillCard(b) {
  $("card-name").textContent = b.fr;
  $("card-latin").textContent = latinLine(b);
  $("card-dl").innerHTML = birdFacts(b);
  $("card-anecdote").textContent = b.anecdote;
}

/* Noms bretons : libellés « br » de Wikidata (source communautaire) */
async function fetchBretonNames(list) {
  for (const b of list) {
    const m = bm(b.id);
    if (m.bretonChecked) continue;
    try {
      const r = await api(ENWIKI, { action: "query", titles: b.latin, redirects: "1", prop: "pageprops", ppprop: "wikibase_item" });
      const q = r.query.pages[0] && r.query.pages[0].pageprops && r.query.pages[0].pageprops.wikibase_item;
      if (q) {
        const w = await api("https://www.wikidata.org/w/api.php", { action: "wbgetentities", ids: q, props: "labels", languages: "br" });
        const lab = w.entities && w.entities[q] && w.entities[q].labels && w.entities[q].labels.br && w.entities[q].labels.br.value;
        m.breton = lab && lab.toLowerCase() !== b.latin.toLowerCase() ? lab : null;
      }
      m.bretonChecked = true;
    } catch {}
  }
  saveMeta();
}

/* Choix de la collection sur l'accueil, avec le pourcentage d'oiseaux maîtrisés */
function renderCollections() {
  document.querySelectorAll(".col-btn").forEach((btn) => {
    const col = btn.dataset.col, ready = !!meta.preparedBy[col], m = masteryOf(col);
    btn.classList.toggle("on", col === COL);
    btn.querySelector(".col-state").textContent = ready ? `${m.pct} % maîtrisés` : "à préparer";
    btn.querySelector(".col-bar").style.visibility = ready ? "visible" : "hidden";
    btn.querySelector(".col-bar i").style.width = (ready ? m.pct : 0) + "%";
  });
  $("home-sub").textContent = COLS[COL].sub;
}
document.querySelectorAll(".col-btn").forEach((btn) => (btn.onclick = () => {
  COL = btn.dataset.col; localStorage.setItem(COL_KEY, COL);
  Object.values(photoUrls).forEach((u) => URL.revokeObjectURL(u)); photoUrls = {};
  refreshHome(false);
}));

/* ---------- Écran de préparation ---------- */
function counts() {
  let photos = 0, songs = 0;
  activeBirds().forEach((b) => { const m = meta.birds[b.id]; if (m && m.photo) photos++; if (m && m.audio) songs++; });
  return { photos, songs };
}

async function chooseActive(rowFor, mark) {
  const ok = (b) => isReady(b.id) && hasSong(b.id);
  const list = colList(), used = new Set(list.map((b) => b.id)), active = [];
  for (const b of list) {
    if (ok(b)) { active.push(b); continue; }
    let found = null;
    for (const r of colReserves()) {               // remplaçant du même milieu (terre / mer) si précisé
      if (used.has(r.id) || (b.milieu && r.milieu !== b.milieu)) continue;
      if (!ok(r)) { rowFor(r).textContent = "recherche…"; try { await fetchBird(r); } catch (e) { console.warn(r.id, e); } }
      mark(r);
      if (ok(r)) { found = r; used.add(r.id); break; }
    }
    active.push(found || b);                       // à défaut, l'oiseau reste (avec photo seule)
  }
  meta.activeBy[COL] = active.filter((b) => isReady(b.id)).map((b) => b.id);
  saveMeta();
}

async function prepare() {
  show("download");
  $("btn-retry").hidden = true; $("btn-dl-start").hidden = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const list = $("dl-list"); list.innerHTML = "";
  const rows = {};
  const rowFor = (b, label) => {
    if (!rows[b.id]) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${esc(label || b.fr)}</span><span class="st">…</span>`;
      list.appendChild(li); rows[b.id] = li.querySelector(".st");
      li.scrollIntoView({ block: "nearest" });
    }
    return rows[b.id];
  };
  const LIST = colList();
  LIST.forEach((b) => rowFor(b));
  const todo = LIST.filter((b) => !(meta.birds[b.id] && meta.birds[b.id].photo && meta.birds[b.id].audio));
  let done = LIST.length - todo.length;
  const mark = (b) => {
    const m = meta.birds[b.id] || {};
    const st = rowFor(b);
    const reserve = !LIST.includes(b);
    if (m.photo && m.audio) { st.innerHTML = ic("check") + (reserve ? " ajouté" : ""); st.className = "st ok"; }
    else if (reserve) { st.textContent = "non trouvé"; st.className = "st err"; }
    else { st.textContent = "sans chant → remplacé"; st.className = "st warn"; }
  };
  LIST.forEach((b) => { if (!todo.includes(b)) mark(b); });
  const update = () => {
    $("dl-bar").style.width = Math.round((done / LIST.length) * 100) + "%";
    $("dl-status").textContent = `${done} / ${LIST.length} oiseaux traités`;
  };
  update();
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const b = todo[i++];
      rows[b.id].textContent = "téléchargement…";
      try { await fetchBird(b); } catch (e) { console.warn(b.id, e); }
      mark(b); done++; update();
      await sleep(150);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (LIST.some((b) => !(isReady(b.id) && hasSong(b.id)))) {
    $("dl-status").textContent = `Remplacement des oiseaux sans chant par ${COLS[COL].replaceNote}…`;
    const sep = document.createElement("li"); sep.innerHTML = "<span><b>Oiseaux de remplacement</b></span>"; list.appendChild(sep);
  }
  await chooseActive(rowFor, mark);
  if (COL === "bretagne") { $("dl-status").textContent = "Recherche des noms en breton…"; await fetchBretonNames(activeBirds()); }
  meta.preparedBy[COL] = true; saveMeta();
  const c = counts();
  $("dl-status").textContent = `Terminé : ${c.photos} oiseaux, dont ${c.songs} avec leur chant, disponibles hors ligne.`;
  $("btn-retry").hidden = c.photos === TARGET && c.songs === TARGET;
  $("btn-dl-start").hidden = c.photos === 0;
}

/* ---------- Navigation entre écrans ---------- */
const SCREENS = ["home", "download", "quiz", "quiz-end", "carnet"];
function show(name) {
  SCREENS.forEach((s) => ($(s).hidden = s !== name));
  const feedOn = name === "feed";
  $("feed").hidden = !feedOn; $("btn-menu").hidden = !feedOn; $("btn-feed-home").hidden = !feedOn;
  if (!feedOn) { clearTimeout(autoTimer); $("hint").hidden = true; }
  if (!feedOn && name !== "quiz") Sfx.stopAmbience(0.8);
}
function refreshHome(display) {
  const c = counts();
  renderCollections();
  const ready = !!meta.preparedBy[COL] && c.photos > 0;
  $("btn-start").hidden = !ready;
  $("btn-quiz").hidden = !ready || c.songs < 3;
  const needsUpgrade = ready && c.songs < TARGET;
  $("btn-prepare").hidden = ready && !needsUpgrade;
  $("btn-prepare").textContent = needsUpgrade ? "Rechercher les chants manquants" : "Préparer l'appli";
  let note = "";
  if (!ready) note = navigator.onLine ? "Première utilisation : connexion internet nécessaire une seule fois (environ 30 à 60 Mo)."
                                      : "Connectez-vous à internet pour la première préparation.";
  else if (needsUpgrade) note = `${TARGET - c.songs} oiseau(x) sans chant : touchez le bouton ci-dessus (connexion requise). S'il n'existe aucun bon enregistrement, l'oiseau est remplacé par ${COLS[COL].replaceNote}.`;
  else if (c.photos < TARGET) note = `${c.photos} oiseaux disponibles. Réglages › Retélécharger les médias pour compléter.`;
  $("home-note").textContent = note;
  if (display !== false) show("home");     // false : on est déjà sur l'accueil (changement de collection), pas de transition
}

/* ---------- Sons : effets, ambiance, chants ---------- */
const AMB_KEY = "oiseaux-ambiance-off";
const AMB_VOL_KEY = "oiseaux-amb-vol";
const VISU_KEY = "oiseaux-visu";
// version 13 : l'ambiance repart à 0 (coupée) une fois, puis le réglage choisi est conservé
if (!localStorage.getItem("oiseaux-amb-reset13")) { localStorage.setItem(AMB_VOL_KEY, "0"); localStorage.setItem("oiseaux-amb-reset13", "1"); }
const visuOn = () => localStorage.getItem(VISU_KEY) !== "0";

const Sfx = {
  ctx: null, amb: null, off: localStorage.getItem(AMB_KEY) === "1",
  vol: +(localStorage.getItem(AMB_VOL_KEY) || 0),           // niveau relatif aux chants (0 = coupé, par défaut)
  setVol(v) {
    this.vol = v; localStorage.setItem(AMB_VOL_KEY, String(v));
    if (v <= 0) { this.stopAmbience(0.3); return; }
    if (this.amb && !this.amb.fading) this.amb.a.volume = v;
    else if (!this.amb) { this.init(); this.startAmbience(); }   // on monte le curseur : l'ambiance démarre
  },
  init() {            // à appeler depuis un toucher : c'est ce qui autorise le son
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch {}
  },
  tone(freq, at, dur, type = "sine", vol = 0.22, toFreq) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
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
  streak(n) { (n >= 5 ? [784, 988, 1175, 1568] : [784, 988, 1319]).forEach((f, i) => this.tone(f, 0.28 + i * 0.075, 0.3, "triangle", 0.15)); },
  end() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.16, i === 3 ? 1.6 : 0.5, "sine", 0.2));
          this.tone(1568, 0.64, 1.6, "sine", 0.06); },                                                    // fin du quiz
  // ambiance : votre fichier ambiance.mp3 déposé sur GitHub (joué en boucle)
  async startAmbience() {
    if (this.off || this.amb || this.vol <= 0 || !isLocal("_ambiance", "file")) return;
    const r = await (await caches.open(MEDIA_CACHE)).match(localKey("_ambiance", "file"));
    if (!r || this.amb) return;
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url); a.loop = true; a.volume = 0;
    this.amb = { a, url };
    try { await a.play(); } catch { return; }
    for (let k = 1; k <= 20 && this.amb && this.amb.a === a; k++) { a.volume = this.vol * k / 20; await sleep(100); }
  },
  setOff(off) {
    this.off = off; localStorage.setItem(AMB_KEY, off ? "1" : "0");
    if (off) this.stopAmbience(0.5); else { this.init(); this.startAmbience(); }
  },
  async stopAmbience(fade = 1) {
    if (!this.amb) return;
    const { a, url } = this.amb; this.amb.fading = true; this.amb = null;
    const v0 = a.volume, steps = Math.max(1, Math.round(fade * 10));
    for (let k = 1; k <= steps; k++) { a.volume = Math.max(0, v0 * (1 - k / steps)); await sleep(100); }
    a.pause(); URL.revokeObjectURL(url);
  },
};
document.addEventListener("visibilitychange", () => {
  if (!Sfx.ctx) return;
  if (document.visibilityState === "hidden") Sfx.ctx.suspend(); else Sfx.ctx.resume();
});

/* Lecture d'un chant. ms : arrêt automatique après cette durée (sinon, c'est l'appelant qui arrête).
   Quand l'onde sonore est activée, le son passe par un analyseur (Web Audio) pour l'afficher en temps réel.
   Si l'analyseur n'est pas utilisable, la lecture se fait directement, comme avant la version 14. */
async function playSong(id, ms) {
  const r = await (await caches.open(MEDIA_CACHE)).match(mediaKey(id, "audio"));
  if (!r) return null;
  const url = URL.createObjectURL(await r.blob());
  const audio = new Audio(url); audio.loop = true; audio.preload = "auto";
  await new Promise((res) => { audio.onloadedmetadata = res; audio.onerror = res; setTimeout(res, 2500); });
  if (isFinite(audio.duration) && audio.duration > 15) audio.currentTime = 1;

  let analyser = null, gain = null, src = null;
  const c = Sfx.ctx;
  if (visuOn() && c) {
    try {
      if (c.state !== "running") await Promise.race([c.resume(), sleep(250)]);
      if (c.state === "running") {
        const an = c.createAnalyser(), g = c.createGain();
        an.fftSize = 1024; an.smoothingTimeConstant = 0.7; an.minDecibels = -82; an.maxDecibels = -18;
        src = c.createMediaElementSource(audio);      // à partir d'ici, le son de ce chant passe par le graphe audio
        src.connect(an); an.connect(g); g.connect(c.destination);
        analyser = an; gain = g;
      }
    } catch (e) {
      console.warn("analyseur indisponible", e);
      if (src) { try { src.disconnect(); src.connect(c.destination); } catch {} }
      analyser = gain = null;
    }
  }

  let stopped = false, timer = null;
  const ctrl = {
    analyser, onstop: null,
    get active() { return !stopped; },
    async stop(fade = 500) {
      if (stopped) return; stopped = true; clearTimeout(timer);
      if (gain) {
        try { const t = c.currentTime; gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0.0001, t + fade / 1000); } catch {}
        await sleep(fade);
      } else {
        const v0 = audio.volume, steps = Math.max(1, Math.round(fade / 50));
        for (let k = 1; k <= steps; k++) { audio.volume = Math.max(0, v0 * (1 - k / steps)); await sleep(50); }
      }
      audio.pause();
      try { if (src) src.disconnect(); if (analyser) analyser.disconnect(); if (gain) gain.disconnect(); } catch {}
      URL.revokeObjectURL(url);
      if (ctrl.onstop) ctrl.onstop();
    },
  };
  if (ms) timer = setTimeout(() => ctrl.stop(600), ms);
  try { await audio.play(); } catch (e) { console.warn("lecture", e); ctrl.stop(0); return null; }
  return ctrl;
}

/* Onde sonore : barres animées en temps réel, aux couleurs de l'appli */
const Visu = {
  raf: 0, canvas: null,
  start(canvas, song) {
    this.stop();
    if (!canvas) return;
    // pas d'analyse en temps réel possible : on n'affiche rien plutôt qu'une onde factice
    if (!visuOn() || !(song && song.analyser)) { canvas.hidden = true; return; }
    canvas.hidden = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = Math.max(2, Math.round(canvas.clientWidth * dpr)), H = Math.max(2, Math.round(canvas.clientHeight * dpr));
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#8fd694"); grad.addColorStop(0.5, "#e9b949"); grad.addColorStop(1, "#f07832");
    const N = 30, lv = new Float32Array(N), raw = new Float32Array(N);
    const an = song.analyser, data = new Uint8Array(an.frequencyBinCount);
    // bandes réparties de 300 Hz à 11 kHz : là où chantent les oiseaux (graves à gauche, aigus à droite)
    const ny = an.context.sampleRate / 2, f0 = 300, f1 = Math.min(11000, ny * 0.95);
    const bands = Array.from({ length: N }, (_, i) => {
      const lo = Math.max(1, Math.floor((f0 * Math.pow(f1 / f0, i / N)) / ny * data.length));
      return [lo, Math.max(lo + 1, Math.ceil((f0 * Math.pow(f1 / f0, (i + 1) / N)) / ny * data.length))];
    });
    const step = W / N, bw = Math.max(2, step * 0.58), mid = H / 2;
    let peak = 0.3;
    this.canvas = canvas;
    const frame = () => {
      const live = song.active;
      if (live) {
        an.getByteFrequencyData(data);
        for (let i = 0; i < N; i++) { let m = 0; for (let k = bands[i][0]; k < bands[i][1]; k++) if (data[k] > m) m = data[k]; raw[i] = m / 255; if (raw[i] > peak) peak = raw[i]; }
      } else raw.fill(0);
      let top = 0;
      g.clearRect(0, 0, W, H); g.fillStyle = grad;
      for (let i = 0; i < N; i++) {
        // un sifflement pur allume aussi ses voisines : on voit une vague qui suit la hauteur du chant
        const side = Math.max(i > 0 ? raw[i - 1] : 0, i < N - 1 ? raw[i + 1] : 0), far = Math.max(i > 1 ? raw[i - 2] : 0, i < N - 2 ? raw[i + 2] : 0);
        const v = Math.max(raw[i], side * 0.66, far * 0.36);
        // le souffle de fond de l'enregistrement reste bas, le chant ressort
        const n = Math.pow(Math.max(0, Math.min(1, (v / peak - 0.3) / 0.7)), 1.15);
        lv[i] += (n - lv[i]) * (n > lv[i] ? 0.55 : 0.13);
        if (lv[i] > top) top = lv[i];
        const h = Math.max(bw, lv[i] * H * 0.96), x = i * step + (step - bw) / 2, y = mid - h / 2, rad = Math.min(bw / 2, h / 2);
        g.beginPath();
        g.moveTo(x + rad, y); g.arcTo(x + bw, y, x + bw, y + h, rad); g.arcTo(x + bw, y + h, x, y + h, rad);
        g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + bw, y, rad); g.closePath(); g.fill();
      }
      peak = Math.max(0.3, peak * 0.997);
      if (!live && top < 0.02) { this.raf = 0; return; }       // le chant est fini : l'onde retombe puis s'arrête
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },
  stop() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.canvas) { try { this.canvas.getContext("2d").clearRect(0, 0, this.canvas.width, this.canvas.height); } catch {} }
    this.canvas = null;
  },
};

/* ---------- Fil d'images ---------- */
const feed = $("feed");
let photoUrls = {};          // id -> objectURL (photo Wikimedia)
let portraitUrls = {}, paysageUrls = {};   // vos recadrages
let pool = [];               // oiseaux disponibles
let speed = +(localStorage.getItem(SPEED_KEY) || 6);
let skipPlay = null;
let autoTimer = null, playing = false, menuOpen = false, wakeLock = null, hintTimer = null;

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function slides() { return feed.children; }
function slideH() { return feed.clientHeight || window.innerHeight; }
function currentIndex() { return Math.round(feed.scrollTop / slideH()); }

function appendRound() {
  let order = shuffle(pool);
  const last = feed.lastElementChild;
  if (last && order[0].id === last.dataset.id && order.length > 1) order.push(order.shift());
  for (const b of order) {
    const s = document.createElement("div");
    s.className = "slide"; s.dataset.id = b.id;
    s.style.setProperty("--kb", "kb" + (1 + Math.floor(Math.random() * 4)));   // sens de l'effet Ken Burns
    s.innerHTML = `<img class="bg" alt="" draggable="false" decoding="async"><img class="fg" alt="" draggable="false" decoding="async">
      <span class="zone">${zoneLabel(b)}</span><div class="label"><b>${esc(b.fr)}</b><i>${esc(b.latin)}</i></div>`;
    s.querySelectorAll("img").forEach((im) => (im.src = portraitUrls[b.id] || photoUrls[b.id]));
    feed.appendChild(s);
  }
}

async function ensurePhotos() {
  const cache = await caches.open(MEDIA_CACHE);
  [portraitUrls, paysageUrls].forEach((m) => Object.values(m).forEach((u) => URL.revokeObjectURL(u)));
  portraitUrls = {}; paysageUrls = {};
  for (const b of activeBirds()) {
    if (isReady(b.id) && !photoUrls[b.id]) {
      const r = await cache.match(mediaKey(b.id, "photo"));
      if (r) photoUrls[b.id] = URL.createObjectURL(await r.blob());
    }
    for (const [kind, store] of [["portrait", portraitUrls], ["paysage", paysageUrls]]) {
      if (!isLocal(b.id, kind)) continue;
      const r = await cache.match(localKey(b.id, kind));
      if (r) store[b.id] = URL.createObjectURL(await r.blob());
    }
  }
}

async function startFeed() {
  Sfx.init();                               // ce premier toucher autorise le son
  await syncLocal();
  await ensurePhotos();
  pool = activeBirds().filter((b) => photoUrls[b.id] || portraitUrls[b.id]);
  if (!pool.length) { meta.preparedBy[COL] = false; saveMeta(); refreshHome(); return; }
  feed.innerHTML = ""; appendRound(); appendRound();
  show("feed"); feed.scrollTop = 0; markLive();
  requestWakeLock();
  Sfx.startAmbience();
  $("hint").hidden = false;
  clearTimeout(hintTimer); hintTimer = setTimeout(() => ($("hint").hidden = true), 9000);
  scheduleAuto();
}

function scheduleAuto(delay) {
  clearTimeout(autoTimer);
  if (playing || menuOpen || feed.hidden) return;
  autoTimer = setTimeout(advance, delay != null ? delay : speed * 1000);
}
function advance() {
  if (playing || menuOpen || feed.hidden) return;
  const idx = currentIndex() + 1;
  if (idx > slides().length - 6) appendRound();
  feed.scrollTo({ top: idx * slideH(), behavior: "smooth" });
}
let settleTimer = null;
function markLive() {                       // l'animation ne tourne que sur la photo visible et ses voisines
  const i = currentIndex(), sl = slides();
  for (let k = 0; k < sl.length; k++) sl[k].classList.toggle("live", Math.abs(k - i) <= 1);
}
function onSettle() {
  if (feed.hidden) return;
  markLive();
  // élagage : on garde le DOM léger lors des longues sessions
  if (!playing && slides().length > 120 && currentIndex() > 70) {
    const n = pool.length, top = feed.scrollTop;
    for (let k = 0; k < n; k++) feed.firstElementChild.remove();
    feed.scrollTop = top - n * slideH();
  }
  if (currentIndex() > slides().length - 6) appendRound();
  if (!playing) scheduleAuto();
}
feed.addEventListener("scroll", () => { clearTimeout(autoTimer); clearTimeout(settleTimer); settleTimer = setTimeout(onSettle, 180); }, { passive: true });

/* ---------- Toucher : glisser = défiler, poser = écouter ---------- */
let touch = null;
feed.addEventListener("pointerdown", (e) => {
  if (!e.isPrimary) return;
  if (playing) { if (skipPlay) skipPlay(); return; }   // second toucher : oiseau suivant
  clearTimeout(autoTimer);
  touch = { x: e.clientX, y: e.clientY, t: performance.now(), fired: false };
  touch.timer = setTimeout(() => { if (touch) { touch.fired = true; trigger(); } }, HOLD_MS);
});
feed.addEventListener("pointermove", (e) => {
  if (!touch || touch.fired) return;
  if (Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > MOVE_PX) cancelTouch();
});
feed.addEventListener("pointerup", () => {
  if (!touch) return;
  if (!touch.fired) { clearTimeout(touch.timer); trigger(); }  // simple tape sans glisser
  touch = null;
});
feed.addEventListener("pointercancel", cancelTouch);   // le navigateur a commencé à défiler
function cancelTouch() { if (touch) { clearTimeout(touch.timer); touch = null; } }
feed.addEventListener("contextmenu", (e) => e.preventDefault());

async function trigger() {
  if (playing) return;
  playing = true;
  clearTimeout(autoTimer);
  const idx = currentIndex();
  const slide = slides()[idx];
  if (!slide) { playing = false; return; }
  feed.classList.add("locked");
  feed.scrollTo({ top: idx * slideH(), behavior: "smooth" });
  $("hint").hidden = true;
  if (navigator.vibrate) navigator.vibrate(15);
  const b = byId(slide.dataset.id);
  slide.classList.add("playing");

  // fiche
  fillCard(b);
  const card = $("card"), bar = $("card-bar"), visu = $("card-visu");
  visu.hidden = !visuOn() || !hasSong(b.id);
  card.classList.remove("out"); card.hidden = false;
  bar.style.transition = "none"; bar.style.width = "0";

  // chant et onde sonore
  let song = null;
  if (hasSong(b.id)) { try { song = await playSong(b.id); } catch (e) { console.warn("lecture", e); } }
  const ok = !!song;
  $("card-nosound").hidden = ok;
  if (ok) Visu.start(visu, song); else visu.hidden = true;
  const total = ok ? SONG_MS : 5000;
  requestAnimationFrame(() => { bar.style.transition = `width ${total}ms linear`; bar.style.width = "100%"; });

  // le chant dure 10 s (même si le doigt est relevé) ; un nouveau toucher passe à l'oiseau suivant
  let skipped = false;
  await new Promise((res) => {
    const t = setTimeout(res, total - 600);
    skipPlay = () => { skipped = true; clearTimeout(t); res(); };
  });
  skipPlay = null;
  if (song) await song.stop(skipped ? 200 : 480);
  else if (!skipped) await sleep(600);
  card.classList.add("out");
  await sleep(skipped ? 250 : 400);
  card.hidden = true; slide.classList.remove("playing");
  Visu.stop();
  feed.classList.remove("locked");
  playing = false;
  advance();                        // oiseau suivant tout de suite
}

/* ---------- Écran toujours allumé ---------- */
async function requestWakeLock() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !feed.hidden) { requestWakeLock(); scheduleAuto(); }
  else clearTimeout(autoTimer);
});

/* ---------- Réglages ---------- */
$("sel-speed").value = String(speed);
$("sel-speed").onchange = (e) => { speed = +e.target.value; localStorage.setItem(SPEED_KEY, speed); };
function ambNote() {
  $("amb-note").textContent = isLocal("_ambiance", "file")
    ? (Sfx.vol <= 0 ? "Ambiance coupée (niveau 0 %). Montez le curseur pour l'entendre."
                    : "Réglez le niveau en écoutant : l'ambiance joue pendant que ce menu est ouvert.")
    : "Aucun fichier ambiance.mp3 trouvé. Déposez-le à la racine du dépôt GitHub, puis rouvrez l'appli avec du réseau.";
}
let menuFromHome = false;
async function openMenu(fromHome) {
  if (playing) return;
  Sfx.init();
  menuFromHome = fromHome; menuOpen = true; clearTimeout(autoTimer);
  $("chk-amb").checked = !Sfx.off;
  const v = Math.round(Sfx.vol * 100); $("rng-amb").value = v; $("val-amb").textContent = v + " %";
  ambNote();
  $("menu").hidden = false;
  if (fromHome) {                       // depuis l'accueil : on récupère le fichier si besoin et on fait écouter le niveau
    await syncLocal(); ambNote();
    if (!$("menu").hidden) Sfx.startAmbience();
  }
}
// fermeture d'une fenêtre ouverte depuis l'accueil ou depuis le défilement
function afterSheet() {
  menuOpen = false;
  if (menuFromHome) { Sfx.stopAmbience(0.6); refreshHome(false); }   // l'accueil reflète ce qui a pu changer (chant écarté…)
  else scheduleAuto();
}
$("btn-menu").onclick = () => openMenu(false);
$("btn-home-settings").onclick = () => openMenu(true);
$("btn-feed-home").onclick = () => {          // retour à l'accueil depuis le défilement
  if (skipPlay) skipPlay();
  clearTimeout(autoTimer);
  refreshHome();
};
const KB_KEY = "oiseaux-kenburns";
document.body.classList.toggle("kb", localStorage.getItem(KB_KEY) !== "0");
$("chk-kb").checked = document.body.classList.contains("kb");
$("chk-kb").onchange = (e) => { document.body.classList.toggle("kb", e.target.checked); localStorage.setItem(KB_KEY, e.target.checked ? "1" : "0"); };
$("chk-visu").checked = visuOn();
$("chk-visu").onchange = (e) => { localStorage.setItem(VISU_KEY, e.target.checked ? "1" : "0"); if (!e.target.checked) Visu.stop(); };
$("chk-amb").onchange = (e) => Sfx.setOff(!e.target.checked);
$("rng-amb").oninput = (e) => {
  const v = +e.target.value; $("val-amb").textContent = v + " %";
  Sfx.setVol(v / 100);
  ambNote();
};
$("btn-close-menu").onclick = () => { $("menu").hidden = true; afterSheet(); };
// un toucher en dehors d'une fenêtre la ferme
document.querySelectorAll(".sheet[data-close]").forEach((s) => s.addEventListener("click", (e) => {
  if (e.target === s) $(s.dataset.close).click();
}));

/* ---------- Crédits ---------- */
$("btn-credits").onclick = () => {
  const line = (label, c) => c
    ? `${label} : ${esc(c.artist)} — ${esc(c.license)}${c.page ? `<br><a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.page)}</a>` : ""}`
    : `${label} : non disponible`;
  $("credits-list").innerHTML = activeBirds().map((b) => {
    const m = meta.birds[b.id] || {};
    const crop = isLocal(b.id, "portrait") || isLocal(b.id, "paysage") ? " (recadrée)" : "";
    return `<div class="credit"><b>${esc(b.fr)}</b> <i>(${esc(b.latin)})</i><br>${line("Photo" + crop, m.photo)}<br>${line("Chant", m.audio)}
      <br><button class="mini" data-other="${b.id}">${ic("replay")} Ce n'est pas le bon chant : en chercher un autre</button></div>`;
  }).join("");
  $("credits-list").querySelectorAll("[data-other]").forEach((btn) => (btn.onclick = () => {
    btn.textContent = "Recherche…"; btn.disabled = true; otherSong(btn.dataset.other);
  }));
  $("menu").hidden = true; $("credits").hidden = false;
};
$("btn-close-credits").onclick = () => { $("credits").hidden = true; afterSheet(); };

/* ---------- Export des photos pour recadrage ---------- */
$("btn-export").onclick = async () => {
  const list = activeBirds().filter((b) => isReady(b.id));
  if (!confirm(`Télécharger les ${list.length} photos dans le dossier Téléchargements du téléphone ?\nAutorisez les téléchargements multiples si le navigateur le demande.`)) return;
  const cache = await caches.open(MEDIA_CACHE);
  let n = 0;
  for (const b of list) {
    const r = await cache.match(mediaKey(b.id, "photo"));
    if (!r) continue;
    const blob = await r.blob();
    const ext = /png/.test(blob.type) ? "png" : /webp/.test(blob.type) ? "webp" : "jpg";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${b.id}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    n++; await sleep(450);
  }
  alert(`${n} photos envoyées vers Téléchargements.`);
};

/* ---------- Retélécharger les médias ---------- */
$("btn-update").onclick = async () => {
  if (!navigator.onLine) { alert("Connexion internet nécessaire pour retélécharger."); return; }
  const full = confirm("OK : tout retélécharger depuis zéro.\nAnnuler : compléter seulement ce qui manque.");
  $("menu").hidden = true; menuOpen = false; clearTimeout(autoTimer);
  if (full) {
    await caches.delete(MEDIA_CACHE);
    Object.values(photoUrls).forEach((u) => URL.revokeObjectURL(u)); photoUrls = {};
    // on garde la liste des enregistrements écartés (voix humaines…) pour ne pas les reprendre
    meta = { birds: {}, activeBy: {}, preparedBy: {}, badAudio: meta.badAudio || {}, fixPygargue: true };
    saveMeta();
  }
  await prepare();
};

/* ---------- Démarrage ---------- */
$("btn-start").onclick = startFeed;
$("btn-dl-start").onclick = startFeed;
$("btn-prepare").onclick = () => {
  if (!navigator.onLine) { alert("Connectez-vous à internet pour la première préparation."); return; }
  prepare();
};
$("btn-retry").onclick = prepare;
window.addEventListener("resize", () => { if (!feed.hidden) feed.scrollTop = currentIndex() * slideH(); });

// nettoyage : écarte un chant déjà enregistré qui serait une voix humaine
(function dropBadAudio() {
  let changed = false;
  Object.entries(meta.birds).forEach(([id, m]) => {
    if (m.audio && m.audio.title && BAD_AUDIO.test("File:" + m.audio.title)) {
      meta.badAudio = meta.badAudio || {};
      (meta.badAudio[id] = meta.badAudio[id] || []).push(m.audio.title);
      delete m.audio; changed = true;
    }
  });
  // signalé : l'enregistrement du pygargue vocifère est une voix humaine
  const pyg = meta.birds["pygargue-vocifere"];
  if (!meta.fixPygargue && pyg && pyg.audio) {
    meta.badAudio = meta.badAudio || {};
    if (pyg.audio.title) (meta.badAudio["pygargue-vocifere"] = meta.badAudio["pygargue-vocifere"] || []).push(pyg.audio.title);
    delete pyg.audio; changed = true;
  }
  if (!meta.fixPygargue) { meta.fixPygargue = true; changed = true; }
  if (changed) saveMeta();
})();

/* ---------- Mise à jour (sans toucher aux photos, chants ni scores) ---------- */
let swUpdating = false, swReloaded = false;
function swReload() { if (!swReloaded) { swReloaded = true; location.reload(); } }
async function checkUpdate() {
  const btn = $("btn-check-update"), label = btn.innerHTML;
  if (!navigator.onLine) { alert("Connexion internet nécessaire pour vérifier les mises à jour."); return; }
  btn.disabled = true; btn.textContent = "Vérification…";
  try {
    // « fresh » : le service worker laisse passer cette demande jusqu'au serveur
    const r = await fetch("app.js?fresh=" + Date.now(), { cache: "no-store" });
    const m = r.ok && (await r.text()).match(/APP_VERSION = "(\d+)"/);
    if (!m) throw new Error("version introuvable");
    if (+m[1] <= +APP_VERSION) { alert(`Vous avez déjà la dernière version (${APP_VERSION}).`); return; }
    btn.textContent = `Installation de la version ${m[1]}…`;
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (!reg) { location.reload(); return; }
    // le navigateur télécharge la nouvelle version en entier, puis la page se recharge toute seule (voir « controllerchange »)
    swUpdating = true;
    await reg.update();
    await sleep(20000);
    alert("La nouvelle version n'est pas encore entièrement disponible. Réessayez dans quelques minutes.");
  } catch (e) {
    alert("Impossible de vérifier pour l'instant. Réessayez dans quelques minutes.");
  } finally {
    swUpdating = false; btn.disabled = false; btn.innerHTML = label;
  }
}
$("btn-check-update").onclick = checkUpdate;

/* ---------- Mode d'emploi ---------- */
$("btn-home-help").onclick = () => { menuFromHome = true; $("help").hidden = false; };
$("btn-menu-help").onclick = () => { $("menu").hidden = true; $("help").hidden = false; };
$("btn-close-help").onclick = () => { $("help").hidden = true; afterSheet(); };

/* ---------- Chant incorrect : en chercher un autre ---------- */
async function otherSong(id) {
  if (!navigator.onLine) { alert("Connexion internet nécessaire."); $("btn-credits").onclick(); return; }
  const b = byId(id), m = bm(id);
  if (m.audio && m.audio.title) { meta.badAudio = meta.badAudio || {}; (meta.badAudio[id] = meta.badAudio[id] || []).push(m.audio.title); }
  delete m.audio; saveMeta();
  try { await fetchBird(b); } catch {}
  alert(hasSong(id) ? `Nouveau chant trouvé pour : ${b.fr}.`
    : `Aucun autre chant trouvé pour ${b.fr}. Il sera remplacé par ${COLS[COL].replaceNote} via l'accueil (« Rechercher les chants manquants »).`);
  $("btn-credits").onclick();
}

if ("serviceWorker" in navigator) {
  // dès qu'une nouvelle version est installée, on recharge une fois pour l'appliquer tout de suite
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController || swUpdating) swReload(); });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// l'écran de démarrage s'efface tout seul (animation CSS d'une seconde) ; on le retire ensuite de la page
setTimeout(() => { const s = $("splash"); if (s) s.remove(); }, 1150);
refreshHome();
