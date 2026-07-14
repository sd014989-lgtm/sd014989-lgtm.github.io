/* ============================================================
   media.js — iOS background-audio support for the PWA build.

   Two jobs, both as an overlay (app/ untouched):

   1. DECOUPLE AUDIO FROM THE SERVICE WORKER. The desktop app plays audio from
      `/api/book/:id/audio`, which our SW serves out of OPFS. But iOS may suspend
      a backgrounded PWA's service worker — then those range requests fail and
      playback stalls when the buffer drains. So we override Player.load: for the
      audio endpoint we hand the <audio> element a blob: URL built directly from
      the OPFS file (typed via File.slice so a multi-GB m4b is NOT copied into
      memory). A blob URL is served by the browser itself, so playback keeps going
      with the SW asleep — and it still works fully offline.

   2. MEDIA SESSION. Populate navigator.mediaSession (title/author/artwork +
      play/pause/seek handlers + position) so audio shows on the iOS lock screen /
      Control Center and iOS treats it as legitimate background media.

   Loaded after the app, before ts-ipad.js.
   ============================================================ */
(function () {
  'use strict';
  if (typeof window.Player === 'undefined') return;

  /* ---------- tiny OPFS + IDB reads ---------- */
  async function opfsGetFile(parts) {
    try {
      let dir = await navigator.storage.getDirectory();
      for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: false });
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: false });
      return await fh.getFile();
    } catch (e) { return null; }
  }
  function bookRec(id) {
    return new Promise((res) => {
      let rq; try { rq = indexedDB.open('ts-ipad', 1); } catch (e) { return res(null); }
      rq.onupgradeneeded = () => { try { if (!rq.result.objectStoreNames.contains('books')) rq.result.createObjectStore('books', { keyPath: 'id' }); } catch (e) {} };
      rq.onsuccess = () => { try { const g = rq.result.transaction('books', 'readonly').objectStore('books').get(id); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); } catch (e) { res(null); } };
      rq.onerror = () => res(null);
    });
  }

  const audioIdRe = /^\/api\/book\/([^/]+)\/audio$/;
  let curBlobUrl = null;
  let curBookId = null;

  /* ---------- override Player.load → blob: URL for on-device audio ---------- */
  const origLoad = Player.load.bind(Player);
  Player.load = function (url) {
    if (typeof url === 'string') {
      const m = url.match(audioIdRe);
      if (m) {
        const id = decodeURIComponent(m[1]);
        curBookId = id;
        loadBlobAudio(id).then((burl) => {
          origLoad(burl || url);           // fall back to the SW URL if OPFS miss
          setTimeout(updateMediaSession, 300);
        });
        return;
      }
    }
    origLoad(url);
    setTimeout(updateMediaSession, 300);
  };

  async function loadBlobAudio(id) {
    const file = await opfsGetFile(['books', id, 'audio']);
    if (!file) return null;
    const rec = await bookRec(id);
    const mime = (rec && rec.audioMime) || 'audio/mpeg';
    // Re-type WITHOUT copying the bytes (slice shares the disk-backed data).
    const typed = file.slice(0, file.size, mime);
    if (curBlobUrl) { try { URL.revokeObjectURL(curBlobUrl); } catch (e) {} }
    curBlobUrl = URL.createObjectURL(typed);
    return curBlobUrl;
  }

  /* ---------- Media Session ---------- */
  function A() { return window.App && App.audio; }
  function seekStep() { return (window.App && App.settings && App.settings.seekStep) || 10; }
  function bookMeta() {
    let title = 'Audiobook', artist = '';
    try { const md = App.book && App.book.packaging && App.book.packaging.metadata; if (md) { title = md.title || title; artist = md.creator || ''; } } catch (e) {}
    const t = document.getElementById('book-title'); if ((!title || title === 'Audiobook') && t && t.textContent) title = t.textContent;
    return { title, artist };
  }

  // iOS 16.4+: declare a real "playback" audio session so audio keeps going when
  // backgrounded/locked and ignores the mute switch (default 'ambient' is silenced
  // by both). Must be set within/after a user-gesture play. Idempotent + guarded.
  function ensurePlaybackSession() {
    try { if ('audioSession' in navigator && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  }

  // Lock-screen artwork must NOT come from the SW (/api/.../cover) — iOS suspends the
  // SW when backgrounded, so that art 404s and goes blank. Build a self-contained
  // data: URL from the OPFS cover, downscaled to a size iOS is happy with.
  let artUrl = null, artFor = null;
  async function buildArtwork(id) {
    if (artFor === id && artUrl) return artUrl;
    try {
      const f = await opfsGetFile(['books', id, 'cover']);
      if (!f || !self.createImageBitmap) return null;
      const bmp = await createImageBitmap(f);
      const S = 320;
      const c = document.createElement('canvas'); c.width = S; c.height = S;
      const ctx = c.getContext('2d');
      const scale = Math.max(S / bmp.width, S / bmp.height);
      const w = bmp.width * scale, h = bmp.height * scale;
      ctx.drawImage(bmp, (S - w) / 2, (S - h) / 2, w, h);
      artUrl = c.toDataURL('image/jpeg', 0.85); artFor = id;
      return artUrl;
    } catch (e) { return null; }
  }

  async function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const a = A(); if (!a) return;
    try {
      const bm = bookMeta();
      const art = curBookId ? await buildArtwork(curBookId) : null;
      const artwork = art ? [{ src: art, sizes: '320x320', type: 'image/jpeg' }]
        : (curBookId ? [{ src: '/api/book/' + encodeURIComponent(curBookId) + '/cover', sizes: '512x512', type: 'image/jpeg' }] : []);
      navigator.mediaSession.metadata = new MediaMetadata({ title: bm.title, artist: bm.artist, album: 'Transcript Studio', artwork });
    } catch (e) {}
    const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {} };
    set('play', () => { const a = A(); if (a && a.paused) a.play(); });
    set('pause', () => { const a = A(); if (a && !a.paused) a.pause(); });
    set('seekbackward', (d) => { const a = A(); if (a) a.currentTime = Math.max(0, a.currentTime - ((d && d.seekOffset) || seekStep())); updatePosition(); });
    set('seekforward', (d) => { const a = A(); if (a) a.currentTime = Math.min(a.duration || 1e12, a.currentTime + ((d && d.seekOffset) || seekStep())); updatePosition(); });
    set('seekto', (d) => { const a = A(); if (a && d && d.seekTime != null) { if (d.fastSeek && a.fastSeek) a.fastSeek(d.seekTime); else a.currentTime = d.seekTime; updatePosition(); } });
    // prev/next map to sentence-ish skips (no chapters guaranteed)
    set('previoustrack', () => { const a = A(); if (a) a.currentTime = Math.max(0, a.currentTime - seekStep()); });
    set('nexttrack', () => { const a = A(); if (a) a.currentTime = Math.min(a.duration || 1e12, a.currentTime + seekStep()); });
    updatePosition();
  }

  function updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const a = A(); if (!a || !isFinite(a.duration) || a.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: a.duration,
        position: Math.min(a.currentTime, a.duration),
        playbackRate: a.playbackRate || 1,
      });
    } catch (e) {}
  }
  function setState(s) { if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = s; } catch (e) {} } }

  /* ---------- bind to the audio element (survives element reassignment) ---------- */
  let bound = null;
  function bind() {
    const a = A(); if (!a || a === bound) return;
    bound = a;
    a.addEventListener('play', () => { ensurePlaybackSession(); setState('playing'); updateMediaSession(); });
    a.addEventListener('pause', () => setState('paused'));
    a.addEventListener('ended', () => setState('paused'));
    a.addEventListener('loadedmetadata', updatePosition);
    a.addEventListener('ratechange', updatePosition);
    let last = 0;
    a.addEventListener('timeupdate', () => { if (Math.abs(a.currentTime - last) > 4) { last = a.currentTime; updatePosition(); } });
  }
  bind();
  setInterval(bind, 1500);

  // Coming back to the foreground after a long pause: iOS can reclaim the media
  // session (lock-screen controls go dead). Re-assert it so controls recover.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const a = A(); if (!a || !a.src) return;
    ensurePlaybackSession();
    setState(a.paused ? 'paused' : 'playing');
    updateMediaSession();
  });

  window.TSMedia = { updateMediaSession, loadBlobAudio, buildArtwork };
})();
