/* ============================================================
   extras.js — cross-cutting conveniences:
     • in-page find (Ctrl/Cmd+F)        • reading-stats modal
     • keyboard-shortcut overlay (?)     • right-click context menu
     • sleep timer                       • shared modal helper
   Exposed as window.Extras; keyboard triggers live in reader.js,
   menu entries in panel.js.
   ============================================================ */
window.Extras = (function () {

  // ---- shared modal -------------------------------------------------------
  let _modal = null;
  function closeModal() { if (_modal) { _modal.remove(); _modal = null; document.removeEventListener('keydown', _modalEsc, true); } }
  function _modalEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } }
  function openModal(title, body) {
    closeModal();
    const card = el('div', { class: 'modal-card' },
      el('button', { class: 'modal-close', text: 'Close', title: 'Close this window', onclick: closeModal }),
      el('h3', { text: title }), body);
    const back = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === back) closeModal(); } }, card);
    document.body.appendChild(back);
    _modal = back;
    document.addEventListener('keydown', _modalEsc, true);
    return back;
  }

  // ---- in-page find -------------------------------------------------------
  let _findBar = null, _hits = [], _hitIdx = -1;
  function clearHits() {
    _hits.forEach(elm => elm.classList.remove('find-hit', 'find-hit-current'));
    _hits = []; _hitIdx = -1;
  }
  function runFind(q) {
    clearHits();
    q = (q || '').trim().toLowerCase();
    const countEl = _findBar && _findBar.querySelector('.find-count');
    if (q.length < 2) { if (countEl) countEl.textContent = ''; return; }
    (App.sentences || []).forEach(s => {
      if (s.el && s.text && s.text.toLowerCase().includes(q)) { s.el.classList.add('find-hit'); _hits.push(s.el); }
    });
    if (countEl) countEl.textContent = _hits.length ? '1/' + _hits.length : '0';
    if (_hits.length) { _hitIdx = 0; markCurrent(); }
  }
  function markCurrent() {
    _hits.forEach((elm, i) => elm.classList.toggle('find-hit-current', i === _hitIdx));
    const cur = _hits[_hitIdx];
    if (cur) cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const countEl = _findBar && _findBar.querySelector('.find-count');
    if (countEl && _hits.length) countEl.textContent = (_hitIdx + 1) + '/' + _hits.length;
  }
  function nextHit(dir) {
    if (!_hits.length) return;
    _hitIdx = (_hitIdx + dir + _hits.length) % _hits.length;
    markCurrent();
  }
  function openFind() {
    if (!App.sentences || !App.sentences.length) { toast('Open a book first'); return; }
    if (_findBar) { _findBar.querySelector('input').focus(); return; }
    const input = el('input', { type: 'text', placeholder: 'Find in book…' });
    const count = el('span', { class: 'find-count' });
    input.addEventListener('input', () => runFind(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nextHit(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    _findBar = el('div', { class: 'find-bar' },
      input, count,
      el('button', { text: '‹', title: 'Previous (Shift+Enter)', onclick: () => nextHit(-1) }),
      el('button', { text: '›', title: 'Next (Enter)', onclick: () => nextHit(1) }),
      el('button', { text: '×', title: 'Close (Esc)', onclick: closeFind }));
    document.body.appendChild(_findBar);
    input.focus();
  }
  function closeFind() { clearHits(); if (_findBar) { _findBar.remove(); _findBar = null; } }

  // ---- keyboard-shortcut overlay -----------------------------------------
  const SHORTCUTS = [
    ['Space', 'Play / pause (or highlight, if enabled)'],
    ['← / →', 'Seek back / forward'],
    ['[ / ]', 'Slower / faster playback'],
    ['H', 'Highlight the current sentence'],
    ['B', 'Bookmark the current position'],
    ['C', 'Copy the current sentence'],
    ['Ctrl/Cmd + F', 'Find in book'],
    ['Ctrl/Cmd + Z / Y', 'Undo / redo'],
    ['Ctrl/Cmd + S', 'Save session'],
    ['Click sentence', 'Highlight (active category)'],
    ['Triple-click', 'Seek audio to that sentence'],
    ['Alt + click', 'Seek audio to that sentence'],
    ['Right-click', 'Sentence context menu'],
    ['?', 'This shortcut list'],
  ];
  function showShortcuts() {
    const rows = SHORTCUTS.map(([k, d]) =>
      el('div', { class: 'kbd-row' }, el('span', {}, el('span', { class: 'kbd', text: k })), el('span', { text: d })));
    openModal('Keyboard shortcuts', el('div', {}, ...rows));
  }

  // ---- reading stats ------------------------------------------------------
  function showStats() {
    const sents = App.sentences || [];
    const bookWords = sents.reduce((n, s) => n + (s.words ? s.words.length : 0), 0);
    const timed = sents.filter(s => s.start != null).length;
    const dur = (App.audio && App.audio.duration) || 0;
    const wpm = dur > 0 ? Math.round(bookWords / (dur / 60)) : null;
    const hlCount = Object.keys(App.highlights || {}).length + (App.wordHighlights || []).length;
    const bmCount = (App.bookmarks || []).length;
    const pos = dur > 0 ? Math.round((App.audio.currentTime / dur) * 100) : 0;
    const name = (App.book && App.book.packaging && App.book.packaging.metadata.title) || (App.meta && App.meta.name) || 'Book';
    const rows = [
      ['Title', name],
      ['Sentences', sents.length.toLocaleString() + (sents.length ? '  (' + timed + ' timed)' : '')],
      ['Words', bookWords.toLocaleString()],
      ['Audio length', dur ? fmtTime(dur) : '—'],
      ['Avg. narration', wpm != null ? wpm + ' wpm' : '—'],
      ['Highlights', String(hlCount)],
      ['Bookmarks', String(bmCount)],
      ['Position', pos + '%'],
    ];
    openModal('Reading stats', el('div', {}, ...rows.map(([k, v]) =>
      el('div', { class: 'stat-row' }, el('span', { text: k }), el('span', { class: 'v', text: v })))));
  }

  // ---- right-click context menu ------------------------------------------
  let _ctx = null;
  function closeCtx() { if (_ctx) { _ctx.remove(); _ctx = null; document.removeEventListener('mousedown', _ctxOutside, true); } }
  function _ctxOutside(e) { if (_ctx && !_ctx.contains(e.target)) closeCtx(); }
  function openContextMenu(x, y, sid) {
    closeCtx();
    const has = !!(App.highlights && App.highlights[sid]);
    const s = (App.sentences || []).find(z => z.sid === sid);
    const items = [];
    items.push(el('button', { text: has ? 'Change highlight…' : 'Highlight as…', onclick: () => { closeCtx(); openCatPicker(sid, x, y); } }));
    if (App.settings.quickHighlight && !has) items.push(el('button', { text: 'Quick highlight (' + (App.settings.activeCategory || 'note') + ')', onclick: () => { closeCtx(); Highlights.setSentence(sid, App.settings.activeCategory || 'note'); } }));
    if (s && s.start != null) items.push(el('button', { text: 'Seek audio here', onclick: () => { closeCtx(); Player.seekToSid(sid); } }));
    if (s && s.start != null) items.push(el('button', { text: 'Bookmark this', onclick: () => { closeCtx(); Highlights.addBookmark(s.start, sid); } }));
    items.push(el('button', { text: 'Copy text', onclick: () => { closeCtx(); copyText(s ? s.text : ''); } }));
    if (has) { items.push(el('div', { class: 'sep' })); items.push(el('button', { text: 'Remove highlight', onclick: () => { closeCtx(); Highlights.removeSentence(sid); } })); }
    _ctx = el('div', { class: 'ctx-menu' }, ...items);
    document.body.appendChild(_ctx);
    const w = _ctx.offsetWidth, h = _ctx.offsetHeight;
    _ctx.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    _ctx.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
    setTimeout(() => document.addEventListener('mousedown', _ctxOutside, true), 0);
  }
  function openCatPicker(sid, x, y) {
    const grid = el('div', { class: 'cat-grid' });
    Highlights.CATS.forEach(c => grid.appendChild(el('button', { class: 'cat-btn', 'data-cat': c.key, style: 'color:' + catContrastColor(c.key), text: c.label, onclick: () => { closePopover(); Highlights.setSentence(sid, c.key); } })));
    openPopover(el('div', {}, el('h4', { text: 'Highlight as' }), grid), { x, y });
  }

  // ---- copy helpers -------------------------------------------------------
  function copyText(txt) {
    if (!txt) { toast('Nothing to copy'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast('Copied'), () => toast('Copy failed'));
    else { const ta = el('textarea', {}); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed'); } ta.remove(); }
  }
  function copyCurrentSentence() {
    const t = (window.Player && Player.curText) || null;
    if (!t) { toast('No sentence playing'); return; }
    copyText(t);
  }

  // ---- sleep timer --------------------------------------------------------
  let _sleepTimer = null;
  function setSleep(min) {
    clearTimeout(_sleepTimer); _sleepTimer = null;
    if (!min || min <= 0) { toast('Sleep timer off'); return; }
    _sleepTimer = setTimeout(() => {
      if (App.audio && !App.audio.paused) App.audio.pause();
      _sleepTimer = null; toast('Sleep timer — paused');
    }, min * 60000);
    toast('Sleep in ' + min + ' min');
  }
  function sleepMenu(anchor) {
    const list = el('div', { class: 'speed-list' });
    [0, 5, 10, 15, 30, 45, 60].forEach(m => list.appendChild(
      el('button', { text: m === 0 ? 'Off' : m + ' min', class: _sleepTimer && m !== 0 ? '' : (m === 0 && !_sleepTimer ? 'is-active' : ''), onclick: () => { closePopover(); setSleep(m); } })));
    openPopover(el('div', {}, el('h4', { text: 'Sleep timer' }), list), anchor);
  }

  // ---- init: right-click on a sentence -----------------------------------
  function init() {
    const reader = $('#reader');
    if (reader) reader.addEventListener('contextmenu', (e) => {
      const sentEl = e.target.closest('.sentence');
      if (!sentEl) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, +sentEl.dataset.sid);
    });
  }
  document.addEventListener('DOMContentLoaded', init);

  return { openFind, closeFind, showShortcuts, showStats, copyCurrentSentence, setSleep, sleepMenu, openContextMenu };
})();
