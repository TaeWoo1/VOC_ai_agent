# Cafe24 OAuth callback — minimal HTTPS receiver (local/dev only)

A throwaway endpoint whose **only** job is to receive the one-time Cafe24
`authorization_code` redirect during gated live verification and confirm that
`code` and `state` arrived. It does **not** exchange the code, store it, or log any
secret. Separate from the SellerOps backend/collector — nothing here deploys them.

Callback path (always): **`/cafe24/callback`**

> **Not the product callback.** This dev receiver's path (`/cafe24/callback`) is
> deliberately different from the SellerOps product endpoint
> (`GET /api/connect/cafe24/callback`, which *does* exchange the code and persist the
> credential). They are two separate things: this tool only confirms the redirect
> arrived during a gated live check; the product backend owns the real flow. Register
> whichever redirect URI matches the target you are testing — never mix the two.

## Safety guarantees (both options)
- Shows **only** booleans: was `code` received, was `state` received.
- Never displays/logs values: no `client_secret`, `refresh_token`, `access_token`,
  `mall_id`, `order` IDs, customer data, raw payloads, or `req.url`.
- **Does not exchange the authorization code.** Token exchange stays a separate,
  local, manual step of the gated live-run procedure (kept outside this repo, not an
  in-repo protocol document).

---

## Option 1 (preferred) — local server + HTTPS tunnel

```sh
# 1. start the local receiver (HTTP, localhost only)
PORT=8787 PUBLIC_BASE_URL=https://<TUNNEL_HOST> node server.mjs

# 2. in another shell, expose it over HTTPS (pick one)
ngrok http 8787
#   -> Forwarding https://<TUNNEL_HOST>  ->  http://127.0.0.1:8787
cloudflared tunnel --url http://127.0.0.1:8787
#   -> https://<TUNNEL_HOST>.trycloudflare.com
```

Take the tunnel's HTTPS host, set it as `PUBLIC_BASE_URL`, and restart `server.mjs`
so the page prints the correct Redirect URI. The tunnel terminates TLS and forwards
to the local HTTP listener — Cafe24 only ever sees HTTPS.

## Option 2 — Vercel / Render (no tunnel)

- **Vercel:** deploy the `vercel/` folder. `api/cafe24/callback.js` is the function;
  `vercel.json` rewrites `/cafe24/callback` → it so the public path is exact. Set
  `PUBLIC_BASE_URL=https://<YOUR_VERCEL_APP>.vercel.app` in project env.
- **Render:** deploy `server.mjs` as a Node web service with `HOST=0.0.0.0`
  (Render injects `PORT`). Set `PUBLIC_BASE_URL=https://<service>.onrender.com`.
  Public URL → `https://<service>.onrender.com/cafe24/callback`.

---

## The exact HTTPS Redirect URI to register

```
https://<TUNNEL_OR_DEPLOY_HOST>/cafe24/callback
```

Replace the host with your tunnel/deploy host. The running endpoint prints this
exact string (from `PUBLIC_BASE_URL`) on startup and on the callback page.

## One Redirect URI, three places — must be byte-identical

The same string (scheme, host, port if any, path, no trailing slash) must be used in:

1. **Cafe24 Developers** → app settings → Redirect URI(s).
2. The **authorize URL** `redirect_uri=...` the mall operator opens.
3. The **token-exchange** `redirect_uri=...` in the local code→token POST.

Any mismatch → Cafe24 rejects the authorize or token call.

---

## Scope of this tool
- Local/dev verification aid only; not part of the product runtime.
- No Cafe24 calls, no token exchange, no credential writes, no DB, no PR.
- Use placeholders for all real hosts/IDs/secrets until the gated run is approved.
