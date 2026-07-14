/* ============================================================
   util.js — global state, DOM + text helpers, sentence splitter,
   theming, popover/toast primitives. Loaded first.
   ============================================================ */

// Single shared application state. All modules read/write through App.
window.App = {
  book: null,            // epub.js Book
  meta: null,            // { id, name, audioUrl, ... }
  blocks: [],            // content model (array of block objects)
  sentences: [],         // flat list of sentence objects (the single index system)
  words: [],             // flat list of timed word objects, sorted by start
  transcript: null,      // raw WhisperX transcript.json
  audio: null,           // <audio> element

  state: {
    mode: 'study',
    focus: false,
    dirty: false,
    lastDarkTheme: 'theme-dark-warm',
    lastLightTheme: 'theme-warm-white',
    activeTheme: 'theme-dark-warm',
    pendingCategory: null, // for drag-select highlight color choice
  },

  settings: {
    theme: 'theme-dark-warm',
    custom: { bg: null, fg: null },     // inline color overrides
    customThemes: [null, null, null],   // 3 saved slots {bg, fg, name}
    font: "'Lora', Georgia, serif",
    readSize: 18,
    panelSize: 15,
    line: 1.35,
    wordSpacing: 0,
    letterSpacing: 0,
    sentenceGap: 4,
    // playback
    seekStep: 5,          // arrow-key seek increment (seconds)
    defaultRate: 1,       // playback speed a book starts at
    autoReturnSec: 0,     // 0=off; after manual scroll, return to playing sentence after N s
    wordHighlight: 'off', // 'off' | 'word' | 'sweep'
    // highlights
    activeCategory: 'note',       // default category for quick one-click highlight
    quickHighlight: true,         // single-click uses activeCategory (no chooser)
    spaceHighlightsPrev: false,   // Space highlights current sentence instead of play/pause
    hlAlpha: 36,                  // highlight background strength (%) — intensity slider
    catColors: { note: null, rule: null, key: null, never: null }, // per-user category color overrides
    // floating panels — null = docked; {x,y,w,h} = floating window geometry
    floating: { hl: null, toc: null },
    autoDayNight: false,          // follow OS prefers-color-scheme on launch
    pins: {},                     // settings quick-control placement: key -> 'panel'|'ribbon'|'window'
  },

  highlights: {},        // sid -> { category, note } for sentence highlights
  wordHighlights: [],    // { id, wids:[...], category, note, sid }
  bookmarks: [],         // { id, time, sid, label } — audio position pins (per-book)
  undoStack: [],
  redoStack: [],
};

// ---- DOM helpers ----------------------------------------------------------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const kid of kids) {
    if (kid == null) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

// normalize a token for matching against WhisperX (lowercase, strip punctuation).
// Strip ALL apostrophes so contractions match regardless of how Whisper renders
// them ("it's" ↔ "its", "don't" ↔ "dont") — both sides normalise identically.
function normWord(w) {
  return (w || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---- Tolerant transcript / JSON parsing -----------------------------------
// WhisperX output from assorted tools can arrive with a UTF-8 BOM, as NDJSON
// (one object per line), or truncated mid-write. Recover what we can rather
// than failing outright with "Bad transcript JSON".
function recoverTruncatedJSON(text) {
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  if (!stack.length && !inStr) return null;          // balanced — nothing to fix
  let s = text;
  if (inStr) s += '"';                                // close a dangling string
  s = s.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i];  // close open containers
  return s;
}

function parseJSONTolerant(text) {
  if (text == null) return null;
  text = String(text).replace(/^﻿/, '').trim();   // strip BOM + whitespace
  if (!text) return null;

  try { return JSON.parse(text); } catch (e) {}        // 1. straight parse

  // 2. NDJSON — one JSON object per line
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const objs = [];
    for (const ln of lines) { try { objs.push(JSON.parse(ln)); } catch (e) {} }
    if (objs.length && objs.length >= lines.length * 0.5) {
      if (objs[0] && (objs[0].word !== undefined || objs[0].start !== undefined)) {
        return { word_segments: objs, segments: [] };   // looks like word rows
      }
      return objs;
    }
  }

  // 3. truncated JSON — close open structures and retry
  const recovered = recoverTruncatedJSON(text);
  if (recovered) { try { return JSON.parse(recovered); } catch (e) {} }

  return null;
}

// ---- Sentence splitter ----------------------------------------------------
// RULE: full stop ('.') is the ONLY boundary. Never split on , ! ? : ;
// Abbreviation-aware, decimal-aware, initial-aware, ellipsis-aware.
const ABBR = new Set([
  'mr','mrs','ms','dr','prof','sr','jr','st','vs','etc','inc','ltd','co','corp',
  'no','vol','pp','fig','al','ph','dept','gen','rev','hon','gov','sen','capt',
  'sgt','col','lt','maj','messrs','mt','rd','ave','blvd','approx','est','dist',
  'e.g','i.e','ie','eg','a.m','p.m','u.s','u.k','ph.d','etc.','op','cit','viz',
]);

function splitIntoSentences(text) {
  text = (text || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out = [];
  let start = 0;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    if (text[i] !== '.') continue;

    // collapse an ellipsis run — not a boundary
    let j = i;
    while (j + 1 < n && text[j + 1] === '.') j++;
    if (j > i) { i = j; continue; }

    // decimal: digit . digit
    if (i > 0 && /[0-9]/.test(text[i - 1]) && i + 1 < n && /[0-9]/.test(text[i + 1])) continue;

    // the token ending at this period
    let ws = i;
    while (ws > start && text[ws - 1] !== ' ') ws--;
    const token = text.slice(ws, i).toLowerCase().replace(/[^a-z.]/g, '');
    if (token.length === 1) continue;                 // single-letter initial: "J."
    if (ABBR.has(token)) continue;                    // known abbreviation
    if (ABBR.has(token.replace(/\.$/, ''))) continue; // e.g. "etc"

    // consume trailing closing punctuation that belongs to this sentence
    let end = i + 1;
    while (end < n && /["'”’)\]]/.test(text[end])) end++;

    // boundary requires end-of-text OR space then a sentence-starter (not lowercase)
    if (end >= n) { out.push(text.slice(start, end).trim()); start = end; continue; }
    if (text[end] !== ' ') continue; // e.g. "google.com" — period glued to next
    let k = end + 1;
    while (k < n && text[k] === ' ') k++;
    const next = text[k];
    if (next && /[a-z]/.test(next)) continue;         // lowercase next → not a real boundary

    out.push(text.slice(start, end).trim());
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// ---- Theming --------------------------------------------------------------
function luminance(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return 0.5;
  const [r, g, b] = [m[1], m[2], m[3]].map(h => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Readable text color (#111 or #fff) for a category-colored button, from the
// CURRENT computed --cat-<key> value (hex or rgb()). Keeps the chooser buttons
// legible even when the user picks an unusually dark or light custom color.
function catContrastColor(key) {
  let c = getComputedStyle(document.documentElement).getPropertyValue('--cat-' + key).trim();
  if (c && c[0] !== '#') {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (m) c = '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
  }
  return luminance(c) < 0.5 ? '#fff' : '#111';
}

// Recompute toolbar chrome (dark/light) from the current reading background.
// Research themes carry their own full chrome palette (set by applyTheme);
// this luminance-derived fallback only runs for legacy presets / custom colors.
function applyChrome() {
  const cs = getComputedStyle(document.body);
  const bg = (App.settings.custom.bg) || cs.getPropertyValue('--bg').trim();
  const dark = luminance(cssColorToHex(bg)) < 0.45;
  const root = document.documentElement.style;
  const tc = EXTENDED_THEMES[App.settings.theme];
  const themedChrome = tc && App.settings.custom.bg === tc.bg && !App.settings.custom.fg;
  if (!themedChrome) {
    _CHROME_VARS.forEach(v => root.removeProperty(v));   // back to :root defaults
    if (dark) {
      root.setProperty('--chrome-bg', '#14130d');
      root.setProperty('--chrome-fg', '#e8e2d2');
      root.setProperty('--chrome-line', 'rgba(255,255,255,.10)');
      root.setProperty('--chrome-hover', 'rgba(255,255,255,.07)');
    } else {
      root.setProperty('--chrome-bg', '#f3f1e8');
      root.setProperty('--chrome-fg', '#21201a');
      root.setProperty('--chrome-line', 'rgba(0,0,0,.12)');
      root.setProperty('--chrome-hover', 'rgba(0,0,0,.05)');
    }
  }
  // readable text on accent-colored surfaces (active buttons, play, chips);
  // 0.179 is the WCAG-contrast crossover between white and near-black text
  const accent = cssColorToHex(cs.getPropertyValue('--accent'));
  root.setProperty('--accent-text', luminance(accent) < 0.179 ? '#fff' : '#111');
  const dn = $('#btn-daynight');
  if (dn) {
    dn.textContent = dark ? 'Light' : 'Dark';
    dn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }
}

// The 24 research-backed themes live in themes.js (AUTO-GENERATED from the two
// research reports via VideoNote): EXTENDED_THEMES + THEME_GROUP_ORDER.
// Each has a full reading palette AND a full UI-chrome palette.

const THEME_CLASSES = ['theme-dark-warm','theme-warm-white','theme-sepia','theme-cool-grey','theme-uworld'];
// Reading-pane vars set by extended themes (cleared when switching away).
const _READ_VARS = ['--bg','--fg','--text-dim','--hover-bg','--sent-bg','--sent-text',
  '--word-bg','--word-text','--cat-note','--cat-rule','--cat-key','--cat-never'];
// UI-chrome vars from the per-theme chrome palette (style.css falls back to the
// derived --chrome-* values when these are unset).
const _CHROME_VAR_MAP = {
  chromeBg: '--chrome-bg', chromeFg: '--chrome-fg', chromeLine: '--chrome-line',
  chromeHover: '--chrome-hover', panelBg: '--panel-bg', titlebarBg: '--titlebar-bg',
  btnBg: '--btn-bg', accent: '--accent', accentHover: '--accent-hover',
  textDim: '--ui-text-dim', textMuted: '--ui-text-muted', scrollbar: '--scrollbar-thumb',
  scrim: '--scrim', modalBg: '--modal-bg', modalBorder: '--modal-border',
  hlItemBg: '--hl-item-bg', hlSelBg: '--hl-sel-bg', hlSelBorder: '--hl-sel-border',
};
const _CHROME_VARS = Object.values(_CHROME_VAR_MAP);

function cssColorToHex(c) {
  c = (c || '').trim();
  if (!c || c[0] === '#') return c;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('') : c;
}

function applyTheme(name) {
  THEME_CLASSES.forEach(c => document.body.classList.remove(c));
  App.settings.custom = { bg: null, fg: null };
  const root = document.documentElement.style;
  _READ_VARS.concat(_CHROME_VARS).forEach(v => root.removeProperty(v));

  const tc = EXTENDED_THEMES[name];
  if (tc) {
    root.setProperty('--bg', tc.bg);
    root.setProperty('--fg', tc.fg);
    root.setProperty('--text-dim', tc.textDim);
    root.setProperty('--hover-bg', tc.hoverBg);
    root.setProperty('--sent-bg', tc.sentBg);
    root.setProperty('--sent-text', tc.sentText);
    root.setProperty('--word-bg', tc.wordBg);
    root.setProperty('--word-text', tc.wordText);
    root.setProperty('--cat-note', tc.catNote);
    root.setProperty('--cat-rule', tc.catRule);
    root.setProperty('--cat-key', tc.catKey);
    root.setProperty('--cat-never', tc.catNever);
    const ch = tc.chrome || {};
    for (const k in _CHROME_VAR_MAP) if (ch[k]) root.setProperty(_CHROME_VAR_MAP[k], ch[k]);
    App.settings.custom.bg = tc.bg; // lets applyChrome() & persistSettings() work correctly
  } else {
    if (!THEME_CLASSES.includes(name)) name = THEME_CLASSES[0];  // unknown persisted id
    document.body.classList.add(name);
  }
  document.body.classList.toggle('research-theme', !!tc);
  App.settings.theme = name;
  App.state.activeTheme = name;
  applyChrome();
  const cs = getComputedStyle(document.body);
  const bg = App.settings.custom.bg || cs.getPropertyValue('--bg').trim();
  if (luminance(cssColorToHex(bg)) < 0.45) App.state.lastDarkTheme = name;
  else App.state.lastLightTheme = name;
  applyCatColorOverrides();   // user category-color overrides win over theme defaults
  persistSettings();
  if (window.PopSync) PopSync.pushTheme();
}

function applyCustomColors(bg, fg) {
  const root = document.documentElement.style;
  const tc = EXTENDED_THEMES[App.settings.theme];
  // Bootstrap re-applies the persisted custom bg, which for research themes is
  // the theme's own bg (applyTheme stores it) — nothing to override then.
  if (tc && bg === tc.bg && !fg && !App.settings.custom.fg) return;
  // Legacy presets declare --bg/--fg via a body class, which shadows inline
  // custom values on <html> — pin current colors inline, then drop the class.
  if (THEME_CLASSES.some(c => document.body.classList.contains(c))) {
    const cs = getComputedStyle(document.body);
    root.setProperty('--bg', cs.getPropertyValue('--bg').trim());
    root.setProperty('--fg', cs.getPropertyValue('--fg').trim());
    THEME_CLASSES.forEach(c => document.body.classList.remove(c));
  }
  if (bg) {
    root.setProperty('--bg', bg); App.settings.custom.bg = bg;
    // theme-tied reading surfaces no longer match a custom bg — fall back to
    // the accent-derived defaults
    ['--text-dim','--hover-bg','--sent-bg','--sent-text','--word-bg','--word-text']
      .forEach(v => root.removeProperty(v));
  }
  if (fg) { root.setProperty('--fg', fg); App.settings.custom.fg = fg; }
  applyChrome();
  persistSettings();
  if (window.PopSync) PopSync.pushTheme();
}

// ---- Global settings persistence (localStorage, app-wide, not per-book) ----
function persistSettings() {
  try { localStorage.setItem('ts-settings', JSON.stringify(App.settings)); } catch (e) {}
}
function loadPersistedSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('ts-settings') || 'null');
    if (s && typeof s === 'object') Object.assign(App.settings, s);
  } catch (e) {}
}

// Re-apply per-user category color overrides on top of whatever the theme set.
function applyCatColorOverrides() {
  const r = document.documentElement.style;
  const cc = App.settings.catColors || {};
  ['note', 'rule', 'key', 'never'].forEach(k => { if (cc[k]) r.setProperty('--cat-' + k, cc[k]); });
}

// Apply typography / spacing settings to CSS variables.
function applySettings() {
  const s = App.settings, r = document.documentElement.style;
  r.setProperty('--read-font', s.font);
  r.setProperty('--read-size', s.readSize + 'px');
  r.setProperty('--panel-size', s.panelSize + 'px');
  r.setProperty('--read-line', s.line);
  r.setProperty('--read-word-spacing', s.wordSpacing + 'px');
  r.setProperty('--read-letter-spacing', s.letterSpacing + 'px');
  r.setProperty('--sentence-gap', s.sentenceGap + 'px');
  r.setProperty('--hl-alpha', (s.hlAlpha != null ? s.hlAlpha : 36) + '%');
  applyCatColorOverrides();
  persistSettings();
}

// ---- Popover + toast ------------------------------------------------------
let _activePopover = null;
function closePopover() {
  if (_activePopover) { _activePopover.remove(); _activePopover = null; }
  document.removeEventListener('mousedown', _popOutside, true);
}
function _popOutside(e) {
  if (_activePopover && !_activePopover.contains(e.target) && !e.target.closest('.tb-btn,.sentence,.word,#speed-btn')) {
    closePopover();
  }
}
// anchor: an element to position near, or {x,y}
function openPopover(content, anchor) {
  closePopover();
  const pop = el('div', { class: 'popover' });
  if (typeof content === 'string') pop.innerHTML = content; else pop.appendChild(content);
  document.body.appendChild(pop);
  let x = 100, y = 100;
  if (anchor && anchor.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    x = Math.min(r.left, window.innerWidth - pop.offsetWidth - 12);
    y = r.bottom + 8;
    if (y + pop.offsetHeight > window.innerHeight - 12) y = Math.max(12, r.top - pop.offsetHeight - 8);
  } else if (anchor && 'x' in anchor) {
    x = Math.min(anchor.x, window.innerWidth - pop.offsetWidth - 12);
    y = Math.min(anchor.y, window.innerHeight - pop.offsetHeight - 12);
  }
  pop.style.left = Math.max(12, x) + 'px';
  pop.style.top = Math.max(12, y) + 'px';
  _activePopover = pop;
  setTimeout(() => document.addEventListener('mousedown', _popOutside, true), 0);
  return pop;
}

let _toastTimer = null;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast' }); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function markDirty(v = true) {
  App.state.dirty = v;
  const dot = $('#dirty-dot');
  if (dot) dot.hidden = !v;
  if (v && window.Autosave) Autosave.schedule();   // debounced near-realtime save
}
