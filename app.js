/* Annuaire des podcasts suisses — PWA (vanilla JS, zéro dépendance) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const LANGS = { fr: 'Français', de: 'Allemand', it: 'Italien', rm: 'Romanche', en: 'Anglais' };
const LANGSHORT = { fr: 'FR', de: 'DE', it: 'IT', rm: 'RM', en: 'EN' };

const state = {
  data: null, byId: {}, episodes: [], q: '', lang: 'all', cat: 'all', sort: 'pertinence', shown: 60, epLang: 'fr',
  favs: new Set(JSON.parse(localStorage.getItem('lmd_favs') || '[]')),
};

const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};
const fmtDur = s => {
  if (!s) return '';
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};
const audioTime = s => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/* ---------------- player ---------------- */
const audio = $('#audio');
let currentEp = null;

const POSKEY = 'lmd_positions_v1', RATEKEY = 'lmd_rate';
const RATES = [1, 1.25, 1.5, 1.75, 2];

const positions = () => { try { return JSON.parse(localStorage.getItem(POSKEY) || '{}'); } catch { return {}; } };
function savedPosition(url) {
  const p = positions()[url];
  if (!p || !p.t || Date.now() - (p.at || 0) > 90 * 864e5) return 0;
  if (p.d && p.t > p.d - 20) return 0;           // épisode terminé : on repart du début
  return p.t > 10 ? p.t : 0;
}
function savePosition() {
  if (!currentEp || !audio.duration) return;
  const m = positions();
  m[currentEp.url] = { t: Math.round(audio.currentTime), d: Math.round(audio.duration), at: Date.now() };
  const keys = Object.keys(m);
  if (keys.length > 80) keys.slice(0, keys.length - 80).forEach(k => delete m[k]);
  try { localStorage.setItem(POSKEY, JSON.stringify(m)); } catch {}
}

let rate = RATES.includes(Number(localStorage.getItem(RATEKEY))) ? Number(localStorage.getItem(RATEKEY)) : 1;
let sleepAt = 0, sleepTick = null;

function applyRate() {
  audio.playbackRate = rate;
  const r = $('#fp-rate'); if (r) r.textContent = (rate === 1 ? '1' : String(rate).replace('.', ',')) + '×';
  localStorage.setItem(RATEKEY, String(rate));
}

function nowPlayingState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!audio.duration) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate,
      position: Math.min(audio.currentTime, audio.duration),
    });
  } catch {}
}

function syncMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const on = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  on('play', () => audio.play().catch(() => {}));
  on('pause', () => audio.pause());
  on('stop', () => closePlayer());
  on('seekbackward', d => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 15)); nowPlayingState(); });
  on('seekforward', d => { audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + (d.seekOffset || 30)); nowPlayingState(); });
  on('seekto', d => { audio.currentTime = d.seekTime; nowPlayingState(); });
}

function playEpisode(btn) {
  const { url, title, pod, cover, link } = btn.dataset;
  const resume = savedPosition(url);
  currentEp = { url, title, pod, cover, link };
  audio.src = url;
  audio.playbackRate = rate;
  audio.addEventListener('loadedmetadata', function once() {
    audio.removeEventListener('loadedmetadata', once);
    if (resume && resume < (audio.duration || 0) - 10) {
      audio.currentTime = resume;
      note('Reprise à ' + audioTime(resume));
    }
    nowPlayingState();
  });
  audio.play().catch(() => {});
  $('#player').hidden = false;
  $('#pl-title').textContent = title;
  $('#pl-pod').textContent = pod;
  $('#pl-cover').src = cover || '';
  $('#pl-cover').onerror = () => { $('#pl-cover').style.visibility = 'hidden'; };
  $('#pl-cover').style.visibility = 'visible';
  $('#fp-cover').src = cover || '';
  $('#fp-title').textContent = title;
  $('#fp-pod').textContent = pod;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist: pod, album: 'Annuaire des podcasts suisses',
      artwork: cover ? [{ src: cover, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  }
  syncMediaSession();
  applyRate();
}

function closePlayer() {
  audio.pause();
  savePosition();
  audio.removeAttribute('src');
  $('#player').hidden = true;
  $('#fullplayer').hidden = true;
  currentEp = null;
  syncPlayIcons();
}

function note(t) {
  const n = $('#fp-note');
  if (!n) return;
  n.textContent = t || '';
  if (t) { clearTimeout(note._t); note._t = setTimeout(() => { n.textContent = ''; }, 3200); }
}

function openFull() {
  if (!currentEp) return;
  $('#fullplayer').hidden = false;
  $('#fp-cover').src = currentEp.cover || '';
  $('#fp-title').textContent = currentEp.title;
  $('#fp-pod').textContent = currentEp.pod;
  document.body.classList.add('fp-open');
}

function syncPlayIcons() {
  const playing = !audio.paused && !audio.ended;
  $$('[data-play]').forEach(b => { if (b.classList.contains('play-btn')) b.textContent = (currentEp && b.dataset.url === currentEp.url && playing) ? '❚❚' : '▶'; });
  $('#pl-toggle').textContent = playing ? '❚❚' : '▶';
  const f = $('#fp-toggle'); if (f) f.textContent = playing ? '❚❚' : '▶';
}

audio.addEventListener('play', () => { syncPlayIcons(); nowPlayingState(); if (sleepTick) startSleepTick(); });
audio.addEventListener('pause', () => { syncPlayIcons(); savePosition(); nowPlayingState(); });
audio.addEventListener('ended', () => { syncPlayIcons(); savePosition(); });
audio.addEventListener('ratechange', nowPlayingState);
audio.addEventListener('seeked', nowPlayingState);

$('#pl-toggle').onclick = () => { if (!audio.src) return; audio.paused ? audio.play() : audio.pause(); };
$('#pl-back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
$('#pl-fwd').onclick = () => { audio.currentTime = audio.currentTime + 30; };
$('#pl-close').onclick = closePlayer;

$('#player').addEventListener('click', e => {
  if (e.target.closest('button')) return;
  openFull();
});

$('#fp-close').onclick = () => { $('#fullplayer').hidden = true; document.body.classList.remove('fp-open'); };
$('#fp-toggle').onclick = () => { if (!audio.src) return; audio.paused ? audio.play() : audio.pause(); };
$('#fp-back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
$('#fp-fwd').onclick = () => { audio.currentTime = audio.currentTime + 30; };
$('#fp-seek').oninput = e => {
  if (!audio.duration) return;
  audio.currentTime = (Number(e.target.value) / 1000) * audio.duration;
};
$('#fp-rate').onclick = () => {
  rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
  applyRate();
  note('Vitesse ' + (rate === 1 ? 'normale' : String(rate).replace('.', ',') + '×'));
};
$('#fp-sleep').onclick = () => {
  const steps = [0, 15, 30, 45];
  const cur = sleepAt ? Math.round((sleepAt - Date.now()) / 60000) : 0;
  const next = steps.find(s => s > cur) ?? 0;
  clearInterval(sleepTick); sleepTick = null;
  if (!next) { sleepAt = 0; $('#fp-sleep').textContent = 'Minuteur'; note('Minuteur annulé'); return; }
  sleepAt = Date.now() + next * 60000;
  $('#fp-sleep').textContent = next + ' min';
  note('Arrêt dans ' + next + ' minutes');
  startSleepTick();
};
function startSleepTick() {
  clearInterval(sleepTick);
  sleepTick = setInterval(() => {
    if (!sleepAt) { clearInterval(sleepTick); sleepTick = null; return; }
    const left = sleepAt - Date.now();
    if (left <= 0) {
      audio.pause(); sleepAt = 0; clearInterval(sleepTick); sleepTick = null;
      $('#fp-sleep').textContent = 'Minuteur'; note('Lecture arrêtée par le minuteur');
    } else if (left < 60000) {
      $('#fp-sleep').textContent = Math.ceil(left / 1000) + ' s';
    }
  }, 1000);
}

audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0, t = audio.currentTime || 0;
  $('#pl-fill').style.width = d ? `${(t / d) * 100}%` : '0%';
  $('#pl-time').textContent = audioTime(t);
  const fp = $('#fullplayer');
  if (fp && !fp.hidden) {
    $('#fp-cur').textContent = audioTime(t);
    $('#fp-dur').textContent = audioTime(d);
    const pct = d ? (t / d) * 100 : 0;
    if (document.activeElement !== $('#fp-seek')) {
      $('#fp-seek').value = Math.round(pct * 10);
      $('#fp-seek').style.setProperty('--p', pct.toFixed(1) + '%');
    }
  }
  if (Math.floor(t) % 5 === 0) savePosition();
});
window.addEventListener('pagehide', savePosition);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });

$('#pl-bar').addEventListener('click', e => {
  const r = $('.pl-track').getBoundingClientRect();
  if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
});

/* ---------------- favorites ---------------- */
function toggleFav(id) {
  state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
  localStorage.setItem('lmd_favs', JSON.stringify([...state.favs]));
  $$(`[data-fav="${id}"]`).forEach(b => {
    const on = state.favs.has(id);
    b.classList.toggle('on', on);
    b.textContent = on ? '♥' : '♡';
    b.setAttribute('aria-pressed', on);
  });
}

/* ---------------- templates ---------------- */
function card(p, opts = {}) {
  const fav = state.favs.has(p.id);
  return `<article class="card">
    <div class="art">
      ${p.aw ? `<span class="award">${esc(p.aw)}</span>` : ''}
      ${opts.fav === false ? '' : `<button class="fav ${fav ? 'on' : ''}" data-fav="${p.id}" aria-label="Enregistrer ${esc(p.t)}" aria-pressed="${fav}">${fav ? '♥' : '♡'}</button>`}
      <a href="#/p/${encodeURIComponent(p.id)}" aria-label="${esc(p.t)}">
        <img loading="lazy" src="${esc(p.cov)}" alt="" onerror="this.style.opacity=0">
      </a>
    </div>
    <a href="#/p/${encodeURIComponent(p.id)}">
      <h3>${esc(p.t)}</h3>
      <div class="by">${esc(p.by)}</div>
      <div class="meta">${LANGSHORT[p.l] || p.l} · ${esc(p.c)}</div>
    </a>
  </article>`;
}

function epRow(e, p) {
  return `<div class="ep">
    <img class="cv" loading="lazy" src="${esc(p.cov)}" alt="" onerror="this.style.opacity=.15">
    <div class="tx">
      <div class="et">${esc(e.t)}</div>
      <div class="em"><a href="#/p/${encodeURIComponent(p.id)}">${esc(p.t)}</a> · ${fmtDate(e.d)}${e.s ? ' · ' + fmtDur(e.s) : ''}</div>
    </div>
    <button class="play-btn" data-play data-url="${esc(e.a)}" data-title="${esc(e.t)}" data-pod="${esc(p.t)}" data-cover="${esc(p.cov)}" aria-label="Écouter ${esc(e.t)}">▶</button>
  </div>`;
}

/* ---------------- views ---------------- */
function viewHome() {
  const d = state.data;
  const laureats = d.podcasts.filter(p => p.aw);
  const day = Math.floor(Date.now() / 864e5);
  const pick = laureats.length ? laureats[day % laureats.length] : d.podcasts[day % d.podcasts.length];
  const news = d.podcasts.filter(p => {
    if (!p.last) return false;
    const age = (Date.now() - new Date(p.last + 'T12:00:00')) / 864e5;
    return age <= 90 && (p.n || 0) <= 12;
  }).sort((a, b) => (b.last || '').localeCompare(a.last || '')).slice(0, 12);
  const epPool = state.episodes.filter(e => state.epLang === 'all' || e.pod.l === state.epLang);
  const recent = epPool.slice(0, 8);
  const latest = d.podcasts.filter(p => p.last).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 12);

  return `<section class="hero">
    <div class="kicker">Le Meilleur du Podcast · Association Le Meilleur De</div>
    <h1>Annuaire des<br><em>podcasts suisses.</em></h1>
    <p>${d.stats.total.toLocaleString('fr-CH')} podcasts suisses et romands, quatre langues nationales, une seule entrée. Écoutez le dernier épisode, cherchez par langue ou par thème, enregistrez vos favoris.</p>
    <div class="stats">
      <span class="stat"><b>${d.stats.total.toLocaleString('fr-CH')}</b> podcasts</span>
      <span class="stat"><b>${d.stats.episodes.toLocaleString('fr-CH')}</b> épisodes</span>
      <span class="stat"><b>${d.stats.laureats}</b> récompensés</span>
      <span class="stat">MAJ ${esc(d.generated.split('-').reverse().join('.'))}</span>
    </div>
    <form class="searchbar" data-search>
      <input type="search" name="q" placeholder="Chercher un podcast, un producteur, un thème…" aria-label="Rechercher">
      <button type="submit">Chercher</button>
    </form>
  </section>

  <section>
    <div class="sec-head"><h2>Le podcast du jour</h2><a href="#/p/${encodeURIComponent(pick.id)}">Voir la fiche →</a></div>
    <a class="pick" href="#/p/${encodeURIComponent(pick.id)}">
      <img src="${esc(pick.cov)}" alt="" onerror="this.style.opacity=0">
      <div class="txt">
        ${pick.aw ? `<span class="chip red">${esc(pick.aw)}</span>` : ''}
        <h3>${esc(pick.t)}</h3>
        <div class="by">${esc(pick.by)}</div>
        <div class="desc">${esc(pick.d)}</div>
      </div>
    </a>
  </section>

  <section>
    <div class="sec-head"><h2>Derniers épisodes mis en ligne</h2><a href="#/explore?sort=recent">Tout voir →</a></div>
    <div class="filters" role="group" aria-label="Langue des épisodes" style="margin:-4px 0 12px">
      <button class="f ${state.epLang === 'fr' ? 'on' : ''}" data-eplang="fr">Français</button>
      <button class="f ${state.epLang === 'de' ? 'on' : ''}" data-eplang="de">Deutsch</button>
      <button class="f ${state.epLang === 'it' ? 'on' : ''}" data-eplang="it">Italiano</button>
      <button class="f ${state.epLang === 'rm' ? 'on' : ''}" data-eplang="rm">Rumantsch</button>
      <button class="f ${state.epLang === 'all' ? 'on' : ''}" data-eplang="all">Tout</button>
    </div>
    <div class="eplist">
      ${recent.map(e => epRow(e.ep, e.pod)).join('') || '<p class="empty">Aucun épisode daté pour le moment.</p>'}
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>Nouveaux podcasts</h2><a href="#/explore">Explorer →</a></div>
    <div class="rail">${news.map(p => card(p, { fav: false })).join('')}</div>
  </section>

  <section>
    <div class="sec-head"><h2>Récompensés au Meilleur du Podcast</h2><a href="#/explore?award=1">Palmarès →</a></div>
    <div class="rail">${laureats.map(p => card(p, { fav: false })).join('')}</div>
  </section>

  <section>
    <div class="sec-head"><h2>Fraîchement actifs</h2><a href="#/explore?sort=recent">Tout voir →</a></div>
    <div class="rail">${latest.map(p => card(p, { fav: false })).join('')}</div>
  </section>

  <footer class="foot">
    <b>Annuaire des podcasts suisses</b> — un projet de l'association Le Meilleur De, réalisé par <b>breew.com</b>.<br>
    Données issues des flux RSS publics et d'Apple Podcasts. Une correction, un retrait ? <a href="https://www.lemeilleurdupodcast.ch/contact/" target="_blank" rel="noopener">Écrivez-nous</a>.
  </footer>`;
}

function filtered() {
  const q = norm(state.q.trim());
  let list = state.data.podcasts.filter(p => {
    if (state.lang !== 'all' && p.l !== state.lang) return false;
    if (state.cat !== 'all' && p.c !== state.cat) return false;
    if (state.award && !p.aw) return false;
    if (!q) return true;
    return norm(p.t + ' ' + p.by + ' ' + p.c + ' ' + p.d + (p.k ? ' ' + p.k + ' ' + (p.v || '') : '')).includes(q);
  });
  if (state.sort === 'recent') list.sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  else if (state.sort === 'alpha') list.sort((a, b) => a.t.localeCompare(b.t, 'fr'));
  else if (q) list.sort((a, b) => {
    const at = norm(a.t).includes(q) ? 0 : 1, bt = norm(b.t).includes(q) ? 0 : 1;
    return at - bt || (b.last || '').localeCompare(a.last || '');
  });
  else list.sort((a, b) => (b.aw ? 1 : 0) - (a.aw ? 1 : 0) || a.t.localeCompare(b.t, 'fr'));
  return list;
}

function viewExplore() {
  const cats = Object.entries(state.data.stats.categories).sort((a, b) => b[1] - a[1]);
  const list = filtered();
  const shown = list.slice(0, state.shown);
  return `<section>
    <div class="sec-head" style="margin-top:24px"><h2>Explorer</h2><span class="count">${list.length.toLocaleString('fr-CH')} résultat${list.length > 1 ? 's' : ''}</span></div>
    <div class="searchbar">
      <input type="search" id="q" value="${esc(state.q)}" placeholder="Titre, producteur, thème…" aria-label="Rechercher" autocomplete="off">
    </div>
    <div class="filters" role="group" aria-label="Langue">
      <button class="f ${state.lang === 'all' ? 'on' : ''}" data-lang="all">Tout</button>
      ${['fr', 'de', 'it', 'rm', 'en'].map(l => `<button class="f ${state.lang === l ? 'on' : ''}" data-lang="${l}">${LANGS[l]} <span style="opacity:.55">${state.data.stats.langues[l] || 0}</span></button>`).join('')}
    </div>
    <div class="filters scroll" role="group" aria-label="Catégorie" style="margin-top:8px">
      <button class="f ${state.cat === 'all' ? 'on' : ''}" data-cat="all">Toutes catégories</button>
      ${cats.map(([c, n]) => `<button class="f ${state.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)} <span style="opacity:.55">${n}</span></button>`).join('')}
    </div>
    <div class="selects">
      <select id="sort" aria-label="Trier">
        <option value="pertinence" ${state.sort === 'pertinence' ? 'selected' : ''}>Pertinence</option>
        <option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Dernière parution</option>
        <option value="alpha" ${state.sort === 'alpha' ? 'selected' : ''}>A → Z</option>
      </select>
      <button class="f ${state.award ? 'on' : ''}" data-award="1">★ Récompensés</button>
    </div>
    <div class="grid" style="margin-top:20px">
      ${shown.map(p => card(p)).join('')}
    </div>
    ${!list.length ? '<p class="empty">Aucun podcast ne correspond. Essayez un autre mot ou retirez un filtre.</p>' : ''}
    ${list.length > state.shown ? `<button class="more" data-more>Charger la suite (${list.length - state.shown})</button>` : ''}
  </section>`;
}

function viewFiche(id) {
  const p = state.byId[id];
  if (!p) return `<p class="empty">Podcast introuvable.</p>`;
  const fav = state.favs.has(p.id);
  const firstEp = p.eps[0];
  return `<a class="back" href="#/explore">← Retour</a>
  <div class="phead">
    <img src="${esc(p.cov)}" alt="Pochette de ${esc(p.t)}" onerror="this.style.opacity=0">
    <div class="info">
      ${p.aw ? `<span class="chip red">${esc(p.aw)}</span>` : ''}
      <h1>${esc(p.t)}</h1>
      <div class="by">${esc(p.by)}</div>
      <div class="chips">
        <span class="chip">${LANGS[p.l] || p.l}</span>
        <span class="chip">${esc(p.c)}</span>
        ${p.k ? `<span class="chip">${esc(p.k)}${p.v ? ' · ' + esc(p.v) : ''}</span>` : ''}
        ${p.n ? `<span class="chip">${p.n} épisodes</span>` : ''}
        ${p.last ? `<span class="chip">MAJ ${fmtDate(p.last)}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="actions">
    ${firstEp ? `<button class="btn pri" data-play data-url="${esc(firstEp.a)}" data-title="${esc(firstEp.t)}" data-pod="${esc(p.t)}" data-cover="${esc(p.cov)}">▶ Dernier épisode${firstEp.s ? ' · ' + fmtDur(firstEp.s) : ''}</button>` : ''}
    <button class="btn ${fav ? 'on' : ''}" data-fav="${p.id}">${fav ? '♥ Enregistré' : '♡ Enregistrer'}</button>
    ${p.site ? `<a class="btn" href="${esc(p.site)}" target="_blank" rel="noopener">Site</a>` : ''}
    ${p.apple ? `<a class="btn" href="${esc(p.apple)}" target="_blank" rel="noopener">Apple Podcasts</a>` : ''}
    ${p.feed ? `<a class="btn" href="${esc(p.feed)}" target="_blank" rel="noopener">RSS</a>` : ''}
    <button class="btn" data-share="${esc(p.t)}">Partager</button>
  </div>
  <p class="desc">${esc(p.d)}</p>
  <section>
    <div class="sec-head"><h2>Derniers épisodes</h2><span class="count">${p.eps.length ? p.eps.length + ' récents' : ''}</span></div>
    <div class="eplist">${p.eps.map(e => epRow(e, p)).join('') || '<p class="empty">Aucun épisode audio trouvé dans le flux.</p>'}</div>
  </section>
  <footer class="foot">
    Producteur : <b>${esc(p.by)}</b><br>
    Fiche issue de l'annuaire du Meilleur du Podcast · réalisé par <b>breew.com</b>. Demande de correction ou de retrait : <a href="https://www.lemeilleurdupodcast.ch/contact/" target="_blank" rel="noopener">formulaire</a>.
  </footer>`;
}

function viewFavs() {
  const list = state.data.podcasts.filter(p => state.favs.has(p.id));
  return `<section>
    <div class="sec-head" style="margin-top:24px"><h2>Enregistrés</h2><span class="count">${list.length}</span></div>
    ${list.length ? `<div class="grid">${list.map(p => card(p)).join('')}</div>`
      : `<p class="empty">Aucun podcast enregistré. Touchez le ♡ sur une fiche pour le retrouver ici — c'est stocké sur cet appareil, sans compte.</p>`}
  </section>`;
}

/* ---------------- router ---------------- */
function setNav(name) {
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
}

function viewAbout() {
  const d = state.data || {};
  const maj = d.generated ? d.generated.split('-').reverse().join('.') : '';
  const n = (d.count || 1294).toLocaleString('fr-CH');
  return `<a class="back" href="#/">← Retour</a>
  <section>
    <div class="sec-head" style="margin-top:18px"><h2>À propos</h2></div>
    <p class="desc">Cet annuaire recense <b>${n} podcasts suisses</b>, dans les quatre langues nationales. Il est né d'un constat simple : les podcasts de ce pays existent, mais on ne les trouve pas. Les plateformes internationales classent par popularité mondiale ; ici, on classe par langue et par thème, avec une place pour les récompensés du Prix Le Meilleur du Podcast.</p>

    <h3 class="about-h">Qui édite</h3>
    <p class="desc">Un projet de l'association <b>Le Meilleur De</b>, qui produit le podcast <i>Le Meilleur du Podcast</i> et son prix annuel. Réalisation technique : <b>breew.com</b>.</p>

    <h3 class="about-h">D'où viennent les données</h3>
    <p class="desc">Des flux RSS publics des podcasts et du catalogue d'Apple Podcasts : titres, descriptions, pochettes, épisodes. Les podcasts appartiennent à leurs producteurs. Cette application ne réhéberge aucun audio : la lecture se fait depuis le flux de chaque podcast, et chaque fiche renvoie vers son site.</p>
    <p class="desc">Dernière mise à jour des données : <b>${esc(maj)}</b>.</p>

    <h3 class="about-h">Une erreur, un retrait</h3>
    <p class="desc">Une fiche inexacte, un podcast qui n'existe plus, une pochette à retirer ? Écrivez-nous, la correction est traitée à la main.</p>
    <div class="actions" style="margin-top:6px">
      <a class="btn" href="https://www.lemeilleurdupodcast.ch/contact/" target="_blank" rel="noopener">Formulaire de contact</a>
      <a class="btn" href="https://www.lemeilleurdupodcast.ch/annuaire-podcasts-suisses/" target="_blank" rel="noopener">L'annuaire sur le web</a>
    </div>

    <h3 class="about-h">Vos données</h3>
    <p class="desc">Aucun compte, aucune inscription. Les podcasts que vous enregistrez restent <b>sur votre appareil</b> : ils ne sont envoyés nulle part, et disparaissent si vous effacez les données du site. Aucun traçage publicitaire, aucun profilage. Le détail figure dans la <a href="https://www.lemeilleurdupodcast.ch/confidentialite/" target="_blank" rel="noopener">politique de confidentialité</a>.</p>

    <h3 class="about-h">Version</h3>
    <p class="desc">Application web installable, version 1. Fonctionne hors ligne une fois chargée. Sur iPhone : Partager, puis « Sur l'écran d'accueil ».</p>
  </section>
  <footer class="foot">Le Meilleur du Podcast — annuaire des podcasts suisses · <a href="https://breew.com" target="_blank" rel="noopener">breew.com</a></footer>`;
}

function render() {
  const hash = location.hash || '#/';
  const [, route, param] = hash.match(/^#\/([\w-]*)\/?(.*)$/) || [, '', ''];
  const v = $('#view');
  if (route === 'p') { v.innerHTML = viewFiche(decodeURIComponent(param)); setNav('explore'); }
  else if (route === 'explore') { v.innerHTML = viewExplore(); setNav('explore'); }
  else if (route === 'favs') { v.innerHTML = viewFavs(); setNav('favs'); }
  else if (route === 'about') { v.innerHTML = viewAbout(); setNav(''); }
  else { v.innerHTML = viewHome(); setNav('home'); }
  window.scrollTo(0, 0);
}

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-play],[data-fav],[data-lang],[data-cat],[data-award],[data-more],[data-share],[data-eplang]');
  if (!t) return;
  if (t.dataset.play !== undefined) {
    e.preventDefault();
    if (currentEp && currentEp.url === t.dataset.url && !audio.paused) { audio.pause(); }
    else if (currentEp && currentEp.url === t.dataset.url) { audio.play(); }
    else playEpisode(t);
    return;
  }
  if (t.dataset.fav) {
    e.preventDefault(); e.stopPropagation();
    toggleFav(t.dataset.fav);
    if (location.hash.startsWith('#/favs')) render();
    else if (location.hash.startsWith('#/p/')) { const id = decodeURIComponent(location.hash.slice(4)); $('#view').innerHTML = viewFiche(id); }
    return;
  }
  if (t.dataset.eplang) { state.epLang = t.dataset.eplang; render(); return; }
  if (t.dataset.lang) { state.lang = t.dataset.lang; state.shown = 60; render(); return; }
  if (t.dataset.cat) { state.cat = t.dataset.cat; state.shown = 60; render(); return; }
  if (t.dataset.award) { state.award = !state.award; render(); return; }
  if (t.dataset.more !== undefined) { state.shown += 60; render(); return; }
  if (t.dataset.share) {
    const url = location.href;
    if (navigator.share) navigator.share({ title: t.dataset.share, url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => { t.textContent = 'Copié'; });
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    state.q = e.target.value; state.shown = 60;
    const v = $('#view'); const pos = e.target.selectionStart;
    v.innerHTML = viewExplore();
    const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'sort') { state.sort = e.target.value; render(); }
});
document.addEventListener('submit', e => {
  if (e.target.matches('[data-search]')) {
    e.preventDefault();
    state.q = new FormData(e.target).get('q') || '';
    state.shown = 60;
    location.hash = '#/explore';
    if (location.hash === '#/explore') render();
  }
});
window.addEventListener('hashchange', render);

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    const res = await fetch('data.json');
    state.data = await res.json();
    state.data.podcasts.forEach(p => { state.byId[p.id] = p; });
    state.episodes = [];
    state.data.podcasts.forEach(p => p.eps.forEach(ep => { if (ep.d && ep.a) state.episodes.push({ ep, pod: p }); }));
    state.episodes.sort((a, b) => b.ep.d.localeCompare(a.ep.d));
    const params = new URLSearchParams((location.hash.split('?')[1] || ''));
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('award')) state.award = true;
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch (err) {
    $('#view').innerHTML = `<p class="empty">Impossible de charger les données (${esc(err.message)}).</p>`;
  }
})();
