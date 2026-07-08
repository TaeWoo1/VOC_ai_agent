// Vercel/Render serverless alternative to the local tunnel.
// Deploy this single function; its public HTTPS URL + /cafe24/callback is the
// Redirect URI. Same guarantees as server.mjs: reports presence ONLY, never
// exchanges the code, never logs/echoes any value or secret.
//
// vercel.json (sibling) rewrites /cafe24/callback -> this function so the public
// path is exactly /cafe24/callback.

module.exports = function handler(req, res) {
  const q = req.query || {};
  const received = { code: Boolean(q.code), state: Boolean(q.state) };

  // Sanitized: booleans only. Never log req.url / req.query values.
  console.log(`[cafe24-callback] code=${received.code} state=${received.state}`);

  const base = process.env.PUBLIC_BASE_URL || 'https://<YOUR_DEPLOY_HOST>';
  const redirectUri = `${base.replace(/\/+$/, '')}/cafe24/callback`;
  const yn = (b) => (b ? 'YES' : 'NO');

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.status(200).send(
    `<!doctype html><meta charset="utf-8"><title>Cafe24 callback</title>
<body style="font-family:system-ui;max-width:640px;margin:40px auto;line-height:1.55">
<h1>Cafe24 OAuth callback received</h1>
<ul>
  <li>authorization <code>code</code> received: <b>${yn(received.code)}</b></li>
  <li><code>state</code> received: <b>${yn(received.state)}</b></li>
</ul>
<p><b>Values are intentionally not displayed.</b> No token exchange was performed.</p>
<hr><p>Register this exact HTTPS Redirect URI in Cafe24 Developers:</p>
<pre>${redirectUri}</pre>
<p style="color:#666">Must be byte-identical in: Cafe24 Developers app settings ·
authorize URL <code>redirect_uri</code> · token-exchange <code>redirect_uri</code>.</p>
</body>`
  );
};
