/* ============================================================
   Transcript Studio — iPad PWA service worker.

   Makes the UNTOUCHED app/ front-end run fully OFFLINE by:
     (1) precaching the app shell + vendored epub.js/jszip, so the
         app opens with the PC turned off, and
     (2) shimming every /api/* endpoint the app calls — books list,
         epub, audio (with HTTP Range/206 for seeking), transcript,
         cover, and session read/write — out of ON-DEVICE storage:
         OPFS holds the book files, IndexedDB holds per-book metadata.

   The PC's server.js is NEVER contacted from here. Pulling books onto
   the device is a separate, explicit action handled by ts-ipad.js,
   which talks to the import source under /pcsource/* (passed straight
   through to the network by the fetch handler below).

   __CACHE_NAME__ / __PRECACHE__ are filled in by scripts/build-ipad.js.
   ============================================================ */
const CACHE = "ts-ipad-v1784252932493";
const PRECACHE = ["/","/.nojekyll","/audio.js","/autosave.js","/extras.js","/fonts/dmsans-rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2","/fonts/dmsans-rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu6-K6h9Q.woff2","/fonts/fonts.css","/fonts/inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2","/fonts/inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2","/fonts/inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2","/fonts/inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2","/fonts/inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2","/fonts/inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7SUc.woff2","/fonts/inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7SUc.woff2","/fonts/lora-0QIhMX1D_JOuMw_LIftL.woff2","/fonts/lora-0QIhMX1D_JOuMw_LJftLp_A.woff2","/fonts/lora-0QIhMX1D_JOuMw_LLPtLp_A.woff2","/fonts/lora-0QIhMX1D_JOuMw_LL_tLp_A.woff2","/fonts/lora-0QIhMX1D_JOuMw_LLvtLp_A.woff2","/fonts/lora-0QIhMX1D_JOuMw_LT_tLp_A.woff2","/fonts/lora-0QIhMX1D_JOuMw_LXftLp_A.woff2","/fonts/lora-0QIvMX1D_JOuM2T7I-NP.woff2","/fonts/lora-0QIvMX1D_JOuM3b7I-NP.woff2","/fonts/lora-0QIvMX1D_JOuMw77I-NP.woff2","/fonts/lora-0QIvMX1D_JOuMwT7I-NP.woff2","/fonts/lora-0QIvMX1D_JOuMwX7I-NP.woff2","/fonts/lora-0QIvMX1D_JOuMwf7I-NP.woff2","/fonts/lora-0QIvMX1D_JOuMwr7Iw.woff2","/fonts/merriweather-u-4c0qyriQwlOrhSvowK_l5-eTxCVx0ZbwLvKH2Gk9hLmp0v5yA-xXPqCzLvF--drGGj.woff2","/fonts/merriweather-u-4c0qyriQwlOrhSvowK_l5-eTxCVx0ZbwLvKH2Gk9hLmp0v5yA-xXPqCzLvF-SdrGGj.woff2","/fonts/merriweather-u-4c0qyriQwlOrhSvowK_l5-eTxCVx0ZbwLvKH2Gk9hLmp0v5yA-xXPqCzLvF-WdrGGj.woff2","/fonts/merriweather-u-4c0qyriQwlOrhSvowK_l5-eTxCVx0ZbwLvKH2Gk9hLmp0v5yA-xXPqCzLvF-adrGGj.woff2","/fonts/merriweather-u-4c0qyriQwlOrhSvowK_l5-eTxCVx0ZbwLvKH2Gk9hLmp0v5yA-xXPqCzLvF-udrA.woff2","/fonts/merriweather-u-4e0qyriQwlOrhSvowK_l5UcA6zuSYEqOzpPe3HOZJ5eX1WtLaQwmYiSeqkJ-mFqA.woff2","/fonts/merriweather-u-4e0qyriQwlOrhSvowK_l5UcA6zuSYEqOzpPe3HOZJ5eX1WtLaQwmYiSeqlJ-mFqA.woff2","/fonts/merriweather-u-4e0qyriQwlOrhSvowK_l5UcA6zuSYEqOzpPe3HOZJ5eX1WtLaQwmYiSeqnJ-mFqA.woff2","/fonts/merriweather-u-4e0qyriQwlOrhSvowK_l5UcA6zuSYEqOzpPe3HOZJ5eX1WtLaQwmYiSeqqJ-k.woff2","/fonts/merriweather-u-4e0qyriQwlOrhSvowK_l5UcA6zuSYEqOzpPe3HOZJ5eX1WtLaQwmYiSequJ-mFqA.woff2","/fonts/playfairdisplay-nuFiD-vYSZviVYUb_rj3ij__anPXDTLYgFE_.woff2","/fonts/playfairdisplay-nuFiD-vYSZviVYUb_rj3ij__anPXDTPYgFE_.woff2","/fonts/playfairdisplay-nuFiD-vYSZviVYUb_rj3ij__anPXDTjYgFE_.woff2","/fonts/playfairdisplay-nuFiD-vYSZviVYUb_rj3ij__anPXDTzYgA.woff2","/fonts/playfairdisplay-nuFkD-vYSZviVYUb_rj3ij__anPXDTnogkk7.woff2","/fonts/playfairdisplay-nuFkD-vYSZviVYUb_rj3ij__anPXDTnohkk72xU.woff2","/fonts/playfairdisplay-nuFkD-vYSZviVYUb_rj3ij__anPXDTnojEk72xU.woff2","/fonts/playfairdisplay-nuFkD-vYSZviVYUb_rj3ij__anPXDTnojUk72xU.woff2","/fonts/sourceserif4-vEFF2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6kA3r4cXk.woff2","/fonts/sourceserif4-vEFF2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6kAHr4cXk.woff2","/fonts/sourceserif4-vEFF2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6kAnr4cXk.woff2","/fonts/sourceserif4-vEFF2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6kCXr4cXk.woff2","/fonts/sourceserif4-vEFF2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6kDXr4.woff2","/fonts/sourceserif4-vEFF2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6kDnr4cXk.woff2","/fonts/sourceserif4-vEFH2_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US0r-aX2AzA.woff2","/fonts/sourceserif4-vEFH2_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US0r0aX2AzA.woff2","/fonts/sourceserif4-vEFH2_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US0r1aX2AzA.woff2","/fonts/sourceserif4-vEFH2_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US0r3aX2AzA.woff2","/fonts/sourceserif4-vEFH2_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US0r5aX2AzA.woff2","/fonts/sourceserif4-vEFH2_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US0r6aX0.woff2","/highlights.js","/icons/apple-touch-icon.png","/icons/icon-192.png","/icons/icon-512-maskable.png","/icons/icon-512.png","/index.html","/media.js","/onedrive.js","/panel.js","/popout.html","/popout.js","/popsync.js","/reader.js","/settings.js","/style.css","/themes.js","/touch.css","/touch.js","/ts-ipad.js","/util.js","/vendor/epubjs/epub.js","/vendor/epubjs/epub.js.map","/vendor/epubjs/epub.legacy.js","/vendor/epubjs/epub.legacy.min.js","/vendor/epubjs/epub.min.js","/vendor/jszip/jszip.js","/vendor/jszip/jszip.min.js"];
const IDB_NAME = 'ts-ipad';
const IDB_VER = 1;

/* ---------------- IndexedDB: per-book metadata ---------------- */
function idb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(IDB_NAME, IDB_VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
function idbGet(store, key) {
  return idb().then(db => new Promise((res, rej) => {
    const rq = db.transaction(store, 'readonly').objectStore(store).get(key);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  }));
}
function idbAll(store) {
  return idb().then(db => new Promise((res, rej) => {
    const rq = db.transaction(store, 'readonly').objectStore(store).getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  }));
}
function idbPut(store, val) {
  return idb().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  }));
}

/* ---------------- OPFS: book file storage ---------------- */
async function opfsDir(parts, create) {
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: !!create });
  return dir;
}
async function opfsGetFile(parts) {
  try {
    const dir = await opfsDir(parts.slice(0, -1), false);
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: false });
    return await fh.getFile();
  } catch (e) { return null; }
}
async function opfsWrite(parts, data) {
  const dir = await opfsDir(parts.slice(0, -1), true);
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const bytes = data instanceof Uint8Array ? data
    : (data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(String(data)));
  // Safari only exposes createWritable in workers for newer versions but always
  // supports the sync access handle in a worker (the SW IS a worker) — prefer it.
  // syncAccessHandle writes with an explicit flush() proved durable (page-side
  // createWritable writes were evicted under storage pressure; these were not).
  if (fh.createSyncAccessHandle) {
    const h = await fh.createSyncAccessHandle();
    try { h.truncate(0); h.write(bytes, { at: 0 }); h.flush(); } finally { h.close(); }
  } else {
    const w = await fh.createWritable();
    await w.write(bytes); await w.close();
  }
}
// Stream a fetch Response body into an OPFS file via the durable sync access
// handle, chunk by chunk, so a multi-GB audiobook never buffers in memory.
async function opfsWriteStream(parts, response) {
  const dir = await opfsDir(parts.slice(0, -1), true);
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  if (fh.createSyncAccessHandle && response.body && response.body.getReader) {
    const h = await fh.createSyncAccessHandle();
    try {
      h.truncate(0);
      let at = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        h.write(value, { at }); at += value.byteLength;
      }
      h.flush();
    } finally { h.close(); }
  } else if (response.body && response.body.pipeTo) {
    const w = await fh.createWritable();
    await response.body.pipeTo(w);
  } else {
    await opfsWrite(parts, new Uint8Array(await response.arrayBuffer()));
  }
}

/* ---------------- HTTP helpers ---------------- */
function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Serve a File with HTTP Range support so <audio> can seek in a multi-GB m4b
// exactly like it would against express' sendFile on the PC.
function rangeResponse(file, request, mime) {
  if (!file) return new Response('not found', { status: 404 });
  const size = file.size;
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] === '' ? NaN : parseInt(m[1], 10);
      let end = m[2] === '' ? NaN : parseInt(m[2], 10);
      if (isNaN(start)) { const n = isNaN(end) ? 0 : end; start = Math.max(0, size - n); end = size - 1; }
      else if (isNaN(end)) { end = size - 1; }
      if (end >= size) end = size - 1;
      if (start > end || start >= size || start < 0) {
        return new Response(null, { status: 416, headers: Object.assign({}, base, { 'Content-Range': 'bytes */' + size }) });
      }
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: Object.assign({}, base, {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
          'Content-Length': String(end - start + 1),
        }),
      });
    }
  }
  return new Response(file, { status: 200, headers: Object.assign({}, base, { 'Content-Length': String(size) }) });
}

/* ---------------- /api/* shim ---------------- */
function bookToCard(r) {
  return {
    id: r.id, name: r.name || r.id, epub: 'book.epub',
    audio: r.audio ? (r.audioName || 'audio') : null,
    hasTranscript: !!r.hasTranscript, hasAligned: false, hasSession: !!r.hasSession,
    title: r.title || r.name || r.id, author: r.author || '',
    hasCover: !!r.hasCover, highlights: r.highlights || 0,
    percent: typeof r.percent === 'number' ? r.percent : null,
  };
}

async function apiBooks() {
  const recs = await idbAll('books');
  recs.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  return jsonResp({ books: recs.map(bookToCard) });
}
async function apiDiag() {
  const recs = await idbAll('books');
  return jsonResp({
    booksDir: 'On-device storage (OPFS)', exists: true,
    entries: recs.map(r => r.id), folders: recs.length,
    error: null, onedrive: false, ipad: true,
  });
}
async function apiKind(id, kind, request) {
  const rec = await idbGet('books', id);
  if (kind === 'epub') return rangeResponse(await opfsGetFile(['books', id, 'book.epub']), request, 'application/epub+zip');
  if (kind === 'audio') return rangeResponse(await opfsGetFile(['books', id, 'audio']), request, (rec && rec.audioMime) || 'audio/mpeg');
  if (kind === 'transcript') return rangeResponse(await opfsGetFile(['books', id, 'transcript.json']), request, 'application/json');
  if (kind === 'aligned') return rangeResponse(await opfsGetFile(['books', id, 'aligned.json']), request, 'application/json');
  if (kind === 'session') return rangeResponse(await opfsGetFile(['books', id, 'session.json']), request, 'application/json');
  return new Response('bad kind', { status: 400 });
}
async function apiCover(id, request) {
  const rec = await idbGet('books', id);
  return rangeResponse(await opfsGetFile(['books', id, 'cover']), request, (rec && rec.coverMime) || 'image/jpeg');
}
async function apiSaveSession(id, request) {
  let data = {};
  try { data = await request.json(); }
  catch (e) { try { data = JSON.parse(await request.text()); } catch (_) { data = {}; } }
  const markdown = typeof data.markdown === 'string' ? data.markdown : null;
  if (markdown != null) delete data.markdown;
  data.savedAt = data.savedAt || Date.now();
  try {
    await opfsWrite(['books', id, 'session.json'], JSON.stringify(data, null, 2));
    if (markdown != null) await opfsWrite(['books', id, 'highlights.md'], markdown);
    const rec = (await idbGet('books', id)) || { id, name: id };
    rec.hasSession = true;
    rec.highlights = (data.highlights ? Object.keys(data.highlights).length : 0) +
                     (Array.isArray(data.wordHighlights) ? data.wordHighlights.length : 0);
    if (data.position && typeof data.position.percent === 'number') rec.percent = data.position.percent;
    rec.sessionSavedAt = data.savedAt;
    await idbPut('books', rec);
  } catch (e) { return jsonResp({ ok: false, error: String(e) }, 500); }
  return jsonResp({ ok: true, savedAt: data.savedAt });
}

async function handleApi(request, url) {
  const p = url.pathname;
  if (request.method === 'GET') {
    if (p === '/api/books') return apiBooks();
    if (p === '/api/diag') return apiDiag();
    let m = p.match(/^\/api\/book\/([^/]+)\/cover$/);
    if (m) return apiCover(decodeURIComponent(m[1]), request);
    m = p.match(/^\/api\/book\/([^/]+)\/([^/]+)$/);
    if (m) return apiKind(decodeURIComponent(m[1]), m[2], request);
    return new Response('not found', { status: 404 });
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    const m = p.match(/^\/api\/book\/([^/]+)\/session$/);
    if (m) return apiSaveSession(decodeURIComponent(m[1]), request);
  }
  return new Response('bad request', { status: 400 });
}

/* ---------------- Shell caching ---------------- */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (e) {
    if (request.mode === 'navigate') {
      const idx = (await cache.match('/index.html')) || (await cache.match('/'));
      if (idx) return idx;
    }
    return new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

/* ---------------- Lifecycle ---------------- */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'skipWaiting') { self.skipWaiting(); return; }
  if (d && d.type === 'import-book') { e.waitUntil(importBookSW(d, e.ports && e.ports[0])); }
});

// Durable import: the SW (a worker) pulls each book file from the source URL and
// writes it via the sync access handle. Called by ts-ipad.js so imports survive
// storage pressure that evicts page-side createWritable output.
async function importBookSW(d, port) {
  const id = d.id, urls = d.urls || {}, meta = d.meta || {};
  const post = (m) => { try { port && port.postMessage(m); } catch (e) {} };
  const rec = { id, name: meta.name || id, title: meta.title || meta.name || id, author: meta.author || '', importedAt: meta.now || 0 };
  async function pull(url, name) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(name + ' ' + r.status); await opfsWriteStream(['books', id, name], r); return r; }
  try {
    post({ step: 'epub' }); await pull(urls.epub, 'book.epub');
    if (urls.audio) { post({ step: 'audio' }); const r = await pull(urls.audio, 'audio'); rec.audio = true; rec.audioName = meta.audioName || 'audio'; rec.audioMime = meta.audioMime || r.headers.get('content-type') || 'audio/mpeg'; }
    if (urls.transcript) { post({ step: 'transcript' }); try { await pull(urls.transcript, 'transcript.json'); rec.hasTranscript = true; } catch (e) {} }
    if (urls.cover) { try { const r = await pull(urls.cover, 'cover'); rec.hasCover = true; rec.coverMime = r.headers.get('content-type') || 'image/jpeg'; } catch (e) {} }
    if (urls.session) {
      post({ step: 'highlights' });
      try {
        const r = await fetch(urls.session, { cache: 'no-store' });
        if (r.ok) {
          const txt = await r.text();
          await opfsWrite(['books', id, 'session.json'], txt);
          const s = JSON.parse(txt);
          rec.hasSession = true;
          rec.highlights = (s.highlights ? Object.keys(s.highlights).length : 0) + (Array.isArray(s.wordHighlights) ? s.wordHighlights.length : 0);
          rec.percent = s.position && typeof s.position.percent === 'number' ? s.position.percent : null;
          rec.sessionSavedAt = s.savedAt || 0;
        }
      } catch (e) {}
    }
    if (rec.highlights == null) rec.highlights = meta.highlights || 0;
    if (rec.percent == null && typeof meta.percent === 'number') rec.percent = meta.percent;
    await idbPut('books', rec);
    post({ done: true, rec });
  } catch (e) { post({ error: String(e && e.message || e) }); }
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;      // cross-origin → network
  if (url.pathname.startsWith('/pcsource/')) return;    // import source → network
  if (url.pathname.startsWith('/api/')) { e.respondWith(handleApi(req, url)); return; }
  if (req.method !== 'GET') return;
  e.respondWith(cacheFirst(req));
});
