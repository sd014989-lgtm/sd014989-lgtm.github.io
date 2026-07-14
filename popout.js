/* ============================================================
   popout.js — runs inside a popped-out window (Now Playing / Highlights /
   Contents). Talks to the main window over the same-origin 'ts-sync'
   BroadcastChannel. Renders the panel chosen by ?panel= and relays clicks
   back to the main window as commands.
   ============================================================ */
(function () {
  const panel = new URLSearchParams(location.search).get('panel') || 'np';
  const ch = ('BroadcastChannel' in window) ? new BroadcastChannel('ts-sync') : null;
  const root = document.getElementById('po-root');
  const head = document.getElementById('po-head');

  // minimal helpers (no util.js in the pop-out)
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return (h ? h + ':' : '') + (h ? String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  function send(action, extra) { if (ch) ch.postMessage(Object.assign({ t: 'cmd', action }, extra || {})); }
  let _themedVars = [];
  function applyTheme(th) {
    if (!th || !th.vars) return;
    const r = document.documentElement.style;
    _themedVars.forEach(v => r.removeProperty(v));   // clear the previous theme
    _themedVars = Object.keys(th.vars);
    _themedVars.forEach(v => r.setProperty(v, th.vars[v]));
    document.body.classList.toggle('research-theme', !!th.research);
  }

  const LABEL = { note: 'Note', rule: 'Rule', key: 'Key Point', never: 'Never Do' };

  // ---- Now Playing ----
  let npEls = null;
  function buildNP() {
    head.textContent = 'Now Playing';
    root.className = 'po-body po-np-body';
    const sent = el('div', { id: 'po-sentence', class: 'np-sentence', text: '—' });
    // Same transport glyphs as the main Now Playing window (⏮ N / N ⏭)
    const back = el('button', { class: 'np-ctl', text: '⏮ 5', title: 'Skip backward', onclick: () => send('back') });
    const play = el('button', { class: 'np-ctl np-play', text: '▶', title: 'Play', onclick: () => send('toggle') });
    const fwd  = el('button', { class: 'np-ctl', text: '5 ⏭', title: 'Skip forward', onclick: () => send('fwd') });
    const speed = el('button', { class: 'np-ctl', text: '1×', title: 'Change playback speed (click to cycle)', onclick: () => send('cycleSpeed') });
    const word = el('span', { id: 'po-word', class: 'np-word', text: '—' });
    root.appendChild(sent);
    const controls = el('div', { class: 'np-controls' }, back, play, fwd, speed, word);
    root.parentNode.appendChild(controls);   // controls sit below the scrolling body
    npEls = { sent, back, play, fwd, speed, word };
  }
  function renderNP(m) {
    if (!npEls) return;
    if (m.sentence != null) npEls.sent.textContent = m.sentence;
    if (m.word != null) npEls.word.textContent = m.word;
    if (m.playing != null) { npEls.play.textContent = m.playing ? '❚❚' : '▶'; npEls.play.title = m.playing ? 'Pause' : 'Play'; }
    if (m.speed != null) npEls.speed.textContent = m.speed + '×';
    if (m.step != null) {
      npEls.back.textContent = '⏮ ' + m.step; npEls.back.title = 'Skip backward ' + m.step + ' seconds';
      npEls.fwd.textContent = m.step + ' ⏭'; npEls.fwd.title = 'Skip forward ' + m.step + ' seconds';
    }
  }

  // ---- Highlights ----
  function buildHL() { head.textContent = 'Highlights'; root.className = 'po-body po-list'; }
  const TYPE_LABEL = { paragraph: '', chapter_title: 'Chapter', section_title: 'Section', epigraph: 'Epigraph', list_item: 'List', blockquote: 'Quote', image_caption: 'Caption', phrase: 'Phrase' };
  function renderHL(items) {
    root.innerHTML = '';
    if (!items || !items.length) { root.appendChild(el('div', { class: 'po-empty', text: 'No highlights yet.\nClick a sentence in the main window.' })); return; }
    items.forEach(it => {
      const card = el('div', { class: 'hl-card cat-' + it.category, title: 'Click to jump in the main window', onclick: () => send('goSid', { sid: it.sid }) });
      card.appendChild(el('div', { class: 'meta' },
        el('span', { text: LABEL[it.category] + (TYPE_LABEL[it.type] ? ' · ' + TYPE_LABEL[it.type] : '') }),
        el('span', { text: it.time != null ? fmtTime(it.time) : '—' })));
      card.appendChild(el('div', { class: 'txt', text: it.text }));
      if (it.note) card.appendChild(el('div', { class: 'note', text: it.note }));
      root.appendChild(card);
    });
  }

  // ---- Contents (TOC) ----
  function buildTOC() { head.textContent = 'Contents'; root.className = 'po-body po-list'; }
  function renderTOC(chapters) {
    root.innerHTML = '';
    if (!chapters || !chapters.length) { root.appendChild(el('div', { class: 'po-empty', text: 'No chapters.' })); return; }
    chapters.forEach(c => {
      const row = el('button', { class: 'po-toc-row', onclick: () => { if (c.sid != null) send('goSid', { sid: c.sid }); } },
        el('span', { text: c.label }));
      if (c.start != null) row.appendChild(el('span', { class: 't', text: fmtTime(c.start) }));
      root.appendChild(row);
    });
  }

  // ---- wire up ----
  if (panel === 'np') buildNP();
  else if (panel === 'hl') buildHL();
  else if (panel === 'toc') buildTOC();

  if (ch) ch.onmessage = (e) => {
    const m = e.data; if (!m) return;
    if (m.theme) applyTheme(m.theme);
    if (m.t === 'np' && panel === 'np') renderNP(m);
    else if (m.t === 'hl' && panel === 'hl') renderHL(m.items);
    else if (m.t === 'toc' && panel === 'toc') renderTOC(m.chapters);
    else if (m.t === 'theme') { /* theme already applied above */ }
  };

  if (ch) ch.postMessage({ t: 'hello', panel });
})();
