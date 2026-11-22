/**
 * Warrior Wayfinder™ web app — a static, client-side port of the Android app.
 * Data: live public feed on GitHub, with a local snapshot fallback.
 * Place, favorites, and Peer Talk interest stay in this browser only.
 */
import { zipPoint, distanceMiles, isValidZip, cleanZipInput, nearestZipFromCoords, isLatLng, milesText } from './geo.js';
import * as store from './store.js';

const FEED_URL = 'https://raw.githubusercontent.com/brianpage1303/warrior-wayfinder-feed/main/feed.json';
const SNAPSHOT_URL = 'data/feed-snapshot.json';
const BUNDLED_URL = 'data/bundled.json';

const NEAR_ME_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'greenville', label: 'Greenville' },
  { id: 'spartanburg', label: 'Spartanburg' },
  { id: 'pickens', label: 'Pickens' },
  { id: 'anderson', label: 'Anderson' },
  { id: 'oconee', label: 'Oconee' },
  { id: 'statewide', label: 'Statewide' },
];
const REGION_CENTER_ZIPS = { greenville: '29601', spartanburg: '29301', pickens: '29671', anderson: '29621', oconee: '29691' };
const ORG_GROUPS = [
  { id: 'local', label: 'Local SC / Upstate' },
  { id: 'posts', label: 'American Legion & VFW' },
  { id: 'statewide', label: 'Statewide' },
  { id: 'national', label: 'National' },
];
const RADIUS_STEPS = [50, 100, 250];
const PEER_CATEGORIES = [
  { id: 'transition', label: 'Transition & civilian life' },
  { id: 'jobs', label: 'Jobs & career' },
  { id: 'family', label: 'Family & relationships' },
  { id: 'housing', label: 'Housing & getting stable' },
  { id: 'women', label: 'Women veterans & spouses' },
  { id: 'mental', label: 'Mental health (peer, not therapy)' },
  { id: 'benefits', label: 'Benefits navigation' },
  { id: 'just-talk', label: 'Just someone who’s been there' },
];
const TABS = [
  { href: '#/home', id: 'home', label: 'Home', icon: 'home' },
  { href: '#/browse', id: 'browse', label: 'Browse', icon: 'grid' },
  { href: '#/orgs', id: 'orgs', label: 'Orgs', icon: 'people' },
  { href: '#/events', id: 'events', label: 'Events', icon: 'calendar' },
  { href: '#/saved', id: 'saved', label: 'Saved', icon: 'bookmark' },
];

const UPSTATE_PLACE = {
  id: 'upstate',
  kind: 'upstate',
  label: 'Upstate South Carolina',
  searchText: 'Upstate South Carolina',
  stateCode: 'SC',
  stateName: 'South Carolina',
  nearMe: 'all',
};

const state = {
  bundled: { topics: [], donateOrgs: [], articles: [], states: [], cities: [] },
  feed: { events: [], organizations: [], vaEvents: [], vaEventsUpdatedAt: null },
  feedSource: 'loading',
  feedError: null,
  place: store.loadPlace(),
  saved: store.loadSaved(),
  theme: store.loadTheme(),
  coords: null,
  radius: 50,
  calendarCursor: null,
};

let placesById = new Map();

function regionLabel(id) {
  return NEAR_ME_CHIPS.find((c) => c.id === id)?.label ?? id;
}
function matchesNearMe(regions, filter) {
  if (filter === 'all') return true;
  if (!regions || !regions.length) return false;
  return regions.includes(filter);
}
function placeTakesZip(place) {
  return place.kind === 'state' || place.kind === 'city';
}
function isCuratedPlace(place) {
  return place.kind === 'upstate' || place.kind === 'locality' || (place.stateCode === 'SC' && place.kind !== 'city');
}

function buildPlaces(bundled) {
  const map = new Map();
  const add = (p) => map.set(p.id, p);
  add(UPSTATE_PLACE);
  for (const l of NEAR_ME_CHIPS.filter((c) => c.id !== 'all')) {
    add({
      id: `locality:${l.id}`,
      kind: 'locality',
      label: l.id === 'statewide' ? 'Statewide South Carolina' : `${l.label}, South Carolina`,
      searchText: l.id === 'statewide' ? 'South Carolina' : `${l.label}, South Carolina`,
      stateCode: 'SC',
      stateName: 'South Carolina',
      nearMe: l.id,
    });
  }
  for (const s of bundled.states) {
    add({
      id: `state:${s.code}`,
      kind: 'state',
      label: s.name,
      searchText: s.code === 'DC' ? 'Washington, DC' : s.name,
      stateCode: s.code,
      stateName: s.code === 'DC' ? 'District of Columbia' : s.name,
    });
  }
  for (const c of bundled.cities) {
    const st = bundled.states.find((s) => s.code === c.state);
    const stateName = st?.name ?? c.state;
    const slug = c.name.toLowerCase().replace(/[.’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    add({
      id: `city:${slug}:${c.state}`,
      kind: 'city',
      label: `${c.name}, ${stateName}`,
      searchText: `${c.name}, ${c.state === 'DC' ? 'DC' : stateName}`,
      stateCode: c.state,
      stateName: c.state === 'DC' ? 'District of Columbia' : stateName,
    });
  }
  placesById = map;
}

function placeById(id) {
  return placesById.get(id) || UPSTATE_PLACE;
}
function placeForStateCode(code) {
  return placesById.get(`state:${code}`) || null;
}
function currentPlace() {
  return placeById(state.place.id);
}
function currentZip() {
  const place = currentPlace();
  return placeTakesZip(place) && isValidZip(state.place.zip || '') ? state.place.zip : null;
}

function persistPlace() {
  store.savePlace(state.place);
}
function persistSaved() {
  store.saveSaved(state.saved);
}

function toggleSave(kind, id) {
  const set = state.saved[kind];
  if (!set) return;
  if (set.has(id)) set.delete(id);
  else set.add(id);
  persistSaved();
}

function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function etDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/* ---------- DOM helpers ---------- */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function byId(id) {
  return document.getElementById(id);
}

/* ---------- Feed / events ---------- */
function areaPoint(place, zip) {
  if (state.coords && isLatLng(state.coords.latitude, state.coords.longitude) && state.place.source === 'gps') {
    return { kind: 'point', point: state.coords, zip: zip || state.place.zip, label: state.place.nearLabel || place.label, fromLocation: true };
  }
  if (zip) {
    const p = zipPoint(zip);
    if (p) return { kind: 'point', point: p, zip, label: zip, fromLocation: false };
  }
  if (place.nearMe && REGION_CENTER_ZIPS[place.nearMe]) {
    const p = zipPoint(REGION_CENTER_ZIPS[place.nearMe]);
    if (p) return { kind: 'point', point: p, zip: REGION_CENTER_ZIPS[place.nearMe], label: place.label, fromLocation: false };
  }
  if (place.kind === 'upstate') {
    const p = zipPoint('29601');
    if (p) return { kind: 'point', point: p, zip: '29601', label: place.label, fromLocation: false };
  }
  if (place.stateCode) return { kind: 'state', stateCode: place.stateCode, label: place.label };
  return { kind: 'none' };
}

function curatedState(e) {
  const m = (e.location || '').match(/,\s*([A-Z]{2})\b(?:\s+\d{5})?/);
  if (m) return m[1];
  return e.region ? 'SC' : null;
}

function eventPoint(e) {
  if (isLatLng(e.lat, e.lng)) return { latitude: e.lat, longitude: e.lng };
  return null;
}

function buildNearbyList({ center, radius, curated, va, today = todayISO() }) {
  const items = [];
  const fits = (point, evState) => {
    if (center.kind === 'point' && point) {
      const miles = distanceMiles(center.point, point);
      return { ok: miles <= radius, miles };
    }
    if (center.kind === 'state') {
      return { ok: evState === center.stateCode, miles: null };
    }
    return { ok: true, miles: null };
  };

  for (const e of curated) {
    if (e.date < today && !e.isRecurring) continue;
    const point = eventPoint(e);
    const { ok, miles } = fits(point, curatedState(e));
    if (!ok) continue;
    items.push({
      id: e.id,
      source: 'curated',
      title: e.title,
      date: e.date,
      time: e.time,
      org: e.orgName,
      where: e.location,
      miles,
      isRecurring: e.isRecurring,
      raw: e,
    });
  }
  for (const e of va) {
    if (e.date < today) continue;
    const point = isLatLng(e.lat, e.lng) ? { latitude: e.lat, longitude: e.lng } : (e.zip ? zipPoint(e.zip) : null);
    const { ok, miles } = fits(point, e.state);
    if (!ok) continue;
    items.push({
      id: e.id,
      source: 'va',
      title: e.title,
      date: e.date,
      endDate: e.endDate,
      time: e.time,
      org: e.sponsor ? `${e.sponsor} · listed by VA` : 'VA outreach event',
      where: e.city ? `${e.city}, ${e.state}` : [e.venue, e.street, e.city, e.state, e.zip].filter(Boolean).join(', '),
      miles,
      raw: e,
    });
  }
  const sortDate = (i) => (i.date < today ? today : i.date);
  return items.sort(
    (a, b) =>
      sortDate(a).localeCompare(sortDate(b)) ||
      (a.miles ?? Number.MAX_VALUE) - (b.miles ?? Number.MAX_VALUE) ||
      a.title.localeCompare(b.title)
  );
}

function daysWithEvents(items, year, monthIndex) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const days = new Set();
  const last = new Date(year, monthIndex + 1, 0).getDate();
  for (const i of items) {
    const start = i.date;
    const end = i.endDate ?? i.date;
    for (let d = 1; d <= last; d++) {
      const iso = `${prefix}-${String(d).padStart(2, '0')}`;
      if (iso >= start && iso <= end) days.add(d);
    }
  }
  return days;
}

function getEventById(id) {
  const curated = state.feed.events.find((e) => e.id === id);
  if (curated) {
    return {
      id: curated.id,
      source: 'curated',
      title: curated.title,
      date: curated.date,
      time: curated.time,
      org: curated.orgName,
      where: curated.location,
      description: curated.description,
      url: curated.url,
      isRecurring: curated.isRecurring,
      raw: curated,
    };
  }
  const va = state.feed.vaEvents.find((e) => e.id === id);
  if (va) {
    return {
      id: va.id,
      source: 'va',
      title: va.title,
      date: va.date,
      endDate: va.endDate,
      time: va.time,
      org: va.sponsor ? `${va.sponsor} · listed by VA` : 'VA outreach event',
      where: va.city ? `${va.city}, ${va.state}` : [va.venue, va.street, va.city, va.state, va.zip].filter(Boolean).join(', '),
      description: va.summary,
      url: va.url,
      raw: va,
    };
  }
  return null;
}

function getOrgById(id) {
  return state.feed.organizations.find((o) => o.id === id) || null;
}

function getArticleById(id) {
  return state.bundled.articles.find((a) => a.id === id) || null;
}

/* ---------- Routing ---------- */
function parseHash() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const path = (pathPart || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const query = {};
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { path: '/' + parts.join('/'), parts, query };
}

function go(hash) {
  if (location.hash === hash) {
    render();
    return;
  }
  location.hash = hash;
  render();
}

const APP_ROUTES = new Set(['home', 'browse', 'orgs', 'events', 'saved', 'place', 'crisis', 'about', 'peer-talk', 'donate', 'article']);

function isAppRoute(parsed) {
  const first = parsed.parts[0];
  return !!first && APP_ROUTES.has(first);
}

/* ---------- Render shell ---------- */
function iconSvg(name) {
  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    people: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
}

function starBtn(kind, id) {
  const on = state.saved[kind]?.has(id);
  return `<button type="button" class="ww-star${on ? ' is-on' : ''}" data-save="${kind}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from saved' : 'Save'}">${on ? '★ Saved' : '☆ Save'}</button>`;
}

function placeChip() {
  const place = currentPlace();
  const zip = currentZip();
  const label = state.place.source === 'gps' && state.place.nearLabel
    ? state.place.nearLabel
    : zip
      ? `${place.label} · ${zip}`
      : place.label;
  return `<a class="ww-place-chip" href="#/place">${esc(label)} · Change</a>`;
}

function applyTheme(inApp) {
  const root = document.documentElement;
  if (inApp) {
    root.dataset.theme = state.theme.color;
    root.dataset.mode = state.theme.mode;
    root.classList.add('boot-app');
  } else {
    delete root.dataset.theme;
    delete root.dataset.mode;
    root.classList.remove('boot-app');
  }
}

function renderShell(activeTab) {
  const marketing = byId('marketing');
  const app = byId('app-root');
  if (marketing) marketing.hidden = false;
  if (!isAppRoute(parseHash())) {
    document.body.classList.remove('in-app');
    if (app) app.hidden = true;
    if (marketing) marketing.hidden = false;
    return false;
  }
  document.body.classList.add('in-app');
  if (marketing) marketing.hidden = true;
  if (app) app.hidden = false;
  const tabs = TABS.map((t) => {
    const current = t.id === activeTab;
    return `<a class="ww-tab${current ? ' is-on' : ''}" href="${t.href}" ${current ? 'aria-current="page"' : ''}>${iconSvg(t.icon)}<span>${t.label}</span></a>`;
  }).join('');
  app.innerHTML = `
    <header class="ww-top">
      <div class="ww-top-row">
        <a class="ww-brand" href="#/home">
          <img src="assets/app-icon.png" width="40" height="40" alt="">
          <span>Warrior Wayfinder™</span>
        </a>
        <a class="btn btn-primary btn-sm" href="#/download-anchor" data-to-download>Download</a>
      </div>
      <nav class="ww-top-nav" aria-label="App">${tabs}</nav>
    </header>
    <div id="app-main" class="ww-main"></div>
    <nav class="ww-tabs" aria-label="Tabs">${tabs}</nav>
    <a class="ww-fab" href="#/crisis" aria-label="Crisis help: Call 988, then press 1"><span>988</span><small>Crisis</small></a>
  `;
  const dl = app.querySelector('[data-to-download]');
  if (dl) {
    dl.addEventListener('click', (e) => {
      e.preventDefault();
      leaveToMarketing('#download');
    });
  }
  return true;
}

function leaveToMarketing(anchor) {
  location.hash = '';
  requestAnimationFrame(() => {
    const el = document.querySelector(anchor);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  });
}

function bindSaveButtons(root) {
  root.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSave(btn.dataset.save, btn.dataset.id);
      render();
    });
  });
}

/* ---------- Screens ---------- */
function renderHome() {
  const articles = state.bundled.articles.filter((a) => a.forYou).slice(0, 6);
  const topics = state.bundled.topics;
  byId('app-main').innerHTML = `
    <p class="eyebrow">Warrior Wayfinder™</p>
    <h1 class="ww-h1">Welcome home.</h1>
    <div class="ww-actions-row">
      <a class="ww-pill sage" href="#/place">Your place</a>
      <a class="ww-pill" href="#/donate">Donate</a>
    </div>
    <div class="ww-welcome">
      <p>Your warm anytime info hub for veterans — short reads, local orgs, events, and next steps. No account needed. Save what helps; come back whenever you need it.</p>
      <p class="ww-place-line">Your place: ${esc(currentPlace().label)}${state.place.source === 'gps' ? ' (from your location)' : ''}.</p>
      ${placeChip()}
    </div>
    <div class="ww-quick">
      <a class="ww-card ww-quick-card" href="#/orgs">
        <span class="feature-icon icon-sage">${iconSvg('people')}</span>
        <strong>Orgs</strong>
        <span>SC &amp; national resources</span>
      </a>
      <a class="ww-card ww-quick-card" href="#/events">
        <span class="feature-icon icon-warm">${iconSvg('calendar')}</span>
        <strong>Events</strong>
        <span>Monthly local calendar</span>
      </a>
    </div>
    <a class="ww-card ww-row-card" href="#/browse?topic=benefits">
      <div><strong>Benefits &amp; discounts</strong><p>State perks, veteran ID, and programs you can open on official sites.</p></div>
      <span aria-hidden="true">›</span>
    </a>
    <a class="ww-card ww-row-card" href="#/peer-talk">
      <div><strong>Find someone to talk to</strong><p>Peer Talk starter — interest signup, not live chat. Crisis help stays one tap away.</p></div>
      <span aria-hidden="true">›</span>
    </a>
    <a class="ww-crisis-link" href="#/crisis">About &amp; crisis help (988)</a>
    <p class="ww-kicker">Topics</p>
    <div class="ww-chips">
      ${topics.map((t) => `<a class="ww-chip" href="#/browse?topic=${esc(t.id)}">${esc(t.label)}</a>`).join('')}
    </div>
    <p class="ww-kicker">For you today</p>
    <div class="ww-list">
      ${articles.map((a) => `<a class="ww-card ww-row-card" href="#/article/${esc(a.id)}"><div><strong>${esc(a.title)}</strong><p>${esc(a.topics.map((id) => state.bundled.topics.find((t) => t.id === id)?.label || id).join(' · '))} · ${a.minutes} min</p></div><span aria-hidden="true">›</span></a>`).join('') || '<p class="muted">No short reads loaded.</p>'}
    </div>
  `;
}

function renderPlace() {
  const place = currentPlace();
  const zip = state.place.zip || '';
  const states = state.bundled.states;
  byId('app-main').innerHTML = `
    <p class="eyebrow">Your place</p>
    <h1 class="ww-h1">Show what’s near you</h1>
    <p>Warrior Wayfinder™ can use a ZIP code or state you enter, or (if you tap the button) your browser’s approximate location. Location is converted to a ZIP and state on this device using a U.S. Census ZIP table — nothing is sent to a mapping service or to us.</p>
    <div class="ww-card ww-stack">
      <p class="ww-place-line">Current: <strong>${esc(state.place.nearLabel || place.label)}</strong>${currentZip() ? ` · ZIP ${esc(currentZip())}` : ''}</p>
      <button type="button" class="btn btn-primary" id="use-location">Use my location</button>
      <p class="muted" id="locate-status" hidden></p>
    </div>
    <div class="ww-card ww-stack">
      <label class="ww-label" for="zip-input">ZIP code</label>
      <input class="ww-input" id="zip-input" inputmode="numeric" maxlength="5" value="${esc(zip)}" placeholder="29601">
      <button type="button" class="btn btn-secondary" id="apply-zip">Use this ZIP</button>
    </div>
    <div class="ww-card ww-stack">
      <label class="ww-label" for="state-input">State or Upstate area</label>
      <select class="ww-input" id="state-input">
        <option value="upstate"${place.id === 'upstate' ? ' selected' : ''}>Upstate South Carolina</option>
        ${NEAR_ME_CHIPS.filter((c) => c.id !== 'all').map((c) => `<option value="locality:${c.id}"${place.id === `locality:${c.id}` ? ' selected' : ''}>${c.id === 'statewide' ? 'Statewide South Carolina' : c.label + ', South Carolina'}</option>`).join('')}
        ${states.map((s) => `<option value="state:${s.code}"${place.id === `state:${s.code}` ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-secondary" id="apply-state">Use this area</button>
    </div>
    <p class="muted">Approximate location only, and only when you ask. Works in the 50 states and DC. You can change this any time.</p>
  `;
  const status = byId('locate-status');
  byId('apply-zip').addEventListener('click', () => {
    const z = cleanZipInput(byId('zip-input').value);
    if (!isValidZip(z)) {
      status.hidden = false;
      status.textContent = 'Enter a complete 5-digit U.S. ZIP.';
      return;
    }
    const pt = zipPoint(z);
    if (!pt) {
      status.hidden = false;
      status.textContent = 'That ZIP isn’t in the Census list. Try a nearby ZIP.';
      return;
    }
    const sp = placeForStateCode(pt.stateCode) || UPSTATE_PLACE;
    state.place = { id: sp.id, zip: z, source: 'manual', choseOnce: true, nearLabel: null };
    state.coords = null;
    persistPlace();
    go('#/home');
  });
  byId('apply-state').addEventListener('click', () => {
    const id = byId('state-input').value;
    state.place = { id, zip: placeTakesZip(placeById(id)) ? state.place.zip : null, source: 'manual', choseOnce: true, nearLabel: null };
    state.coords = null;
    persistPlace();
    go('#/home');
  });
  byId('use-location').addEventListener('click', () => locateMe(status));
}

function locateMe(status) {
  if (!navigator.geolocation) {
    status.hidden = false;
    status.textContent = 'This browser can’t share a location. Enter a ZIP or pick a state instead.';
    return;
  }
  status.hidden = false;
  status.textContent = 'Finding your area…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const near = nearestZipFromCoords(latitude, longitude);
      if (!near || !near.stateCode) {
        status.textContent = 'We couldn’t match that point to a U.S. ZIP. Enter a ZIP or pick a state.';
        return;
      }
      if (!['AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA','WI','WV','WY'].includes(near.stateCode)) {
        status.textContent = 'Warrior Wayfinder™ covers the 50 states and DC. Choose a state or ZIP.';
        return;
      }
      const sp = placeForStateCode(near.stateCode) || UPSTATE_PLACE;
      // If the ZIP is in Upstate SC counties, prefer the county locality when we can; ZIP table has no county, so SC stays the state unless user picks Upstate.
      state.coords = { latitude, longitude };
      state.place = {
        id: near.stateCode === 'SC' ? 'upstate' : sp.id,
        zip: near.stateCode === 'SC' ? null : near.zip,
        source: 'gps',
        choseOnce: true,
        nearLabel: `ZIP ${near.zip}, ${sp.label}`,
      };
      persistPlace();
      go('#/home');
    },
    (err) => {
      status.hidden = false;
      status.textContent =
        err.code === 1
          ? 'No problem — enter a ZIP or pick a state below. You can tap Use my location any time.'
          : 'We couldn’t find your area just now. Enter a ZIP or pick a state, or try again.';
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 }
  );
}

function renderOrgs(parsed) {
  const place = currentPlace();
  const curated = isCuratedPlace(place);
  const q = (parsed.query.q || '').trim().toLowerCase();
  const filter = parsed.query.region || (place.nearMe && place.nearMe !== 'all' ? place.nearMe : 'all');
  let orgs = state.feed.organizations;
  if (curated) orgs = orgs.filter((o) => matchesNearMe(o.regions, filter));
  else orgs = orgs.filter((o) => o.group === 'national');
  if (q) {
    orgs = orgs.filter((o) => `${o.name} ${o.blurb} ${o.region || ''} ${o.address || ''}`.toLowerCase().includes(q));
  }
  const detailId = parsed.parts[1];
  if (detailId) return renderOrgDetail(detailId);

  const chips = curated
    ? `<div class="ww-chips">${NEAR_ME_CHIPS.map((c) => `<a class="ww-chip${filter === c.id ? ' is-on' : ''}" href="#/orgs?region=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ''}">${c.label}</a>`).join('')}</div>`
    : '';

  const zip = currentZip();
  const finders = officialFinders(place, zip);

  let body = '';
  if (curated) {
    body = ORG_GROUPS.map((g) => {
      const list = orgs.filter((o) => o.group === g.id);
      if (!list.length) return '';
      return `<section class="ww-group"><h2>${esc(g.label)}</h2>${list.map(orgCard).join('')}</section>`;
    }).join('') || '<p class="muted">No organizations tagged for this area yet.</p>';
  } else {
    body = `
      <p class="muted">Official finders for ${esc(place.label)}. The curated post list stays Upstate South Carolina — these cards open real sites, with no invented phone numbers. National organizations are listed below.</p>
      ${finders}
      ${orgs.length ? `<section class="ww-group"><h2>National</h2>${orgs.map(orgCard).join('')}</section>` : ''}
    `;
  }

  byId('app-main').innerHTML = `
    <p class="eyebrow">Resources</p>
    <h1 class="ww-h1">Organizations</h1>
    <p class="muted">Trusted SC, Upstate, and national resources. Tap a card for details, or star it to save.</p>
    ${placeChip()}
    <form class="ww-search" id="org-search">
      <label class="visually-hidden" for="org-q">Search organizations</label>
      <input class="ww-input" id="org-q" name="q" type="search" placeholder="Search organizations" value="${esc(parsed.query.q || '')}">
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </form>
    ${chips}
    ${body}
    <p class="muted ww-footnote">${curated
      ? "Links go to each organization’s public homepage, Facebook, or official Legion/VFW listing. Confirm addresses and phones before visiting."
      : 'Other states use official finders, not a made-up national directory. Confirm hours on the site you open. Switch your place back to Upstate South Carolina for the curated list.'}</p>
  `;
  byId('org-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = byId('org-q').value.trim();
    const params = new URLSearchParams();
    if (curated && filter !== 'all') params.set('region', filter);
    if (query) params.set('q', query);
    const s = params.toString();
    go('#/orgs' + (s ? '?' + s : ''));
  });
  bindSaveButtons(byId('app-main'));
}

function orgCard(o) {
  return `<article class="ww-card ww-org-card">
    <a class="ww-card-link" href="#/orgs/${esc(o.id)}">
      <strong>${esc(o.name)}</strong>
      ${o.region ? `<p class="ww-meta">${esc(o.region)}</p>` : ''}
      <p>${esc(o.blurb)}</p>
    </a>
    ${starBtn('orgs', o.id)}
  </article>`;
}

function officialFinders(place, zip) {
  const address = zip || place.searchText;
  const items = [
    { name: 'VA locations', blurb: zip ? `VA hospitals, clinics, and benefits offices near ${zip}.` : 'Official VA facility locator.', url: zip ? `https://www.va.gov/find-locations/?facilityType=health&address=${encodeURIComponent(zip)}` : 'https://www.va.gov/find-locations/' },
    { name: 'VFW post finder', blurb: zip ? `Official VFW post finder with ${zip} filled in.` : 'Find a VFW post. Type your ZIP on their page.', url: zip ? `https://www.vfw.org/find-a-post?zip=${encodeURIComponent(zip)}` : 'https://www.vfw.org/find-a-post' },
    { name: 'American Job Centers', blurb: zip ? `Department of Labor job centers within 25 miles of ${zip}.` : 'Find an American Job Center.', url: zip ? `https://www.careeronestop.org/LocalHelp/AmericanJobCenters/find-american-job-centers.aspx?location=${encodeURIComponent(zip)}&radius=25` : 'https://www.careeronestop.org/LocalHelp/AmericanJobCenters/find-american-job-centers.aspx' },
  ];
  return `<section class="ww-group"><h2>Near ${esc(zip ? `${zip} · ${place.label}` : place.label)}</h2>${items.map((i) => `<a class="ww-card ww-row-card" href="${esc(i.url)}" rel="noopener noreferrer" target="_blank"><div><strong>${esc(i.name)}</strong><p>${esc(i.blurb)}</p></div><span aria-hidden="true">›</span></a>`).join('')}</section>`;
}

function renderOrgDetail(id) {
  const o = getOrgById(id);
  if (!o) {
    byId('app-main').innerHTML = `<p><a href="#/orgs">← Organizations</a></p><p>We couldn’t find that organization.</p>`;
    return;
  }
  const tel = (o.phone || '').replace(/[^\d+]/g, '');
  byId('app-main').innerHTML = `
    <p><a class="ww-back" href="#/orgs">← Organizations</a></p>
    <p class="eyebrow">${esc((ORG_GROUPS.find((g) => g.id === o.group) || {}).label || 'Organization')}</p>
    <h1 class="ww-h1">${esc(o.name)}</h1>
    ${starBtn('orgs', o.id)}
    ${o.region ? `<p class="ww-meta">${esc(o.region)}</p>` : ''}
    <p>${esc(o.blurb)}</p>
    <div class="ww-card ww-stack">
      ${o.address ? `<p><strong>Address</strong><br>${esc(o.address)}</p>` : ''}
      ${o.phone ? `<p><strong>Phone</strong><br><a href="tel:${esc(tel)}">${esc(o.phone)}</a></p>` : ''}
      <p><a class="btn btn-primary" href="${esc(o.url)}" rel="noopener noreferrer" target="_blank">Visit website</a></p>
    </div>
    <p class="muted">Confirm hours, address, and phone on the organization’s own site before you visit or call.</p>
  `;
  bindSaveButtons(byId('app-main'));
}

function renderEvents(parsed) {
  if (parsed.parts[1]) return renderEventDetail(parsed.parts[1]);
  const place = currentPlace();
  const zip = currentZip();
  const center = areaPoint(place, zip);
  const today = todayISO();
  const listed = buildNearbyList({
    center,
    radius: state.radius,
    curated: state.feed.events,
    va: state.feed.vaEvents,
    today,
  });
  const now = state.calendarCursor || new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const marked = daysWithEvents(listed, year, month);
  const selected = parsed.query.day || null;
  const shown = selected ? listed.filter((i) => selected >= i.date && selected <= (i.endDate || i.date)) : listed;
  const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const firstDow = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<span class="ww-cal-empty"></span>';
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const has = marked.has(d);
    const isSel = selected === iso;
    const isToday = iso === today;
    if (has) {
      cells += `<a class="ww-cal-day has-event${isSel ? ' is-on' : ''}${isToday ? ' is-today' : ''}" href="#/events?day=${iso}">${d}</a>`;
    } else {
      cells += `<span class="ww-cal-day${isToday ? ' is-today' : ''}">${d}</span>`;
    }
  }

  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);

  byId('app-main').innerHTML = `
    <p class="eyebrow">Community</p>
    <h1 class="ww-h1">Local events</h1>
    ${placeChip()}
    <p class="muted">${listed.length} coming up${center.kind === 'point' ? ` within ${state.radius} miles` : place.stateCode ? ` in ${esc(place.stateName)}` : ''}.</p>
    ${state.feed.vaEventsUpdatedAt ? `<p class="muted">VA events updated ${esc(state.feed.vaEventsUpdatedAt.slice(0, 10))}.</p>` : ''}
    ${state.feedSource === 'snapshot' ? '<p class="muted">Showing a saved copy of the public feed (taken November 21, 2026) because the live GitHub list could not be reached.</p>' : state.feedSource === 'live' ? '<p class="muted">List loaded from the public Warrior Wayfinder™ feed on GitHub.</p>' : '<p class="muted">The events list could not be loaded just now.</p>'}
    <div class="ww-cal-nav">
      <button type="button" class="btn btn-secondary btn-sm" id="cal-prev" aria-label="Previous month">‹</button>
      <h2 class="ww-cal-title">${esc(monthName)}</h2>
      <button type="button" class="btn btn-secondary btn-sm" id="cal-next" aria-label="Next month">›</button>
    </div>
    <div class="ww-cal">
      <div class="ww-cal-dow">${['S','M','T','W','T','F','S'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="ww-cal-grid">${cells}</div>
    </div>
    ${selected ? `<p><a href="#/events">Show all upcoming</a> · ${esc(selected)}</p>` : ''}
    <div class="ww-radius">
      ${RADIUS_STEPS.filter((r) => r > state.radius).map((r) => `<button type="button" class="ww-chip" data-radius="${r}">Show within ${r} miles</button>`).join('')}
      ${state.radius > 50 ? `<button type="button" class="ww-chip" data-radius="50">Back to 50 miles</button>` : ''}
    </div>
    <div class="ww-list" id="event-list">
      ${shown.map(eventCard).join('') || `<p class="muted">${selected ? 'No events listed on this day.' : 'No upcoming events in this range right now. Try a wider radius or another place.'}</p>`}
    </div>
    <p class="muted ww-footnote">Always confirm dates, RSVP, and access details on the organizer’s site before you travel.</p>
  `;
  byId('cal-prev').addEventListener('click', () => { state.calendarCursor = prev; render(); });
  byId('cal-next').addEventListener('click', () => { state.calendarCursor = next; render(); });
  byId('app-main').querySelectorAll('[data-radius]').forEach((b) => {
    b.addEventListener('click', () => { state.radius = Number(b.dataset.radius); render(); });
  });
  bindSaveButtons(byId('app-main'));
}

function eventCard(e) {
  const miles = milesText(e.miles);
  return `<article class="ww-card ww-org-card">
    <a class="ww-card-link" href="#/events/${esc(e.id)}">
      <p class="ww-meta">${esc(e.date)}${e.time ? ' · ' + esc(e.time) : ''}${miles ? ' · ' + esc(miles) : ''}${e.source === 'va' ? ' · VA' : ''}${e.isRecurring ? ' · Recurring' : ''}</p>
      <strong>${esc(e.title)}</strong>
      <p>${esc(e.org)}${e.where ? ' · ' + esc(e.where) : ''}</p>
    </a>
    ${starBtn('events', e.id)}
  </article>`;
}

function renderEventDetail(id) {
  const e = getEventById(id);
  if (!e) {
    byId('app-main').innerHTML = `<p><a href="#/events">← Events</a></p><p>We couldn’t find that event.</p>`;
    return;
  }
  byId('app-main').innerHTML = `
    <p><a class="ww-back" href="#/events">← Events</a></p>
    <p class="eyebrow">${e.source === 'va' ? 'VA outreach event' : 'Verified local event'}</p>
    <h1 class="ww-h1">${esc(e.title)}</h1>
    ${starBtn('events', e.id)}
    <div class="ww-card ww-stack">
      <p><strong>Date</strong><br>${esc(e.date)}${e.endDate && e.endDate !== e.date ? ' – ' + esc(e.endDate) : ''}</p>
      ${e.time ? `<p><strong>Time</strong><br>${esc(e.time)}</p>` : ''}
      ${e.where ? `<p><strong>Location</strong><br>${esc(e.where)}</p>` : ''}
      <p><strong>Organizer</strong><br>${esc(e.org)}</p>
    </div>
    ${e.description ? `<p>${esc(e.description)}</p>` : ''}
    <div class="hero-actions">
      ${e.url ? `<a class="btn btn-primary" href="${esc(e.url)}" rel="noopener noreferrer" target="_blank">Event page</a>` : ''}
      <button type="button" class="btn btn-secondary" id="ics-btn">Add to calendar</button>
    </div>
    <p class="muted">Always confirm dates, RSVP, and access details on the organizer’s site before you travel.</p>
  `;
  byId('ics-btn').addEventListener('click', () => downloadIcs(e));
  bindSaveButtons(byId('app-main'));
}

function downloadIcs(e) {
  const stamp = e.date.replace(/-/g, '');
  const uid = `${e.id}@semper-ready-studios`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Semper Ready Studios//Warrior Wayfinder//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}T000000Z`,
    `DTSTART;VALUE=DATE:${stamp}`,
    e.endDate ? `DTEND;VALUE=DATE:${e.endDate.replace(/-/g, '')}` : '',
    `SUMMARY:${(e.title || '').replace(/\n/g, ' ')}`,
    e.where ? `LOCATION:${(e.where || '').replace(/\n/g, ' ')}` : '',
    e.url ? `URL:${e.url}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(e.title || 'event').slice(0, 40).replace(/[^\w]+/g, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderBrowse(parsed) {
  const q = (parsed.query.q || '').trim();
  const topic = parsed.query.topic || '';
  const topics = state.bundled.topics;
  const qLower = q.toLowerCase();

  let articles = state.bundled.articles;
  if (topic) articles = articles.filter((a) => a.topics.includes(topic));
  if (qLower) {
    articles = articles.filter((a) =>
      `${a.title} ${a.why} ${a.source} ${(a.body || []).join(' ')}`.toLowerCase().includes(qLower)
    );
  }
  let orgs = state.feed.organizations;
  let events = [...state.feed.events, ...state.feed.vaEvents];
  if (qLower) {
    orgs = orgs.filter((o) => `${o.name} ${o.blurb} ${o.region || ''}`.toLowerCase().includes(qLower));
    events = events.filter((e) => `${e.title || ''} ${e.orgName || e.sponsor || ''} ${e.location || e.city || ''} ${e.description || e.summary || ''}`.toLowerCase().includes(qLower));
  } else {
    orgs = [];
    events = [];
  }

  byId('app-main').innerHTML = `
    <p class="eyebrow">Explore</p>
    <h1 class="ww-h1">Browse topics</h1>
    <form class="ww-search" id="browse-search">
      <label class="visually-hidden" for="browse-q">Search orgs, events, and short reads</label>
      <input class="ww-input" id="browse-q" type="search" placeholder="Search orgs, events, and short reads" value="${esc(q)}" autofocus>
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </form>
    <div class="ww-chips">
      <a class="ww-chip${!topic ? ' is-on' : ''}" href="#/browse${q ? '?q=' + encodeURIComponent(q) : ''}">All</a>
      ${topics.map((t) => {
        const params = new URLSearchParams();
        params.set('topic', t.id);
        if (q) params.set('q', q);
        return `<a class="ww-chip${topic === t.id ? ' is-on' : ''}" href="#/browse?${params}">${esc(t.label)}</a>`;
      }).join('')}
    </div>
    ${q ? `<p class="muted">${articles.length + orgs.length + events.length} result${articles.length + orgs.length + events.length === 1 ? '' : 's'} for “${esc(q)}”.</p>` : ''}
    ${orgs.length ? `<h2>Organizations</h2>${orgs.slice(0, 20).map(orgCard).join('')}` : ''}
    ${events.length ? `<h2>Events</h2>${events.slice(0, 20).map((e) => eventCard({
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.time,
      org: e.orgName || e.sponsor || (e.id && String(e.id).startsWith('va') ? 'VA' : ''),
      where: e.location || (e.city ? `${e.city}, ${e.state}` : ''),
      miles: null,
      source: e.orgName ? 'curated' : 'va',
    })).join('')}` : ''}
    <h2>${topic ? esc((topics.find((t) => t.id === topic) || {}).label || 'Reads') : 'Short reads'}</h2>
    <div class="ww-list">
      ${articles.map((a) => `<a class="ww-card ww-row-card" href="#/article/${esc(a.id)}"><div><strong>${esc(a.title)}</strong><p>${esc(a.why || a.source)} · ${a.minutes} min</p></div><span aria-hidden="true">›</span></a>`).join('') || '<p class="muted">No short reads match that search.</p>'}
    </div>
  `;
  byId('browse-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = byId('browse-q').value.trim();
    const params = new URLSearchParams();
    if (topic) params.set('topic', topic);
    if (query) params.set('q', query);
    const s = params.toString();
    go('#/browse' + (s ? '?' + s : ''));
  });
  bindSaveButtons(byId('app-main'));
}

function renderArticle(id) {
  const a = getArticleById(id);
  if (!a) {
    byId('app-main').innerHTML = `<p><a href="#/browse">← Browse</a></p><p>We couldn’t find that read.</p>`;
    return;
  }
  byId('app-main').innerHTML = `
    <p><a class="ww-back" href="#/browse">← Browse</a></p>
    <p class="eyebrow">${esc((a.topics || []).map((id) => state.bundled.topics.find((t) => t.id === id)?.label || id).join(' · '))}</p>
    <h1 class="ww-h1">${esc(a.title)}</h1>
    ${starBtn('articles', a.id)}
    <p class="muted">${esc(a.source)}${a.published ? ' · ' + esc(a.published) : ''} · ${a.minutes} min</p>
    ${a.why ? `<p><em>${esc(a.why)}</em></p>` : ''}
    ${(a.body || []).map((p) => `<p>${esc(p)}</p>`).join('')}
    ${a.url ? `<p><a class="btn btn-primary" href="${esc(a.url)}" rel="noopener noreferrer" target="_blank">Read the full article</a></p>` : '<p class="muted">This short read is original Warrior Wayfinder™ material, not a reprint of another site.</p>'}
  `;
  bindSaveButtons(byId('app-main'));
}

function renderCrisis() {
  byId('app-main').innerHTML = `
    <p class="eyebrow">Mission &amp; help</p>
    <h1 class="ww-h1">About &amp; crisis help</h1>
    <div class="ww-crisis-card">
      <h2>Need support right now?</h2>
      <p>If you or a veteran you know is in crisis, reach out. Confidential help is available 24/7.</p>
      <a class="btn btn-crisis" href="tel:988">Call 988, then press 1<br><small>Veterans Crisis Line</small></a>
      <p>Or text <a href="sms:838255">838255</a> · Chat at <a href="https://www.veteranscrisisline.net/" rel="noopener noreferrer" target="_blank">veteranscrisisline.net</a><br>If this is a life-threatening emergency, call <a href="tel:911">911</a>.</p>
    </div>
    <h2>Look</h2>
    <p class="muted">Current: ${esc({ A: 'Navy + Gold', B: 'Cream + Navy', C: 'Forest + Cream', D: 'Charcoal + Copper', E: 'Slate + Sky' }[state.theme.color])} · ${state.theme.mode === 'dark' ? 'Dark' : 'Light'} mode. Saved on this device.</p>
    <div class="ww-chips" id="theme-colors">
      ${['A','B','C','D','E'].map((id) => `<button type="button" class="ww-chip${state.theme.color === id ? ' is-on' : ''}" data-color="${id}">${esc({ A: 'Navy+Gold', B: 'Cream+Navy', C: 'Forest+Cream', D: 'Charcoal+Copper', E: 'Slate+Sky' }[id])}</button>`).join('')}
    </div>
    <button type="button" class="btn btn-secondary" id="toggle-dark">${state.theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</button>
    <h2>Our mission</h2>
    <p>Warrior Wayfinder™ is a warm anytime info hub for veterans — especially those transitioning to civilian life. We curate short, practical pieces so you can find clarity, camaraderie, and next steps without an account or a clinical vibe.</p>
    <h2>Partner organizations</h2>
    <div class="ww-list">
      ${state.bundled.donateOrgs.map((o) => `<div class="ww-card"><strong>${esc(o.name)}</strong><p class="ww-meta">${esc(o.location)}</p></div>`).join('')}
    </div>
    <p><a class="btn btn-primary" href="#/donate">Support a partner</a></p>
    <p class="muted">No accounts, no ads, and no personal data sold. Your location stays on this device. Read the <a href="privacy.html">privacy policy</a>.</p>
  `;
  byId('toggle-dark').addEventListener('click', () => {
    state.theme.mode = state.theme.mode === 'dark' ? 'light' : 'dark';
    store.saveTheme(state.theme);
    applyTheme(true);
    render();
  });
  byId('theme-colors').querySelectorAll('[data-color]').forEach((b) => {
    b.addEventListener('click', () => {
      state.theme.color = b.dataset.color;
      store.saveTheme(state.theme);
      applyTheme();
      render();
    });
  });
}

function renderDonate() {
  byId('app-main').innerHTML = `
    <p><a class="ww-back" href="#/home">← Home</a></p>
    <p class="eyebrow">Give locally</p>
    <h1 class="ww-h1">Where should your gift go?</h1>
    <p>Pick a South Carolina partner. Each gift goes straight to their site — Warrior Wayfinder™ never handles your payment.</p>
    ${state.bundled.donateOrgs.map((o) => `
      <article class="ww-card ww-stack">
        <strong>${esc(o.name)}</strong>
        <p class="ww-meta">${esc(o.location)}</p>
        <p>${esc(o.blurb)}</p>
        <p><a class="btn btn-primary" href="${esc(o.url)}" rel="noopener noreferrer" target="_blank">Continue to ${esc(o.name)}</a></p>
      </article>`).join('')}
  `;
}

function renderSaved() {
  const orgs = [...state.saved.orgs].map(getOrgById).filter(Boolean);
  const articles = [...state.saved.articles].map(getArticleById).filter(Boolean);
  const events = [...state.saved.events].map(getEventById).filter(Boolean);
  byId('app-main').innerHTML = `
    <p class="eyebrow">Favorites</p>
    <h1 class="ww-h1">Saved</h1>
    <p class="muted">Saved on this device only. Nothing you star is sent to us.</p>
    <h2>Organizations</h2>
    ${orgs.map(orgCard).join('') || '<p class="muted">No saved organizations yet.</p>'}
    <h2>Events</h2>
    ${events.map((e) => eventCard({ ...e, miles: null })).join('') || '<p class="muted">No saved events yet.</p>'}
    <h2>Short reads</h2>
    <div class="ww-list">
      ${articles.map((a) => `<a class="ww-card ww-row-card" href="#/article/${esc(a.id)}"><div><strong>${esc(a.title)}</strong><p>${a.minutes} min</p></div><span aria-hidden="true">›</span></a>`).join('') || '<p class="muted">No saved reads yet.</p>'}
    </div>
  `;
  bindSaveButtons(byId('app-main'));
}

function renderPeerTalk() {
  const saved = store.loadPeer();
  const selected = new Set(saved?.categories || []);
  byId('app-main').innerHTML = `
    <p class="eyebrow">Coming soon</p>
    <h1 class="ww-h1">Peer Talk</h1>
    <p>Peer Talk is not live matching or chat yet. If you’d like to be notified later, you can save an interest form <strong>on this device only</strong>. It is not emailed or sent anywhere.</p>
    <div class="ww-crisis-card">
      <p>If you need to talk now, crisis help is one tap away.</p>
      <a class="btn btn-crisis" href="tel:988">Call 988, then press 1</a>
    </div>
    <form id="peer-form" class="ww-card ww-stack">
      <p class="ww-label">Topics</p>
      <div class="ww-chips">
        ${PEER_CATEGORIES.map((c) => `
          <label class="ww-chip${selected.has(c.id) ? ' is-on' : ''}">
            <input type="checkbox" name="cat" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''}> ${esc(c.label)}
          </label>`).join('')}
      </div>
      <label class="ww-label" for="peer-name">Name (optional)</label>
      <input class="ww-input" id="peer-name" value="${esc(saved?.name || '')}">
      <label class="ww-label" for="peer-email">Email (optional)</label>
      <input class="ww-input" id="peer-email" type="email" value="${esc(saved?.email || '')}">
      <label class="ww-label" for="peer-note">Note (optional)</label>
      <textarea class="ww-input" id="peer-note" rows="3">${esc(saved?.note || '')}</textarea>
      <button class="btn btn-primary" type="submit">Save interest on this device</button>
      <p class="muted" id="peer-status">${saved ? 'Interest already saved on this device.' : ''}</p>
    </form>
  `;
  const form = byId('peer-form');
  form.querySelectorAll('input[name=cat]').forEach((box) => {
    box.addEventListener('change', () => {
      box.parentElement.classList.toggle('is-on', box.checked);
    });
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const categories = [...form.querySelectorAll('input[name=cat]:checked')].map((i) => i.value);
    const status = byId('peer-status');
    if (!categories.length) {
      status.textContent = 'Choose at least one area you’d like peer connection around.';
      return;
    }
    const email = byId('peer-email').value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status.textContent = 'That email does not look valid. Leave it blank or fix it.';
      return;
    }
    store.savePeer({
      name: byId('peer-name').value.trim() || undefined,
      email: email || undefined,
      categories,
      note: byId('peer-note').value.trim() || undefined,
      savedAt: new Date().toISOString(),
    });
    status.textContent = 'Thanks — Peer Talk is coming soon. We saved your interest on this device. This is not live matching or chat.';
  });
}

/* ---------- Router ---------- */
function render() {
  const parsed = parseHash();
  const inApp = isAppRoute(parsed);
  applyTheme(inApp);
  const first = parsed.parts[0] || '';
  const tab = ['home', 'browse', 'orgs', 'events', 'saved'].includes(first)
    ? first
    : first === 'article'
      ? 'browse'
      : first === 'place' || first === 'donate' || first === 'peer-talk' || first === 'crisis' || first === 'about'
        ? 'home'
        : '';

  if (!isAppRoute(parsed)) {
    renderShell();
    return;
  }
  if (!renderShell(tab)) return;
  const mainNeeded = byId('app-main');
  if (!mainNeeded) return;
  switch (first) {
    case 'home': renderHome(); break;
    case 'place': renderPlace(); break;
    case 'orgs': renderOrgs(parsed); break;
    case 'events': renderEvents(parsed); break;
    case 'browse': renderBrowse(parsed); break;
    case 'article': renderArticle(parsed.parts[1]); break;
    case 'crisis':
    case 'about': renderCrisis(); break;
    case 'donate': renderDonate(); break;
    case 'saved': renderSaved(); break;
    case 'peer-talk': renderPeerTalk(); break;
    default: renderHome();
  }
}

async function loadFeed() {
  const day = etDate();
  const urls = [`${FEED_URL}?d=${day}`, SNAPSHOT_URL];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || !Array.isArray(data.organizations)) continue;
      state.feed.events = Array.isArray(data.events) ? data.events : [];
      state.feed.organizations = data.organizations;
      state.feed.vaEvents = Array.isArray(data.vaEvents) ? data.vaEvents : [];
      state.feed.vaEventsUpdatedAt = data.vaEventsUpdatedAt || data.generatedAt || null;
      state.feedSource = url.startsWith('http') ? 'live' : 'snapshot';
      state.feedError = null;
      return;
    } catch (err) {
      state.feedError = String(err);
    }
  }
  state.feedSource = 'none';
}

function redirectLegacyHash() {
  const map = { '#orgs': '#/orgs', '#events': '#/events', '#browse': '#/browse' };
  if (map[location.hash]) {
    location.replace(location.pathname + location.search + map[location.hash]);
    return true;
  }
  return false;
}

async function init() {
  if (redirectLegacyHash()) return;
  try {
    const res = await fetch(BUNDLED_URL);
    state.bundled = await res.json();
    buildPlaces(state.bundled);
  } catch (err) {
    console.error('Failed to load bundled data', err);
  }
  await loadFeed();
  window.addEventListener('hashchange', () => {
    if (redirectLegacyHash()) return;
    if (isAppRoute(parseHash())) window.scrollTo(0, 0);
    render();
  });
  render();
}

init();
