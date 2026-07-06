# Keymaster client snippets

Zero-dependency license verification you copy into your app — no SDK to install.

| File | Runtime | Use |
|---|---|---|
| [`verify-node.js`](verify-node.js) | Node.js (CJS, `node:crypto`) | Desktop/CLI/Electron apps — includes `machineFingerprint()` and the recommended offline+check-in startup flow |
| [`verify-browser.mjs`](verify-browser.mjs) | Browsers, Deno, Bun, Workers, Node 20+ (WebCrypto) | Web apps / anything with `crypto.subtle` |

Get your public key once from `GET /api/v1/pubkey` (`.key`, SPKI DER base64) and embed it in your app at build time.

The `KM1` key format is documented byte-for-byte in [`../docs/API.md`](../docs/API.md) — implementing verification in Swift/Rust/C#/Go is ~30 lines with any ed25519 library.

**Remember:** offline verification cannot see server-side revocations or seat state. Cache the activation receipt (`KMR1…`) returned by `/api/v1/activate` and check in online periodically (see `exampleStartupCheck` in `verify-node.js`).
