/* ============================================================
   ts-ipad.js — the iPad companion glue (loaded LAST, after the app).

   Three jobs:
     1. Register the service worker (which serves the app + /api/* offline)
        and ask the browser to make storage persistent (so iOS won't evict
        the on-device books/highlights).
     2. Pull books from the PC into on-device OPFS storage, and seed the
        app's own IndexedDB with each book's highlights so they show up.
     3. Two-way reconcile highlights with the PC (last-writer-wins per book)
        so a highlight made offline on the iPad lands on the PC next sync,
        and vice-versa.

   The import/sync SOURCE is same-origin under /pcsource/* (served by
   scripts/serve-ipad.js reading the same books/ folder the desktop app
   uses) — so there is no cross-origin/CORS problem and the PC app is
   never modified. A different source host can be set in localStorage
   'ts-ipad-pc' (full origin), in which case it talks to that host's
   /api/* directly.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- source URL resolution ---------- */
  function pcBase() { try { return (localStorage.getItem('ts-ipad-pc') || '').replace(/\/+$/, ''); } catch (e) { return ''; } }
  function srcList() { const b = pcBase(); return b ? b + '/api/books' : '/pcsource/books'; }
  function srcFile(id, kind) { const b = pcBase(); return b ? b + '/api/book/' + encodeURIComponent(id) + '/' + kind : '/pcsource/book/' + encodeURIComponent(id) + '/' + kind; }
  function srcSessionPut(id) { return srcFile(id, 'session'); }

  /* ---------- OPFS + IndexedDB (page side) ---------- */
  async function opfsDir(parts, create) {
    let dir = await navigator.storage.getDirectory();
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: !!create });
    return dir;
  }
  async function opfsGetText(parts) {
    try {
      const dir = await opfsDir(parts.slice(0, -1), false);
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: false });
      return await (await fh.getFile()).text();
    } catch (e) { return null; }
  }
  async function opfsWriteText(parts, text) {
    const dir = await opfsDir(parts.slice(0, -1), true);
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([text])); await w.close();
  }
  // Stream a network response straight to an OPFS file (no full-file buffering).
  async function streamToOpfs(url, parts) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('GET ' + url + ' → ' + res.status);
    const dir = await opfsDir(parts.slice(0, -1), true);
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    if (res.body && res.body.pipeTo) await res.body.pipeTo(w);
    else { await w.write(await res.blob()); await w.close(); }
    return res.headers.get('content-type') || '';
  }

  function idb(name, ver, upgrade) {
    return new Promise((resolve, reject) => {
      let rq; try { rq = indexedDB.open(name, ver); } catch (e) { return reject(e); }
      if (upgrade) rq.onupgradeneeded = () => upgrade(rq.result);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  function metaDb() { return idb('ts-ipad', 1, db => { if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' }); }); }
  function metaPut(rec) { return metaDb().then(db => new Promise((res, rej) => { const tx = db.transaction('books', 'readwrite'); tx.objectStore('books').put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); })); }
  function metaGet(id) { return metaDb().then(db => new Promise((res) => { const rq = db.transaction('books', 'readonly').objectStore('books').get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); })); }
  function metaAll() { return metaDb().then(db => new Promise((res) => { const rq = db.transaction('books', 'readonly').objectStore('books').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); })); }

  // Write a session into the APP's own IndexedDB (db 'transcript-studio',
  // store 'sessions', keyPath 'key') so autosave.loadRedundant() surfaces the
  // synced highlights on open, exactly like the desktop reconcile path.
  function seedAppSession(id, sess) {
    return idb('transcript-studio', 1, db => { if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'key' }); })
      .then(db => new Promise((res) => {
        try { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ key: id, data: sess, savedAt: sess.savedAt || 0 }); tx.oncomplete = res; tx.onerror = res; }
        catch (e) { res(); }
      })).catch(() => {});
  }
  function readAppSession(id) {
    return idb('transcript-studio', 1, db => { if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'key' }); })
      .then(db => new Promise((res) => {
        try { const rq = db.transaction('sessions', 'readonly').objectStore('sessions').get(id); rq.onsuccess = () => res(rq.result ? rq.result.data : null); rq.onerror = () => res(null); }
        catch (e) { res(null); }
      })).catch(() => null);
  }

  const AUDIO_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac' };
  function audioMimeFor(name) { const ext = (name || '').split('.').pop().toLowerCase(); return AUDIO_MIME[ext] || 'audio/mpeg'; }

  /* ---------- import one book ---------- */
  // Prefer the service worker (durable syncAccessHandle writes, streams big audio
  // without buffering). Fall back to page-side writes if no SW controls the page.
  async function importBook(b, onProgress) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      try { return await importViaSW(b, onProgress); }
      catch (e) { /* fall through to page-side */ }
    }
    return importPageSide(b, onProgress);
  }

  // Core SW streaming import: hands the SW a set of URLs (any source — Tailscale
  // /pcsource OR pre-authenticated OneDrive downloadUrls) and it streams each to OPFS
  // via createSyncAccessHandle (durable, low-memory for big audio).
  function swImport(id, urls, meta, onProgress) {
    return new Promise((resolve, reject) => {
      const ch = new MessageChannel();
      const to = setTimeout(() => reject(new Error('import timed out')), 30 * 60 * 1000);
      ch.port1.onmessage = (e) => {
        const m = e.data || {};
        if (m.step && onProgress) onProgress(m.step);
        if (m.done) { clearTimeout(to); resolve(m.rec); }
        if (m.error) { clearTimeout(to); reject(new Error(m.error)); }
      };
      navigator.serviceWorker.controller.postMessage({ type: 'import-book', id, urls, meta }, [ch.port2]);
    });
  }

  async function importViaSW(b, onProgress) {
    const id = b.id;
    const urls = {
      epub: srcFile(id, 'epub'),
      audio: b.audio ? srcFile(id, 'audio') : null,
      transcript: b.hasTranscript ? srcFile(id, 'transcript') : null,
      cover: b.hasCover ? srcFile(id, 'cover') : null,
      session: b.hasSession ? srcFile(id, 'session') : null,
    };
    const meta = {
      name: b.name || id, title: b.title || b.name || id, author: b.author || '',
      audioName: typeof b.audio === 'string' ? b.audio : 'audio',
      audioMime: audioMimeFor(typeof b.audio === 'string' ? b.audio : 'audio'),
      highlights: b.highlights, percent: b.percent, now: Date.now(),
    };
    const rec = await swImport(id, urls, meta, onProgress);
    // seed the app's own IndexedDB session so highlights show on open
    if (b.hasSession) { try { const s = await fetch(srcFile(id, 'session')).then(r => r.ok ? r.json() : null); if (s) await seedAppSession(id, s); } catch (e) {} }
    return rec;
  }

  async function importPageSide(b, onProgress) {
    const id = b.id;
    onProgress && onProgress('epub');
    await streamToOpfs(srcFile(id, 'epub'), ['books', id, 'book.epub']);

    const rec = { id, name: b.name || id, title: b.title || b.name || id, author: b.author || '', importedAt: Date.now() };

    if (b.audio) {
      onProgress && onProgress('audio');
      await streamToOpfs(srcFile(id, 'audio'), ['books', id, 'audio']);
      rec.audio = true; rec.audioName = typeof b.audio === 'string' ? b.audio : 'audio'; rec.audioMime = audioMimeFor(rec.audioName);
    }
    if (b.hasTranscript) {
      onProgress && onProgress('transcript');
      try { await streamToOpfs(srcFile(id, 'transcript'), ['books', id, 'transcript.json']); rec.hasTranscript = true; } catch (e) {}
    }
    if (b.hasCover) {
      try { const ct = await streamToOpfs(srcFile(id, 'cover'), ['books', id, 'cover']); rec.hasCover = true; rec.coverMime = ct || 'image/jpeg'; } catch (e) {}
    }
    if (b.hasSession) {
      onProgress && onProgress('highlights');
      try {
        const txt = await fetch(srcFile(id, 'session')).then(r => r.ok ? r.text() : null);
        if (txt) {
          await opfsWriteText(['books', id, 'session.json'], txt);
          const s = JSON.parse(txt);
          rec.hasSession = true;
          rec.highlights = (s.highlights ? Object.keys(s.highlights).length : 0) + (Array.isArray(s.wordHighlights) ? s.wordHighlights.length : 0);
          rec.percent = s.position && typeof s.position.percent === 'number' ? s.position.percent : null;
          rec.sessionSavedAt = s.savedAt || 0;
          await seedAppSession(id, s);
        }
      } catch (e) {}
    }
    if (rec.highlights == null) rec.highlights = b.highlights || 0;
    if (rec.percent == null && typeof b.percent === 'number') rec.percent = b.percent;
    await metaPut(rec);
    return rec;
  }

  /* ---------- two-way session reconcile (last-writer-wins per book) ---------- */
  async function reconcileBook(id) {
    // local = newer of (app IndexedDB autosave, OPFS session.json mirror)
    const appSess = await readAppSession(id);
    const opfsTxt = await opfsGetText(['books', id, 'session.json']);
    const opfsSess = opfsTxt ? JSON.parse(opfsTxt) : null;
    let local = appSess; if (opfsSess && (!local || (opfsSess.savedAt || 0) > (local.savedAt || 0))) local = opfsSess;

    // remote = PC's session.json
    let remote = null;
    try { const r = await fetch(srcFile(id, 'session')); if (r.ok) remote = await r.json(); } catch (e) {}

    const lt = local && local.savedAt || 0;
    const rt = remote && remote.savedAt || 0;
    if (lt > rt && local) {
      // push local → PC
      try {
        await fetch(srcSessionPut(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(local) });
        await opfsWriteText(['books', id, 'session.json'], JSON.stringify(local, null, 2));
        await markSynced(id, lt);
        return 'pushed';
      } catch (e) { return 'push-failed'; }
    } else if (rt > lt && remote) {
      // pull PC → device (OPFS mirror + app IndexedDB)
      await opfsWriteText(['books', id, 'session.json'], JSON.stringify(remote, null, 2));
      await seedAppSession(id, remote);
      const rec = (await metaGet(id)) || { id, name: id };
      rec.hasSession = true;
      rec.highlights = (remote.highlights ? Object.keys(remote.highlights).length : 0) + (Array.isArray(remote.wordHighlights) ? remote.wordHighlights.length : 0);
      rec.percent = remote.position && typeof remote.position.percent === 'number' ? remote.position.percent : rec.percent;
      rec.sessionSavedAt = remote.savedAt || 0;
      rec.lastSyncedAt = Date.now();
      await metaPut(rec);
      return 'pulled';
    }
    if (remote) await markSynced(id, lt);   // only if we actually reached the PC
    return 'in-sync';
  }

  async function reconcileAll(onProgress) {
    const local = await metaAll();
    const out = {};
    for (const b of local) { onProgress && onProgress(b.title || b.id); try { out[b.id] = await reconcileBook(b.id); } catch (e) { out[b.id] = 'error'; } }
    return out;
  }

  /* ---------- OneDrive library + sync (via TSOneDrive transport) ----------
     The OneDrive app folder IS the whole library — one folder per book:
       approot:/<id>/{book.epub, audio.<ext>, transcript.json?, session.json, cover?}
     Every device (PC, iPad, Android) reads/writes these same files; the PC's OneDrive
     client mirrors them to disk. Session reconcile is last-writer-wins by savedAt. */
  function odOn() { return !!(window.TSOneDrive && TSOneDrive.connected()); }
  function safeJSON(t) { try { return JSON.parse(t); } catch (e) { return null; } }
  function odPath(id, sub) { return '/me/drive/special/approot:/' + encodeURIComponent(id) + (sub ? '/' + encodeURIComponent(sub) : ''); }
  const OD_AUDIO_RE = /\.(mp3|m4a|m4b|aac|ogg|opus|wav|flac)$/i;

  async function odGetSession(id) {
    const res = await TSOneDrive.graphFetch(odPath(id, 'session.json') + ':/content', { headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('OneDrive read ' + res.status);
    return safeJSON(await res.text());
  }
  async function odPutSession(id, obj) {
    const res = await TSOneDrive.graphFetch(odPath(id, 'session.json') + ':/content',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    if (!res.ok) throw new Error('OneDrive write ' + res.status);
    return true;
  }

  async function odFolderChildren(id) {
    const res = await TSOneDrive.graphFetch(odPath(id) + ':/children?$select=name,size,folder&$top=200');
    if (!res.ok) return [];
    return (await res.json()).value || [];
  }
  // The whole library: each approot subfolder that contains an .epub is a book.
  async function odListLibrary() {
    const res = await TSOneDrive.graphFetch('/me/drive/special/approot/children?$select=name,folder&$top=400');
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('OneDrive list ' + res.status);
    const folders = ((await res.json()).value || []).filter(it => it.folder);
    const books = [];
    for (const f of folders) {
      const id = f.name;
      let kids; try { kids = await odFolderChildren(id); } catch (e) { continue; }
      const epub = kids.find(k => /\.epub$/i.test(k.name));
      if (!epub) continue;                                   // not a book folder
      const audio = kids.find(k => OD_AUDIO_RE.test(k.name));
      const cover = kids.find(k => /^cover(\.|$)/i.test(k.name));
      books.push({
        id, name: id, title: id, author: '',
        epub: epub.name, epubSize: epub.size || 0,
        audio: audio ? audio.name : null, audioSize: audio ? (audio.size || 0) : 0,
        hasTranscript: kids.some(k => k.name.toLowerCase() === 'transcript.json'),
        hasSession: kids.some(k => k.name.toLowerCase() === 'session.json'),
        hasCover: !!cover, coverName: cover ? cover.name : null,
      });
    }
    return books;
  }
  async function odListIds() { try { return (await odListLibrary()).map(b => b.id); } catch (e) { return []; } }

  async function odDownloadUrl(id, filename) {
    const res = await TSOneDrive.graphFetch(odPath(id, filename) + '?$select=id,@microsoft.graph.downloadUrl');
    if (!res.ok) return null;
    return (await res.json())['@microsoft.graph.downloadUrl'] || null;
  }

  // Download a whole book from OneDrive into on-device OPFS (offline). Reuses the SW
  // streaming import — the per-file pre-authenticated downloadUrls need no auth header.
  async function odDownloadBook(b, onProgress) {
    const id = b.id;
    onProgress && onProgress('preparing');
    const urls = {
      epub: await odDownloadUrl(id, b.epub),
      audio: b.audio ? await odDownloadUrl(id, b.audio) : null,
      transcript: b.hasTranscript ? await odDownloadUrl(id, 'transcript.json') : null,
      cover: b.hasCover ? await odDownloadUrl(id, b.coverName) : null,
      session: b.hasSession ? await odDownloadUrl(id, 'session.json') : null,
    };
    if (!urls.epub) throw new Error('could not read the book file from OneDrive');
    const meta = { name: id, title: b.title || id, author: b.author || '', audioName: b.audio || 'audio', audioMime: audioMimeFor(b.audio || ''), now: Date.now() };
    const rec = (navigator.serviceWorker && navigator.serviceWorker.controller)
      ? await swImport(id, urls, meta, onProgress)
      : await odDownloadPageSide(id, urls, meta, onProgress);
    try { await odEnrichMeta(id); } catch (e) {}                     // title/author/cover from the epub
    if (urls.session) { try { const s = await fetch(urls.session).then(r => r.ok ? r.json() : null); if (s) await seedAppSession(id, s); } catch (e) {} }
    return rec;
  }
  async function odDownloadPageSide(id, urls, meta, onProgress) {
    onProgress && onProgress('epub'); await streamToOpfs(urls.epub, ['books', id, 'book.epub']);
    const rec = { id, name: id, title: meta.title, author: meta.author, importedAt: Date.now() };
    if (urls.audio) { onProgress && onProgress('audio'); await streamToOpfs(urls.audio, ['books', id, 'audio']); rec.audio = true; rec.audioName = meta.audioName; rec.audioMime = meta.audioMime; }
    if (urls.transcript) { onProgress && onProgress('transcript'); try { await streamToOpfs(urls.transcript, ['books', id, 'transcript.json']); rec.hasTranscript = true; } catch (e) {} }
    if (urls.cover) { try { await streamToOpfs(urls.cover, ['books', id, 'cover']); rec.hasCover = true; } catch (e) {} }
    if (urls.session) { try { const txt = await fetch(urls.session).then(r => r.ok ? r.text() : null); if (txt) { await opfsWriteText(['books', id, 'session.json'], txt); const s = safeJSON(txt); rec.hasSession = true; rec.sessionSavedAt = (s && s.savedAt) || 0; } } catch (e) {} }
    await metaPut(rec);
    return rec;
  }
  // Enrich the library card with title/author from the downloaded epub (JSZip, vendored).
  async function odEnrichMeta(id) {
    if (typeof JSZip === 'undefined') return;
    let file = null;
    try { const dir = await opfsDir(['books', id], false); const fh = await dir.getFileHandle('book.epub', { create: false }); file = await fh.getFile(); } catch (e) { return; }
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let opfPath = null;
    const cont = zip.file('META-INF/container.xml');
    if (cont) { const m = /full-path="([^"]+)"/.exec(await cont.async('string')); if (m) opfPath = m[1]; }
    if (!opfPath) opfPath = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.opf'));
    if (!opfPath) return;
    const opf = await zip.file(opfPath).async('string');
    const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    const t = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf);
    const a = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf);
    const rec = (await metaGet(id)) || { id, name: id };
    if (t && strip(t[1])) rec.title = strip(t[1]);
    if (a && strip(a[1])) rec.author = strip(a[1]);
    await metaPut(rec);
  }

  async function reconcileODBook(id, isLocal) {
    const appSess = await readAppSession(id);
    const opfsTxt = await opfsGetText(['books', id, 'session.json']);
    const opfsSess = opfsTxt ? safeJSON(opfsTxt) : null;
    let local = appSess; if (opfsSess && (!local || (opfsSess.savedAt || 0) > (local.savedAt || 0))) local = opfsSess;

    let cloud = await odGetSession(id);
    const lt = local && local.savedAt || 0;
    const ct = cloud && cloud.savedAt || 0;
    if (lt > ct && local) { await odPutSession(id, local); return 'pushed'; }
    if (ct > lt && cloud) {
      await seedAppSession(id, cloud);                                  // makes highlights appear on open (even for a re-imported book)
      await opfsWriteText(['books', id, 'session.json'], JSON.stringify(cloud, null, 2));
      if (isLocal) {                                                    // update the library card only for real on-device books
        const rec = (await metaGet(id)) || { id, name: id };
        rec.hasSession = true;
        rec.highlights = (cloud.highlights ? Object.keys(cloud.highlights).length : 0) + (Array.isArray(cloud.wordHighlights) ? cloud.wordHighlights.length : 0);
        rec.percent = cloud.position && typeof cloud.position.percent === 'number' ? cloud.position.percent : rec.percent;
        rec.sessionSavedAt = cloud.savedAt || 0;
        await metaPut(rec);
      }
      return 'pulled';
    }
    return 'in-sync';
  }

  let odSyncing = false, odLastRun = 0;
  async function syncOneDrive(reason) {
    if (!odOn() || odSyncing) return null;
    if (reason !== 'manual' && reason !== 'connect' && (Date.now() - odLastRun) < 15000) return null;   // throttle auto runs
    odSyncing = true; odLastRun = Date.now();
    try {
      // Only on-device books have a local session to reconcile; cloud-only books have
      // nothing to sync until downloaded. (The panel lists the full library separately.)
      const localRecs = await metaAll();
      const res = {};
      for (const r of localRecs) { try { res[r.id] = await reconcileODBook(r.id, true); } catch (e) { res[r.id] = 'error'; } }
      try { localStorage.setItem('ts-onedrive-lastsync', String(Date.now())); } catch (e) {}
      renderOneDrive(); refreshFabBadge();
      return res;
    } finally { odSyncing = false; }
  }
  function odLastSyncText() {
    let ts = 0; try { ts = parseInt(localStorage.getItem('ts-onedrive-lastsync') || '0', 10); } catch (e) {}
    return ts ? 'synced ' + fmtAge(ts) : 'not synced yet';
  }
  function cnt(res, k) { return res ? Object.values(res).filter(x => x === k).length : 0; }

  /* ---------- reachability + remote listing ---------- */
  async function fetchRemoteBooks() {
    const r = await fetch(srcList(), { cache: 'no-store' });
    if (!r.ok) throw new Error('source ' + r.status);
    return (await r.json()).books || [];
  }

  /* ---------- minimal UI: a floating Sync button + panel ---------- */
  const css = `
  #tsipad-fab{position:fixed;right:14px;bottom:14px;z-index:99998;border:none;border-radius:999px;
    padding:11px 16px;font:600 14px/1 system-ui,sans-serif;color:#fff;background:#5b6cf0;
    box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer}
  #tsipad-fab:active{transform:translateY(1px)}
  #tsipad-scrim{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.5);display:none}
  #tsipad-panel{position:fixed;z-index:99999;left:50%;top:50%;transform:translate(-50%,-50%);
    width:min(560px,92vw);max-height:82vh;overflow:auto;background:#1f1b18;color:#eee;
    border:1px solid #3a332e;border-radius:14px;padding:18px 18px 22px;display:none;
    box-shadow:0 20px 60px rgba(0,0,0,.5);font:14px/1.5 system-ui,sans-serif}
  #tsipad-panel h2{margin:0 0 4px;font-size:18px}
  #tsipad-panel .sub{opacity:.7;font-size:12.5px;margin-bottom:12px}
  #tsipad-panel .row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #322b26}
  #tsipad-panel .row .meta{flex:1;min-width:0}
  #tsipad-panel .row .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tsipad-panel .row .a{opacity:.65;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tsipad-panel .chips{display:flex;gap:5px;margin-top:2px}
  #tsipad-panel .chip{font-size:10.5px;padding:1px 6px;border-radius:999px;background:#332c26;opacity:.85}
  #tsipad-panel button.act{border:none;border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer;background:#5b6cf0;color:#fff}
  #tsipad-panel button.act.have{background:#2f6b3f}
  #tsipad-panel button.act:disabled{opacity:.5;cursor:default}
  #tsipad-panel .bar{display:flex;gap:8px;margin:6px 0 14px;flex-wrap:wrap}
  #tsipad-panel .bar button{border:1px solid #453d36;background:#2a241f;color:#eee;border-radius:8px;padding:7px 12px;cursor:pointer}
  #tsipad-panel .status{font-size:12.5px;opacity:.8;min-height:18px;margin-top:8px}
  #tsipad-panel .err{color:#ff9b9b}
  #tsipad-panel .persist{font-size:12px;line-height:1.45;border-radius:9px;padding:8px 10px;margin:0 0 12px}
  #tsipad-panel .persist.ok{background:#1c2f22;border:1px solid #2f5c3f;color:#bfe6cd}
  #tsipad-panel .persist.warn{background:#3a2a18;border:1px solid #7a5a2a;color:#ffdca6}
  #tsipad-panel .od-status{font-size:12.5px;border-radius:8px;padding:7px 10px;margin-top:6px}
  #tsipad-panel .od-status.ok{background:#1c2f22;border:1px solid #2f5c3f;color:#bfe6cd}
  #tsipad-panel .od-status.warn{background:#3a2a18;border:1px solid #7a5a2a;color:#ffdca6}
  #tsipad-panel code{background:#161310;border:1px solid #3a332e;border-radius:5px;padding:1px 5px;font-size:11.5px;word-break:break-all}
  #tsipad-panel .row .synced{font-size:11.5px;margin-top:2px}
  #tsipad-panel .row .synced.warn{color:#ffcf8f}
  #tsipad-panel .row .synced.ok{color:#8fd6a4;opacity:.9}
  /* The FAB is position:fixed, so it is already a containing block for the badge. */
  #tsipad-fab .tsipad-badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;box-sizing:border-box;
    padding:0 4px;border-radius:999px;background:#e8564e;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;
    box-shadow:0 2px 6px rgba(0,0,0,.4)}
  #tsipad-panel input{width:100%;box-sizing:border-box;background:#161310;border:1px solid #3a332e;color:#eee;border-radius:8px;padding:8px}
  `;

  function h(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(k => k && e.appendChild(k));
    return e;
  }

  let panel, scrim, statusEl, fabEl, persistEl, odHeadEl;
  let storagePersisted = null, storageEstimate = null;
  function setStatus(msg, isErr) { if (statusEl) { statusEl.textContent = msg || ''; statusEl.className = 'status' + (isErr ? ' err' : ''); } }

  /* ---------- durability helpers ---------- */
  function fmtAge(ts) {
    if (!ts) return 'never';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return 'just now';
    const m = s / 60; if (m < 90) return Math.round(m) + ' min ago';
    const hr = m / 60; if (hr < 36) return Math.round(hr) + ' h ago';
    return Math.round(hr / 24) + ' d ago';
  }
  function fmtMB(bytes) { return bytes ? (bytes / 1048576 >= 1024 ? (bytes / 1073741824).toFixed(1) + ' GB' : Math.round(bytes / 1048576) + ' MB') : '0 MB'; }
  // A book is "unsynced" when its last local save is newer than its last sync to the PC.
  function isUnsynced(rec) { return (rec && (rec.sessionSavedAt || 0) > ((rec.lastSyncedAt || 0) + 1)); }
  async function unsyncedCount() { try { return (await metaAll()).filter(isUnsynced).length; } catch (e) { return 0; } }
  // Stamp a successful sync on the book's meta record.
  async function markSynced(id, savedAt) {
    try { const rec = (await metaGet(id)) || { id, name: id }; rec.lastSyncedAt = Date.now(); if (savedAt) rec.sessionSavedAt = Math.max(rec.sessionSavedAt || 0, savedAt); await metaPut(rec); } catch (e) {}
  }

  async function refreshFabBadge() {
    if (!fabEl) return;
    const n = await unsyncedCount();
    let dot = fabEl.querySelector('.tsipad-badge');
    if (n > 0) {
      if (!dot) { dot = h('span', { class: 'tsipad-badge' }); fabEl.appendChild(dot); }
      dot.textContent = n > 9 ? '9+' : String(n);
      fabEl.title = n + ' book(s) with highlights not yet synced to the PC';
    } else if (dot) { dot.remove(); fabEl.title = 'Highlights synced'; }
  }

  async function renderPersistence() {
    if (!persistEl) return;
    const used = storageEstimate && storageEstimate.usage ? ' · ' + fmtMB(storageEstimate.usage) + ' stored' : '';
    if (storagePersisted === true) {
      persistEl.className = 'persist ok';
      persistEl.innerHTML = 'Storage: <b>persistent ✓</b>' + used + ' — iOS will keep your books &amp; highlights on this iPad.';
    } else {
      persistEl.className = 'persist warn';
      persistEl.innerHTML = '⚠ <b>Storage not guaranteed by iOS.</b>' + used + ' Keep this app on your Home Screen and Sync (or Export) often — otherwise iOS may clear unsynced highlights if the app sits unused for days.';
    }
  }

  // The connection header of the panel. States: not-configured (one-time setup — only
  // if the build wasn't pre-baked with a Client ID), not-connected (Connect), connected.
  function renderOneDrive() {
    if (!odHeadEl) return;
    odHeadEl.innerHTML = '';
    const OD = window.TSOneDrive;
    if (!OD) { odHeadEl.appendChild(h('div', { class: 'od-status warn', text: 'OneDrive module not loaded.' })); return; }
    const st = OD.status();
    if (!st.configured) {
      const input = h('input', { placeholder: 'Microsoft Client ID', value: OD.getClientId() || '' });
      odHeadEl.appendChild(h('div', { class: 'sub', html: 'One-time setup (~5 min, once ever — see <b>docs/ONEDRIVE.md</b>): register a free app on your Microsoft account as a <b>Single-page application</b> with this exact Redirect URI, then paste the Client ID:<br><code>' + OD.redirectUri() + '</code>' }));
      odHeadEl.appendChild(input);
      odHeadEl.appendChild(h('div', { class: 'bar', style: 'margin-top:8px' }, [
        h('button', { class: 'act', text: 'Save & continue', onclick: () => { OD.setClientId(input.value); renderOneDrive(); buildLibrary(); } }),
      ]));
      return;
    }
    if (st.connected) {
      odHeadEl.appendChild(h('div', { class: 'od-status ok', text: '✓ Connected' + (st.account && st.account.email ? ' as ' + st.account.email : '') + ' · ' + odLastSyncText() }));
      odHeadEl.appendChild(h('div', { class: 'bar', style: 'margin-top:8px' }, [
        h('button', { text: '↻ Sync now', onclick: async () => { setStatus('Syncing…'); const r = await syncOneDrive('manual'); setStatus('Synced — ' + cnt(r, 'pushed') + ' up, ' + cnt(r, 'pulled') + ' down.' + (cnt(r, 'error') ? ' ' + cnt(r, 'error') + ' failed.' : ''), cnt(r, 'error') > 0); renderOneDrive(); } }),
        h('button', { text: 'Sign out', onclick: async () => { await OD.disconnect(); renderOneDrive(); buildLibrary(); } }),
      ]));
    } else {
      odHeadEl.appendChild(st.error ? h('div', { class: 'od-status warn', text: st.error })
        : h('div', { class: 'sub', text: 'Sign in once to sync your books & highlights across every device (iPad, PC, Android).' }));
      odHeadEl.appendChild(h('div', { class: 'bar', style: 'margin-top:8px' }, [
        h('button', { class: 'act', text: st.needReconnect ? 'Reconnect OneDrive' : 'Connect OneDrive', onclick: () => OD.connect() }),
      ]));
    }
  }

  // Bundle every on-device book's highlights into one file the user can save OFF the
  // iPad (Files / OneDrive / Mail) via the share sheet — works with the PC off. This
  // is the real defence against deleting the app or losing the device before syncing.
  async function exportHighlights() {
    setStatus('Preparing export…');
    const bundle = { app: 'transcript-studio', kind: 'highlights-backup', exportedAt: Date.now(), books: [] };
    for (const r of await metaAll()) {
      // newest of the OPFS mirror and the app's own autosave copy
      let sess = null;
      const txt = await opfsGetText(['books', r.id, 'session.json']);
      if (txt) { try { sess = JSON.parse(txt); } catch (e) {} }
      const appS = await readAppSession(r.id);
      if (appS && (!sess || (appS.savedAt || 0) > (sess.savedAt || 0))) sess = appS;
      if (sess) bundle.books.push({ id: r.id, title: r.title || r.name, author: r.author || '', session: sess });
    }
    if (!bundle.books.length) { setStatus('No highlights to export yet.', true); return; }
    const json = JSON.stringify(bundle, null, 2);
    const fname = 'transcript-studio-highlights-' + new Date().toISOString().slice(0, 10) + '.json';
    const file = new File([json], fname, { type: 'application/json' });
    const nHl = bundle.books.reduce((n, b) => n + (b.session.highlights ? Object.keys(b.session.highlights).length : 0) + (Array.isArray(b.session.wordHighlights) ? b.session.wordHighlights.length : 0), 0);
    // Prefer the iOS share sheet (Save to Files / OneDrive / Mail).
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Transcript Studio highlights' }); setStatus('Exported ' + nHl + ' highlight(s) from ' + bundle.books.length + ' book(s).'); return; }
      catch (e) { if (e && e.name === 'AbortError') { setStatus('Export cancelled.'); return; } /* else fall through to download */ }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: fname }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 5000);
    setStatus('Exported ' + nHl + ' highlight(s) from ' + bundle.books.length + ' book(s).');
  }

  // Belt-and-suspenders: on tab hide / unload, keepalive-PUT the current session in
  // addition to the app's own beacon, so the last highlight isn't lost on a hard kill.
  function flushBelt() {
    try {
      if (!(window.App && App.meta && App.meta.id && window.Highlights && Highlights.buildSession)) return;
      const sess = Highlights.buildSession(); sess.savedAt = Date.now();
      fetch('/api/book/' + encodeURIComponent(App.meta.id) + '/session', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sess), keepalive: true,
      }).catch(() => {});
    } catch (e) {}
  }

  async function openPanel() {
    scrim.style.display = 'block'; panel.style.display = 'block';
    if (navigator.storage && navigator.storage.estimate) { try { storageEstimate = await navigator.storage.estimate(); } catch (e) {} }
    renderPersistence();
    renderOneDrive();
    buildLibrary();
    refreshFabBadge();
    if (odOn()) syncOneDrive('foreground');
  }
  function closePanel() { scrim.style.display = 'none'; panel.style.display = 'none'; }

  // The book list: the OneDrive library when connected, else whatever is on this device.
  async function buildLibrary() {
    const list = panel && panel.querySelector('#tsipad-list');
    if (!list) return;
    list.innerHTML = '';
    const localById = {}; (await metaAll()).forEach(r => localById[r.id] = r);
    if (!odOn()) {
      const on = Object.values(localById);
      if (!on.length) { list.appendChild(h('div', { class: 'sub', text: 'Connect OneDrive above to see and download your books.' })); return; }
      list.appendChild(h('div', { class: 'sub', text: 'On this iPad (connect OneDrive to add more & keep in sync):' }));
      on.forEach(r => list.appendChild(bookRow(bookCardShape(r), true, r)));
      return;
    }
    setStatus('Loading your OneDrive library…');
    let books = [];
    try { books = await odListLibrary(); }
    catch (e) { setStatus('Could not read OneDrive: ' + e.message, true); return; }
    if (!books.length) {
      list.appendChild(h('div', { class: 'sub', html: 'No books yet. Add one by making a folder in <b>OneDrive → Apps → TranscriptStudio</b> and dropping in its <b>.epub</b> + audio file — it will appear here on every device.' }));
      Object.values(localById).forEach(r => { if (!localById[r.id]._shown) list.appendChild(bookRow(bookCardShape(r), true, r)); });
      setStatus('0 books in OneDrive.');
      return;
    }
    books.forEach(b => list.appendChild(bookRow(b, !!localById[b.id], localById[b.id])));
    setStatus(books.length + ' book(s) in your OneDrive.');
  }
  function bookCardShape(r) { return { id: r.id, name: r.name, title: r.title, author: r.author, audio: r.audio, hasTranscript: r.hasTranscript, hasCover: r.hasCover, hasSession: r.hasSession, highlights: r.highlights, percent: r.percent }; }

  function syncLine(rec) {
    if (!rec) return null;
    if (isUnsynced(rec)) return h('div', { class: 'synced warn', text: '● highlights not yet synced · saved ' + fmtAge(rec.sessionSavedAt) });
    if (rec.lastSyncedAt) return h('div', { class: 'synced ok', text: '✓ synced ' + fmtAge(rec.lastSyncedAt) });
    return null;
  }

  function bookRow(b, haveIt, rec) {
    const chips = h('div', { class: 'chips' });
    if (b.audio) chips.appendChild(h('span', { class: 'chip', text: 'audio' }));
    if (b.hasTranscript) chips.appendChild(h('span', { class: 'chip', text: 'sync' }));
    const hlN = (rec && rec.highlights) || 0;
    if (hlN) chips.appendChild(h('span', { class: 'chip', text: hlN + ' hl' }));
    const downloadable = !!b.epub;                       // came from the OneDrive listing (has a real filename)
    const btn = h('button', { class: 'act' + (haveIt ? ' have' : ''), text: haveIt ? '✓ On device' : 'Download' });
    const row = h('div', { class: 'row' }, [
      h('div', { class: 'meta' }, [h('div', { class: 't', text: b.title || b.name }), b.author ? h('div', { class: 'a', text: b.author }) : null, chips, haveIt ? syncLine(rec) : null]),
      btn,
    ]);
    if (!downloadable) { btn.disabled = true; return row; }   // on-device-only shape while disconnected
    btn.addEventListener('click', async () => {
      btn.disabled = true; const label0 = btn.textContent;
      try {
        await odDownloadBook(b, (step) => { btn.textContent = step + '…'; setStatus('Downloading “' + (b.title || b.name) + '” — ' + step + '…'); });
        btn.textContent = '✓ On device'; btn.classList.add('have');
        setStatus('Downloaded “' + (b.title || b.name) + '”. Opening library…');
        if (window.loadLibrary) try { window.loadLibrary(); } catch (e) {}
      } catch (e) {
        btn.disabled = false; btn.textContent = label0;
        setStatus('Download failed: ' + e.message, true);
      }
    });
    return row;
  }

  function buildUI() {
    document.head.appendChild(h('style', { text: css }));
    scrim = h('div', { id: 'tsipad-scrim', onclick: closePanel });
    statusEl = h('div', { class: 'status' });
    persistEl = h('div', { class: 'persist' });
    odHeadEl = h('div');
    panel = h('div', { id: 'tsipad-panel' }, [
      h('h2', { text: '☁ OneDrive' }),
      h('div', { class: 'sub', text: 'Your books, audio and highlights live in OneDrive and stay in sync across every device. Add a book by dropping its .epub + audio into your OneDrive folder — it appears here automatically.' }),
      odHeadEl,
      persistEl,
      h('div', { id: 'tsipad-list', style: 'margin-top:4px' }),
      statusEl,
      h('div', { class: 'bar', style: 'margin-top:14px;border-top:1px solid #322b26;padding-top:12px' }, [
        h('button', { text: '↻ Refresh', onclick: () => buildLibrary() }),
        h('button', { text: '⤓ Export highlights', title: 'Save a backup copy off this device (Files / Mail)', onclick: () => exportHighlights() }),
        h('button', { text: 'Close', onclick: closePanel }),
      ]),
    ]);
    document.body.appendChild(scrim);
    document.body.appendChild(panel);
    fabEl = h('button', { id: 'tsipad-fab', text: '☁ Sync', onclick: openPanel });
    document.body.appendChild(fabEl);
    renderPersistence();
    refreshFabBadge();
    renderOneDrive();
    if (window.TSOneDrive) TSOneDrive.onChange(renderOneDrive);
  }

  /* ---------- boot ---------- */
  async function boot() {
    if ('serviceWorker' in navigator) {
      // Reload once whenever a new SW takes control: on FIRST launch this makes the
      // SW-served /api work immediately; on UPDATES it applies CSS/JS fixes in a
      // single relaunch. No loop — an unchanged SW never re-fires controllerchange,
      // and the flag blocks a double reload within one page load.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (window.__tsReloading) return; window.__tsReloading = true; location.reload();
      });
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        if (reg && reg.update) { try { reg.update(); } catch (e) {} }   // check for updates on launch
      } catch (e) { console.warn('SW register failed', e); }
    }
    // Ask iOS to make storage persistent, and REMEMBER whether it agreed so the
    // Sync panel can warn the user if their highlights are at risk of eviction.
    if (navigator.storage) {
      if (navigator.storage.persisted) { try { storagePersisted = await navigator.storage.persisted(); } catch (e) {} }
      if (!storagePersisted && navigator.storage.persist) { try { storagePersisted = await navigator.storage.persist(); } catch (e) {} }
      if (navigator.storage.estimate) { try { storageEstimate = await navigator.storage.estimate(); } catch (e) {} }
    }
    buildUI();

    // Belt for the last highlight before a hard kill (in addition to the app's beacon).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { flushBelt(); }
      else { refreshFabBadge(); syncOneDrive('foreground'); }
    });
    window.addEventListener('pagehide', flushBelt);
    // Keep the "unsynced" nudge current during a long reading session (the SW stamps
    // sessionSavedAt on every save; recompute the badge from it periodically).
    setInterval(refreshFabBadge, 45000);

    // OneDrive: finish any sign-in redirect, then auto-sync (restore on first connect),
    // and keep syncing on a slow timer. All best-effort; no-op when not connected.
    if (window.TSOneDrive) {
      TSOneDrive.ready.then((r) => {
        renderOneDrive();
        if (r && r.justConnected) syncOneDrive('connect');
        else if (odOn()) syncOneDrive('boot');
      }).catch(() => {});
      setInterval(() => syncOneDrive('timer'), 60000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // expose for debugging / future automation
  window.TSiPad = { metaAll, syncOneDrive, reconcileODBook, odGetSession, odPutSession, odListIds, odListLibrary, odDownloadBook, buildLibrary,
    importBook, reconcileAll, reconcileBook, fetchRemoteBooks };   // last four: legacy Tailscale fallback (dev)
})();
