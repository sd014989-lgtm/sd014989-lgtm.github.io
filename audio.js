/* ============================================================
   audio.js — player + the sync engine.
   Sync uses a ~80ms setInterval (NOT the audio 'timeupdate' event,
   which fires too slowly and skips short sentences). Minimum dwell
   per sentence so short blocks aren't flashed past.
   ============================================================ */
window.Player = (function () {
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];   // VideoNote's rate set
  const TICK_MS = 80;
  const MIN_DWELL = 0.3; // seconds a sentence stays current minimum

  let timer = null;
  let curWordIdx = -1;
  let curSid = null;
  let curSidSince = 0;
  let curWordEl = null;
  let curSentEl = null;
  let curSentData = null; // App.sentences entry for curSid (for sweep timing)
  let autoscroll = true;
  let _browseTimer = null;   // auto-return timer
  let _progScroll = false;   // true while ensureVisible() is scrolling (suppress browse detection)

  function audio() { return App.audio; }

  // keep both the footer play button and the Now-Playing window button in sync
  function setPlayIcons(sym) {
    const playing = sym === '❚❚';
    const a = $('#play-btn'); if (a) { a.textContent = sym; a.title = playing ? 'Pause (Space)' : 'Play (Space)'; }
    const b = $('#np-play'); if (b) { b.textContent = sym; b.title = playing ? 'Pause' : 'Play'; }
    if (window.PopSync) PopSync.playing(playing);
  }

  // Skip-seek buttons show the current step in their LABEL (VideoNote style:
  // "⏮ 10" / "10 ⏭") and tooltip; called at init and whenever seekStep changes.
  function updateSeekTooltips() {
    const step = (App.settings && App.settings.seekStep) || 5;
    const back = $('#np-back'); if (back) { back.textContent = '⏮ ' + step; back.title = 'Skip backward ' + step + ' seconds'; }
    const fwd  = $('#np-fwd');  if (fwd)  { fwd.textContent = step + ' ⏭'; fwd.title  = 'Skip forward ' + step + ' seconds'; }
  }

  // Set the playback rate everywhere (audio, dropdown, pop-outs).
  function setRate(sp) {
    const a = audio();
    sp = parseFloat(sp) || 1;
    a.playbackRate = sp;
    const sel = $('#speed-sel'); if (sel) sel.value = String(sp);
    if (window.PopSync) PopSync.speed(sp);
    return sp;
  }

  let stallTimer = null;
  function load(url) {
    const a = audio();
    a.src = url;
    const bar = $('#audio-bar'); if (bar) bar.hidden = false;   // player now lives in the NP window
    const dt = $('#dur-time'); if (dt) dt.textContent = '…';   // loading indicator
    a.load();
    // If metadata never arrives (e.g. a cloud-only file in OneDrive that won't
    // stream), say so instead of failing silently.
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!a.duration || isNaN(a.duration)) {
        $('#dur-time').textContent = '!';
        toast('Audio is taking long to load — if it lives in OneDrive it may be cloud-only. Right-click it → "Always keep on this device", or move the book folder to a local/USB drive.');
      }
    }, 12000);
    a.onloadedmetadata = () => {
      clearTimeout(stallTimer);
      $('#dur-time').textContent = '-' + fmtTime(a.duration);   // VideoNote-style remaining
      setRate(App.settings.defaultRate || 1);                    // start at the default speed
      buildChapterMarks(); buildHighlightMarks(); buildBookmarkMarks();
    };
    a.onerror = () => { clearTimeout(stallTimer); $('#dur-time').textContent = '!'; toast('Could not load the audio file (' + ((a.error && a.error.code) ? 'code ' + a.error.code : 'unknown') + '). Check the file is a supported format and fully downloaded.'); };
    a.ontimeupdate = () => { /* progress only; sync uses interval */ };
    a.onplay = () => { setPlayIcons('❚❚'); start(); };
    a.onpause = () => { setPlayIcons('▶'); stop(); };
    a.onended = () => { setPlayIcons('▶'); stop(); };
  }

  function toggle() {
    const a = audio();
    if (!a.src) { toast('Load an audio file first'); return; }
    if (a.paused) a.play(); else a.pause();
  }

  function start() { if (!timer) timer = setInterval(tick, TICK_MS); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  function tick() {
    const a = audio();
    const t = a.currentTime;
    // progress bar + times (current · -remaining, VideoNote style)
    const pct = a.duration ? (t / a.duration) * 100 : 0;
    $('#progress-fill').style.width = pct + '%';
    $('#cur-time').textContent = fmtTime(t);
    if (a.duration) $('#dur-time').textContent = '-' + fmtTime(a.duration - t);

    // remember position for resume (saved on close / next highlight)
    const prevSid = App.state.position && App.state.position.sid;
    App.state.position = { sid: curSid != null ? curSid : prevSid, audioTime: t, percent: a.duration ? t / a.duration : null };

    // keep the TOC's current-chapter highlight in sync (throttles internally)
    if (window.Panel && Panel.updateActiveChapter) Panel.updateActiveChapter(t);

    const W = App.words;
    if (!W.length) return;

    // find last word whose start <= t (hint-accelerated)
    let i = curWordIdx; if (i < 0 || i >= W.length) i = 0;
    while (i < W.length - 1 && W[i + 1].start <= t) i++;
    while (i > 0 && W[i].start > t) i--;

    const w = W[i];
    const whl = App.settings.wordHighlight || 'off';
    if (w !== curWordEl) {
      if (curWordEl && curWordEl.el && whl === 'word') curWordEl.el.classList.remove('word-current');
      if (w.el && whl === 'word') w.el.classList.add('word-current');
      curWordEl = w;
      curWordIdx = i;
      $('#word-pill').textContent = w.text;
      const npw = document.getElementById('np-word'); if (npw) npw.textContent = w.text;
      if (window.PopSync) PopSync.word(w.text);
    }

    // sentence highlight with min dwell
    if (w.sid !== curSid && (t - curSidSince) >= MIN_DWELL) {
      setSentence(w.sid, t);
    } else if (curSid == null) {
      setSentence(w.sid, t);
    }

    // sweep word highlight: animate a left-to-right gradient fill on the active sentence
    if (whl === 'sweep' && curSentEl && curSentData) {
      const start = curSentData.start, end = curSentData.end;
      const dur = (start != null && end != null) ? end - start : 0;
      const p = dur > 0 ? Math.max(0, Math.min(1, (t - start) / dur)) : 0;
      curSentEl.style.setProperty('--sweep-p', (p * 100).toFixed(2) + '%');
    }
  }

  function setSentence(sid, t) {
    if (curSentEl) {
      curSentEl.classList.remove('sentence-current', 'sweep-active');
      curSentEl.style.removeProperty('--sweep-p');
    }
    const s = App.sentences.find(x => x.sid === sid);
    curSid = sid; curSidSince = t; curSentData = s || null;
    const nps = document.getElementById('np-sentence'); if (nps) nps.textContent = s ? s.text : '—';
    if (window.PopSync) PopSync.sentence(s ? s.text : '—');
    if (s && s.el) {
      s.el.classList.add('sentence-current');
      if ((App.settings.wordHighlight || 'off') === 'sweep') s.el.classList.add('sweep-active');
      curSentEl = s.el;
      if (autoscroll && !audio().paused) ensureVisible(s.el);
    }
  }

  function ensureVisible(elm) {
    const wrap = $('#reader-scroll') || $('#reader-wrap');   // inner scroller (book window)
    const r = elm.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    if (r.top < w.top + 80 || r.bottom > w.bottom - 80) {
      _progScroll = true;
      setTimeout(() => { _progScroll = false; }, 250);
      elm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function initAutoReturn() {
    const wrap = $('#reader-scroll') || $('#reader-wrap');
    if (!wrap) return;
    wrap.addEventListener('scroll', () => {
      if (_progScroll) return;
      const a = audio();
      if (!a || a.paused) return;
      const sec = App.settings.autoReturnSec || 0;
      if (sec <= 0) return;
      autoscroll = false;
      clearTimeout(_browseTimer);
      _browseTimer = setTimeout(() => {
        autoscroll = true;
        _browseTimer = null;
        if (curSentEl) ensureVisible(curSentEl);
      }, sec * 1000);
    });
  }

  function seek(t) { const a = audio(); if (a.src) { a.currentTime = Math.max(0, Math.min(t, a.duration || t)); curWordIdx = -1; } }
  // Resume to a saved audio time once metadata is available (paused).
  function resume(t) {
    if (t == null || !isFinite(t) || t <= 0) return;
    const a = audio();
    const doSeek = () => { seek(t); tick(); };
    if (a.readyState >= 1 && a.duration) doSeek();
    else a.addEventListener('loadedmetadata', doSeek, { once: true });
  }
  // Seek to a sentence. Never fail silently — an untimed sentence / missing
  // transcript / missing audio each explain themselves with a toast.
  function seekToSid(sid) {
    const s = App.sentences.find(x => x.sid === +sid);
    if (!s || s.start == null) {
      const anyTimed = (App.sentences || []).some(x => x.start != null);
      toast(anyTimed ? 'No audio timing for this sentence'
                     : 'No transcript for this book — add transcript.json to enable audio sync');
      return false;
    }
    if (!audio().src) { toast('No audio file loaded'); return false; }
    seek(s.start); if (audio().paused) tick();
    return true;
  }

  // ---- progress bar interactions ----
  function initProgress() {
    const bar = $('#progress'), tip = $('#progress-tip');
    bar.addEventListener('click', (e) => {
      const a = audio(); if (!a.duration) return;
      const r = bar.getBoundingClientRect();
      seek(((e.clientX - r.left) / r.width) * a.duration);
    });
    bar.addEventListener('mousemove', (e) => {
      const a = audio(); if (!a.duration) { tip.hidden = true; return; }
      const r = bar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      tip.hidden = false; tip.style.left = (frac * 100) + '%';
      tip.textContent = fmtTime(frac * a.duration);
    });
    bar.addEventListener('mouseleave', () => { tip.hidden = true; });
    $('#play-btn').addEventListener('click', toggle);
    const sel = $('#speed-sel');
    if (sel) sel.addEventListener('change', () => setRate(sel.value));
    // VideoNote: clicking the player body toggles play/pause
    const npBody = $('#np-body');
    if (npBody) npBody.addEventListener('click', (e) => { if (!e.target.closest('button,select,a')) toggle(); });
  }

  function buildChapterMarks() {
    const a = audio(); const marks = $('#chapter-marks');
    marks.innerHTML = '';
    if (!a.duration || !App.chapters) return;
    App.chapters.forEach(ch => {
      if (ch.start == null) return;
      const m = el('div', { class: 'chapter-mark', title: ch.label });
      m.style.left = (ch.start / a.duration * 100) + '%';
      m.addEventListener('click', (e) => { e.stopPropagation(); seek(ch.start); });
      m.addEventListener('mouseenter', () => {
        const tip = $('#progress-tip'); tip.hidden = false;
        tip.style.left = (ch.start / a.duration * 100) + '%';
        tip.textContent = ch.label;
      });
      marks.appendChild(m);
    });
  }

  function openSpeed(anchor) {
    const a = audio();
    const list = el('div', { class: 'speed-list' });
    SPEEDS.forEach(sp => {
      const b = el('button', { text: sp + '×', class: a.playbackRate === sp ? 'is-active' : '', onclick: () => { setRate(sp); closePopover(); } });
      list.appendChild(b);
    });
    const wrap = el('div', {}, el('h4', { text: 'Speed' }), list);
    openPopover(wrap, anchor);
  }

  // Advance playback rate to the next preset (used by the pop-out speed button).
  function cycleSpeed() { return stepSpeed(1, true); }

  // Step playback rate by one preset (+1 / -1). Used by [ and ] keys.
  function stepSpeed(dir, wrap) {
    const a = audio();
    let i = SPEEDS.indexOf(a.playbackRate);
    if (i < 0) i = SPEEDS.indexOf(1);
    i = wrap ? (i + dir + SPEEDS.length) % SPEEDS.length
             : Math.max(0, Math.min(SPEEDS.length - 1, i + dir));
    return setRate(SPEEDS[i]);
  }

  // Triangular pins on the progress bar, one per bookmark.
  function buildBookmarkMarks() {
    const a = audio(); const marks = $('#bookmark-marks');
    if (!marks) return;
    marks.innerHTML = '';
    if (!a.duration || !App.bookmarks) return;
    App.bookmarks.forEach(bm => {
      if (bm.time == null) return;
      const m = el('div', { class: 'bm-mark', title: (bm.label || 'Bookmark') + ' · ' + fmtTime(bm.time) });
      m.style.left = (bm.time / a.duration * 100) + '%';
      m.addEventListener('click', (e) => { e.stopPropagation(); seek(bm.time); });
      m.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); Highlights.removeBookmark(bm.id); });
      marks.appendChild(m);
    });
  }

  // Coloured ticks on the progress bar, one per highlighted timed sentence.
  function buildHighlightMarks() {
    const a = audio(); const marks = $('#highlight-marks');
    if (!marks) return;
    marks.innerHTML = '';
    if (!a.duration || !App.highlights) return;
    Object.entries(App.highlights).forEach(([sid, rec]) => {
      const s = App.sentences.find(x => x.sid === +sid);
      if (!s || s.start == null) return;
      const m = el('div', { class: 'hl-mark cat-' + rec.category, title: 'Highlight' });
      m.style.left = (s.start / a.duration * 100) + '%';
      m.addEventListener('click', (e) => { e.stopPropagation(); seek(s.start); });
      marks.appendChild(m);
    });
  }

  document.addEventListener('DOMContentLoaded', () => { initProgress(); initAutoReturn(); updateSeekTooltips(); });

  return {
    load, toggle, seek, resume, seekToSid, buildChapterMarks, buildHighlightMarks, buildBookmarkMarks, openSpeed, cycleSpeed, stepSpeed, setRate, updateSeekTooltips,
    setAutoscroll: (v) => { autoscroll = v; clearTimeout(_browseTimer); _browseTimer = null; },
    get autoscroll() { return autoscroll; },
    get curSid() { return curSid; },
    get curText() { return curSentData ? curSentData.text : null; },
  };
})();
