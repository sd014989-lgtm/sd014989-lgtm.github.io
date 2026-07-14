/* ============================================================
   popsync.js — cross-window sync for popped-out panels.

   The app serves everything over one origin (http://localhost:PORT), so a
   pop-out window (opened with window.open → a real OS BrowserWindow under
   Electron, or a tab in a browser) talks to this main window over a same-origin
   BroadcastChannel. No IPC / preload / Node-in-renderer required.

   Panels: 'np' (Now Playing HUD), 'hl' (Highlights list), 'toc' (Contents).

   Protocol on channel 'ts-sync':
     main → popout : { t:'np',  sentence, word, playing, speed, theme }
                     { t:'hl',  items:[...], theme }
                     { t:'toc', chapters:[...], theme }
                     { t:'theme', theme }                  (recolor all pop-outs)
     popout → main : { t:'hello', panel }                  (request initial state)
                     { t:'cmd', action, sid? }
                       np : toggle | back | fwd | cycleSpeed
                       hl/toc : goSid | seekSid
   ============================================================ */
window.PopSync = (function () {
  const ch = ('BroadcastChannel' in window) ? new BroadcastChannel('ts-sync') : null;
  let np = { sentence: '—', word: '—', playing: false, speed: 1 };

  // Every themable CSS var, so pop-outs mirror the FULL research-theme palette.
  // Sent as { vars: {'--bg': ...}, research: bool }; unset vars are omitted so
  // the pop-out falls back exactly like the main window.
  const THEME_SYNC_VARS = [
    '--bg','--fg','--accent','--accent-hover','--accent-text',
    '--text-dim','--hover-bg','--sent-bg','--sent-text','--word-bg','--word-text',
    '--cat-note','--cat-rule','--cat-key','--cat-never','--hl-alpha',
    '--chrome-bg','--chrome-fg','--chrome-line','--chrome-hover',
    '--panel-bg','--titlebar-bg','--btn-bg','--ui-text-dim','--ui-text-muted',
    '--scrollbar-thumb','--scrim','--modal-bg','--modal-border',
    '--hl-item-bg','--hl-sel-bg','--hl-sel-border',
  ];
  function theme() {
    const cs = getComputedStyle(document.body);
    const custom = App.settings && App.settings.custom;
    const vars = {};
    THEME_SYNC_VARS.forEach(v => { const val = cs.getPropertyValue(v).trim(); if (val) vars[v] = val; });
    if (custom && custom.bg) vars['--bg'] = custom.bg;
    if (custom && custom.fg) vars['--fg'] = custom.fg;
    return { vars, research: document.body.classList.contains('research-theme') };
  }

  function pushNP() {
    if (!ch) return;
    const step = (window.App && App.settings && App.settings.seekStep) || 5;
    ch.postMessage(Object.assign({ t: 'np', theme: theme(), step }, np));
  }
  function pushHighlights() {
    if (!ch || !window.Highlights) return;
    let items = [];
    try { items = Highlights.exportItems(); } catch (e) {}
    ch.postMessage({ t: 'hl', items, theme: theme() });
  }
  function pushTOC() {
    if (!ch) return;
    const chapters = (App.chapters || []).map(c => ({ label: c.label, sid: c.sid, start: c.start }));
    ch.postMessage({ t: 'toc', chapters, theme: theme() });
  }
  function pushTheme() { if (ch) ch.postMessage({ t: 'theme', theme: theme() }); }

  if (ch) ch.onmessage = (e) => {
    const m = e.data;
    if (!m) return;
    if (m.t === 'hello') {
      if (m.panel === 'hl') pushHighlights();
      else if (m.panel === 'toc') pushTOC();
      else pushNP();
      return;
    }
    if (m.t !== 'cmd') return;
    const step = (App.settings && App.settings.seekStep) || 5;
    if (m.action === 'toggle') { if (window.Player) Player.toggle(); }
    else if (m.action === 'back' && App.audio) App.audio.currentTime -= step;
    else if (m.action === 'fwd'  && App.audio) App.audio.currentTime += step;
    else if (m.action === 'cycleSpeed' && window.Player && Player.cycleSpeed) Player.cycleSpeed();
    else if (m.action === 'goSid'   && m.sid != null && typeof scrollToSid === 'function') scrollToSid(+m.sid);
    else if (m.action === 'seekSid' && m.sid != null && window.Player) Player.seekToSid(+m.sid);
  };

  const SIZE = { np: 'width=380,height=240', hl: 'width=380,height=640', toc: 'width=320,height=640' };
  function openPanel(which) {
    const w = window.open('popout.html?panel=' + which, 'ts-popout-' + which, SIZE[which] || SIZE.np);
    // give the new window a moment to subscribe, then send its current state
    setTimeout(() => { if (which === 'hl') pushHighlights(); else if (which === 'toc') pushTOC(); else pushNP(); }, 350);
    return w;
  }

  return {
    enabled: !!ch,
    sentence(s) { np.sentence = s; pushNP(); },
    word(w)     { np.word = w; pushNP(); },
    playing(p)  { np.playing = p; pushNP(); },
    speed(sp)   { np.speed = sp; pushNP(); },
    pushTheme, pushHighlights, pushTOC,
    openPanel,
    openNowPlaying() { return openPanel('np'); },
  };
})();
