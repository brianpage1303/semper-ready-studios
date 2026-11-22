/** Device-local state, using the same storage keys as the Android app where they apply. */

export const KEYS = {
  place: 'warrior-wayfinder-place-v1',
  saved: 'warrior-wayfinder-favorites-v2',
  peer: 'homefront-reads-peer-interest-v1',
  theme: 'warrior-wayfinder-theme-v1',
  color: 'warrior-wayfinder-color-theme-v1',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export function loadPlace() {
  return read(KEYS.place, {
    id: 'upstate',
    zip: null,
    source: 'manual',
    choseOnce: false,
    nearLabel: null,
  });
}

export function savePlace(state) {
  write(KEYS.place, state);
}

export function loadSaved() {
  const v = read(KEYS.saved, { articles: [], orgs: [], events: [] });
  return {
    articles: new Set(Array.isArray(v.articles) ? v.articles : []),
    orgs: new Set(Array.isArray(v.orgs) ? v.orgs : []),
    events: new Set(Array.isArray(v.events) ? v.events : []),
  };
}

export function saveSaved(state) {
  write(KEYS.saved, {
    articles: [...state.articles],
    orgs: [...state.orgs],
    events: [...state.events],
  });
}

export function loadPeer() {
  return read(KEYS.peer, null);
}

export function savePeer(record) {
  write(KEYS.peer, record);
}

export function loadTheme() {
  const mode = localStorage.getItem(KEYS.theme) || 'light';
  const color = localStorage.getItem(KEYS.color) || 'B';
  return {
    mode: mode === 'dark' ? 'dark' : 'light',
    color: 'ABCDE'.includes(color) ? color : 'B',
  };
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(KEYS.theme, theme.mode);
    localStorage.setItem(KEYS.color, theme.color);
  } catch {
    /* ignore */
  }
}
