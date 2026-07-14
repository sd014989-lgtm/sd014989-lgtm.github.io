/* ============================================================
   highlights.js — highlighting, notes, undo/redo, save/load/export.
   Interaction model:
     • plain click on a sentence        → category chooser (or edit if already highlighted)
     • drag-select / double-click words → word/phrase highlight chooser
     • click an existing highlight       → note popup (edit note, change category, remove)
     • Alt+click a sentence              → seek audio there (timed sentences only)
   ============================================================ */
window.Highlights = (function () {
  const CATS = [
    { key: 'note',  label: 'Note',      cls: 'hl-note'  },
    { key: 'rule',  label: 'Rule',      cls: 'hl-rule'  },
    { key: 'key',   label: 'Key Point', cls: 'hl-key'   },
    { key: 'never', label: 'Never Do',  cls: 'hl-never' },
  ];
  const CAT_CLASS = { note: 'hl-note', rule: 'hl-rule', key: 'hl-key', never: 'hl-never' };
  let _wid = 0;
  let _clickTimer = null;   // pending single-click action; a following double/triple-click cancels it

  // ---- history ----
  function serialize() { return JSON.stringify({ h: App.highlights, w: App.wordHighlights }); }
  function deserialize(str) { const o = JSON.parse(str); App.highlights = o.h || {}; App.wordHighlights = o.w || []; }
  function pushUndo() {
    App.undoStack.push(serialize());
    if (App.undoStack.length > 60) App.undoStack.shift();
    App.redoStack.length = 0;
  }
  function undo() {
    if (!App.undoStack.length) return toast('Nothing to undo');
    App.redoStack.push(serialize());
    deserialize(App.undoStack.pop());
    applyAll(); Panel.renderHighlights(); markDirty();
  }
  function redo() {
    if (!App.redoStack.length) return toast('Nothing to redo');
    App.undoStack.push(serialize());
    deserialize(App.redoStack.pop());
    applyAll(); Panel.renderHighlights(); markDirty();
  }

  // ---- apply records to DOM ----
  function applyAll() {
    $$('.sentence').forEach(s => { s.classList.remove('hl-note','hl-rule','hl-key','hl-never','has-note'); });
    $$('.word').forEach(w => { w.classList.remove('hl-note','hl-rule','hl-key','hl-never','has-note'); });
    for (const [sid, rec] of Object.entries(App.highlights)) {
      const s = App.sentences.find(x => x.sid === +sid);
      if (s && s.el) { s.el.classList.add(CAT_CLASS[rec.category]); if (rec.note) s.el.classList.add('has-note'); }
    }
    for (const wh of App.wordHighlights) {
      wh.wids.forEach(id => {
        const w = document.querySelector('.word[data-wid="' + id + '"]');
        if (w) { w.classList.add(CAT_CLASS[wh.category]); if (wh.note) w.classList.add('has-note'); }
      });
    }
  }

  // ---- mutations ----
  function setSentence(sid, category) {
    pushUndo();
    App.highlights[sid] = App.highlights[sid] || {};
    App.highlights[sid].category = category;
    if (!('note' in App.highlights[sid])) App.highlights[sid].note = '';
    applyAll(); Panel.renderHighlights(); markDirty();
  }
  function removeSentence(sid) {
    pushUndo(); delete App.highlights[sid];
    applyAll(); Panel.renderHighlights(); markDirty();
  }
  function setSentenceNote(sid, note) {
    pushUndo();
    if (App.highlights[sid]) { App.highlights[sid].note = note; applyAll(); Panel.renderHighlights(); markDirty(); }
  }
  function addWordHighlight(wids, sid, category) {
    pushUndo();
    App.wordHighlights.push({ id: 'w' + (_wid++) + '-' + sid, wids, sid, category, note: '' });
    applyAll(); Panel.renderHighlights(); markDirty();
  }
  function removeWordHighlight(id) {
    pushUndo(); App.wordHighlights = App.wordHighlights.filter(w => w.id !== id);
    applyAll(); Panel.renderHighlights(); markDirty();
  }
  function setWordHighlight(id, patch) {
    pushUndo(); const wh = App.wordHighlights.find(w => w.id === id);
    if (wh) Object.assign(wh, patch);
    applyAll(); Panel.renderHighlights(); markDirty();
  }

  // ---- popovers ----
  function catChooser(onPick, anchor, withRemove) {
    const grid = el('div', { class: 'cat-grid' });
    CATS.forEach(c => grid.appendChild(el('button', { class: 'cat-btn', 'data-cat': c.key, style: 'color:' + catContrastColor(c.key), text: c.label, onclick: () => { closePopover(); onPick(c.key); } })));
    if (withRemove) grid.appendChild(el('button', { class: 'cat-btn remove', text: 'Remove highlight', onclick: () => { closePopover(); onPick(null); } }));
    openPopover(el('div', {}, el('h4', { text: 'Highlight as' }), grid), anchor);
  }

  function sentenceNotePopup(sid, anchor) {
    const rec = App.highlights[sid];
    const area = el('textarea', { class: 'note-area', placeholder: 'Add a note…' }); area.value = rec.note || '';
    const grid = el('div', { class: 'cat-grid' });
    CATS.forEach(c => grid.appendChild(el('button', { class: 'cat-btn' + (rec.category === c.key ? ' is-active' : ''), 'data-cat': c.key, style: 'color:' + catContrastColor(c.key), text: c.label, onclick: () => { setSentence(sid, c.key); } })));
    const actions = el('div', { class: 'pop-actions' },
      el('button', { class: 'primary', text: 'Save note', onclick: () => { setSentenceNote(sid, area.value.trim()); closePopover(); } }),
      el('button', { text: 'Remove', onclick: () => { removeSentence(sid); closePopover(); } }));
    openPopover(el('div', {}, el('h4', { text: 'Highlight' }), grid, area, actions), anchor);
  }

  function wordNotePopup(wh, anchor) {
    const area = el('textarea', { class: 'note-area', placeholder: 'Add a note…' }); area.value = wh.note || '';
    const grid = el('div', { class: 'cat-grid' });
    CATS.forEach(c => grid.appendChild(el('button', { class: 'cat-btn' + (wh.category === c.key ? ' is-active' : ''), 'data-cat': c.key, style: 'color:' + catContrastColor(c.key), text: c.label, onclick: () => setWordHighlight(wh.id, { category: c.key }) })));
    const actions = el('div', { class: 'pop-actions' },
      el('button', { class: 'primary', text: 'Save note', onclick: () => { setWordHighlight(wh.id, { note: area.value.trim() }); closePopover(); } }),
      el('button', { text: 'Remove', onclick: () => { removeWordHighlight(wh.id); closePopover(); } }));
    openPopover(el('div', {}, el('h4', { text: 'Phrase highlight' }), grid, area, actions), anchor);
  }

  // ---- active-category button (lives in the Highlights window footer) ----
  function updateQuickCatBtn() {
    const cat = App.settings.activeCategory || 'note';
    const c = CATS.find(x => x.key === cat) || CATS[0];
    const dot = $('#quickcat-dot');
    const label = $('#quickcat-label');
    if (dot) { dot.className = 'dot ' + cat; }
    if (label) label.textContent = c.label;
  }

  function cycleActiveCategory() {
    const keys = CATS.map(c => c.key);
    const cur = App.settings.activeCategory || 'note';
    const idx = keys.indexOf(cur);
    App.settings.activeCategory = keys[(idx + 1) % keys.length];
    persistSettings();
    updateQuickCatBtn();
  }

  // ---- event wiring ----
  function selectedWords(sel) {
    const words = [];
    if (!sel.rangeCount) return words;
    const range = sel.getRangeAt(0);
    $$('.word').forEach(w => { if (range.intersectsNode(w)) words.push(w); });
    return words;
  }

  function init() {
    const reader = $('#reader');

    const qcBtn = $('#hl-cat-cycle') || $('#btn-quickcat');
    if (qcBtn) qcBtn.addEventListener('click', cycleActiveCategory);
    updateQuickCatBtn();

    // Highlights-window footer (VideoNote parity): highlight the sentence being
    // read right now, highlight + note it, export.
    const addCur = $('#hl-add-current');
    if (addCur) addCur.addEventListener('click', () => {
      const sid = window.Player ? Player.curSid : null;
      if (sid == null) { toast('Nothing is playing — click a sentence instead'); return; }
      setSentence(sid, App.settings.activeCategory || 'note');
    });
    const noteCur = $('#hl-note-current');
    if (noteCur) noteCur.addEventListener('click', () => {
      const sid = window.Player ? Player.curSid : null;
      if (sid == null) { toast('Nothing is playing — click a sentence instead'); return; }
      if (!App.highlights[sid]) setSentence(sid, App.settings.activeCategory || 'note');
      sentenceNotePopup(sid, { x: Math.max(20, window.innerWidth / 2 - 130), y: 120 });
    });
    const exp = $('#hl-export');
    if (exp) exp.addEventListener('click', () => exportMarkdown());

    // mouseup ONLY handles a drag-selection → word/phrase highlight. A drag always
    // reports detail === 1; double/triple clicks (detail 2/3) select text too but are
    // gated out here so they fall through to the click handler's seek/cancel logic.
    reader.addEventListener('mouseup', (e) => {
      if (e.detail !== 1) return;
      const sel = window.getSelection();
      const text = sel.toString();
      if (text && text.trim().length) {
        const words = selectedWords(sel);
        if (words.length) {
          const wids = words.map(w => +w.dataset.wid);
          const sid = +(words[0].closest('.sentence').dataset.sid);
          const anchor = { x: e.clientX, y: e.clientY };
          catChooser((cat) => { if (cat) addWordHighlight(wids, sid, cat); sel.removeAllRanges(); }, anchor);
        }
      }
    });

    // click dispatches by detail. The single-click action is DEFERRED ~250ms so a
    // following double/triple-click can cancel it — otherwise the 1st click of a
    // double-click opens a popup (note editor / category chooser) that then lingers
    // on screen after the 2nd click seeks. See doSentenceClick for the branches.
    //   single-click → deferred highlight / note popup
    //   double/triple-click → cancel the pending single-click, close any popover, seek
    reader.addEventListener('click', (e) => {
      const sentEl = e.target.closest('.sentence');
      if (!sentEl) return;
      const sid = +sentEl.dataset.sid;

      if (e.detail >= 2) {                                         // double / triple → seek
        clearTimeout(_clickTimer); _clickTimer = null;            // cancel the pending single-click
        closePopover();                                           // close a popup a slow 1st-click may have opened
        const s = window.getSelection(); if (s) s.removeAllRanges();
        Player.seekToSid(sid);
        return;
      }

      // detail === 1
      if (e.altKey) { Player.seekToSid(sid); return; }            // intentional → seek immediately
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length) return;            // drag-select handled by mouseup
      const target = e.target, x = e.clientX, y = e.clientY;
      clearTimeout(_clickTimer);
      _clickTimer = setTimeout(() => { _clickTimer = null; doSentenceClick(sid, target, x, y); }, 250);
    });
  }

  function doSentenceClick(sid, target, x, y) {
    // word highlight under cursor → its note popup
    const wordEl = target.closest && target.closest('.word');
    if (wordEl) {
      const wid = +wordEl.dataset.wid;
      const wh = App.wordHighlights.find(h => h.wids.includes(wid));
      if (wh) { wordNotePopup(wh, { x, y }); return; }
    }
    if (App.highlights[sid]) {
      sentenceNotePopup(sid, { x, y });
    } else if (App.settings.quickHighlight) {
      setSentence(sid, App.settings.activeCategory || 'note');
    } else {
      catChooser((cat) => { if (cat) setSentence(sid, cat); }, { x, y });
    }
  }

  // ---- session save / load / export ----
  // Per-book session holds ONLY highlights/notes/position. Appearance settings are
  // global (localStorage), not stored per book.
  function buildSession() {
    return {
      app: 'transcript-studio', version: 3,
      book: App.meta ? (App.meta.id || App.meta.name) : null,
      bookName: App.book && App.book.packaging ? App.book.packaging.metadata.title : (App.meta && App.meta.name),
      highlights: App.highlights,
      wordHighlights: App.wordHighlights,
      bookmarks: App.bookmarks || [],
      position: App.state.position || null,   // { sid, audioTime, percent }
    };
  }

  // ---- bookmarks (audio-position pins, no category) ----
  let _bmId = 0;
  function addBookmark(time, sid, label) {
    if (time == null) return;
    App.bookmarks = App.bookmarks || [];
    App.bookmarks.push({ id: 'bm' + (_bmId++) + '-' + Math.round(time * 1000), time, sid, label: label || '' });
    App.bookmarks.sort((a, b) => a.time - b.time);
    if (window.Player && Player.buildBookmarkMarks) Player.buildBookmarkMarks();
    markDirty(); Panel.renderHighlights();
    toast('Bookmark added');
  }
  function removeBookmark(id) {
    App.bookmarks = (App.bookmarks || []).filter(b => b.id !== id);
    if (window.Player && Player.buildBookmarkMarks) Player.buildBookmarkMarks();
    markDirty(); Panel.renderHighlights();
  }

  function exportJSON() {
    download(((App.meta && App.meta.name) || 'book') + '.session.json', JSON.stringify(buildSession(), null, 2));
    toast('Exported JSON');
  }

  async function save() {
    const sess = buildSession();
    if (App.meta && App.meta.id) {
      try {
        await fetch('/api/book/' + encodeURIComponent(App.meta.id) + '/session', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sess),
        });
        markDirty(false); toast('Session saved to book folder');
        return;
      } catch (e) { /* fall through to download */ }
    }
    download((App.meta && App.meta.name || 'session') + '.session.json', JSON.stringify(sess, null, 2));
    markDirty(false); toast('Session downloaded');
  }

  function loadSession(sess) {
    if (!sess) return;
    App.highlights = sess.highlights || {};
    App.wordHighlights = sess.wordHighlights || [];
    App.bookmarks = sess.bookmarks || [];
    // Advance the id counters past any loaded ids so freshly-created word
    // highlights / bookmarks can never collide with restored ones (which would
    // make remove/edit hit the wrong — or both — records).
    _wid  = App.wordHighlights.reduce((m, w) => Math.max(m, (parseInt(String(w.id).slice(1), 10) || 0) + 1), _wid);
    _bmId = (App.bookmarks || []).reduce((m, b) => Math.max(m, (parseInt(String(b.id).slice(2), 10) || 0) + 1), _bmId);
    // Ignore any legacy per-book `settings`/`mode` (appearance is global now).
    App.state.position = sess.position || null;
    App.undoStack.length = 0; App.redoStack.length = 0;
    applyAll();
    if (window.Player && Player.buildBookmarkMarks) Player.buildBookmarkMarks();
    Panel.renderHighlights(); markDirty(false);
  }

  function exportItems() {
    // unified, ordered list of highlights for export
    const items = [];
    for (const [sid, rec] of Object.entries(App.highlights)) {
      const s = App.sentences.find(x => x.sid === +sid);
      if (s) items.push({ sid: +sid, category: rec.category, note: rec.note, text: s.text, type: s.blockType, time: s.start });
    }
    for (const wh of App.wordHighlights) {
      const s = App.sentences.find(x => x.sid === wh.sid);
      if (!s) continue;   // skip orphaned word highlights (corrupt/stale session) so sort stays sane
      const txt = wh.wids.map(id => { const sw = App.sentences.find(x => x.words.some(w => w.wid === id)); const w = sw && sw.words.find(w => w.wid === id); return w ? w.text : ''; }).join(' ');
      items.push({ id: wh.id, sid: wh.sid, category: wh.category, note: wh.note, text: txt, type: 'phrase', time: s.start });
    }
    items.sort((a, b) => a.sid - b.sid);
    return items;
  }

  function buildMarkdown() {
    const items = exportItems();
    const name = (App.book && App.book.packaging && App.book.packaging.metadata.title) || (App.meta && App.meta.name) || 'Book';
    const LABEL = { note: 'Note', rule: 'Rule', key: 'Key Point', never: 'Never Do' };
    let md = '# Highlights — ' + name + '\n\n';
    if (!items.length) md += '_No highlights yet._\n';
    items.forEach(it => {
      md += '- **[' + LABEL[it.category] + ']** ' + (it.time != null ? '`' + fmtTime(it.time) + '` ' : '`—` ') + it.text + '\n';
      if (it.note) md += '  > ' + it.note.replace(/\n/g, '\n  > ') + '\n';
    });
    return md;
  }
  function exportMarkdown() {
    const name = (App.book && App.book.packaging && App.book.packaging.metadata.title) || (App.meta && App.meta.name) || 'Book';
    download(name + '.highlights.md', buildMarkdown());
    toast('Exported Markdown');
  }
  function exportText() {
    const items = exportItems();
    const LABEL = { note: 'NOTE', rule: 'RULE', key: 'KEY', never: 'NEVER' };
    let txt = '';
    items.forEach(it => { txt += '[' + LABEL[it.category] + '] ' + (it.time != null ? fmtTime(it.time) : '—') + '  ' + it.text + '\n'; if (it.note) txt += '    note: ' + it.note + '\n'; });
    download(((App.meta && App.meta.name) || 'book') + '.highlights.txt', txt);
    toast('Exported text');
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click(); a.remove();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    undo, redo, applyAll, save, loadSession, buildSession, buildMarkdown, exportMarkdown, exportText, exportJSON, exportItems,
    setSentence, removeSentence, setSentenceNote, setWordHighlight, removeWordHighlight,
    addBookmark, removeBookmark,
    CATS, updateQuickCatBtn, cycleActiveCategory,
    focusSid: (sid) => scrollToSid(sid),
  };
})();
