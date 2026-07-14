/* ============================================================
   reader.js — book loading, content model, rendering, mode toggle,
   transcript→text time mapping, navigation, app bootstrap.
   ============================================================ */

let _sidSeq = 0, _widSeq = 0;

// ---- Content model --------------------------------------------------------
// A book becomes an ordered list of `blocks`. Text blocks own `sentences`;
// each sentence owns `words`. sid/wid are global stable ids — the single
// index system shared by the playhead and the highlight layer.

function newSentence(text, blockType, blockIndex, anchors, richWords, richOffset) {
  const words = [];
  const toks = text.split(/\s+/).filter(Boolean);
  toks.forEach((tok, i) => {
    const rw = richWords && richWords[(richOffset || 0) + i];
    words.push({
      wid: _widSeq++, text: tok, norm: normWord(tok),
      start: null, end: null, last: i === toks.length - 1,
      bold: rw ? rw.bold : false, italic: rw ? rw.italic : false,
    });
  });
  const sid = _sidSeq++;
  words.forEach(w => { w.sid = sid; });   // each word knows its sentence (single index system)
  return { sid, text, blockType, blockIndex, words, el: null, start: null, end: null, anchors };
}

// Walk an inline HTML node and collect per-word {text, bold, italic} tuples.
// Recognises <strong>/<b> for bold, <em>/<i> for italic, and common EPUB
// style/class conventions (font-weight:bold, font-style:italic on <span>s).
function extractRichWords(node) {
  const result = [];
  function walk(n, bold, italic) {
    for (const child of n.childNodes) {
      if (child.nodeType === 3) {  // text node
        child.textContent.split(/\s+/).filter(Boolean).forEach(t => result.push({ text: t, bold, italic }));
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        const style = child.style || {};
        const cls   = (child.className || '').toLowerCase();
        const b  = bold   || tag === 'strong' || tag === 'b'
                          || /bold/.test(style.fontWeight || '')
                          || /bold/.test(cls);
        const it = italic || tag === 'em'     || tag === 'i'
                          || /italic/.test(style.fontStyle || '')
                          || /italic/.test(cls);
        walk(child, b, it);
      }
    }
  }
  walk(node, false, false);
  return result;
}

function classifyParagraph(node) {
  const cls = (node.className || '').toLowerCase();
  if (/epigraph|epig/.test(cls)) return 'epigraph';
  return 'paragraph';
}
function isEpigraph(node) {
  const cls = (node.className || '').toLowerCase();
  return /epigraph|epig/.test(cls) || node.tagName.toLowerCase() === 'blockquote' && /italic/.test(cls);
}

const CONTAINER_TAGS = new Set(['div','section','article','main','aside','header','footer','body','nav','span']);

function resolvePath(base, rel) {
  const stack = base.split('/').slice(0, -1);
  rel.split('/').forEach(p => { if (p === '..') stack.pop(); else if (p !== '.' && p !== '') stack.push(p); });
  return stack.join('/');
}

async function buildContentModel(book) {
  _sidSeq = 0; _widSeq = 0;
  const blocks = [];
  const sentences = [];
  App.anchorMap = {};       // "href#id" -> sid ; "href" -> first sid
  const imgJobs = [];

  function emitText(node, type, blockIndex, hrefBase, anchorId) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const richWords = extractRichWords(node);
    const parts = splitIntoSentences(text);
    const block = { type, sentences: [] };
    let richOffset = 0;
    parts.forEach(p => {
      const s = newSentence(p, type, blockIndex, [], richWords, richOffset);
      richOffset += s.words.length;
      block.sentences.push(s);
      sentences.push(s);
    });
    if (block.sentences.length) {
      blocks.push(block);
      const firstSid = block.sentences[0].sid;
      if (anchorId) App.anchorMap[hrefBase + '#' + anchorId] = firstSid;
      if (App.anchorMap[hrefBase] === undefined) App.anchorMap[hrefBase] = firstSid;
    }
  }

  function emitImage(imgNode, blockIndex, canonical, caption) {
    const block = { type: 'image', src: null, caption: caption || null };
    const rel = imgNode.getAttribute('src') || imgNode.getAttribute('xlink:href');
    if (rel && book.archived) {
      // Resolve against the section's canonical (zip-root) path so it works
      // whether or not the book nests content under OEBPS/. canonical already
      // starts with "/", which is what archive.createUrl wants (it strips it).
      const abs = resolvePath(canonical, rel);
      imgJobs.push(book.archive.createUrl(abs).then(u => { block.src = u; }).catch(() => {}));
    } else if (rel) {
      block.src = rel;
    }
    blocks.push(block);
  }

  function walk(node, blockIndex, hrefBase, canonical) {
    let pendingAnchor = null;
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      const id = child.getAttribute && child.getAttribute('id');
      const anchorId = id || pendingAnchor; pendingAnchor = id || pendingAnchor;

      if (/^h[1-6]$/.test(tag)) {
        emitText(child, tag === 'h1' || tag === 'h2' ? 'chapter_title' : 'section_title', blockIndex, hrefBase, anchorId);
      } else if (tag === 'p') {
        const img = child.querySelector('img');
        if (img && child.textContent.replace(/\s+/g, '').length < 3) { emitImage(img, blockIndex, canonical); }
        else emitText(child, classifyParagraph(child), blockIndex, hrefBase, anchorId);
      } else if (tag === 'blockquote') {
        const t = isEpigraph(child) ? 'epigraph' : 'blockquote';
        const ps = child.querySelectorAll(':scope > p');
        if (ps.length) ps.forEach(p => emitText(p, t, blockIndex, hrefBase, anchorId));
        else emitText(child, t, blockIndex, hrefBase, anchorId);
      } else if (tag === 'ul' || tag === 'ol') {
        Array.from(child.children).forEach(li => { if (li.tagName.toLowerCase() === 'li') emitText(li, 'list_item', blockIndex, hrefBase, anchorId); });
      } else if (tag === 'li') {
        emitText(child, 'list_item', blockIndex, hrefBase, anchorId);
      } else if (tag === 'figure') {
        const img = child.querySelector('img');
        const cap = child.querySelector('figcaption');
        if (img) emitImage(img, blockIndex, canonical, cap ? cap.textContent.trim() : null);
        else if (cap) emitText(cap, 'image_caption', blockIndex, hrefBase, anchorId);
      } else if (tag === 'figcaption') {
        emitText(child, 'image_caption', blockIndex, hrefBase, anchorId);
      } else if (tag === 'img') {
        emitImage(child, blockIndex, canonical);
      } else if (tag === 'hr') {
        blocks.push({ type: 'section_break' });
      } else if (CONTAINER_TAGS.has(tag)) {
        // only recurse if it has element children; otherwise treat text as paragraph
        if (child.children.length) walk(child, blockIndex, hrefBase, canonical);
        else emitText(child, 'paragraph', blockIndex, hrefBase, anchorId);
      } else {
        if ((child.textContent || '').trim()) emitText(child, 'paragraph', blockIndex, hrefBase, anchorId);
      }
    }
  }

  const items = book.spine.spineItems;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const docEl = await item.load(book.load.bind(book));
      const body = docEl.querySelector ? (docEl.querySelector('body') || docEl) : docEl;
      const hrefBase = item.href || item.url || '';
      const canonical = item.canonical || ('/' + hrefBase);
      if (body) walk(body, i, hrefBase, canonical);
    } catch (e) {
      console.warn('section load failed', item && item.href, e);
    } finally {
      try { item.unload(); } catch (e) {}
    }
  }

  await Promise.all(imgJobs);
  App.blocks = blocks;
  App.sentences = sentences;
}

// ---- Rendering ------------------------------------------------------------
function renderReader() {
  const reader = $('#reader');
  reader.innerHTML = '';
  const frag = document.createDocumentFragment();
  let i = 0;
  const blocks = App.blocks;

  while (i < blocks.length) {
    const b = blocks[i];

    if (b.type === 'section_break') {
      frag.appendChild(el('div', { class: 'blk blk-section_break' }, '* * *'));
      i++; continue;
    }
    if (b.type === 'image') {
      const fig = el('div', { class: 'blk blk-image' });
      if (b.src) fig.appendChild(el('img', { src: b.src, alt: b.caption || '' }));
      if (b.caption) fig.appendChild(el('div', { class: 'blk-image_caption', text: b.caption }));
      frag.appendChild(fig);
      i++; continue;
    }
    // group consecutive list_item blocks into one list
    if (b.type === 'list_item') {
      const list = el('div', { class: 'blk blk-list' });
      while (i < blocks.length && blocks[i].type === 'list_item') {
        const li = el('div', { class: 'blk blk-list_item' });
        renderSentencesInto(li, blocks[i]);
        list.appendChild(li);
        i++;
      }
      frag.appendChild(list);
      continue;
    }

    const blkEl = el('div', { class: 'blk blk-' + b.type });
    renderSentencesInto(blkEl, b);
    frag.appendChild(blkEl);
    i++;
  }

  reader.appendChild(frag);
}

function renderSentencesInto(container, block) {
  for (const s of block.sentences) {
    const sEl = el('span', { class: 'sentence', 'data-sid': s.sid });
    if (s.start == null) sEl.classList.add('no-time');
    s.words.forEach((w) => {
      const wEl = el('span', { class: 'word', 'data-wid': w.wid, text: w.text });
      w.el = wEl;
      // Wrap with <em>/<strong> when the source had italic/bold; keep the
      // innermost node as the .word span so sync-highlight targeting still works.
      let node = wEl;
      if (w.italic) { const em = document.createElement('em'); em.appendChild(node); node = em; }
      if (w.bold)   { const strong = document.createElement('strong'); strong.appendChild(node); node = strong; }
      sEl.appendChild(node);
      if (!w.last) sEl.appendChild(document.createTextNode(' '));
    });
    s.el = sEl;
    container.appendChild(sEl);
  }
}

// ---- Mode toggle ----------------------------------------------------------
function setMode(mode) {
  App.state.mode = mode;
  document.body.dataset.mode = mode;
  const reader = $('#reader');
  reader.classList.toggle('book-mode', mode === 'book');
  reader.classList.toggle('study-mode', mode === 'study');
  $('#mode-book').classList.toggle('is-active', mode === 'book');
  $('#mode-study').classList.toggle('is-active', mode === 'study');
}

// ---- Transcript → text time mapping --------------------------------------
function flattenTranscript(tr) {
  const out = [];
  if (!tr) return out;
  const push = (w) => {
    if (w && w.word != null && w.start != null) out.push({ w: normWord(w.word), start: +w.start, end: +(w.end != null ? w.end : w.start) });
  };
  // book_word_segments: produced by --book-text mode in transcribe_whisperx.py.
  // These already contain the EPUB's exact words aligned to audio, so the JS
  // matcher gets near-100% hits without any further normalisation tricks.
  if (Array.isArray(tr.book_word_segments) && tr.book_word_segments.length) tr.book_word_segments.forEach(push);
  else if (Array.isArray(tr.word_segments) && tr.word_segments.length) tr.word_segments.forEach(push);
  else if (Array.isArray(tr.segments)) tr.segments.forEach(seg => (seg.words || []).forEach(push));
  else if (Array.isArray(tr.words)) tr.words.forEach(push);
  return out.filter(x => x.w);
}

// Map WhisperX word timings onto the book's own words. The audiobook and the
// ebook diverge in big ways (audiobook publisher intro the ebook lacks; ebook
// copyright/TOC the audio skips; the odd skipped/abridged passage), so a sliding
// window alone desyncs and never recovers.
//
// Anchor-based alignment (what survives those gaps):
//   1. Find trigrams that occur EXACTLY ONCE in both the book and the transcript
//      — distinctive phrases that pin the two sequences together reliably.
//   2. Keep anchors in book order, discarding any that aren't also increasing in
//      transcript order (removes coincidental cross-matches).
//   3. Time-stamp each anchor word, then fill the words BETWEEN consecutive
//      anchors with a short local greedy match bounded to that transcript span —
//      so a bad local guess can never run away past the next anchor.
function mapTranscript() {
  const T = flattenTranscript(App.transcript);
  if (!T.length) { App.words = []; return 0; }

  const BW = [];   // matchable book words, in reading order
  for (const s of App.sentences) for (const w of s.words) if (w.norm) BW.push(w);
  if (BW.length < 4) { App.words = []; return 0; }

  const Tn = T.map(x => x.w);
  const Bn = BW.map(w => w.norm);

  // Build an n-gram index: key → {count, firstPos}.
  function buildIndex(arr, n) {
    const cnt = new Map(), pos = new Map();
    for (let i = 0; i + n <= arr.length; i++) {
      let k = arr[i];
      for (let j = 1; j < n; j++) k += '|' + arr[i + j];
      cnt.set(k, (cnt.get(k) || 0) + 1);
      if (!pos.has(k)) pos.set(k, i);
    }
    return { cnt, pos };
  }

  // Collect anchors at a given n-gram size.
  function findAnchors(n) {
    const Ti = buildIndex(Tn, n), Bi = buildIndex(Bn, n);
    const out = [];
    for (const [k, c] of Bi.cnt) if (c === 1 && Ti.cnt.get(k) === 1) out.push([Bi.pos.get(k), Ti.pos.get(k)]);
    return out;
  }

  // Try 4-gram anchors first (more specific → fewer false positives).
  // If the book is very repetitive and 4-grams are sparse, supplement with
  // 3-gram anchors; the LIS step below discards any inconsistent extras.
  let rawAnchors = findAnchors(4);
  if (rawAnchors.length < 10) {
    const extra = findAnchors(3);
    rawAnchors = rawAnchors.concat(extra);
  }
  rawAnchors.sort((a, b) => a[0] - b[0]);
  // Deduplicate by book position (earlier entry wins; 4-gram entries come first).
  const seenBp = new Set();
  const anchors = rawAnchors.filter(([bp]) => { if (seenBp.has(bp)) return false; seenBp.add(bp); return true; });

  // Keep the largest consistent chain: the Longest Increasing Subsequence of
  // transcript positions (O(n log n)). This discards outliers such as a front-
  // matter title that also appears once in the audio's end credits — which a
  // naive "keep if increasing" greedy would let poison the whole alignment.
  const A = [];
  if (anchors.length) {
    const tails = [], prev = new Array(anchors.length).fill(-1);
    for (let i = 0; i < anchors.length; i++) {
      const x = anchors[i][1];
      let lo = 0, hi = tails.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (anchors[tails[m]][1] < x) lo = m + 1; else hi = m; }
      if (lo > 0) prev[i] = tails[lo - 1];
      if (lo === tails.length) tails.push(i); else tails[lo] = i;
    }
    let k = tails.length ? tails[tails.length - 1] : -1;
    while (k >= 0) { A.push(anchors[k]); k = prev[k]; }
    A.reverse();
  }

  let matched = 0;
  const assign = (w, p) => { if (w.start == null) matched++; w.start = T[p].start; w.end = T[p].end; };

  // local greedy fill of BW[bStart,bEnd) within T[tStart,tEnd)
  function fill(bStart, bEnd, tStart, tEnd) {
    let t = tStart;
    for (let bi = bStart; bi < bEnd; bi++) {
      const norm = Bn[bi];
      let found = -1;
      const lim = Math.min(tEnd, t + 24);
      for (let p = t; p < lim; p++) if (Tn[p] === norm) { found = p; break; }
      if (found < 0) for (let p = t; p < lim; p++) {
        const tw = Tn[p];
        if (tw && (tw.startsWith(norm) || norm.startsWith(tw)) && Math.min(tw.length, norm.length) >= 4) { found = p; break; }
      }
      if (found >= 0) { assign(BW[bi], found); t = found + 1; }
    }
  }

  if (A.length) {
    for (const [bp, tp] of A) assign(BW[bp], tp);          // the anchor words
    fill(0, A[0][0], 0, A[0][1]);                          // before first anchor
    for (let a = 0; a < A.length; a++) {                   // between anchors
      const [bp, tp] = A[a];
      const nx = A[a + 1];
      fill(bp + 1, nx ? nx[0] : BW.length, tp + 1, nx ? nx[1] : T.length);
    }
  } else {
    fill(0, BW.length, 0, T.length);                       // degenerate fallback
  }

  for (const s of App.sentences) {
    const timed = s.words.filter(w => w.start != null);
    s.start = timed.length ? Math.min(...timed.map(w => w.start)) : null;
    s.end = timed.length ? Math.max(...timed.map(w => w.end)) : null;
  }
  App.words = App.sentences.flatMap(s => s.words.filter(w => w.start != null)).sort((a, b) => a.start - b.start);
  return BW.length ? matched / BW.length : 0;
}

// ---- Navigation -----------------------------------------------------------
function scrollToSid(sid, pulse = true) {
  const s = App.sentences.find(x => x.sid === +sid);
  if (!s || !s.el) return;
  s.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (pulse) { s.el.classList.remove('hl-flash'); void s.el.offsetWidth; s.el.classList.add('hl-flash'); }
}
function scrollToHref(href) {
  if (!href) return;
  let key = href;
  // normalize: strip leading ../ and try with/without fragment
  const tryKeys = [href, href.replace(/^.*?([^/]+\.x?html.*)$/, '$1')];
  if (href.includes('#')) tryKeys.push(href.split('#')[0]);
  for (const base of Object.keys(App.anchorMap)) {
    if (tryKeys.some(k => base.endsWith(k) || k.endsWith(base) || base.includes(k))) {
      scrollToSid(App.anchorMap[base]); return;
    }
  }
  // last resort: match on filename
  const file = href.split('/').pop().split('#')[0];
  const hit = Object.keys(App.anchorMap).find(b => b.includes(file));
  if (hit) scrollToSid(App.anchorMap[hit]);
}

// ---- Book opening ---------------------------------------------------------
async function openBook(src, meta) {
  $('#library').hidden = true;
  $('#book-title').textContent = 'Loading…';
  // epub.js cannot infer the archive type from an extensionless URL (it would
  // try to load it as an unpacked directory and hang). Always feed it an
  // ArrayBuffer so it opens the zip as a binary archive.
  if (typeof src === 'string') {
    try { src = await fetch(src).then(r => r.arrayBuffer()); }
    catch (e) { toast('Could not load EPUB'); $('#book-title').textContent = 'Transcript Studio'; $('#library').hidden = false; return; }
  }
  const book = window.ePub(src);
  App.book = book;
  App.meta = meta || {};
  await book.ready;

  await buildContentModel(book);
  renderReader();
  setMode(App.state.mode);
  document.body.classList.remove('no-book');   // book is open — reveal full toolbar

  // Title
  try {
    const md = book.packaging && book.packaging.metadata;
    $('#book-title').textContent = (md && md.title) || (meta && meta.name) || 'Untitled';
  } catch (e) { $('#book-title').textContent = (meta && meta.name) || 'Book'; }

  // TOC
  try { Panel.buildTOC(book.navigation && book.navigation.toc); } catch (e) { console.warn(e); }

  // Load AUDIO FIRST and independently — it must not depend on the transcript
  // fetch or the (heavier) alignment step succeeding.
  if (meta && meta.audioUrl) Player.load(meta.audioUrl);
  else if (meta && meta.id && meta.audio) Player.load('/api/book/' + encodeURIComponent(meta.id) + '/audio');

  // transcript (for sync) — failures here must not break audio or the reader.
  if (meta && meta.transcript) { App.transcript = meta.transcript; }
  else if (meta && meta.id && meta.hasTranscript) {
    try {
      const txt = await fetch('/api/book/' + encodeURIComponent(meta.id) + '/transcript').then(r => r.text());
      App.transcript = parseJSONTolerant(txt);
      if (!App.transcript) { console.warn('transcript unparseable'); toast('Transcript could not be parsed (sync off)'); }
    }
    catch (e) { console.warn('transcript fetch failed', e); toast('Could not load transcript (sync off)'); }
  }
  if (App.transcript) {
    try {
      const rate = mapTranscript();
      App.sentences.forEach(s => { if (s.el) s.el.classList.toggle('no-time', s.start == null); });
      toast('Aligned ' + Math.round(rate * 100) + '% of words to audio');
    } catch (e) {
      console.error('alignment failed', e);
      toast('Audio sync alignment failed — playback still works');
    }
  }

  // existing session? load disk copy, then reconcile against the redundant
  // IndexedDB copy and use whichever is newer (covers a close-time beacon that
  // never reached disk, or read-only media).
  let diskSession = (meta && meta.session) || null;
  if (!diskSession && meta && meta.id && meta.hasSession) {
    try { diskSession = await fetch('/api/book/' + encodeURIComponent(meta.id) + '/session').then(r => r.json()); } catch (e) {}
  }
  const chosen = window.Autosave ? await Autosave.loadRedundant(diskSession) : diskSession;
  if (chosen) {
    Highlights.loadSession(chosen);
    if (chosen !== diskSession) toast('Restored newer local autosave');
  }

  // resume where you left off (audio time + scroll), if saved
  const pos = App.state.position;
  if (pos) {
    if (pos.audioTime) Player.resume(pos.audioTime);
    if (pos.sid != null) setTimeout(() => scrollToSid(pos.sid, false), 300);
  }

  Panel.renderHighlights();
  markDirty(false);

  // Enter the 3-window workspace (Book + Highlights + Now Playing).
  if (Panel.enterWorkspace) Panel.enterWorkspace();
}

// ---- Library --------------------------------------------------------------
async function loadLibrary() {
  const list = $('#book-list');
  list.innerHTML = '';
  let books = [], fetchOk = true;
  try { books = (await fetch('/api/books').then(r => r.json())).books || []; }
  catch (e) { fetchOk = false; }

  if (!books.length) {
    // Don't look "broken" — explain what the server actually sees, and give a Refresh.
    let diag = null;
    try { diag = await fetch('/api/diag').then(r => r.json()); } catch (e) {}
    const box = el('div', { class: 'empty-diag' });
    box.appendChild(el('div', { class: 'empty-title', text: fetchOk ? 'No books found yet' : 'Could not reach the server' }));
    if (diag) {
      box.appendChild(el('div', { class: 'muted small', text: 'Looking in: ' + diag.booksDir }));
      if (!diag.exists) box.appendChild(el('div', { class: 'muted small', text: 'That folder does not exist yet — create it and add a book folder inside.' }));
      else if (diag.error) box.appendChild(el('div', { class: 'muted small', text: 'Read error: ' + diag.error }));
      else box.appendChild(el('div', { class: 'muted small', text: 'It contains ' + diag.folders + ' folder(s), ' + diag.entries.length + ' entries — but none with an .epub.' }));
      if (diag.onedrive) box.appendChild(el('div', { class: 'warn small', text: 'This folder is in OneDrive. If you just copied files in, they may still be syncing or be cloud-only — wait a moment and hit Refresh, or move the books folder to a local/USB drive (see books-path.txt).' }));
    }
    box.appendChild(el('div', { class: 'muted small', text: 'Each book needs its own folder containing a .epub (plus optional audio + transcript.json).' }));
    const actions = el('div', { class: 'empty-actions' },
      el('button', { class: 'file-btn', text: 'Refresh', onclick: () => loadLibrary() }));
    box.appendChild(actions);
    list.appendChild(box);
    return;
  }
  const grid = el('div', { class: 'book-grid' });
  books.forEach(b => {
    const cover = b.hasCover
      ? el('img', { class: 'card-cover', src: '/api/book/' + encodeURIComponent(b.id) + '/cover', alt: '', loading: 'lazy' })
      : el('div', { class: 'card-cover card-cover-ph', text: (b.title || b.name || '?').slice(0, 1).toUpperCase() });

    const chips = el('div', { class: 'card-chips' });
    if (b.audio) chips.appendChild(el('span', { class: 'chip on', text: 'audio' }));
    if (b.hasTranscript) chips.appendChild(el('span', { class: 'chip on', text: 'sync' }));
    if (b.highlights) chips.appendChild(el('span', { class: 'chip', title: 'Saved highlights', text: b.highlights + ' highlight' + (b.highlights === 1 ? '' : 's') }));
    if (b.percent != null) chips.appendChild(el('span', { class: 'chip', text: Math.round(b.percent * 100) + '%' }));

    const card = el('div', { class: 'book-card', title: b.title || b.name, onclick: () => openBook('/api/book/' + encodeURIComponent(b.id) + '/epub', b) },
      cover,
      el('div', { class: 'card-info' },
        el('div', { class: 'card-title', text: b.title || b.name }),
        b.author ? el('div', { class: 'card-author', text: b.author }) : null,
        chips));
    grid.appendChild(card);
  });
  list.appendChild(grid);
}

// ---- Bootstrap ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  App.audio = $('#audio');
  document.body.classList.add('no-book');   // hide book-only toolbar controls until a book opens
  // Global appearance settings (localStorage), applied before first paint.
  loadPersistedSettings();
  const savedCustom = (App.settings.custom && App.settings.custom.bg) ? Object.assign({}, App.settings.custom) : null;
  applySettings();
  // Optionally follow the OS light/dark preference on launch.
  if (App.settings.autoDayNight && window.matchMedia) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? App.state.lastDarkTheme : App.state.lastLightTheme);
  } else {
    applyTheme(App.settings.theme);
    if (savedCustom) applyCustomColors(savedCustom.bg, savedCustom.fg);
  }
  loadLibrary();

  // manual file-open disclosure
  const mt = $('#manual-toggle');
  if (mt) mt.addEventListener('click', () => { const a = $('#manual-actions'); a.hidden = !a.hidden; });

  // mode tabs
  $('#mode-book').addEventListener('click', () => setMode('book'));
  $('#mode-study').addEventListener('click', () => setMode('study'));

  // focus mode — now lives on the Book window header
  const focusBtn = $('#reader-focus') || $('#btn-focus');
  if (focusBtn) focusBtn.addEventListener('click', (e) => {
    App.state.focus = !App.state.focus;
    $('#reader').classList.toggle('focus-mode', App.state.focus);
    e.currentTarget.classList.toggle('is-active', App.state.focus);
  });

  // window toggles (VideoNote-style ribbon)
  $('#btn-toc').addEventListener('click', () => Panel.toggle('toc'));
  $('#btn-highlights').addEventListener('click', () => Panel.toggle('hl'));
  $('#btn-np').addEventListener('click', () => Panel.toggleNowPlaying());
  $$('.panel-close').forEach(b => b.addEventListener('click', () => Panel.toggle(b.dataset.close, false)));
  const resetBtn = $('#btn-reset-layout');
  if (resetBtn) resetBtn.addEventListener('click', () => Panel.resetLayout());
  const libBtn = $('#btn-library');
  if (libBtn) libBtn.addEventListener('click', () => Panel.goLibrary());

  // per-window controls: reading controls (Aa) + theme picker live on the Book window
  const typeBtn = $('#reader-type') || $('#btn-type');
  if (typeBtn) typeBtn.addEventListener('click', (e) => Panel.openTypePopover(e.currentTarget));
  const themeBtn = $('#reader-theme') || $('#btn-theme');
  if (themeBtn) themeBtn.addEventListener('click', (e) => Panel.openThemePopover(e.currentTarget));

  // ⚙ Settings modal (replaces the old Menu / Theme / Light / Save ribbon buttons;
  // Ctrl+S still saves and autosave runs regardless)
  if (window.SettingsPanel) SettingsPanel.init();

  // ⛶ Fullscreen — VideoNote behavior: hide the ribbon, windows get the screen.
  // Uses the web Fullscreen API (works in the Electron shell and browsers; Esc
  // handled natively). Where the API is unavailable, fall back to hiding the
  // ribbon only ("zen" mode) so the button always does something useful.
  const setFs = (onOff) => {
    document.body.classList.toggle('fullscreen', onOff);
    window.dispatchEvent(new Event('resize'));   // windows re-clamp to the new space
  };
  document.addEventListener('fullscreenchange', () => setFs(!!document.fullscreenElement));
  const exitFs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    setFs(false);
  };
  const fsBtn = $('#btn-fullscreen');
  if (fsBtn) fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement || document.body.classList.contains('fullscreen')) { exitFs(); return; }
    document.documentElement.requestFullscreen().then(() => setFs(true)).catch(() => setFs(true));
  });
  const fsExit = $('#fs-exit');
  if (fsExit) fsExit.addEventListener('click', exitFs);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !document.fullscreenElement && document.body.classList.contains('fullscreen')) exitFs();
  });

  // highlights panel tabs
  $$('.hl-tab').forEach(t => t.addEventListener('click', () => {
    $$('.hl-tab').forEach(x => x.classList.remove('is-active'));
    t.classList.add('is-active');
    Panel.hlTab = t.dataset.tab;
    Panel.renderHighlights();
  }));

  // file inputs (open without server folder)
  const fileState = { epub: null, audio: null, transcript: null };
  $('#open-epub').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => openBook(reader.result, { name: f.name.replace(/\.epub$/i, ''), audioUrl: fileState.audio, transcript: fileState.transcript });
    reader.readAsArrayBuffer(f);
  });
  $('#open-audio').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    fileState.audio = URL.createObjectURL(f);
    if (App.book) Player.load(fileState.audio); else toast('Audio ready — now open an EPUB');
  });
  $('#open-transcript').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      fileState.transcript = parseJSONTolerant(r.result);
      if (!fileState.transcript) { toast('Bad transcript JSON (could not recover)'); return; }
      if (App.book) { App.transcript = fileState.transcript; const rate = mapTranscript(); App.sentences.forEach(s => s.el && s.el.classList.toggle('no-time', s.start == null)); toast('Aligned ' + Math.round(rate * 100) + '%'); }
      else toast('Transcript ready — now open an EPUB');
    };
    r.readAsText(f);
  });
  $('#open-session').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { Highlights.loadSession(JSON.parse(r.result)); Panel.renderHighlights(); toast('Session loaded'); } catch (err) { toast('Bad session JSON'); } };
    r.readAsText(f);
  });

  // global keyboard
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+F opens find even when focus is elsewhere; everything else below
    // is suppressed while typing in a field.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); if (window.Extras) Extras.openFind(); return;
    }
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName);
    if (typing) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (App.settings.spaceHighlightsPrev && Player.curSid != null) {
        Highlights.setSentence(Player.curSid, App.settings.activeCategory || 'note');
        toast('Highlighted');
      } else {
        Player.toggle();
      }
    }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); Highlights.undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); Highlights.redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); Highlights.save(); }
    else if (e.key === 'ArrowRight') { if (App.audio) App.audio.currentTime += (App.settings.seekStep || 5); }
    else if (e.key === 'ArrowLeft') { if (App.audio) App.audio.currentTime -= (App.settings.seekStep || 5); }
    else if (e.key === ']') { if (App.audio && Player.stepSpeed) Player.stepSpeed(1); }
    else if (e.key === '[') { if (App.audio && Player.stepSpeed) Player.stepSpeed(-1); }
    else if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (Player.curSid != null) { Highlights.setSentence(Player.curSid, App.settings.activeCategory || 'note'); toast('Highlighted'); }
      else toast('No sentence playing');
    }
    else if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (App.audio && App.audio.src) Highlights.addBookmark(App.audio.currentTime, Player.curSid);
      else toast('Load audio first');
    }
    else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (window.Extras) Extras.copyCurrentSentence();
    }
    else if (e.key === '?') { e.preventDefault(); if (window.Extras) Extras.showShortcuts(); }
  });

  // (No unsaved-changes nag: autosave debounces to disk and flushes via
  //  sendBeacon on close — see autosave.js.)
});
