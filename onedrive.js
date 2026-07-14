/* ============================================================
   onedrive.js — OPTIONAL OneDrive cloud sync for the iPad PWA.

   Purpose: make highlights safe in the cloud automatically, so the PC can be off
   forever and a reinstalled iPad restores everything. This module is ONLY the
   auth + transport layer; ts-ipad.js does the actual per-book reconcile using
   these primitives. It is purely additive: with no Client ID / not connected,
   the app behaves exactly as before (local + Tailscale sync).

   Design decisions (from research on iOS-PWA OAuth):
   • Hand-rolled OAuth 2.0 authorization-code + PKCE, PUBLIC client, NO secret.
     Authority https://login.microsoftonline.com/consumers (personal MS accounts).
   • We store the PKCE verifier/state AND the tokens in the **Cache Storage API**,
     which — unlike sessionStorage/localStorage/IndexedDB — is reported to be
     SHARED across iOS's Safari-vs-installed-PWA storage partitions. That is the
     single thing that makes the redirect round-trip survive on iOS, and it is
     exactly what MSAL cannot do (it insists on sessionStorage). This is why we
     hand-roll instead of vendoring MSAL.
   • redirectUri is SAME-ORIGIN (the PWA's own start URL) so iOS keeps the return
     inside the standalone window instead of breaking out to Safari.
   • The SPA refresh token is non-renewable past 24h, so expect a periodic
     interactive reconnect; that only pauses cloud sync, it never loses data.

   Exposes window.TSOneDrive.
   ============================================================ */
(function () {
  'use strict';

  var AUTHORITY = 'https://login.microsoftonline.com/consumers';
  var AUTHZ = AUTHORITY + '/oauth2/v2.0/authorize';
  var TOKEN = AUTHORITY + '/oauth2/v2.0/token';
  var GRAPH = 'https://graph.microsoft.com/v1.0';
  var SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.AppFolder';
  var CACHE = 'ts-onedrive';
  var K_PENDING = location.origin + '/__ts_od_pending';   // Cache Storage keys (never fetched)
  var K_TOKENS = location.origin + '/__ts_od_tokens';
  var LS_CLIENT = 'ts-onedrive-clientid';
  // build-ipad.js replaces this token with the user's Client ID (from TS_ONEDRIVE_CLIENT_ID)
  // so every device ships pre-configured — the user just taps Connect. The Client ID is a
  // PUBLIC identifier (not a secret), safe to bake into the build.
  var BAKED_CLIENT_ID = '__TS_CLIENT_ID__';
  function bakedId() { return (BAKED_CLIENT_ID && BAKED_CLIENT_ID.charAt(0) !== '_') ? BAKED_CLIENT_ID.trim() : ''; }
  function isBaked() { return !!bakedId(); }

  function redirectUri() { return location.origin + '/'; }
  function clientId() { const b = bakedId(); if (b) return b; try { return (localStorage.getItem(LS_CLIENT) || '').trim(); } catch (e) { return ''; } }

  var nav = function (u) { location.assign(u); };   // swappable so tests can capture the URL instead of leaving
  var listeners = [];
  function onChange(cb) { listeners.push(cb); }
  function emit() { listeners.forEach(function (cb) { try { cb(status()); } catch (e) {} }); }

  /* ---------- Cache Storage JSON store (cross-partition on iOS) ---------- */
  async function cacheGet(key) {
    try { const c = await caches.open(CACHE); const r = await c.match(new Request(key)); return r ? await r.json() : null; }
    catch (e) { return null; }
  }
  async function cachePut(key, obj) {
    try { const c = await caches.open(CACHE); await c.put(new Request(key), new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } })); }
    catch (e) {}
  }
  async function cacheDel(key) { try { const c = await caches.open(CACHE); await c.delete(new Request(key)); } catch (e) {} }

  /* ---------- PKCE + base64url ---------- */
  function b64url(bytes) {
    var s = ''; var b = new Uint8Array(bytes);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randB64url(nbytes) { var a = new Uint8Array(nbytes); crypto.getRandomValues(a); return b64url(a); }
  async function sha256b64url(str) {
    var data = new TextEncoder().encode(str);
    var digest = await crypto.subtle.digest('SHA-256', data);
    return b64url(digest);
  }

  /* ---------- token state ---------- */
  var tokens = null;        // { access_token, refresh_token, expires_at, scope }
  var account = null;       // { name, email }
  var needReconnect = false;
  var lastError = '';

  function decodeIdToken(idt) {
    try {
      var payload = idt.split('.')[1];
      var json = decodeURIComponent(atob(payload.replace(/-/g, '+').replace(/_/g, '/')).split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join(''));
      var o = JSON.parse(json);
      return { name: o.name || '', email: o.preferred_username || o.email || '' };
    } catch (e) { return null; }
  }

  async function persistTokens() { await cachePut(K_TOKENS, { tokens: tokens, account: account }); }
  async function loadTokens() {
    var t = await cacheGet(K_TOKENS);
    if (t && t.tokens) { tokens = t.tokens; account = t.account || account; }
  }

  async function exchange(params) {
    params.set('client_id', clientId());
    params.set('redirect_uri', redirectUri());
    var res = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { throw new Error(data.error_description || data.error || ('token ' + res.status)); }
    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || (tokens && tokens.refresh_token) || null,
      expires_at: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
      scope: data.scope || SCOPES,
    };
    if (data.id_token) { var a = decodeIdToken(data.id_token); if (a) account = a; }
    needReconnect = false; lastError = '';
    await persistTokens();
    return tokens;
  }

  // Interactive sign-in: stash PKCE state in Cache Storage, then leave for Microsoft.
  async function connect() {
    if (!clientId()) { lastError = 'Set your Client ID first.'; emit(); return; }
    var verifier = randB64url(48);
    var challenge = await sha256b64url(verifier);
    var state = randB64url(16);
    await cachePut(K_PENDING, { verifier: verifier, state: state, at: Date.now() });
    var q = new URLSearchParams({
      client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(),
      response_mode: 'query', scope: SCOPES, state: state,
      code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    });
    nav(AUTHZ + '?' + q.toString());
  }

  // On page load: if we returned from Microsoft with ?code=…, finish the exchange.
  async function handleRedirect() {
    var qp = new URLSearchParams(location.search);
    var code = qp.get('code'), st = qp.get('state'), err = qp.get('error');
    if (err) { lastError = qp.get('error_description') || err; cleanUrl(); emit(); return false; }
    if (!code) return false;
    var pending = await cacheGet(K_PENDING);
    cleanUrl();
    if (!pending || pending.state !== st) { lastError = 'Sign-in state mismatch (try Connect again).'; emit(); return false; }
    await cacheDel(K_PENDING);
    try {
      var p = new URLSearchParams({ grant_type: 'authorization_code', code: code, code_verifier: pending.verifier });
      await exchange(p);
      emit();
      return true;   // freshly connected — ts-ipad triggers a restore sync
    } catch (e) { lastError = String(e.message || e); needReconnect = true; emit(); return false; }
  }
  function cleanUrl() { try { history.replaceState(null, '', location.pathname); } catch (e) {} }

  async function refresh() {
    if (!tokens || !tokens.refresh_token) { needReconnect = true; return null; }
    try {
      var p = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope: SCOPES });
      await exchange(p);
      return tokens.access_token;
    } catch (e) {
      lastError = 'OneDrive session expired — tap Reconnect.'; needReconnect = true; tokens = null; await persistTokens(); emit();
      return null;
    }
  }

  async function getToken() {
    if (!tokens) await loadTokens();
    if (!tokens) return null;
    if (tokens.expires_at && tokens.expires_at > Date.now() + 5000) return tokens.access_token;
    return await refresh();
  }

  async function disconnect() { tokens = null; account = null; needReconnect = false; await cacheDel(K_TOKENS); await cacheDel(K_PENDING); emit(); }

  /* ---------- Graph transport ---------- */
  async function graphFetch(path, init) {
    var tok = await getToken();
    if (!tok) throw new Error('not-connected');
    init = init || {};
    var headers = Object.assign({}, init.headers || {});
    headers['Authorization'] = 'Bearer ' + tok;
    var res = await fetch(GRAPH + path, Object.assign({}, init, { headers: headers }));
    if (res.status === 401) { // token rejected — force one refresh + retry
      tokens = null; var t2 = await getToken();
      if (!t2) throw new Error('not-connected');
      headers['Authorization'] = 'Bearer ' + t2;
      res = await fetch(GRAPH + path, Object.assign({}, init, { headers: headers }));
    }
    return res;
  }

  function connected() { return !!(tokens && !needReconnect); }
  function status() { return { configured: !!clientId(), connected: connected(), needReconnect: needReconnect, account: account, error: lastError }; }

  // Boot: rehydrate tokens from Cache Storage, then complete any pending redirect.
  var ready = (async function () {
    await loadTokens();
    var fresh = await handleRedirect();
    emit();
    return { justConnected: fresh };
  })();

  window.TSOneDrive = {
    ready: ready,
    configured: function () { return !!clientId(); },
    isBaked: isBaked,
    connected: connected,
    status: status,
    account: function () { return account; },
    getClientId: clientId,
    setClientId: function (id) { try { localStorage.setItem(LS_CLIENT, (id || '').trim()); } catch (e) {} emit(); },
    connect: connect,
    disconnect: disconnect,
    getToken: getToken,
    graphFetch: graphFetch,
    onChange: onChange,
    redirectUri: redirectUri,
    _setNavigate: function (fn) { nav = fn || function (u) { location.assign(u); }; },   // test seam only
  };
})();
