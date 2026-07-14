/* ============================================================
   panel.js — TOC (left), highlights panel (right), resizers,
   reading-controls / theme / menu popovers, chapter markers.
   ============================================================ */
window.Panel = (function () {
  let hlTab = 'order';
  let _activeChapterIdx = -1;

  // Light up the TOC row for the chapter the playhead is currently inside.
  // Called every tick from audio.js; only touches the DOM when the chapter changes.
  function updateActiveChapter(t) {
    if (!App.chapters || !App.chapters.length) return;
    let idx = -1;
    for (let i = 0; i < App.chapters.length; i++) {
      const st = App.chapters[i].start;
      if (st != null && st <= t) idx = i;
    }
    if (idx === _activeChapterIdx) return;
    _activeChapterIdx = idx;
    const list = $('#toc-list');
    if (!list) return;
    list.querySelectorAll('.toc-row.is-active').forEach(r => r.classList.remove('is-active'));
    if (idx >= 0) {
      const row = list.querySelector('.toc-row[data-chapter-idx="' + idx + '"]');
      if (row) {
        row.classList.add('is-active');
        const item = row.closest('.toc-item');
        if (item) item.classList.add('open');                  // reveal its sub-chapters
        const panel = $('#toc-panel');
        if (panel && !panel.hidden) row.scrollIntoView({ block: 'nearest' });  // keep it in view
      }
    }
  }

  // ---- panels open/close + resize ----
  function toggle(which, show) {
    const windowed = document.body.classList.contains('windowed');
    if (windowed && (which === 'hl' || which === 'toc' || which === 'np')) {
      const p = panelFor(which); if (!p) return;
      const willShow = show === undefined ? p.hidden : show;
      if (willShow) showWin(which); else hideWin(which);
      return;
    }
    if (which === 'np') return toggleNowPlaying(show);
    const p = panelFor(which);
    if (!p) return;
    p.hidden = show === undefined ? !p.hidden : !show;
  }

  // ---- Floating windows -------------------------------------------------
  // A docked side-panel can pop out into a draggable / resizable floating
  // window. Geometry lives in App.settings.floating[key]; null = docked.
  // This is the reusable primitive: any panel with a .panel-head and a
  // [data-fresize] corner handle can be made floatable.
  const _PANEL_IDS = { toc: 'toc-panel', hl: 'hl-panel', np: 'now-playing', book: 'reader-wrap' };
  function panelFor(key) { return document.getElementById(_PANEL_IDS[key] || 'hl-panel'); }
  function geomFor(key) { return App.settings.floating && App.settings.floating[key]; }
  function setGeom(key, g) {
    App.settings.floating = App.settings.floating || {};
    App.settings.floating[key] = g;
    persistSettings();
  }

  // Clamp saved geometry into the CURRENT viewport. Saved layouts can come from
  // a bigger monitor / different window size — without this a window can restore
  // fully off-screen and look "broken" (open but nowhere visible).
  function _clampGeom(g) {
    const W = window.innerWidth || 1280, H = window.innerHeight || 800;
    const w = Math.min(Math.max(220, g.w || 320), W - 16);
    const h = Math.min(Math.max(140, g.h || 240), H - 16);
    const x = Math.max(0, Math.min(g.x || 0, W - Math.max(120, Math.round(w * 0.3))));
    const y = Math.max(0, Math.min(g.y || 0, H - 60));
    return { x, y, w, h };
  }

  function applyFloatState(key) {
    const panel = panelFor(key);
    if (!panel) return;
    let g = geomFor(key);
    // 'np' (Now Playing) is a float-ONLY window — always floating, never docked.
    if (key === 'np' && !g) {
      g = { x: Math.max(20, (window.innerWidth || 900) - 360),
            y: Math.max(20, (window.innerHeight || 600) - 240), w: 320, h: 184 };
    }
    if (g) {
      const c = _clampGeom(g);
      panel.classList.add('floating');
      panel.style.left = c.x + 'px'; panel.style.top = c.y + 'px';
      panel.style.width = c.w + 'px'; panel.style.height = c.h + 'px';
    } else {
      panel.classList.remove('floating');
      panel.style.left = panel.style.top = panel.style.height = '';
      panel.style.width = '';
    }
  }

  // Re-clamp every visible floating window when the viewport changes
  // (fullscreen enter/exit, window resize) so none get stranded off-screen.
  window.addEventListener('resize', () => {
    if (!document.body.classList.contains('windowed')) return;
    WIN_KEYS.forEach(k => {
      const p = panelFor(k);
      if (p && !p.hidden && p.classList.contains('floating')) applyFloatState(k);
    });
  });

  function toggleFloat(key) {
    const panel = panelFor(key);
    if (!panel) return;
    if (geomFor(key)) {
      setGeom(key, null);
    } else {
      const r = panel.getBoundingClientRect();
      const w = Math.min(440, Math.max(280, r.width || 340));
      const h = Math.max(220, Math.min((window.innerHeight || 720) - 120, 560));
      const x = Math.max(20, (window.innerWidth || 1000) - w - 30);
      const y = 70;
      setGeom(key, { x, y, w, h });
    }
    applyFloatState(key);
  }

  function persistGeom(key, panel) {
    const r = panel.getBoundingClientRect();
    setGeom(key, { x: r.left, y: r.top, w: r.width, h: r.height });
  }

  // ---- reusable drag / resize, shared by every floating panel ----
  const SNAP = 12;
  function attachDrag(key) {
    const panel = panelFor(key);
    const head = panel && panel.querySelector('.panel-head');
    if (!head) return;
    head.addEventListener('mousedown', (e) => {
      if (!panel.classList.contains('floating')) return;   // docked: ignore
      if (e.target.closest('button')) return;
      e.preventDefault();
      delete _maxState[key];   // dragging voids any pending maximize-restore
      const r = panel.getBoundingClientRect();
      const offX = e.clientX - r.left, offY = e.clientY - r.top;
      const move = (ev) => {
        const w = panel.offsetWidth, h = panel.offsetHeight;
        let x = ev.clientX - offX, y = ev.clientY - offY;
        if (Math.abs(x) < SNAP) x = 0;                                  // edge snap
        if (Math.abs(y) < SNAP) y = 0;
        if (Math.abs(window.innerWidth - (x + w)) < SNAP) x = window.innerWidth - w;
        if (Math.abs(window.innerHeight - (y + h)) < SNAP) y = window.innerHeight - h;
        x = Math.max(0, Math.min(window.innerWidth - 60, x));
        y = Math.max(0, Math.min(window.innerHeight - 40, y));
        panel.style.left = x + 'px'; panel.style.top = y + 'px';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); persistGeom(key, panel); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }
  function attachResize(key) {
    const panel = panelFor(key);
    const handle = panel && panel.querySelector('[data-fresize]');
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      if (!panel.classList.contains('floating')) return;
      e.preventDefault(); e.stopPropagation();
      const r = panel.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
      const move = (ev) => {
        panel.style.width = Math.max(220, sw + (ev.clientX - sx)) + 'px';
        panel.style.height = Math.max(120, sh + (ev.clientY - sy)) + 'px';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); persistGeom(key, panel); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }

  // ---- VideoNote-style window chrome: z-order, 8-way resize, min/max, pills --
  const WIN_KEYS = ['book', 'hl', 'toc', 'np'];
  const WIN_TITLE = { book: 'Book', hl: 'Highlights', toc: 'Contents', np: 'Now Playing' };
  let _zTop = 80;
  let _frontPanel = null;
  const _pills = {};
  const _maxState = {};

  function bringToFront(panel) {
    if (!panel || panel === _frontPanel) return;   // already frontmost → skip (avoids z churn on repeated clicks)
    _frontPanel = panel;
    _zTop++;
    if (_zTop > 3000) { WIN_KEYS.forEach((k, i) => { const p = panelFor(k); if (p) p.style.zIndex = 80 + i; }); _zTop = 90; }
    panel.style.zIndex = _zTop;
  }

  // Eight resize handles (edges + corners), generated once per window.
  // top corners (ne/nw) are omitted so they can't sit over the header buttons.
  const RES_EDGES = ['n', 's', 'e', 'w', 'se', 'sw'];
  function addResizeHandles(key) {
    const panel = panelFor(key);
    if (!panel || panel._fwHandles) return;
    panel._fwHandles = true;
    RES_EDGES.forEach(edge => {
      const h = el('div', { class: 'fw-resize fw-resize-' + edge });
      h.addEventListener('mousedown', (e) => startResize(e, key, edge));
      panel.appendChild(h);
    });
  }
  function startResize(e, key, edge) {
    const panel = panelFor(key);
    if (!panel || !panel.classList.contains('floating')) return;
    e.preventDefault(); e.stopPropagation();
    delete _maxState[key];   // a manual resize voids any pending maximize-restore
    bringToFront(panel);
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height, sl = r.left, st = r.top;
    const MINW = 240, MINH = 140;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let nw = sw, nh = sh, nx = sl, ny = st;
      if (edge.includes('e')) nw = Math.max(MINW, sw + dx);
      if (edge.includes('w')) { nw = Math.max(MINW, sw - dx); nx = sl + (sw - nw); }
      if (edge.includes('s')) nh = Math.max(MINH, sh + dy);
      if (edge.includes('n')) { nh = Math.max(MINH, sh - dy); ny = st + (sh - nh); }
      panel.style.left = nx + 'px'; panel.style.top = ny + 'px';
      panel.style.width = nw + 'px'; panel.style.height = nh + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); persistGeom(key, panel); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  // Minimize → taskbar pill; restore brings it back to front.
  function addPill(key) {
    if (_pills[key]) return;
    const area = $('#restore-area'); if (!area) return;
    const pill = el('button', { class: 'restore-pill', text: WIN_TITLE[key] || key, title: 'Restore ' + (WIN_TITLE[key] || key),
      onclick: () => showWin(key) });
    area.appendChild(pill); _pills[key] = pill;
  }
  function removePill(key) { if (_pills[key]) { _pills[key].remove(); delete _pills[key]; } }

  function showWin(key) {
    const p = panelFor(key); if (!p) return;
    p.hidden = false;
    ensureFloating(key);
    bringToFront(p);
    removePill(key);
    if (key === 'hl') renderHighlights();
  }
  function hideWin(key) {
    if (key === 'book') return;   // the reader is primary content — never minimizable
    const p = panelFor(key); if (!p) return;
    p.hidden = true;
    addPill(key);
  }

  function maximize(key) {
    const p = panelFor(key); if (!p) return;
    bringToFront(p);
    if (_maxState[key]) {
      const g = _maxState[key]; delete _maxState[key];
      const b = _bounds();                                   // clamp in case the viewport shrank while maximized
      const gx = Math.max(0, Math.min(b.W - 60, g.x));
      const gy = Math.max(0, Math.min(b.H - 40, g.y));
      p.style.left = gx + 'px'; p.style.top = gy + 'px'; p.style.width = g.w + 'px'; p.style.height = g.h + 'px';
      persistGeom(key, p);
    } else {
      const r = p.getBoundingClientRect();
      _maxState[key] = { x: r.left, y: r.top, w: r.width, h: r.height };
      const b = _bounds(); const M = 8;
      p.style.left = M + 'px'; p.style.top = (b.top + M) + 'px';
      p.style.width = (b.W - M * 2) + 'px'; p.style.height = (b.H - b.top - b.footer - M * 2) + 'px';
    }
  }

  // ---- Now Playing (float-only HUD) ----
  function toggleNowPlaying(show) {
    if (document.body.classList.contains('windowed')) return toggle('np', show);
    const np = panelFor('np'); if (!np) return;
    np.hidden = show === undefined ? !np.hidden : !show;
    if (!np.hidden) applyFloatState('np');
  }

  // ---- windowed workspace -------------------------------------------------
  // Default layout: Book (left), Highlights (top-right), Now Playing (bottom-
  // right) as floating windows over a neutral backdrop. No docked mode.
  function _bounds() {
    const W = window.innerWidth || 1280, H = window.innerHeight || 800;
    const tb = document.getElementById('toolbar');
    const ab = document.getElementById('audio-bar');
    const top = (tb ? tb.offsetHeight : 40);
    const footer = (ab && !ab.hidden ? ab.offsetHeight : 0);
    return { W, H, top, footer };
  }

  // Tile the three default windows. Called on book open (first time / re-tile).
  function arrangeWorkspace() {
    const { W, H, top, footer } = _bounds();
    const M = 12;
    const availH = Math.max(200, H - top - footer - M * 2);
    const rightW = Math.max(300, Math.round(W * 0.34));
    const bookW = Math.max(360, W - rightW - M * 3);
    const bookX = M, colY = top + M;
    const rightX = bookX + bookW + M;
    const hlH = Math.round(availH * 0.56);
    const npH = availH - hlH - M;
    setGeom('book', { x: bookX, y: colY, w: bookW, h: availH });
    setGeom('hl',   { x: rightX, y: colY, w: rightW, h: hlH });
    setGeom('np',   { x: rightX, y: colY + hlH + M, w: rightW, h: npH });
    ['book', 'hl', 'np'].forEach(k => { const p = panelFor(k); if (p) { p.hidden = false; applyFloatState(k); } });
    document.body.classList.add('windowed');
    renderHighlights();
  }

  // Enter the workspace on book open: restore saved window geometry if the user
  // has arranged before, otherwise tile the defaults.
  function enterWorkspace() {
    document.body.classList.add('windowed');
    // restore if ANY window geometry was saved (so a partial layout isn't clobbered)
    if (geomFor('book') || geomFor('hl') || geomFor('np')) {
      ['book', 'hl', 'np'].forEach(k => { const p = panelFor(k); if (p) { p.hidden = false; ensureFloating(k); } });
      if (geomFor('toc')) { const t = panelFor('toc'); if (t) applyFloatState('toc'); }  // toc stays hidden until opened
      renderHighlights();
    } else {
      arrangeWorkspace();
    }
  }

  // Ensure a panel shown from a toolbar toggle appears as a floating window.
  function ensureFloating(key) {
    if (geomFor(key)) { applyFloatState(key); return; }
    const { W, H, top } = _bounds();
    const w = key === 'toc' ? 300 : 360;
    const h = Math.min(H - top - 40, 560);
    const x = key === 'toc' ? 24 : Math.max(24, W - w - 24);
    setGeom(key, { x, y: top + 24, w, h });
    applyFloatState(key);
  }

  function resetLayout() { WIN_KEYS.forEach(k => delete _maxState[k]); arrangeWorkspace(); toast('Windows re-tiled'); }

  // Leave the workspace (e.g. back to Library): drop floating visuals so the
  // reader fills the layout again, but KEEP saved geometry for the next book.
  function exitWorkspace() {
    document.body.classList.remove('windowed');
    ['book', 'hl', 'np', 'toc'].forEach(k => {
      const p = panelFor(k);
      removePill(k); delete _maxState[k];
      if (!p) return;
      p.classList.remove('floating');
      p.style.left = p.style.top = p.style.width = p.style.height = p.style.zIndex = '';
      p.hidden = (k !== 'book');   // force the book visible (Library UI is nested inside it)
    });
  }

  function initFloating() {
    ['hl', 'toc'].forEach(key => {
      const panel = panelFor(key);
      if (!panel) return;
      const fbtn = panel.querySelector('[data-float]');
      if (fbtn) fbtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFloat(key); });
      const pbtn = panel.querySelector('[data-popout]');
      if (pbtn) pbtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.PopSync && PopSync.enabled) {
          const w = PopSync.openPanel(pbtn.dataset.popout);
          if (!w) toast('The pop-out window was blocked — the panel stays here instead');
        } else toast('Pop-out needs a browser with BroadcastChannel');
      });
      attachDrag(key);
      applyFloatState(key);
    });
    // Book window: drag only (no dock/close/popout — it's always present)
    if (panelFor('book')) attachDrag('book');
    const rc = $('#reader-contents');
    if (rc) rc.addEventListener('click', (e) => { e.stopPropagation(); toggle('toc'); });
    // Now Playing window: float-only, skip buttons wired here (play/speed/body
    // are wired by audio.js initProgress).
    if (panelFor('np')) {
      attachDrag('np');
      const back = $('#np-back'), fwd = $('#np-fwd');
      if (back)  back.addEventListener('click',  () => { if (App.audio) App.audio.currentTime -= (App.settings.seekStep || 5); });
      if (fwd)   fwd.addEventListener('click',   () => { if (App.audio) App.audio.currentTime += (App.settings.seekStep || 5); });
      const pop = $('#np-popout');
      if (pop) pop.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.PopSync && PopSync.enabled) {
          const w = PopSync.openNowPlaying();
          // Only hide the in-app window once the OS window actually opened —
          // a blocked window.open used to make Now Playing just vanish.
          if (w) toggleNowPlaying(false);
          else toast('The pop-out window was blocked — Now Playing stays here');
        } else toast('Pop-out needs a browser with BroadcastChannel');
      });
    }

    // VideoNote-style chrome for every window: 8-way resize, bring-to-front,
    // and the Minimize / Maximize title-bar buttons.
    WIN_KEYS.forEach(key => {
      const p = panelFor(key);
      if (!p) return;
      addResizeHandles(key);
      p.addEventListener('mousedown', () => bringToFront(p), true);
    });
    $$('[data-min]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); hideWin(b.dataset.min); }));
    $$('[data-max]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); maximize(b.dataset.max); }));
  }

  function initResizers() {
    $$('.resizer').forEach(r => {
      r.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const which = r.dataset.resize;
        const panel = which === 'toc' ? $('#toc-panel') : $('#hl-panel');
        const startX = e.clientX, startW = panel.offsetWidth;
        const move = (ev) => {
          let w = which === 'toc' ? startW + (ev.clientX - startX) : startW - (ev.clientX - startX);
          const maxW = window.innerWidth * (which === 'toc' ? 0.5 : 0.8);
          const minW = which === 'toc' ? 160 : 120;
          w = Math.max(minW, Math.min(maxW, w));
          panel.style.width = w + 'px';
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      });
    });
  }

  // ---- TOC ----
  function hrefToSid(href) {
    if (!href || !App.anchorMap) return undefined;
    const map = App.anchorMap;
    if (map[href] !== undefined) return map[href];
    const file = href.split('/').pop();
    const fileNoFrag = file.split('#')[0];
    let hit = Object.keys(map).find(b => b.endsWith(href) || href.endsWith(b));
    if (!hit) hit = Object.keys(map).find(b => b.split('#')[0].endsWith(fileNoFrag) && b.includes('#') === href.includes('#'));
    if (!hit) hit = Object.keys(map).find(b => b.includes(fileNoFrag));
    return hit ? map[hit] : undefined;
  }

  function buildTOC(toc) {
    const list = $('#toc-list');
    list.innerHTML = '';
    if (!toc || !toc.length) { list.appendChild(el('div', { class: 'hl-empty', text: 'No chapters in this EPUB.' })); return; }

    function node(entry) {
      const item = el('div', { class: 'toc-item' });
      const line = el('div', { class: 'toc-item-line' });
      const hasKids = entry.subitems && entry.subitems.length;
      const twist = el('span', { class: 'toc-twist' + (hasKids ? '' : ' empty'), text: '▶' });
      if (hasKids) twist.addEventListener('click', (e) => { e.stopPropagation(); item.classList.toggle('open'); });
      const row = el('button', { class: 'toc-row', title: entry.label.trim(), text: entry.label.trim(), onclick: () => { const sid = hrefToSid(entry.href); if (sid !== undefined) scrollToSid(sid); else toast('Section not found'); } });
      line.appendChild(twist); line.appendChild(row);
      item.appendChild(line);
      if (hasKids) { const kids = el('div', { class: 'toc-children' }); entry.subitems.forEach(s => kids.appendChild(node(s))); item.appendChild(kids); }
      return item;
    }
    toc.forEach(e => list.appendChild(node(e)));

    // chapter markers: top-level entries -> first timed sentence at/after their sid
    App.chapters = toc.map(e => {
      const sid = hrefToSid(e.href);
      let start = null;
      if (sid !== undefined) {
        for (let i = App.sentences.findIndex(s => s.sid === sid); i >= 0 && i < App.sentences.length; i++) {
          if (App.sentences[i].start != null) { start = App.sentences[i].start; break; }
        }
      }
      return { label: e.label.trim(), sid, start };
    });
    if (window.Player) Player.buildChapterMarks();

    // tag each top-level chapter row so the playhead can light up the current one
    list.querySelectorAll(':scope > .toc-item > .toc-item-line > .toc-row')
        .forEach((r, i) => { r.dataset.chapterIdx = i; });
    _activeChapterIdx = -1;
    if (window.PopSync && PopSync.enabled) PopSync.pushTOC();   // sync any TOC pop-out

    // search
    const search = $('#toc-search');
    search.oninput = () => {
      const q = search.value.toLowerCase();
      $$('.toc-item', list).forEach(it => {
        const txt = it.querySelector('.toc-row').textContent.toLowerCase();
        const self = txt.includes(q);
        const kid = Array.from(it.querySelectorAll('.toc-children .toc-row')).some(r => r.textContent.toLowerCase().includes(q));
        it.style.display = (!q || self || kid) ? '' : 'none';
      });
    };
  }

  // ---- Highlights panel ----
  const LABEL = { note: 'Note', rule: 'Rule', key: 'Key Point', never: 'Never Do' };
  const TYPE_LABEL = { paragraph: '', chapter_title: 'Chapter', section_title: 'Section', epigraph: 'Epigraph', list_item: 'List', blockquote: 'Quote', image_caption: 'Caption', phrase: 'Phrase' };

  function card(it) {
    const c = el('div', { class: 'hl-card cat-' + it.category });
    const meta = el('div', { class: 'meta' });
    meta.appendChild(el('span', { text: LABEL[it.category] + (TYPE_LABEL[it.type] ? ' · ' + TYPE_LABEL[it.type] : '') }));
    meta.appendChild(el('div', { class: 'meta-right' },
      el('span', { text: it.time != null ? fmtTime(it.time) : '—' }),
      el('button', { class: 'hl-edit', title: "Edit this highlight's note and category", text: 'Edit',
        onclick: (e) => { e.stopPropagation(); toggleCardEditor(c, it); } })));
    c.appendChild(meta);
    c.appendChild(el('div', { class: 'txt', text: it.text, onclick: () => scrollToSid(it.sid) }));
    if (it.note) c.appendChild(el('div', { class: 'note', text: it.note }));
    return c;
  }

  // Inline editor that expands inside a highlight card (replaces the old scroll-only model).
  function toggleCardEditor(cardEl, it) {
    const open = cardEl.querySelector('.hl-editor');
    if (open) { open.remove(); return; }
    const isPhrase = it.type === 'phrase';
    const area = el('textarea', { class: 'note-area', placeholder: 'Add a note…' });
    area.value = it.note || '';
    const grid = el('div', { class: 'cat-grid' });
    ['note', 'rule', 'key', 'never'].forEach(k => {
      grid.appendChild(el('button', { class: 'cat-btn' + (it.category === k ? ' is-active' : ''), 'data-cat': k, style: 'color:' + catContrastColor(k), text: LABEL[k],
        onclick: () => { if (isPhrase) Highlights.setWordHighlight(it.id, { category: k }); else Highlights.setSentence(it.sid, k); } }));
    });
    const actions = el('div', { class: 'pop-actions' },
      el('button', { class: 'primary', text: 'Save note',
        onclick: () => { if (isPhrase) Highlights.setWordHighlight(it.id, { note: area.value.trim() }); else Highlights.setSentenceNote(it.sid, area.value.trim()); } }),
      el('button', { text: 'Remove',
        onclick: () => { if (isPhrase) Highlights.removeWordHighlight(it.id); else Highlights.removeSentence(it.sid); } }));
    const editor = el('div', { class: 'hl-editor' }, grid, area, actions);
    editor.addEventListener('click', (e) => e.stopPropagation());
    cardEl.appendChild(editor);
    area.focus();
  }

  function renderHighlights() {
    if (window.Player && Player.buildHighlightMarks) Player.buildHighlightMarks();
    if (window.PopSync && PopSync.enabled) PopSync.pushHighlights();   // sync any pop-out window
    const body = $('#hl-body');
    if (!body) return;
    const items = Highlights.exportItems();

    // tab badges
    $$('.hl-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === hlTab));

    body.innerHTML = '';
    if (!items.length) { body.appendChild(el('div', { class: 'hl-empty', text: 'No highlights yet.\nClick a sentence to highlight it.' })); return; }

    if (hlTab === 'order') {
      items.forEach(it => body.appendChild(card(it)));
    } else {
      ['note', 'rule', 'key', 'never'].forEach(cat => {
        const sub = items.filter(i => i.category === cat);
        if (!sub.length) return;
        const head = el('div', { class: 'hl-cat-head' }, el('span', { class: 'dot ' + cat }), el('span', { text: LABEL[cat] }), el('span', { class: 'count', text: sub.length }));
        body.appendChild(head);
        sub.forEach(it => body.appendChild(card(it)));
      });
    }
  }

  // ---- Reading controls popover ----
  const FONTS = [
    ["Lora", "'Lora', Georgia, serif"],
    ["Merriweather", "'Merriweather', Georgia, serif"],
    ["Playfair", "'Playfair Display', Georgia, serif"],
    ["Source Serif", "'Source Serif 4', 'Source Serif Pro', Georgia, serif"],
    ["Georgia", "Georgia, serif"],
    ["Inter", "'Inter', system-ui, sans-serif"],
    ["DM Sans", "'DM Sans', system-ui, sans-serif"],
  ];

  function rangeRow(label, key, min, max, step, onChange) {
    const input = el('input', { type: 'range', min, max, step, value: App.settings[key] });
    input.addEventListener('input', () => { App.settings[key] = parseFloat(input.value); applySettings(); if (onChange) onChange(); });
    return el('div', { class: 'row' }, el('label', { text: label }), input);
  }

  function toggleRow(label, key, onChange) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!App.settings[key];
    cb.addEventListener('change', () => { App.settings[key] = cb.checked; persistSettings(); if (onChange) onChange(cb.checked); });
    return el('div', { class: 'row' }, el('label', { text: label }), cb);
  }

  function selectRow(label, key, options, onChange) {
    const sel = el('select');
    options.forEach(([value, text]) => { const o = el('option', { value, text }); if (String(App.settings[key]) === value) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => { App.settings[key] = sel.value; persistSettings(); if (onChange) onChange(sel.value); });
    return el('div', { class: 'row' }, el('label', { text: label }), sel);
  }

  function openTypePopover(anchor) {
    const fontSel = el('select');
    FONTS.forEach(([name, css]) => { const o = el('option', { value: css, text: name }); if (css === App.settings.font) o.selected = true; fontSel.appendChild(o); });
    fontSel.addEventListener('change', () => { App.settings.font = fontSel.value; applySettings(); });

    const wrap = el('div', {},
      el('h4', { text: 'Reading' }),
      el('div', { class: 'row' }, el('label', { text: 'Font' }), fontSel),
      rangeRow('Text size', 'readSize', 13, 30, 1),
      rangeRow('Panel size', 'panelSize', 11, 22, 1),
      rangeRow('Line height', 'line', 1.0, 2.2, 0.05),
      rangeRow('Sentence gap', 'sentenceGap', 0, 24, 1),
      rangeRow('Word spacing', 'wordSpacing', 0, 12, 0.5),
      rangeRow('Letter spacing', 'letterSpacing', -1, 4, 0.1),
      el('h4', { text: 'Playback' }),
      rangeRow('Seek step (s)', 'seekStep', 1, 30, 1, () => { if (window.Player && Player.updateSeekTooltips) Player.updateSeekTooltips(); }),
      rangeRow('Auto-return (s)', 'autoReturnSec', 0, 120, 5),
      selectRow('Word highlight', 'wordHighlight', [['off','Off'],['sweep','Sweep'],['word','Word']]),
      el('h4', { text: 'Highlights' }),
      rangeRow('Highlight strength', 'hlAlpha', 10, 80, 2),
      toggleRow('Quick highlight', 'quickHighlight'),
      toggleRow('Space = highlight', 'spaceHighlightsPrev'),
    );
    openPopover(wrap, anchor);
  }

  // ---- Theme popover ----
  const PRESETS = [
    ['theme-dark-warm', '#1c1a12', '#f0e9d8', 'Dark warm'],
    ['theme-warm-white', '#fdfcf3', '#1a1612', 'Warm white'],
    ['theme-sepia', '#eee2cb', '#1a0f05', 'Sepia'],
    ['theme-cool-grey', '#eeeeee', '#1a1a1a', 'Cool grey'],
    ['theme-uworld', '#dbdded', '#1a1a2e', 'UWorld'],
  ];

  function openThemePopover(anchor) {
    const sw = el('div', { class: 'theme-swatches' });
    PRESETS.forEach(([cls, bg, fg, name]) => {
      const s = el('div', { class: 'swatch' + (App.settings.theme === cls && !App.settings.custom.bg ? ' is-active' : ''), title: name });
      s.style.background = bg; s.style.color = fg; s.textContent = 'Aa'; s.style.display = 'flex'; s.style.alignItems = 'center'; s.style.justifyContent = 'center';
      s.addEventListener('click', () => { applyTheme(cls); openThemePopover(anchor); });
      sw.appendChild(s);
    });

    // custom slots
    const slots = el('div', { class: 'theme-swatches' });
    App.settings.customThemes.forEach((ct, idx) => {
      const s = el('div', { class: 'swatch', title: ct ? (ct.name || 'Custom ' + (idx + 1)) : 'Empty slot — Save current' });
      if (ct) { s.style.background = ct.bg; s.style.color = ct.fg; s.textContent = 'Aa'; s.style.display = 'flex'; s.style.alignItems = 'center'; s.style.justifyContent = 'center';
        s.addEventListener('click', () => applyCustomColors(ct.bg, ct.fg));
        s.addEventListener('contextmenu', (e) => { e.preventDefault(); App.settings.customThemes[idx] = null; openThemePopover(anchor); });
      } else { s.textContent = '+'; s.style.opacity = '.5'; s.style.display = 'flex'; s.style.alignItems = 'center'; s.style.justifyContent = 'center';
        s.addEventListener('click', () => {
          const cs = getComputedStyle(document.body);
          App.settings.customThemes[idx] = { bg: App.settings.custom.bg || cs.getPropertyValue('--bg').trim(), fg: App.settings.custom.fg || cs.getPropertyValue('--fg').trim(), name: 'Custom ' + (idx + 1) };
          openThemePopover(anchor); toast('Saved custom theme');
        });
      }
      slots.appendChild(s);
    });

    const cs = getComputedStyle(document.body);
    const bgPick = el('input', { type: 'color', value: rgbToHex(App.settings.custom.bg || cs.getPropertyValue('--bg').trim()) });
    const fgPick = el('input', { type: 'color', value: rgbToHex(App.settings.custom.fg || cs.getPropertyValue('--fg').trim()) });
    bgPick.addEventListener('input', () => applyCustomColors(bgPick.value, null));
    fgPick.addEventListener('input', () => applyCustomColors(null, fgPick.value));

    // Research themes: the full 24-theme set from the research reports as a
    // grouped swatch grid (Dark / In-between / Light) — the primary picker.
    // Each swatch previews bg + text + active-word color; tooltip has the score.
    const research = el('div', {});
    THEME_GROUP_ORDER.forEach(group => {
      research.appendChild(el('h4', { text: group }));
      const grid = el('div', { class: 'theme-swatches' });
      Object.values(EXTENDED_THEMES).filter(t => t.group === group).forEach(t => {
        const s = el('div', {
          class: 'swatch rswatch' + (App.settings.theme === t.id ? ' is-active' : ''),
          title: t.name + ' — reading-comfort score ' + t.overall,
        });
        s.style.background = t.bg; s.style.color = t.fg;
        const bar = el('i', { class: 'bar' });
        bar.style.background = t.wordBg;
        s.appendChild(el('span', { class: 'aa', text: 'Aa' }));
        s.appendChild(bar);
        s.appendChild(el('span', { class: 'nm', text: t.name }));
        s.addEventListener('click', () => { applyTheme(t.id); openThemePopover(anchor); });
        grid.appendChild(s);
      });
      research.appendChild(grid);
    });

    // per-user category color overrides
    const catPick = el('div', { class: 'catcolor-grid' });
    ['note', 'rule', 'key', 'never'].forEach(k => {
      const csk = getComputedStyle(document.body);
      const cur = (App.settings.catColors && App.settings.catColors[k]) || csk.getPropertyValue('--cat-' + k).trim();
      const ci = el('input', { type: 'color', value: rgbToHex(cur) });
      ci.addEventListener('input', () => {
        App.settings.catColors = App.settings.catColors || {};
        App.settings.catColors[k] = ci.value;
        applyCatColorOverrides(); persistSettings(); renderHighlights();
        if (window.Player && Player.buildHighlightMarks) Player.buildHighlightMarks();
      });
      const reset = el('button', { class: 'reset', text: 'Reset', title: 'Reset to theme default',
        onclick: () => { if (App.settings.catColors) App.settings.catColors[k] = null; applyTheme(App.settings.theme); renderHighlights(); openThemePopover(anchor); } });
      catPick.appendChild(el('div', { class: 'catcolor-row' }, el('span', { text: LABEL[k] }), ci, reset));
    });

    const wrap = el('div', { class: 'theme-pop' },
      research,
      el('hr', { class: 'pop-divider' }),
      el('h4', { text: 'Classic presets' }), sw,
      el('h4', { text: 'Custom slots (right-click to clear)' }), slots,
      el('div', { class: 'row' }, el('label', { text: 'Background' }), bgPick),
      el('div', { class: 'row' }, el('label', { text: 'Text' }), fgPick),
      el('h4', { text: 'Category colors' }), catPick,
    );
    openPopover(wrap, anchor);
  }

  function openBookmarks(anchor) {
    const wrap = el('div', {}, el('h4', { text: 'Bookmarks' }));
    const bms = (App.bookmarks || []).slice().sort((a, b) => a.time - b.time);
    if (!bms.length) {
      wrap.appendChild(el('div', { class: 'hl-empty', text: 'No bookmarks yet.\nPress B to add one at the current spot.' }));
    } else {
      const list = el('div', { class: 'menu-list' });
      bms.forEach(bm => {
        const row = el('button', { text: fmtTime(bm.time) + (bm.label ? '  ' + bm.label : ''),
          title: 'Click to seek · right-click to remove',
          onclick: () => { closePopover(); if (window.Player) Player.seek(bm.time); } });
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); Highlights.removeBookmark(bm.id); openBookmarks(anchor); });
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }
    openPopover(wrap, anchor);
  }

  function openMenuPopover(anchor) {
    const list = el('div', { class: 'menu-list' },
      el('button', { text: 'Save session', onclick: () => { closePopover(); Highlights.save(); } }),
      el('button', { text: 'Load session…', onclick: () => { closePopover(); $('#open-session').click(); } }),
      el('button', { text: 'Export highlights (Markdown)', onclick: () => { closePopover(); Highlights.exportMarkdown(); } }),
      el('button', { text: 'Export highlights (Text)', onclick: () => { closePopover(); Highlights.exportText(); } }),
      el('button', { text: 'Export session (JSON)', onclick: () => { closePopover(); Highlights.exportJSON(); } }),
      el('button', { text: 'Bookmarks…', onclick: () => { openBookmarks(anchor); } }),
      el('button', { text: 'Reading stats', onclick: () => { closePopover(); if (window.Extras) Extras.showStats(); } }),
      el('button', { text: 'Sleep timer…', onclick: () => { if (window.Extras) Extras.sleepMenu(anchor); } }),
      el('button', { text: 'Keyboard shortcuts', onclick: () => { closePopover(); if (window.Extras) Extras.showShortcuts(); } }),
      el('button', { text: 'Toggle auto-scroll', onclick: () => { closePopover(); Player.setAutoscroll(!Player.autoscroll); toast('Auto-scroll ' + (Player.autoscroll ? 'on' : 'off')); } }),
      el('button', { text: 'Follow OS theme on launch: ' + (App.settings.autoDayNight ? 'On' : 'Off'), onclick: () => { App.settings.autoDayNight = !App.settings.autoDayNight; persistSettings(); closePopover(); toast('Follow OS theme ' + (App.settings.autoDayNight ? 'on' : 'off')); } }),
      el('button', { text: 'Now Playing window', onclick: () => { closePopover(); toggleNowPlaying(); } }),
      el('button', { text: 'Re-tile windows', onclick: () => { closePopover(); resetLayout(); } }),
      el('button', { text: 'Library', onclick: () => { closePopover(); confirmLeave(() => { exitWorkspace(); $('#library').hidden = false; loadLibrary(); }); } }),
    );
    openPopover(el('div', {}, el('h4', { text: 'Menu' }), list), anchor);
  }

  function confirmLeave(fn) {
    if (!App.state.dirty) return fn();
    const actions = el('div', { class: 'pop-actions' },
      el('button', { class: 'primary', text: 'Save first', onclick: () => { closePopover(); Highlights.save().then ? Highlights.save() : Highlights.save(); fn(); } }),
      el('button', { text: 'Discard', onclick: () => { closePopover(); markDirty(false); fn(); } }),
      el('button', { text: 'Cancel', onclick: () => closePopover() }));
    openPopover(el('div', {}, el('h4', { text: 'Unsaved highlights' }), el('div', { text: 'You have unsaved changes.' }), actions), { x: window.innerWidth / 2 - 110, y: 120 });
  }

  function rgbToHex(c) {
    if (!c) return '#000000';
    c = c.trim();
    if (c[0] === '#') return c.length === 4 ? '#' + c.slice(1).split('').map(x => x + x).join('') : c;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (!m) return '#000000';
    return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
  }

  document.addEventListener('DOMContentLoaded', () => { initResizers(); initFloating(); });

  // Bookmarks list opened from Settings (no anchor button — center it).
  function openBookmarksCentered() {
    openBookmarks({ x: Math.max(20, window.innerWidth / 2 - 130), y: 90 });
  }

  // Ribbon "Library" button: leave the workspace (with unsaved-changes guard).
  function goLibrary() {
    confirmLeave(() => { exitWorkspace(); $('#library').hidden = false; loadLibrary(); });
  }

  return { toggle, toggleFloat, toggleNowPlaying, enterWorkspace, arrangeWorkspace, resetLayout, buildTOC, renderHighlights, updateActiveChapter, openTypePopover, openThemePopover, openMenuPopover, openBookmarksCentered, goLibrary, get hlTab() { return hlTab; }, set hlTab(v) { hlTab = v; } };
})();
