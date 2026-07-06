# Keymaster API v1

Stable, versioned licensing API. Everything under `/api/v1/` is public (CORS-enabled, rate-limited) — your shipped apps call it directly. Admin endpoints live under `/api/admin/` behind a session cookie.

Base URL examples below assume `https://licenses.example.com`.

---

## The KM1 key format (byte-for-byte)

A license key is three dot-separated parts:

```
KM1.<base64url(payload)>.<base64url(signature)>
```

| Part | Content |
|---|---|
| `KM1` | Literal prefix, version 1 of the format |
| payload | Canonical JSON (see below), UTF-8, base64url (RFC 4648 §5, **no padding**) |
| signature | Ed25519 signature over the **exact payload bytes** (the base64url-decoded second part), base64url, no padding |

### Payload fields

```json
{ "i": 1767225600, "l": "a1b2c3d4e5f6", "p": "my-app", "s": 2, "t": "pro" }
```

| Field | Type | Meaning |
|---|---|---|
| `l` | string | License id (12 hex chars) — the DB primary key |
| `p` | string | Product slug |
| `t` | string | Tier (free-text: `standard`, `pro`, …) |
| `s` | number | Seat limit |
| `i` | number | Issued at, unix seconds |
| `e` | number | Expires at, unix seconds — **omitted entirely for perpetual licenses** |

Customer email is deliberately **not** embedded (keys get pasted into support tickets).

### Canonical JSON

Signatures are computed over canonical JSON: **keys sorted lexicographically (recursively), no whitespace**. If you re-serialize the payload in another language, you must reproduce this exactly:

```
{"i":1767225600,"l":"a1b2c3d4e5f6","p":"my-app","s":2,"t":"pro"}
```

### Verifying offline (any language)

1. Split on `.` — expect 3 parts, part 1 = `KM1`.
2. Base64url-decode part 2 → payload bytes. Parse as JSON.
3. Base64url-decode part 3 → 64-byte Ed25519 signature.
4. Verify the signature over the **raw payload bytes** (not re-serialized JSON) with the server's public key.
5. If `payload.e` exists and `now > e` → expired.

The public key is served at `GET /api/v1/pubkey` as SPKI DER base64 (and PEM). Embed it in your app at build time. Reference implementations: [`snippets/verify-node.js`](../snippets/verify-node.js) (Node, zero-dep) and [`snippets/verify-browser.mjs`](../snippets/verify-browser.mjs) (WebCrypto).

> **Honest limitation:** offline verification proves authenticity + expiry only. It cannot see server-side **revocations** or **seat counts**. Ship a periodic online `POST /api/v1/validate` check-in with a grace period — the snippet's `exampleStartupCheck` shows the pattern.

### Activation receipts (KMR1)

`POST /api/v1/activate` returns a signed receipt with the same construction, prefix `KMR1`:

```json
{ "a": 1767225600, "f": "<fingerprint>", "l": "a1b2c3d4e5f6", "u": 1769817600 }
```

`u` = check-in window end (30 days). Cache the receipt; while it verifies and `now < u` (+ your grace period), let the app run offline.

---

## Public endpoints

### `GET /api/health`
`{ "ok": true, "app": "keymaster", "version": 1 }`

### `GET /api/v1/pubkey`
```json
{ "alg": "ed25519", "format": "spki-der-base64", "key": "MCowBQYDK2Vw…", "pem": "-----BEGIN PUBLIC KEY-----…" }
```

### `POST /api/v1/activate`
```json
{ "license_key": "KM1.…", "fingerprint": "<=128 chars>", "hostname": "optional", "app_version": "optional" }
```
- **200** `{ ok, valid: true, idempotent, receipt: "KMR1.…", license: { id, product, tier, seats, seats_used, expires_at } }`
  - Re-activating an already-active fingerprint is idempotent (`idempotent: true`, no extra seat, no webhook).
- **400** `{ valid:false, reason: "malformed" | "invalid_signature" }` — bad key
- **403** `reason: "revoked" | "expired" | "seat_limit"` (seat_limit includes `seats`, `seats_used`)
- **404** `reason: "unknown_license"` — signature fine but this server never issued it
- **429** `reason: "rate_limited"`

### `POST /api/v1/deactivate`
`{ "license_key", "fingerprint" }` → **200** `{ ok, freed, seats_used }`. Frees the seat; works even on revoked/expired licenses.

### `POST /api/v1/validate`
`{ "license_key", "fingerprint"? }` — lightweight check-in.
- **200** `{ ok, valid: true, seat_held, product, tier, seats, seats_used, expires_at }` (`seat_held` is null if no fingerprint sent; sending one refreshes `last_seen`)
- **400/403/404** same shapes as activate.

### `GET|POST /api/v1/download`
Params/body: `{ "license_key", "version"? }` (default: latest semver).
- **POST 200** `{ ok, url, version, expires_at }` — `url` is a signed link valid for `DOWNLOAD_TTL` seconds (default 900).
- **GET** → **302** straight to the signed URL (used by the customer portal button).

### `GET /dl/:token`
Streams the artifact (`Content-Disposition: attachment`) or 302s to the version's external URL. Token is HMAC-SHA256-signed and expiring: **403** invalid, **410** expired. This is the *only* route to artifacts — `data/artifacts/` is never served statically. Each hit is logged to `download_events`.

### `GET /license/:key`
Human-friendly customer portal page: status, seats used, download-latest button. No account needed — the key is the credential.

---

## Webhooks

Set a per-product webhook URL (admin UI → product → webhook). On events, Keymaster POSTs:

```json
{ "event": "activation" | "deactivation" | "validation_failed" | "test", "license": "<license id>", "fingerprint": "…", "ts": 1767225600, "reason": "only on validation_failed" }
```

Headers: `Content-Type: application/json`, `X-Keymaster-Signature: <hex HMAC-SHA256 of the raw body, keyed with the product's webhook secret>`.

Verify like:

```js
const ok = crypto.timingSafeEqual(
  Buffer.from(req.headers['x-keymaster-signature'], 'hex'),
  crypto.createHmac('sha256', SECRET).update(rawBody).digest()
);
```

Delivery: 3 attempts (immediately, +1s, +4s), 8s timeout each; every outcome is visible in the admin Webhooks log.

---

## Admin endpoints (session cookie via `POST /api/admin/login`)

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/login` / `logout` / `GET me` | Session auth (`ADMIN_PASSWORD`) |
| `GET/POST /api/admin/products`, `GET/PUT/DELETE /api/admin/products/:id` | Product CRUD |
| `POST /api/admin/products/:id/versions` | Multipart: `semver`, `notes`, `artifact` file **or** `artifact_url` |
| `DELETE /api/admin/versions/:id` | Remove version + stored artifact |
| `POST /api/admin/products/:id/webhook/test` · `…/webhook/rotate-secret` | Webhook tooling |
| `POST /api/admin/licenses` | Issue — `{ product_id, tier?, seats?, expires_at?, customer_email?, customer_name?, order_ref?, count? }`; `count > 1` bulk-issues and returns an array of full key strings |
| `GET /api/admin/licenses?search=&product_id=` | Search key/email/name/order ref |
| `GET /api/admin/licenses/:id` | Detail + activations + download history |
| `POST /api/admin/licenses/:id/revoke` (`{reason}`) / `unrevoke` | Revocation is server-side state |
| `POST /api/admin/activations/:id/deactivate` | Free a seat from the dashboard |
| `GET /api/admin/webhook-deliveries?product_id=` | Delivery log |
| `GET /api/admin/stats` | Tiles + 30-day activation series |

---

## Recipe: issue keys from a Stripe / Whop webhook

Keymaster deliberately has no checkout integration — wire your payment provider's webhook to the admin API from a tiny relay you host next to it:

```js
// stripe-relay.js — run beside Keymaster; keep ADMIN_PASSWORD in env
app.post('/stripe-hook', async (req, res) => {
  const event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const login = await fetch(`${KEYMASTER}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const lic = await fetch(`${KEYMASTER}/api/admin/licenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ product_id: 1, customer_email: s.customer_details.email, order_ref: s.id })
    }).then((r) => r.json());
    await sendEmail(s.customer_details.email, `Your license key: ${lic.key}\nManage it: ${KEYMASTER}/license/${encodeURIComponent(lic.key)}`);
  }
  res.sendStatus(200);
});
```

Same shape for Whop: listen for `membership.went_valid`, POST to `/api/admin/licenses`, email/DM the key.
