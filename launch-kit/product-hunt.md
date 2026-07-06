# Product Hunt Launch — Keymaster

## Name
Keymaster

## Tagline (60 chars)
Self-hosted license keys for your software. Pay once. (51)

## Description (260 chars)
Sell software without giving Gumroad 10% forever. Keymaster is a self-hosted license server: ed25519-signed keys your app verifies offline, seat limits with machine fingerprints, signed expiring downloads, activation webhooks. $49 once, runs on a $5 VPS. (253)

## Full description

Every "licensing as a service" option quietly becomes your most expensive dependency. Keygen.sh starts at $99/month. Gumroad takes 10% + 50¢ of every sale. LemonSqueezy takes 5%. Forever.

Keymaster is the alternative: a license server you own.

**What it does**
- Issues ed25519-signed license keys (`KM1.…`) that your desktop or web app can verify **completely offline** — the keypair is generated on your server, you own it
- Activation API with machine fingerprints and seat limits (2-seat license = 2 machines, deactivate to move), versioned under `/api/v1`
- Signed activation receipts so your app keeps working on planes and in air-gapped offices
- Versioned product downloads behind signed URLs that expire in 15 minutes
- HMAC-signed webhooks on every activation/deactivation, with retries and a delivery log
- A no-login customer portal: paste your key, see your seats, download the latest build
- Drop-in zero-dependency verification snippets for Node and browsers, and the key format is documented byte-for-byte so you can port it to Swift, Rust, C#, whatever

**What it doesn't do**
Payments. Wire your Stripe/Whop webhook to the admin API with the 20-line recipe in the docs and email keys on purchase.

Dark-mode React dashboard, SQLite storage, Docker one-liner, MIT source. Runs as a desktop app for local key authoring or on a $5 VPS for production.

$49 once. If you sell $10k/year of software, Gumroad's cut is $1,000+ — every year.

## Maker first comment

Hey PH 👋

I sell small desktop tools, and I got tired of the math: 10% of every Gumroad sale, or $99/mo for Keygen before I'd sold a single copy that month. Licensing felt like the last thing indie devs were still forced to rent.

So I built Keymaster the way I always wished it worked: one binary-ish Node app on my VPS, an ed25519 keypair that *I* control, and a key format simple enough to document byte-for-byte (canonical JSON + signature, base64url). My apps verify keys offline in ~15 lines with no SDK. Seat limits work off a machine fingerprint hash. Downloads go through expiring signed URLs so my build artifacts aren't just… public.

Honesty corner, because licensing tools love to overpromise: offline validation can't see revocations — that's physics, not a bug. Keymaster handles it with signed activation receipts + periodic online check-ins with a grace period, and the docs are upfront about the tradeoff.

I'm dogfooding it as the license backend for my own product suite. Source is MIT on GitHub; the paid version is the 1-click packaged installer.

Would love to hear what language snippets you'd want next (Swift and C# are top of my list). 🔑

## Gallery shots (5)

1. **Dashboard** — stat tiles (licenses, active seats, downloads) over the 30-day activation bar chart, dark UI. Caption: "Your licensing business at a glance."
2. **License table + issue modal** — masked keys with copy buttons, status pills, the bulk-issue modal open. Caption: "Issue 1 or 1,000 keys in one click."
3. **Key format diagram** — annotated `KM1.<payload>.<signature>` breakdown with the canonical JSON payload and "verifiable offline with your public key". Caption: "A key format you can implement in any language."
4. **Snippet code shot** — `verify-node.js` usage: verifyLicense + machineFingerprint + activate call. Caption: "Integrate in 20 lines. No SDK."
5. **License detail drawer + customer portal side-by-side** — activations with per-machine deactivate buttons; the customer-facing portal page. Caption: "Seat management for you, a no-login portal for them."
