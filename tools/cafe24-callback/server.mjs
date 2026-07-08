#!/usr/bin/env node
// Minimal, dependency-free Cafe24 OAuth callback receiver for LOCAL/DEV verification.
//
// What it does:  serves GET /cafe24/callback and reports ONLY whether `code` and
//                `state` arrived (booleans). Nothing else.
// What it never does:  exchange the authorization code, store it, or log/echo any
//                value — no client_secret / refresh_token / access_token / mall_id /
//                order IDs / customer data / raw payloads ever touch this process.
//
// Put an HTTPS tunnel (ngrok or cloudflared) in front of this HTTP listener; the
// tunnel's public origin + /cafe24/callback is the Redirect URI you register.
//
//   PUBLIC_BASE_URL=https://<TUNNEL_HOST> node server.mjs
//   # then:  ngrok http 8787      (or)   cloudflared tunnel --url http://127.0.0.1:8787

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1'; // 127.0.0.1 for a tunnel; 0.0.0.0 for Render
const CALLBACK_PATH = '/cafe24/callback';
// The public HTTPS origin the tunnel/host exposes, e.g. https://abc123.ngrok-free.app
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://<TUNNEL_HOST>';
const REDIRECT_URI = `${PUBLIC_BASE_URL.replace(/\/+$/, '')}${CALLBACK_PATH}`;

function page(received) {
  const yn = (b) => (b ? 'YES' : 'NO');
  return `<!doctype html><meta charset="utf-8"><title>Cafe24 callback</title>
<body style="font-family:system-ui;max-width:640px;margin:40px auto;line-height:1.55">
<h1>Cafe24 OAuth callback received</h1>
<ul>
  <li>authorization <code>code</code> received: <b>${yn(received.code)}</b></li>
  <li><code>state</code> received: <b>${yn(received.state)}</b></li>
</ul>
<p><b>Values are intentionally not displayed.</b> No token exchange was performed.
Read the <code>code</code> and verify <code>state</code> only from your local flow.</p>
<hr>
<p>Register this exact HTTPS Redirect URI in Cafe24 Developers:</p>
<pre>${REDIRECT_URI}</pre>
<p style="color:#666">The same Redirect URI must be byte-identical in all three places:
Cafe24 Developers app settings · the authorize URL <code>redirect_uri</code> ·
the token-exchange <code>redirect_uri</code>.</p>
</body>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname !== CALLBACK_PATH) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  // Presence booleans ONLY. We never read, store, or echo the actual values,
  // and we never log req.url (it carries the code).
  const received = {
    code: url.searchParams.has('code'),
    state: url.searchParams.has('state'),
  };
  console.log(`[cafe24-callback] hit ${CALLBACK_PATH} code=${received.code} state=${received.state}`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(received));
});

server.listen(PORT, HOST, () => {
  console.log(`[cafe24-callback] listening on http://${HOST}:${PORT}${CALLBACK_PATH}`);
  console.log(`[cafe24-callback] Redirect URI to register: ${REDIRECT_URI}`);
  console.log('[cafe24-callback] No token exchange. No secret values logged.');
});
