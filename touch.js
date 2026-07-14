/* ============================================================
   touch.js — iPad/touch interaction layer for the PWA build.

   The desktop app assumes right-click, hover, and a MOUSE (all window drag /
   resize / maximize code in panel.js is mousedown/mousemove). This overlay
   makes the SAME desktop UI work by touch WITHOUT modifying app/:

     • touch→mouse shim: finger-drags on window headers, the 8-way resize
       edges, corner handles, docked resizers, and the Now Playing progress
       bar are translated into the mouse events panel.js/audio.js listen for
       — so drag, resize, maximize and the player scrubber all work by touch.
     • sentence taps owned at the touch level (iOS eats fast double CLICKS):
       single tap = highlight / edit, double tap = seek, long-press = menu.
     • a two-row bottom bar: a fat audio scrubber with times, and icon+text
       buttons (no cryptic icon-only buttons) sized for iPad Pro 12.9".
     • safe-area clamp: maximized / restored / fullscreen windows are kept
       below the iOS status bar (the app tiles from y≈8 when the toolbar is
       hidden, which lands under the clock).

   Loaded before ts-ipad.js. To debug the desktop layout in a browser, set
   localStorage 'ts-force-desktop' = '1'.
   ============================================================ */
(function () {
  'use strict';

  let forceDesktop = false;
  try { forceDesktop = localStorage.getItem('ts-force-desktop') === '1'; } catch (e) {}
  if (forceDesktop) return;   // this IS the iPad build → touch mode is the default

  let inited = false;
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(init);

  function init() {
    if (inited) return; inited = true;
    document.body.classList.add('ts-touch');
    wireSentenceTouch();
    wirePhrase();
    touchToMouse();
    buildBar();
    syncPlayIcon();
    wireSafeAreaClamp();
  }
  function inPhraseMode() { return document.body.classList.contains('ts-phrase-mode'); }

  /* ---------- helpers that drive the app ---------- */
  function A() { return window.App && App.audio; }
  function seekStep() { return (window.App && App.settings && App.settings.seekStep) || 5; }
  function seekBy(d) { const a = A(); if (a && a.src) a.currentTime = Math.max(0, Math.min(a.duration || 1e12, a.currentTime + d)); else toastSafe('Load a book with audio first'); }
  function clickEl(id) { const el = document.getElementById(id); if (el) el.click(); }
  function toastSafe(m) { if (window.toast) toast(m); }
  function fmtT(s) { if (!isFinite(s) || s < 0) s = 0; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }

  /* ============================================================
     1. SENTENCE TAPS — owned at the TOUCH level.
     The previous version listened for `click`, but iOS suppresses / delays
     the second synthesized click of a fast double-tap, so double-tap-to-seek
     never fired on the device. touchend is delivered raw and immediately.
       single tap  → quick-highlight (or the edit menu if already highlighted)
       double tap  → seek audio to that sentence
       long press  → the app's context menu (highlight / note / seek / copy)
     ============================================================ */
  function wireSentenceTouch() {
    const reader = document.getElementById('reader');
    if (!reader) return;
    let sid = null, sx = 0, sy = 0, moved = false, multi = false;
    let lpTimer = null, lpFired = false;
    let lastSid = null, lastAt = 0, pendTimer = null, px = 0, py = 0;
    const cancelLP = () => { clearTimeout(lpTimer); lpTimer = null; };

    reader.addEventListener('touchstart', (e) => {
      if (inPhraseMode()) { cancelLP(); sid = null; return; }   // ✂ mode owns the gesture
      // A cancelled phrase chooser can leave an invisible programmatic selection
      // behind — clear it on the next reading touch so it can't confuse the app.
      try { const s = window.getSelection(); if (s && s.rangeCount) s.removeAllRanges(); } catch (e2) {}
      if (e.touches.length !== 1) { multi = true; cancelLP(); return; }
      const t = e.touches[0];
      const sentEl = t.target.closest && t.target.closest('.sentence');
      multi = false; moved = false; lpFired = false;
      sid = sentEl ? +sentEl.dataset.sid : null;
      if (sid == null) return;
      sx = t.clientX; sy = t.clientY;
      cancelLP();
      lpTimer = setTimeout(() => {
        lpFired = true;
        if (window.Extras && Extras.openContextMenu) Extras.openContextMenu(sx, sy, sid);
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e2) {} }
      }, 460);
    }, { passive: true });

    reader.addEventListener('touchmove', (e) => {
      const t = e.touches[0]; if (!t) return;
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) { moved = true; cancelLP(); }
    }, { passive: true });

    reader.addEventListener('touchcancel', () => { cancelLP(); sid = null; }, { passive: true });

    reader.addEventListener('touchend', (e) => {
      cancelLP();
      if (inPhraseMode()) { sid = null; return; }
      if (sid == null) return;
      const endSid = sid; sid = null;
      if (lpFired) { e.preventDefault(); return; }              // menu already opened
      if (moved || multi) return;                               // scroll / pinch, not a tap
      e.preventDefault();                                       // suppress the synthesized click (the app's handler never sees it)
      const now = Date.now();
      if (lastSid === endSid && (now - lastAt) < 350) {         // DOUBLE TAP → seek
        clearTimeout(pendTimer); pendTimer = null; lastSid = null;
        if (window.Player && Player.seekToSid) Player.seekToSid(endSid);
        return;
      }
      lastSid = endSid; lastAt = now;
      const t = e.changedTouches && e.changedTouches[0];
      px = t ? t.clientX : sx; py = t ? t.clientY : sy;
      clearTimeout(pendTimer);
      pendTimer = setTimeout(() => { pendTimer = null; lastSid = null; singleTap(endSid, px, py); }, 300);
    }, { passive: false });

    // Belt: if any click on a sentence still synthesizes, swallow it so the
    // app's click-count handler can't double-fire what we already handled.
    reader.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.sentence')) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }
  function singleTap(sid, x, y) {
    if (window.App && App.highlights && App.highlights[sid]) {
      if (window.Extras && Extras.openContextMenu) Extras.openContextMenu(x, y, sid);   // edit existing
    } else if (window.Highlights && Highlights.setSentence) {
      Highlights.setSentence(sid, (window.App && App.settings && App.settings.activeCategory) || 'note');
    }
  }

  /* ============================================================
     1b. PHRASE MODE — highlight PART of a sentence by touch.
     Desktop does this with mouse drag-select → the app's reader `mouseup`
     handler reads the DOM selection, opens its category chooser, and calls
     addWordHighlight (with undo). Touch can't drag-select (we disable
     user-select for clean gestures), so:
       ✂ Phrase (bar button) → drag a finger across words (live paint) →
       release → we build a REAL DOM Range over those words and dispatch the
       very mouseup(detail 1) the app listens for → the app's own chooser +
       data path run unmodified. One-shot: applying (or re-tapping ✂) exits.
     ============================================================ */
  let phWords = null, phAnchor = -1, phCur = -1, phPainted = [];
  function setPhraseMode(on) {
    document.body.classList.toggle('ts-phrase-mode', on);
    const b = document.getElementById('tsbar-phrase');
    if (b) b.classList.toggle('active', on);
    phClear();
    if (on) {
      phWords = Array.prototype.slice.call(document.querySelectorAll('#reader .word'));
      if (!phWords.length) { toastSafe('Open a book first'); setPhraseMode(false); return; }
      if (window.closePopover) closePopover();
      toastSafe('Drag across the words you want, then pick a color. Tap ✂ again to cancel.');
    } else { phWords = null; }
  }
  function phClear() {
    phPainted.forEach(w => w.classList.remove('ts-psel'));
    phPainted = []; phAnchor = -1; phCur = -1;
  }
  function phPaint() {
    phPainted.forEach(w => w.classList.remove('ts-psel'));
    phPainted = [];
    if (phAnchor < 0 || phCur < 0) return;
    const lo = Math.min(phAnchor, phCur), hi = Math.max(phAnchor, phCur);
    for (let i = lo; i <= hi; i++) { phWords[i].classList.add('ts-psel'); phPainted.push(phWords[i]); }
  }
  function phWordAt(x, y) {
    const el2 = document.elementFromPoint(x, y);
    const w = el2 && el2.closest && el2.closest('.word');
    return w ? phWords.indexOf(w) : -1;
  }
  function wirePhrase() {
    const reader = document.getElementById('reader');
    if (!reader) return;
    reader.addEventListener('touchstart', (e) => {
      if (!inPhraseMode() || e.touches.length !== 1) return;
      e.preventDefault();                                   // ✂ mode: no scrolling, we own the finger
      const t = e.touches[0];
      phWords = Array.prototype.slice.call(document.querySelectorAll('#reader .word'));  // fresh (chapter may have changed)
      const i = phWordAt(t.clientX, t.clientY);
      if (i >= 0) { phAnchor = phCur = i; phPaint(); }
    }, { passive: false, capture: true });
    reader.addEventListener('touchmove', (e) => {
      if (!inPhraseMode() || phAnchor < 0) return;
      e.preventDefault();
      const t = e.touches[0]; if (!t) return;
      const i = phWordAt(t.clientX, t.clientY);
      if (i >= 0 && i !== phCur) { phCur = i; phPaint(); }
    }, { passive: false, capture: true });
    reader.addEventListener('touchend', (e) => {
      if (!inPhraseMode()) return;
      e.preventDefault(); e.stopImmediatePropagation();     // keep the tap model out of this
      if (phAnchor < 0) return;
      const lo = Math.min(phAnchor, phCur), hi = Math.max(phAnchor, phCur);
      const first = phWords[lo], last = phWords[hi];
      const t = e.changedTouches && e.changedTouches[0];
      phApply(first, last, t ? t.clientX : 100, t ? t.clientY : 100);
    }, { passive: false, capture: true });
    reader.addEventListener('touchcancel', () => { if (inPhraseMode()) phClear(); }, { passive: true });
  }
  function phApply(first, last, x, y) {
    // user-select:none excludes words from selection.toString() — re-enable just
    // long enough to build the range and hand it to the app's own mouseup flow.
    document.body.classList.add('ts-phrase-apply');
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.setStartBefore(first); range.setEndAfter(last);
      sel.addRange(range);
      last.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: window, detail: 1, button: 0,
        clientX: x, clientY: Math.max(60, y - 10),
      }));   // → app: selection → category chooser → addWordHighlight (undo-able)
    } catch (err) { toastSafe('Could not select that phrase'); }
    finally { setTimeout(() => document.body.classList.remove('ts-phrase-apply'), 120); }
    phClear();
    setPhraseMode(false);   // one-shot; the chooser popover stays up for the pick
  }

  /* ============================================================
     2. TOUCH→MOUSE SHIM — the whole desktop window system by finger.
     panel.js wires drag (.panel-head), 8-way resize (.fw-resize), corner
     resize ([data-fresize]) and docked resizers (.resizer) with mouse events
     only. We translate a one-finger gesture on those exact elements into
     mousedown → mousemove(document) → mouseup(document), which is precisely
     what those handlers expect. #progress (Now Playing bar) also gets a
     synthetic click at the release point = tap/drag-to-seek.
     ============================================================ */
  function touchToMouse() {
    const SEL = '.panel-head, .fw-resize, [data-fresize], .resizer, #progress';
    const fire = (type, el, pt) => el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, button: 0,
      clientX: pt.clientX, clientY: pt.clientY,
    }));
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = t.target.closest ? t.target.closest(SEL) : null;
      if (!target) return;
      if (target.classList.contains('panel-head')) {
        if (t.target.closest('button, select, input, a')) return;   // header buttons stay tappable
        const panel = target.closest('.side-panel, #reader-wrap');
        if (!panel || !panel.classList.contains('floating')) return; // docked headers don't drag
      }
      e.preventDefault();                       // no scroll, no synthesized mouse sequence
      fire('mousedown', target, t);
      // Dispatch on the TARGET, not document: it bubbles up to the document-level
      // drag handlers either way, and target-level listeners (e.g. #progress's
      // hover tooltip) now fire too — so scrubbing shows the time under the finger.
      const move = (ev) => { const mt = ev.touches[0]; if (mt) { ev.preventDefault(); fire('mousemove', target, mt); } };
      const end = (ev) => {
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        const lt = (ev.changedTouches && ev.changedTouches[0]) || t;
        fire('mouseup', target, lt);
        if (target.id === 'progress') { fire('click', target, lt); fire('mouseleave', target, lt); }   // seek, then hide the tip
      };
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', end);
      document.addEventListener('touchcancel', end);
    }, { passive: false, capture: true });
  }

  /* ============================================================
     3. SAFE-AREA CLAMP — keep floating windows out of the status bar.
     panel.js computes bounds from the toolbar height; in fullscreen the
     toolbar is display:none, so maximize/tile lands at y≈8 — under the iOS
     clock. Clamp every visible floating window below the safe-area (or the
     toolbar when it's visible) whenever fullscreen / maximize / restore /
     resize happens.
     ============================================================ */
  let satProbe = null;
  function safeTop() {
    if (!satProbe) {
      satProbe = document.createElement('div');
      satProbe.style.cssText = 'position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);width:0;pointer-events:none;visibility:hidden';
      document.body.appendChild(satProbe);
    }
    return satProbe.getBoundingClientRect().height || 0;
  }
  function clampWindows() {
    const tb = document.getElementById('toolbar');
    const tbVisible = tb && getComputedStyle(tb).display !== 'none';
    const minTop = (tbVisible ? tb.getBoundingClientRect().bottom : safeTop()) + 4;
    ['toc-panel', 'hl-panel', 'now-playing', 'reader-wrap'].forEach(id => {
      const p = document.getElementById(id);
      if (!p || p.hidden || !p.classList.contains('floating')) return;
      const r = p.getBoundingClientRect();
      if (r.top >= minTop - 1) return;
      p.style.top = minTop + 'px';
      const maxH = window.innerHeight - minTop - 8;
      if (r.height > maxH) p.style.height = maxH + 'px';
    });
  }
  function clampSoon() { setTimeout(clampWindows, 30); setTimeout(clampWindows, 250); }
  function wireSafeAreaClamp() {
    new MutationObserver((muts) => {
      for (const m of muts) if (m.attributeName === 'class') { clampSoon(); return; }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });   // fullscreen / windowed toggles
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-max], .restore-pill, #btn-reset-layout, #btn-fullscreen, #fs-exit')) clampSoon();
    }, true);
    window.addEventListener('resize', clampSoon);
    clampSoon();
  }

  /* ============================================================
     4. BOTTOM BAR — two rows for iPad Pro 12.9".
     Row 1: fat audio scrubber (current time · draggable track · remaining).
     Row 2: icon + text buttons (every button labelled, no icon-only cryptics).
     ============================================================ */
  function mkBtn(icon, label, title, onTap, opts) {
    opts = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title || label;
    b.setAttribute('aria-label', title || label);
    if (opts.cls) b.className = opts.cls;
    const ic = document.createElement('span'); ic.className = 'ico'; ic.textContent = icon;
    const lb = document.createElement('span'); lb.className = 'lbl' + (opts.optional ? ' opt' : '') + (opts.optional2 ? ' opt2' : ''); lb.textContent = label;
    b.appendChild(ic); b.appendChild(lb);
    b.addEventListener('click', (e) => { e.preventDefault(); onTap(b); });
    return b;
  }
  function sep() { const s = document.createElement('span'); s.className = 'tbar-sep'; return s; }
  function grow() { const s = document.createElement('span'); s.className = 'grow'; return s; }

  let scrubDragging = false;
  function buildScrubber() {
    const row = document.createElement('div');
    row.id = 'tsbar-scrub';
    const cur = document.createElement('span'); cur.id = 'tsbar-cur'; cur.className = 'tsbar-time'; cur.textContent = '0:00';
    const track = document.createElement('div'); track.id = 'tsbar-track';
    const fill = document.createElement('div'); fill.id = 'tsbar-fill';
    const knob = document.createElement('div'); knob.id = 'tsbar-knob';
    track.appendChild(fill); track.appendChild(knob);
    const rem = document.createElement('span'); rem.id = 'tsbar-rem'; rem.className = 'tsbar-time'; rem.textContent = '-0:00';
    row.appendChild(cur); row.appendChild(track); row.appendChild(rem);

    function paint(frac, dur) {
      const pct = Math.max(0, Math.min(1, frac)) * 100;
      fill.style.width = pct + '%';
      knob.style.left = pct + '%';
      cur.textContent = fmtT(frac * dur);
      rem.textContent = '-' + fmtT((1 - frac) * dur);
    }
    function update() {
      if (scrubDragging) return;
      const a = A();
      if (a && a.src && isFinite(a.duration) && a.duration > 0) { row.classList.remove('empty'); paint(a.currentTime / a.duration, a.duration); }
      else { row.classList.add('empty'); fill.style.width = '0%'; knob.style.left = '0%'; cur.textContent = '0:00'; rem.textContent = '-0:00'; }
    }
    setInterval(update, 500);
    update();

    function fracFromX(x) { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); }
    track.addEventListener('touchstart', (e) => {
      const a = A(); if (!(a && a.src && isFinite(a.duration) && a.duration > 0)) return;
      e.preventDefault(); scrubDragging = true;
      paint(fracFromX(e.touches[0].clientX), a.duration);
    }, { passive: false });
    track.addEventListener('touchmove', (e) => {
      if (!scrubDragging) return;
      const a = A(); if (!a) return;
      e.preventDefault();
      paint(fracFromX(e.touches[0].clientX), a.duration);
    }, { passive: false });
    const finish = (e) => {
      if (!scrubDragging) return;
      scrubDragging = false;
      const a = A(); if (!(a && a.src && isFinite(a.duration))) return;
      const t = (e.changedTouches && e.changedTouches[0]);
      if (t && window.Player && Player.seek) Player.seek(fracFromX(t.clientX) * a.duration);
      else if (t) a.currentTime = fracFromX(t.clientX) * a.duration;
    };
    track.addEventListener('touchend', finish);
    track.addEventListener('touchcancel', () => { scrubDragging = false; });
    // mouse fallback (in-app browser testing)
    track.addEventListener('click', (e) => {
      const a = A(); if (!(a && a.src && isFinite(a.duration) && a.duration > 0)) return;
      if (window.Player && Player.seek) Player.seek(fracFromX(e.clientX) * a.duration);
      else a.currentTime = fracFromX(e.clientX) * a.duration;
    });
    return row;
  }

  function buildBar() {
    if (document.getElementById('tsipad-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'tsipad-bar';

    bar.appendChild(buildScrubber());

    const row = document.createElement('div');
    row.id = 'tsbar-btns';

    row.appendChild(mkBtn('‹', 'Library', 'Back to your library', () => clickEl('btn-library')));
    row.appendChild(mkBtn('☰', 'Contents', 'Show / hide the Contents window', () => clickEl('btn-toc'), { optional: true }));
    row.appendChild(mkBtn('🖍', 'Highlights', 'Show / hide the Highlights window', () => clickEl('btn-highlights'), { optional: true }));
    row.appendChild(mkBtn('⋯', 'Menu', 'Exports, bookmarks, stats, sleep timer…', (b) => {
      const r = b.getBoundingClientRect();
      if (window.Panel && Panel.openMenuPopover) Panel.openMenuPopover({ x: Math.max(8, r.left - 40), y: r.top - 8 });
    }));

    row.appendChild(grow());

    const back = mkBtn('⏪', seekStep() + 's', 'Skip backward', () => seekBy(-seekStep()));
    back.id = 'tsbar-back';
    row.appendChild(back);
    const play = mkBtn('▶', 'Play', 'Play / pause', () => { if (window.Player) Player.toggle(); }, { cls: 'primary' });
    play.id = 'tsbar-play';
    row.appendChild(play);
    const fwd = mkBtn('⏩', seekStep() + 's', 'Skip forward', () => seekBy(seekStep()));
    fwd.id = 'tsbar-fwd';
    row.appendChild(fwd);
    const speed = mkBtn('1×', 'Speed', 'Playback speed', (b) => {
      const r = b.getBoundingClientRect();
      if (window.Player && Player.openSpeed) Player.openSpeed({ x: Math.max(8, r.left - 40), y: r.top - 8 });
      else if (window.Player && Player.cycleSpeed) Player.cycleSpeed();
      setTimeout(updateSpeed, 50);
    }, { cls: 'tbar-speed' });
    speed.id = 'tsbar-speed';
    row.appendChild(speed);

    row.appendChild(grow());

    row.appendChild(mkBtn('★', 'Highlight', 'Highlight the sentence being read right now', () => {
      const el = document.getElementById('hl-add-current');
      if (el) el.click(); else if (window.Player && Player.curSid != null && window.Highlights) Highlights.setSentence(Player.curSid, (App.settings && App.settings.activeCategory) || 'note');
    }));
    const phrase = mkBtn('✂', 'Phrase', 'Select part of a sentence to highlight — tap, then drag across words', () => setPhraseMode(!inPhraseMode()));
    phrase.id = 'tsbar-phrase';
    row.appendChild(phrase);
    row.appendChild(mkBtn('✎', 'Note', 'Highlight the current sentence and open its note', () => clickEl('hl-note-current'), { optional: true }));
    row.appendChild(mkBtn('⚑', 'Bookmark', 'Bookmark this position in the audio', () => {
      const a = A();
      if (a && a.src && window.Highlights) Highlights.addBookmark(a.currentTime, window.Player ? Player.curSid : null);
      else toastSafe('Load audio first');
    }, { optional2: true }));
    row.appendChild(sep());
    row.appendChild(mkBtn('🔍', 'Find', 'Find in book', () => { if (window.Extras) Extras.openFind(); }, { optional2: true }));
    row.appendChild(mkBtn('↶', 'Undo', 'Undo the last highlight change', () => { if (window.Highlights) Highlights.undo(); }, { optional2: true }));
    row.appendChild(mkBtn('⚙', 'Settings', 'All settings', () => clickEl('btn-settings'), { optional: true }));

    bar.appendChild(row);
    document.body.appendChild(bar);
    updateSpeed();
    updateSeekLabels();
  }

  function updateSpeed() {
    const el = document.getElementById('tsbar-speed'); const a = A();
    if (el && a) { const l = el.querySelector('.ico'); if (l) l.textContent = (a.playbackRate || 1).toString().replace(/\.0+$/, '') + '×'; }
  }
  function updateSeekLabels() {
    const s = seekStep() + 's';
    const b = document.querySelector('#tsbar-back .lbl'); if (b) b.textContent = s;
    const f = document.querySelector('#tsbar-fwd .lbl'); if (f) f.textContent = s;
  }
  function syncPlayIcon() {
    const upd = () => {
      const b = document.getElementById('tsbar-play'); const a = A();
      if (b) {
        const playing = a && a.src && !a.paused;
        const ic = b.querySelector('.ico'), lb = b.querySelector('.lbl');
        if (ic) ic.textContent = playing ? '❚❚' : '▶';
        if (lb) lb.textContent = playing ? 'Pause' : 'Play';
      }
      updateSpeed(); updateSeekLabels();
    };
    const bind = (a) => { if (!a || a === syncPlayIcon._a) return; syncPlayIcon._a = a;
      ['play', 'pause', 'ended', 'ratechange', 'loadedmetadata'].forEach(ev => a.addEventListener(ev, upd)); upd(); };
    bind(A());
    // upd() every tick too, so a changed seek-step / speed setting shows without
    // waiting for an audio event.
    setInterval(() => { bind(A()); upd(); }, 1500);
    upd();
  }

  window.TSTouch = { rebuildBar: buildBar, clampWindows, setPhraseMode };
})();
