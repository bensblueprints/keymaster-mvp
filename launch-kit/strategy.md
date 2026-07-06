# Launch Strategy — Keymaster

## Pricing math (lead with this everywhere)

Suggested one-time price: **$49**.

- **Gumroad**: 10% + $0.50/sale. At $10k/yr revenue → **$1,000+/yr forever**. Keymaster pays for itself on your first ~$500 of sales.
- **LemonSqueezy**: 5% + 50¢ → ~$550/yr at $10k. Pays for itself in ~1 month of modest sales.
- **Keygen.sh** self-serve: from **$99/mo** = $1,188/yr → Keymaster pays for itself in **15 days**.

One-liner: *"Selling $10k of software a year? Gumroad's cut is $1,000 — every year. Keymaster is $49, once, on your own VPS, with keys signed by your own keypair."*

## Target communities (rules-aware angles)

- **r/selfhosted** — angle: "I self-hosted the last SaaS in my stack: the license server." Show the Docker compose + dashboard. No pricing talk in the post body (sub is allergic); link the repo, mention MIT. Answer "why not Keygen CE?" honestly (heavier, needs Postgres/Redis; this is one Node process + SQLite).
- **r/SideProject** — build-in-public post: "My side projects now license themselves — I made my license server the product." Screenshots + the offline-verification snippet. Pricing welcome here.
- **r/gamedev** (+ r/IndieDev) — angle: licensing desktop tools/plugins/editors without Steam's cut: seat limits for studio licenses, offline validation for artists' workstations that aren't online. Follow self-promo rules: participate first, post in the weekly threads where required.
- **r/indiehackers / Indie Hackers forum** — the revenue math post: "I calculated what Gumroad's fee costs me over 5 years."
- **r/node** — technical post: "Designing an offline-verifiable license key format with ed25519 and canonical JSON" — teach the format, repo link at the end.

## Hacker News — Show HN draft

**Title:** Show HN: Keymaster – self-hosted license server with offline ed25519 key verification

**Post:**
I sell small desktop tools and didn't want licensing to be a subscription (Keygen starts at $99/mo) or a revenue share (Gumroad takes 10%). So I built a license server I can run on a $5 VPS.

Design notes:
- Keys are `KM1.<base64url(canonical JSON)>.<base64url(ed25519 sig)>` — self-describing, verifiable offline with just the public key. The canonical-JSON rule (sorted keys, no whitespace) is documented byte-for-byte so you can implement verification in any language; zero-dep Node and WebCrypto snippets ship in the repo.
- Activation API enforces seat limits via machine fingerprints (hash of hostname+MAC+platform — a heuristic, and the docs say so). Re-activation is idempotent; deactivation frees the seat.
- Offline validation can't see revocations — that's inherent, so activations return a signed receipt with a check-in window, and the recommended client flow is offline-verify + periodic online validate with a grace period.
- Downloads go through HMAC-signed URLs that expire in 15 minutes; artifacts are never statically served.
- Everything is Node built-in crypto + SQLite; the whole thing is one Express process.

The code is MIT. I'm dogfooding it as the licensing backend for my other products. Happy to talk key-format design tradeoffs — especially payload minimalism vs. embedding entitlements.

## SEO keywords (10)

1. keygen alternative
2. self hosted license server
3. ed25519 license keys
4. software license key generator self hosted
5. license key API
6. offline license validation
7. gumroad licensing alternative
8. sell software license keys
9. machine fingerprint license activation
10. lemonsqueezy license api alternative

## AppSumo / PitchGround pitch

Keymaster gives software sellers what Keygen charges $99/month for — as a one-time purchase they host themselves. It issues cryptographically signed license keys (ed25519) that customers' apps verify completely offline, enforces per-machine seat limits, delivers product updates through expiring signed download URLs, and fires signed webhooks into any stack. Setup is `docker compose up`; data lives in SQLite on the buyer's VPS. LTD buyers are exactly the "pay once, own it" audience this was built for — and every one of them sells software, so the licensing pain is universal. MIT-licensed source builds trust; the deal SKU is the packaged installer + updates + priority support.

## Dogfooding note

The onetime-suite's own premium tiers run on Keymaster (`/api/v1` is stable + versioned). Mention this in every launch: "I trust it enough to gate my own products with it."
