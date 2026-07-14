/* ============================================================
   autosave.js — robust, near-realtime session persistence.
     • debounced disk save (~1s) to the book folder via PUT
     • redundant copy in IndexedDB (survives USB hiccups; covers
       ad-hoc file-opened books that have no server folder)
     • flush via navigator.sendBeacon on tab hide / unload
     • reconcile disk vs local on load, restoring the newer copy
   ============================================================ */
window.Autosave = (function () {
  const DEBOUNCE = 1000;
  let timer = null;
  let db = null;

  // ---- IndexedDB (best-effort; degrades to disk-only if unavailable) ----
  function idb() {
    return new Promise((resolve) => {
      if (db) return resolve(db);
      let req;
      try { req = indexedDB.open('transcript-studio', 1); }
      catch (e) { return resolve(null); }
      req.onupgradeneeded = () => req.result.createObjectStore('sessions', { keyPath: 'key' });
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => resolve(null);
    });
  }
  async function idbPut(key, data) {
    const d = await idb(); if (!d) return;
    try { d.transaction('sessions', 'readwrite').objectStore('sessions').put({ key, data, savedAt: data.savedAt }); }
    catch (e) {}
  }
  function idbGet(key) {
    return idb().then(d => new Promise((resolve) => {
      if (!d) return resolve(null);
      try {
        const rq = d.transaction('sessions', 'readonly').objectStore('sessions').get(key);
        rq.onsuccess = () => resolve(rq.result ? rq.result.data : null);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }

  function bookKey() { return (App.meta && (App.meta.id || App.meta.name)) || null; }
  function hhmm(ts) { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  function status(text) {
    const el = document.querySelector('#save-status');
    if (el) { el.textContent = text || ''; el.hidden = !text; }
  }

  // ---- core save ----
  async function doSave() {
    if (!App.meta || typeof Highlights === 'undefined' || !Highlights.buildSession) return;
    let sess, markdown = null;
    try {
      sess = Highlights.buildSession();
      sess.savedAt = Date.now();
      try { markdown = Highlights.buildMarkdown(); } catch (e) {}
    } catch (e) { status('Autosave error'); return; }
    const key = bookKey();
    if (key) idbPut(key, sess);                    // redundancy first — never lost (no markdown in IDB)

    if (App.meta.id) {
      status('Saving…');
      try {
        await fetch('/api/book/' + encodeURIComponent(App.meta.id) + '/session', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, sess, { markdown })),
        });
        markDirty(false);
        status('Saved ✓ ' + hhmm(sess.savedAt));
      } catch (e) {
        status('Saved locally (offline)');         // IDB copy already written
      }
    } else {
      // ad-hoc file-opened book (no folder to write to): IDB only
      markDirty(false);
      status('Saved locally ✓');
    }
  }

  function schedule() {
    if (!App.meta) return;
    status('Saving…');
    clearTimeout(timer);
    timer = setTimeout(doSave, DEBOUNCE);
  }

  // Synchronous-ish flush on close: beacon to disk + write IDB.
  function flush() {
    if (!App.meta || typeof Highlights === 'undefined') return;
    const sess = Highlights.buildSession();
    sess.savedAt = Date.now();
    const key = bookKey();
    if (key) idbPut(key, sess);
    if (App.meta.id) {
      try {
        let markdown = null; try { markdown = Highlights.buildMarkdown(); } catch (e) {}
        const blob = new Blob([JSON.stringify(Object.assign({}, sess, { markdown }))], { type: 'application/json' });
        navigator.sendBeacon('/api/book/' + encodeURIComponent(App.meta.id) + '/session', blob);
      } catch (e) {}
    }
  }

  // On load: pick the newer of (disk session, local IDB session).
  async function loadRedundant(diskSession) {
    const key = bookKey(); if (!key) return diskSession;
    const local = await idbGet(key);
    if (local && (!diskSession || (local.savedAt || 0) > (diskSession.savedAt || 0) + 1)) {
      return local;
    }
    return diskSession;
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  return { schedule, flush, loadRedundant, status };
})();
