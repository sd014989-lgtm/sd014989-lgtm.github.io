/* ============================================================
   settings.js — global settings + control-placement system,
   ported from VideoNote's schema-driven Settings panel.

   - One schema drives BOTH the ⚙ Settings modal and the optional "pinned"
     quick-controls the user can place in the ribbon or a window's titlebar.
   - Values live on App.settings (the rest of the app already reads them);
     persistence is the existing persistSettings()/ts-settings localStorage.
   - Pin placements live in App.settings.pins { key: 'panel'|'ribbon'|'window' }.
   ============================================================ */
window.SettingsPanel = (function () {
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const CATS = [
    { value: 'note', label: 'Note' }, { value: 'rule', label: 'Rule' },
    { value: 'key', label: 'Key Point' }, { value: 'never', label: 'Never Do' },
  ];

  // Theme options from the research registry (grouped like VideoNote)
  function themeOpts() {
    return Object.values(EXTENDED_THEMES).map(t => ({ value: t.id, label: t.name + ' — ' + t.overall, group: t.group }));
  }

  // Each item: key = App.settings field (or _action). home = window that can
  // host its pinned control ('book' | 'np' | 'hl' | 'toc').
  const SECTIONS = [
    { title: 'Reading', items: [
      { key: 'theme', type: 'select', options: themeOpts, home: 'book',
        label: 'Reading theme',
        short: 'Eye-strain-optimized palette — 24 research-backed themes.',
        note: 'Choose from 24 research-backed palettes in three groups — Dark, In-between/Warm, Light. The number after each name is its comfort/low-strain score (higher is better). Each theme tunes the page, text, the live sentence, the active word, all window chrome and the four category colors together. The Theme button on the Book window opens the full picker with previews and custom colors.',
        apply: v => applyTheme(v) },
      { key: 'readSize', type: 'number', min: 12, max: 32, step: 1, home: 'book',
        label: 'Reading font size',
        short: 'How big the book text is (12–32).',
        note: 'Bigger text is easier to read from a distance but shows less per screen. The Aa button on the Book window has the full typography controls (font, line height, spacing).',
        apply: () => applySettings() },
      { key: 'quickHighlight', type: 'toggle', home: 'book',
        label: 'Click a sentence to highlight it',
        short: 'Single-click adds the sentence to your highlights.',
        note: 'With this on, a single click on any sentence saves it as a highlight in the active category, without moving the audio. Double-click always seeks the audio there. Turn this off to get a category chooser on every click instead.' },
      { key: 'wordHighlight', type: 'select', options: ['off', 'word', 'sweep'], home: 'book',
        label: 'Live word highlight',
        short: 'Highlight the word being spoken. Off, Word chip, or Sweep.',
        note: '"Word" puts a soft box on the exact spoken word (needs word timings from the transcript). "Sweep" glides a soft highlight left-to-right across the live sentence. "Off" leaves only the sentence highlighted. Colors come from the current research theme.' },
      { key: 'autoReturnSec', type: 'number', min: 0, max: 120, step: 5, home: 'book',
        label: 'Auto-return to live sentence (seconds)',
        short: 'After scrolling away, snap back to the playing sentence. 0 = never.',
        note: 'When you browse elsewhere in the book while audio keeps playing, the app waits this long after your last scroll and then returns to the sentence being spoken. Set 0 to stay where you scrolled.' },
      { key: 'autoDayNight', type: 'toggle', home: null,
        label: 'Follow OS light/dark on launch',
        short: 'Match Windows dark mode when the app starts.',
        note: 'On launch, picks your last-used dark theme when Windows is in dark mode and your last-used light theme otherwise.' },
    ]},
    { title: 'Playback', items: [
      { key: 'seekStep', type: 'number', min: 5, max: 60, step: 5, home: 'np',
        label: 'Skip amount (seconds)',
        short: 'How far the ⏮ / ⏭ buttons and ←/→ keys jump.',
        note: 'The skip buttons in the Now Playing window and the arrow keys move the audio by this many seconds. Smaller (5s) is good for catching a missed sentence; larger (30s+) skips sections faster.',
        apply: () => { if (window.Player && Player.updateSeekTooltips) Player.updateSeekTooltips(); } },
      { key: 'defaultRate', type: 'select', options: RATES, home: 'np',
        label: 'Default playback speed',
        short: 'Speed a book starts at when opened.',
        note: 'New audio starts at this speed (1 = normal). You can still change speed live with the speed dropdown in the Now Playing window; this only sets the starting point.',
        apply: v => { if (window.Player && Player.setRate) Player.setRate(v); } },
      { key: 'spaceHighlightsPrev', type: 'toggle', home: null,
        label: 'Spacebar highlights instead of play/pause',
        short: 'Press Space while listening to highlight the current sentence.',
        note: 'While audio plays, Space highlights the sentence being spoken instead of pausing. Turn off to make Space play/pause.' },
      { key: '_sleep', type: 'action', label: 'Sleep timer…',
        short: 'Pause playback automatically after a set time.',
        note: 'Stops the audio after 15/30/45/60 minutes or at the end of the current chapter — for listening in bed.',
        run: () => { if (window.Extras) Extras.sleepMenu({ x: window.innerWidth / 2 - 110, y: 80 }); } },
    ]},
    { title: 'Highlights & Notes', items: [
      { key: 'activeCategory', type: 'select', options: CATS, home: 'hl',
        label: 'Default highlight category',
        short: 'Which category new highlights are filed under.',
        note: 'Every highlight is tagged Note, Rule, Key Point, or Never Do. This sets the active one. You can also cycle it with the category button in the Highlights window.',
        apply: () => { if (window.Highlights && Highlights.updateQuickCatBtn) Highlights.updateQuickCatBtn(); } },
      { key: 'hlAlpha', type: 'number', min: 10, max: 90, step: 5, home: 'hl',
        label: 'Highlight intensity (%)',
        short: 'How strong highlight backgrounds appear (10–90).',
        note: 'Lower = subtler wash of color behind highlighted sentences; higher = bolder. Applies to all four categories.',
        apply: () => applySettings() },
      { key: 'panelSize', type: 'number', min: 11, max: 22, step: 1, home: 'hl',
        label: 'Notes font size',
        short: 'Text size in the Highlights list (11–22).',
        note: 'Controls how big your saved highlights and notes appear in the Highlights window.',
        apply: () => applySettings() },
      { key: '_exportMd', type: 'action', label: 'Export highlights (Markdown)',
        short: 'Save all highlights + notes as a .md file.',
        note: 'A clean, readable Markdown document grouped by category — also written automatically next to the book on every save.',
        run: () => Highlights.exportMarkdown() },
      { key: '_exportTxt', type: 'action', label: 'Export highlights (Text)',
        short: 'Save all highlights + notes as a plain .txt file.',
        note: 'Same content as the Markdown export, without formatting.',
        run: () => Highlights.exportText() },
      { key: '_exportJson', type: 'action', label: 'Export session (JSON)',
        short: 'Save the full session (highlights, notes, bookmarks, position).',
        note: 'A machine-readable backup you can re-load later from the Library screen.',
        run: () => Highlights.exportJSON() },
    ]},
    { title: 'General', items: [
      { key: '_resetLayout', type: 'action', label: 'Reset window layout',
        short: 'Put the Book / Highlights / Now Playing windows back to defaults.',
        note: 'Restores the windows to their original size and position and reopens any you closed.',
        run: () => Panel.resetLayout() },
      { key: '_stats', type: 'action', label: 'Reading stats',
        short: 'Time listened, highlights made, progress.',
        run: () => { close(); if (window.Extras) Extras.showStats(); } },
      { key: '_shortcuts', type: 'action', label: 'Keyboard shortcuts',
        short: 'Every key the app understands.',
        run: () => { close(); if (window.Extras) Extras.showShortcuts(); } },
      { key: '_bookmarks', type: 'action', label: 'Bookmarks…',
        short: 'Jump to saved audio positions (press B to add one).',
        run: () => { close(); Panel.openBookmarksCentered(); } },
    ]},
  ];

  const ITEMS = SECTIONS.flatMap(s => s.items);
  const HOME_LABEL = { book: 'Book', np: 'Now Playing', hl: 'Highlights', toc: 'Contents' };

  let _overlay = null, _body = null;

  function pins() { App.settings.pins = App.settings.pins || {}; return App.settings.pins; }

  function setValue(it, val) {
    App.settings[it.key] = val;
    if (it.apply) { try { it.apply(val); } catch (e) {} }
    persistSettings();
    renderPins();
  }

  // ── Control factories (shared by modal + pins) ──────────────
  function makeControl(it, compact) {
    if (it.type === 'toggle') {
      const on = !!App.settings[it.key];
      const b = el('button', { class: 'set-toggle' + (on ? ' on' : ''), text: on ? 'On' : 'Off' });
      b.addEventListener('click', () => {
        const nv = !App.settings[it.key];
        b.classList.toggle('on', nv); b.textContent = nv ? 'On' : 'Off';
        setValue(it, nv);
      });
      return b;
    }
    if (it.type === 'select') {
      const s = el('select');
      const opts = typeof it.options === 'function' ? it.options() : it.options;
      const objOpts = typeof opts[0] === 'object';
      if (objOpts && opts[0].group !== undefined) {
        const groups = [];
        for (const o of opts) {
          let g = groups.find(x => x.name === (o.group || ''));
          if (!g) { g = { name: o.group || '', items: [] }; groups.push(g); }
          g.items.push(o);
        }
        for (const g of groups) {
          const parent = g.name ? el('optgroup') : s;
          if (g.name) { parent.label = g.name; s.appendChild(parent); }
          for (const o of g.items) {
            const opt = el('option', { value: o.value, text: o.label });
            if (App.settings[it.key] === o.value) opt.selected = true;
            parent.appendChild(opt);
          }
        }
        s.addEventListener('change', () => setValue(it, s.value));
      } else if (objOpts) {
        for (const o of opts) {
          const opt = el('option', { value: o.value, text: o.label });
          if (App.settings[it.key] === o.value) opt.selected = true;
          s.appendChild(opt);
        }
        s.addEventListener('change', () => setValue(it, s.value));
      } else {
        for (const o of opts) {
          const opt = el('option', { value: String(o), text: String(o) });
          if (App.settings[it.key] === o || String(App.settings[it.key]) === String(o)) opt.selected = true;
          s.appendChild(opt);
        }
        const isNum = typeof opts[0] === 'number';
        s.addEventListener('change', () => setValue(it, isNum ? parseFloat(s.value) : s.value));
      }
      return s;
    }
    if (it.type === 'number') {
      const clamp = v => Math.max(it.min, Math.min(it.max, v));
      if (compact) {
        const wrap = el('span', { class: 'pin-step' });
        const dec = el('button', { text: '−' });
        const val = el('span', { text: String(App.settings[it.key]) });
        const inc = el('button', { text: '+' });
        dec.addEventListener('click', () => { const nv = clamp((App.settings[it.key] || 0) - it.step); val.textContent = nv; setValue(it, nv); });
        inc.addEventListener('click', () => { const nv = clamp((App.settings[it.key] || 0) + it.step); val.textContent = nv; setValue(it, nv); });
        wrap.append(dec, val, inc);
        return wrap;
      }
      const n = el('input', { type: 'number' });
      n.min = it.min; n.max = it.max; n.step = it.step; n.value = App.settings[it.key];
      n.addEventListener('change', () => {
        let v = parseFloat(n.value); if (isNaN(v)) v = App.settings[it.key];
        v = clamp(v); n.value = v;
        setValue(it, v);
      });
      return n;
    }
    // action
    const b = el('button', { class: 'tb-btn', text: it.label });
    b.addEventListener('click', () => it.run && it.run());
    return b;
  }

  // ── Pinned quick-controls (ribbon + window titlebars) ───────
  function renderPins() {
    const ribbon = document.getElementById('ribbon-pins');
    if (ribbon) ribbon.innerHTML = '';
    $$('.fw-pins').forEach(p => { p.innerHTML = ''; });
    const P = pins();
    for (const it of ITEMS) {
      if (it.type === 'action') continue;
      const where = P[it.key] || 'panel';
      let host = null;
      if (where === 'ribbon') host = ribbon;
      else if (where === 'window' && it.home) host = document.querySelector('.fw-pins[data-pins="' + it.home + '"]');
      if (!host) continue;
      const ctl = el('span', { class: 'pin-ctl', title: it.label });
      ctl.append(el('span', { class: 'pin-lbl', text: it.label + ':' }), makeControl(it, true));
      host.appendChild(ctl);
    }
  }

  // ── Modal ────────────────────────────────────────────────────
  function buildBody() {
    _body.innerHTML = '';
    for (const sec of SECTIONS) {
      _body.appendChild(el('div', { class: 'set-section-title', text: sec.title }));
      for (const it of sec.items) {
        const row = el('div', { class: 'set-row' });
        const main = el('div', { class: 'set-row-main' },
          el('div', { class: 'set-label', text: it.label }),
          el('div', { class: 'set-short', text: it.short || '' }));
        if (it.type === 'action') {
          row.append(main, makeControl(it, false));
        } else {
          const ctrlWrap = el('div', { class: 'set-control' });
          ctrlWrap.appendChild(makeControl(it, false));
          if (it.home !== undefined) {
            const place = el('select', { class: 'set-place', title: 'Where to show a quick control for this setting' });
            const opts = [['panel', 'Settings only'], ['ribbon', 'Ribbon']];
            if (it.home) opts.push(['window', HOME_LABEL[it.home] + ' window']);
            for (const [v, t] of opts) {
              const o = el('option', { value: v, text: 'Show in: ' + t });
              if ((pins()[it.key] || 'panel') === v) o.selected = true;
              place.appendChild(o);
            }
            place.addEventListener('change', () => { pins()[it.key] = place.value; persistSettings(); renderPins(); });
            ctrlWrap.appendChild(place);
          }
          row.append(main, ctrlWrap);
        }
        if (it.note) {
          const learn = el('button', { class: 'set-learn', text: 'Learn more ▾' });
          const note = el('div', { class: 'set-note', text: it.note });
          learn.addEventListener('click', () => {
            const open = note.classList.toggle('open');
            learn.textContent = open ? 'Learn more ▴' : 'Learn more ▾';
          });
          row.append(learn, note);
        }
        _body.appendChild(row);
      }
    }
  }

  function open()  { buildBody(); _overlay.classList.add('open'); }
  function close() { _overlay.classList.remove('open'); }

  const DEFAULT_RESET = {
    quickHighlight: true, wordHighlight: 'off', autoReturnSec: 0, autoDayNight: false,
    seekStep: 5, defaultRate: 1, spaceHighlightsPrev: false,
    activeCategory: 'note', hlAlpha: 36, panelSize: 15, readSize: 18,
  };

  function init() {
    _overlay = document.getElementById('settings-overlay');
    _body = document.getElementById('settings-body');
    if (!_overlay || !_body) return;
    const sBtn = document.getElementById('btn-settings');
    if (sBtn) sBtn.addEventListener('click', open);
    document.getElementById('settings-close').addEventListener('click', close);
    _overlay.addEventListener('click', e => { if (e.target === _overlay) close(); });
    document.getElementById('settings-reset').addEventListener('click', () => {
      Object.assign(App.settings, DEFAULT_RESET);
      App.settings.pins = {};
      applySettings(); applyTheme(App.settings.theme);
      if (window.Player && Player.updateSeekTooltips) Player.updateSeekTooltips();
      persistSettings(); renderPins(); buildBody();
      toast('Settings reset');
    });
    renderPins();
  }

  return { init, open, close, renderPins };
})();
