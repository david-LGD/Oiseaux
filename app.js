"use strict";
/* Chants d'oiseaux — web-app hors ligne
   Médias : Wikimedia Commons (licences libres), téléchargés une fois puis gardés en cache. */

const ENWIKI = "https://en.wikipedia.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const MEDIA_CACHE = "oiseaux-media-v1";
const META_KEY = "oiseaux-meta-v1";
const SPEED_KEY = "oiseaux-speed";
const SONG_MS = 10000;          // durée du chant
const HOLD_MS = 300;            // doigt immobile => chant
const MOVE_PX = 12;             // au-delà => c'est un glissement
const RESUME_MS = 1500;         // pause avant reprise du défilement
const MAX_AUDIO_BYTES = 8e6;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Métadonnées (sources, crédits) ---------- */
let meta = loadMeta();
function loadMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || { birds: {} }; } catch { return { birds: {} }; } }
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} }
const bm = (id) => (meta.birds[id] = meta.birds[id] || {});
const mediaKey = (id, kind) => `media/${id}/${kind}`;

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

/* ---------- Écran de préparation ---------- */
function isReady(id) { const m = meta.birds[id]; return !!(m && m.photo); }
function counts() {
  let photos = 0, songs = 0;
  BIRDS.forEach((b) => { const m = meta.birds[b.id]; if (m && m.photo) photos++; if (m && m.audio) songs++; });
  return { photos, songs };
}

async function prepare() {
  show("download");
  $("btn-retry").hidden = true; $("btn-dl-start").hidden = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const list = $("dl-list"); list.innerHTML = "";
  const rows = {};
  BIRDS.forEach((b) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${b.fr}</span><span class="st">…</span>`;
    list.appendChild(li); rows[b.id] = li.querySelector(".st");
  });
  const todo = BIRDS.filter((b) => !(meta.birds[b.id] && meta.birds[b.id].photo && meta.birds[b.id].audio));
  let done = BIRDS.length - todo.length;
  const mark = (b) => {
    const m = meta.birds[b.id] || {};
    const st = rows[b.id];
    if (m.photo && m.audio) { st.textContent = "✓"; st.className = "st ok"; }
    else if (m.photo) { st.textContent = "photo seule"; st.className = "st warn"; }
    else { st.textContent = "échec"; st.className = "st err"; }
  };
  BIRDS.forEach((b) => { if (!todo.includes(b)) mark(b); });
  const update = () => {
    $("dl-bar").style.width = Math.round((done / BIRDS.length) * 100) + "%";
    $("dl-status").textContent = `${done} / ${BIRDS.length} oiseaux traités`;
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
  meta.prepared = true; saveMeta();
  const c = counts();
  $("dl-status").textContent = `Terminé : ${c.photos} photos et ${c.songs} chants disponibles hors ligne.`;
  $("btn-retry").hidden = c.photos === BIRDS.length && c.songs === BIRDS.length;
  $("btn-dl-start").hidden = c.photos === 0;
}

/* ---------- Navigation entre écrans ---------- */
function show(name) {
  ["home", "download"].forEach((s) => ($(s).hidden = s !== name));
  const feedOn = name === "feed";
  $("feed").hidden = !feedOn; $("btn-menu").hidden = !feedOn;
}
function refreshHome() {
  const c = counts();
  const ready = meta.prepared && c.photos > 0;
  $("btn-start").hidden = !ready;
  $("btn-prepare").hidden = ready;
  let note = "";
  if (!ready) note = navigator.onLine ? "Première utilisation : connexion internet nécessaire une seule fois (environ 30 à 60 Mo)."
                                      : "Connectez-vous à internet pour la première préparation.";
  else if (c.photos < BIRDS.length || c.songs < BIRDS.length)
    note = `${c.photos} photos et ${c.songs} chants disponibles. Menu ⋯ > Retélécharger pour compléter.`;
  $("home-note").textContent = note;
  show("home");
}

/* ---------- Fil d'images ---------- */
const feed = $("feed");
let photoUrls = {};          // id -> objectURL
let pool = [];               // oiseaux disponibles
let speed = +(localStorage.getItem(SPEED_KEY) || 6);
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
    s.innerHTML = `<img alt="" draggable="false" decoding="async"><span class="zone">${b.zone}</span>
      <div class="label"><b>${b.fr}</b><i>${b.latin}</i></div>`;
    s.querySelector("img").src = photoUrls[b.id];
    feed.appendChild(s);
  }
}

async function startFeed() {
  pool = [];
  const cache = await caches.open(MEDIA_CACHE);
  for (const b of BIRDS) {
    if (!isReady(b.id)) continue;
    if (!photoUrls[b.id]) {
      const r = await cache.match(mediaKey(b.id, "photo"));
      if (!r) continue;
      photoUrls[b.id] = URL.createObjectURL(await r.blob());
    }
    pool.push(b);
  }
  if (!pool.length) { meta.prepared = false; saveMeta(); refreshHome(); return; }
  feed.innerHTML = ""; appendRound(); appendRound();
  show("feed"); feed.scrollTop = 0;
  requestWakeLock();
  $("hint").hidden = false;
  clearTimeout(hintTimer); hintTimer = setTimeout(() => ($("hint").hidden = true), 9000);
  scheduleAuto();
}

function scheduleAuto(delay) {
  clearTimeout(autoTimer);
  if (playing || menuOpen) return;
  autoTimer = setTimeout(advance, delay != null ? delay : speed * 1000);
}
function advance() {
  if (playing || menuOpen || feed.hidden) return;
  const idx = currentIndex() + 1;
  if (idx > slides().length - 6) appendRound();
  feed.scrollTo({ top: idx * slideH(), behavior: "smooth" });
}
let settleTimer = null;
function onSettle() {
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
  if (playing || !e.isPrimary) return;
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
  const b = BIRDS.find((x) => x.id === slide.dataset.id);
  slide.classList.add("playing");

  // fiche
  $("card-name").textContent = b.fr; $("card-latin").textContent = b.latin;
  $("card-rep").textContent = b.repartition; $("card-hab").textContent = b.habitat;
  $("card-taille").textContent = b.taille; $("card-anecdote").textContent = b.anecdote;
  const card = $("card"), bar = $("card-bar");
  card.classList.remove("out"); card.hidden = false;
  bar.style.transition = "none"; bar.style.width = "0";

  // chant
  let audio = null, url = null, ok = false;
  const m = meta.birds[b.id];
  if (m && m.audio) {
    try {
      const r = await (await caches.open(MEDIA_CACHE)).match(mediaKey(b.id, "audio"));
      if (r) {
        url = URL.createObjectURL(await r.blob());
        audio = new Audio(url); audio.loop = true; audio.preload = "auto";
        await new Promise((res, rej) => { audio.onloadedmetadata = res; audio.onerror = rej; setTimeout(res, 2500); });
        if (isFinite(audio.duration) && audio.duration > 15) audio.currentTime = 1;
        await audio.play(); ok = true;
      }
    } catch (e) { console.warn("lecture", e); }
  }
  $("card-nosound").hidden = ok;
  const total = ok ? SONG_MS : 5000;
  requestAnimationFrame(() => { bar.style.transition = `width ${total}ms linear`; bar.style.width = "100%"; });

  // le chant va jusqu'au bout, même si le doigt est relevé
  await sleep(total - 600);
  if (audio) { const v0 = audio.volume; for (let k = 1; k <= 12; k++) { audio.volume = Math.max(0, v0 * (1 - k / 12)); await sleep(50); } audio.pause(); }
  else await sleep(600);
  if (url) URL.revokeObjectURL(url);
  card.classList.add("out");
  await sleep(500);
  card.hidden = true; slide.classList.remove("playing");
  feed.classList.remove("locked");
  playing = false;
  scheduleAuto(RESUME_MS);
}

/* ---------- Écran toujours allumé ---------- */
async function requestWakeLock() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !feed.hidden) { requestWakeLock(); scheduleAuto(); }
  else clearTimeout(autoTimer);
});

/* ---------- Menu, réglages, crédits ---------- */
$("sel-speed").value = String(speed);
$("sel-speed").onchange = (e) => { speed = +e.target.value; localStorage.setItem(SPEED_KEY, speed); };
$("btn-menu").onclick = () => { if (playing) return; menuOpen = true; clearTimeout(autoTimer); $("menu").hidden = false; };
$("btn-close-menu").onclick = () => { $("menu").hidden = true; menuOpen = false; scheduleAuto(); };
$("btn-credits").onclick = () => {
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const line = (label, c) => c
    ? `${label} : ${esc(c.artist)} — ${esc(c.license)}${c.page ? `<br><a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.page)}</a>` : ""}`
    : `${label} : non disponible`;
  $("credits-list").innerHTML = BIRDS.map((b) => {
    const m = meta.birds[b.id] || {};
    return `<div class="credit"><b>${esc(b.fr)}</b> <i>(${esc(b.latin)})</i><br>${line("Photo", m.photo)}<br>${line("Chant", m.audio)}</div>`;
  }).join("");
  $("menu").hidden = true; $("credits").hidden = false;
};
$("btn-close-credits").onclick = () => { $("credits").hidden = true; menuOpen = false; scheduleAuto(); };
$("btn-update").onclick = async () => {
  if (!navigator.onLine) { alert("Connexion internet nécessaire pour retélécharger."); return; }
  const full = confirm("OK : tout retélécharger depuis zéro.\nAnnuler : compléter seulement ce qui manque.");
  $("menu").hidden = true; menuOpen = false; clearTimeout(autoTimer);
  if (full) {
    await caches.delete(MEDIA_CACHE);
    Object.values(photoUrls).forEach((u) => URL.revokeObjectURL(u)); photoUrls = {};
    meta = { birds: {} }; saveMeta();
  }
  await prepare();
};

/* ---------- Démarrage ---------- */
$("btn-start").onclick = startFeed;      // ce premier toucher autorise aussi le son
$("btn-dl-start").onclick = startFeed;
$("btn-prepare").onclick = () => {
  if (!navigator.onLine) { alert("Connectez-vous à internet pour la première préparation."); return; }
  prepare();
};
$("btn-retry").onclick = prepare;
window.addEventListener("resize", () => { if (!feed.hidden) feed.scrollTop = currentIndex() * slideH(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
refreshHome();
