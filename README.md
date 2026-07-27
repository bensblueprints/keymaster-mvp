# 🔑 Keymaster — Self-Hosted License Key Server

## Get the packaged app

Don't want to build from source? Get the signed installer, lifetime updates and setup support for a one-time payment at [onetimesuite.com/keymaster](https://onetimesuite.com/keymaster/) — same app, MIT source right here.

Part of [OneTimeSuite](https://onetimesuite.com) — pay-once alternatives to subscription software.

## Demo



https://github.com/user-attachments/assets/979015ad-b46a-4454-8443-fa7fc14b2e36



[![MIT License](https://img.shields.io/badge/license-MIT-8b5cf6.svg)](LICENSE)

**Pay once. Own it forever. No subscription — and no platform skimming 5–10% off every sale you make.**

Keymaster is a self-hosted licensing server for people who sell software. It issues **ed25519-signed license keys** your apps can verify **completely offline**, enforces **seat limits with machine fingerprints**, delivers your builds through **signed expiring download URLs**, and fires **HMAC-signed webhooks** on every activation. Your keys, your keypair, your VPS.

Keygen.sh starts at **$99/month**. Gumroad takes **10% + 50¢ of every sale**. Keymaster is a one-time purchase that runs on a $5 VPS.

![Keymaster dashboard](docs/screenshot.png)

## Features

- **🔏 Ed25519-signed keys** — `KM1.<payload>.<signature>` format, self-describing and verifiable offline with just the public key. Keypair generated on first boot; you own it.
- **💺 Activation API with seat limits** — machine fingerprints, idempotent re-activation, deactivate to free a seat, signed activation receipts for offline runs. Versioned under `/api/v1` and kept stable.
- **📴 Offline validation snippets** — zero-dependency Node and browser/WebCrypto verifiers in [`snippets/`](snippets/), plus a fingerprint helper and the recommended offline+check-in hybrid flow. Key format documented byte-for-byte in [`docs/API.md`](docs/API.md) so you can port it to any language.
- **📦 Products & versions** — semver releases with artifact upload or external URLs; customers download via **signed URLs that expire in 15 minutes**. Artifacts are never exposed statically.
- **🪝 Activation webhooks** — per-product URL + secret, `X-Keymaster-Signature` (HMAC-SHA256), 3 retries with backoff, full delivery log in the dashboard.
- **🧑‍💼 Admin dashboard** — dark, fast React SPA: stats + activation chart, license search, issue/bulk-issue/revoke, per-activation deactivate, webhook log.
- **🌐 Customer portal** — `/license/<key>` shows status, seats and a download button. No customer accounts to manage.
- **🔒 100% local** — SQLite + Node built-in crypto. No telemetry, no external services.

## Quick start

```bash
npm i
npm run build   # build the admin UI once
npm start       # → http://localhost:5328/admin  (password: admin — set ADMIN_PASSWORD!)
```

**Desktop app mode** (local license authoring):

```bash
npm run desktop
```

Run it as a desktop app, or deploy to a $5 VPS when you need it public — for real customers you want the VPS, since their apps must reach your activation API. With Docker:

```bash
cp .env.example .env   # set ADMIN_PASSWORD + BASE_URL
docker compose up -d
```

> ⚠️ **Back up `data/keys/signing.pem`.** Your license keys verify against this keypair. Lose the private key and you can never issue new keys that pass validation in apps you've already shipped.

## Integrate in 20 lines

```js
// in your app — copy snippets/verify-node.js, embed your pubkey at build time
const { verifyLicense, machineFingerprint } = require('./verify-node.js');
const PUBKEY = 'MCowBQYDK2VwAyEA…'; // GET /api/v1/pubkey → .key

const check = verifyLicense(userKey, PUBKEY);           // instant, offline
if (!check.valid) quit(check.reason);

const res = await fetch('https://licenses.you.com/api/v1/activate', {   // one-time, online
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ license_key: userKey, fingerprint: machineFingerprint() })
});
const { receipt } = await res.json();                   // cache for offline runs
```

Full API reference, webhook signature verification and a Stripe/Whop key-issuing recipe: [`docs/API.md`](docs/API.md).

**Honest note on offline validation:** an offline check proves the key is authentic and unexpired — it *cannot* see revocations or seat counts. The snippets show the recommended pattern: verify offline instantly, check in online periodically, apply a grace period.

## Keymaster vs. the subscription competition

| | **Keymaster** | Keygen.sh | Gumroad licensing | LemonSqueezy |
|---|---|---|---|---|
| Price | **$49 once** | from $99/mo | 10% + 50¢/sale | 5% + 50¢/sale |
| Your own signing keypair | ✅ | ❌ managed | ❌ | ❌ |
| Offline validation | ✅ ed25519 | ✅ | ❌ server-only | ❌ server-only |
| Seat limits + fingerprints | ✅ | ✅ | limited | ✅ |
| Signed expiring downloads | ✅ | ✅ | ✅ | ✅ |
| Self-hosted / your data | ✅ | ❌ | ❌ | ❌ |
| Cost at $10k/yr sales | **$49 total** | $1,188/yr | ~$1,050/yr | ~$550/yr |

## ☕ Skip the setup — get the 1-click installer

Want the packaged, ready-to-run version with a Windows installer and priority support? Grab it on Whop:

**[→ Get Keymaster on Whop](https://whop.com/onetime-suite)**

## Tech stack

Node 20+ · Express · better-sqlite3 (WAL) · ed25519 via `node:crypto` (zero native crypto deps) · React 18 + Vite · Tailwind CSS v4 · Framer Motion · Lucide · Electron desktop wrapper · Docker

## Configuration

| Env | Default | |
|---|---|---|
| `PORT` | `5328` | HTTP port |
| `ADMIN_PASSWORD` | `admin` | Dashboard password — **change it** |
| `BASE_URL` | request host | Public URL used in signed download links |
| `DATA_DIR` | `./data` | SQLite db, `keys/`, `artifacts/` |
| `DOWNLOAD_TTL` | `900` | Signed URL lifetime (seconds) |

## Development & tests

```bash
npm run dev    # Vite dev server on :5329 (proxies API to :5328)
npm test       # full lifecycle smoke test: keys, offline verify, seats,
               # webhook HMAC, signed downloads, revoke, tampered keys
```

## License

[MIT](LICENSE) © 2026 Ben (bensblueprints)
